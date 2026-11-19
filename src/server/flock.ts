/**
 * Chickens: they fall from the sky into a session, then roam the model on their own. A chicken
 * is 2 klossar tall and stands in one cell; it walks to a neighbouring cell on the same level,
 * flutters up one kloss, and hops down any height. A kloss that lands on a chicken is the end of
 * it. Chickens are not part of the model: they never change where klossar land, are never
 * written to .kl, and do not keep a session alive.
 *
 * The flock lives on the server, so every viewer sees the same chickens. It decides each move
 * and tells viewers about it ("walk from here to there in 450 ms"); viewers animate the rest.
 * Chickens are spawned only through the REST API, never through MCP (on purpose: see
 * docs/TRAINER.md).
 */
import { FormatError, SIZES } from "../core/format.ts";
import type { PlacedKloss } from "../core/types.ts";
import type { Model, ModelEvent } from "./model.ts";

export const MAX_CHICKENS = 50;
const MAX_PER_CALL = 10;
const TICK_MS = 100;
/** How far chickens may wander past the model's edges (or around where they landed). */
const LEASH = 5;

const WALK_MS = 450;
const FLUTTER_MS = 700;
const POP_MS = 350;
const fallMs = (levels: number) => 450 + 110 * levels;

export interface Cell {
  x: number;
  y: number;
  level: number;
}

export type MoveKind = "spawn" | "walk" | "flutter" | "fall" | "pop";

export interface ChickenMove {
  id: number;
  kind: MoveKind;
  /** null for a spawn: it comes from the sky. */
  from: Cell | null;
  to: Cell;
  duration: number;
  /** Who spawned it (sent with spawns). */
  by?: string;
}

export interface ChickenInfo extends Cell {
  id: number;
  by?: string;
  /** A move in progress (for viewers that connect late). */
  move?: { kind: MoveKind; from: Cell | null; to: Cell; duration: number; elapsed: number };
}

export type FlockEvent =
  | { type: "moves"; moves: ChickenMove[] }
  | { type: "gone"; id: number; by?: string; dropper?: string; kloss: number };

/** The session already has as many chickens as it may. */
export class FlockFullError extends Error {
  constructor() {
    super(`a session holds at most ${MAX_CHICKENS} chickens`);
    this.name = "FlockFullError";
  }
}

interface Chicken {
  id: number;
  by?: string;
  /** Where it stands, or where its current move ends. */
  at: Cell;
  move?: { kind: MoveKind; from: Cell | null; start: number; end: number };
  nextAt: number;
  home: { x: number; y: number };
  visited: Set<string>;
  lastDir: [number, number];
}

export interface FlockOptions {
  now?: () => number;
  random?: () => number;
  /** Runs `fn` every `ms` until the returned function is called (a timer; tests pass a stub). */
  every?: (ms: number, fn: () => void) => () => void;
}

const OFFSET = 10_100;
const SPAN = 20_400;
const key = (level: number, x: number, y: number) =>
  level * SPAN * SPAN + (x + OFFSET) * SPAN + (y + OFFSET);
const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class Flock {
  private readonly chickens = new Map<number, Chicken>();
  private readonly listeners = new Set<(e: FlockEvent) => void>();
  private solid = new Set<number>();
  private tops = new Map<number, number>();
  private bounds: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private nextId = 1;
  private stopTimer: (() => void) | null = null;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly every: (ms: number, fn: () => void) => () => void;

  constructor(
    private readonly model: Model,
    opts: FlockOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.every =
      opts.every ??
      ((ms, fn) => {
        const t = setInterval(fn, ms);
        t.unref?.();
        return () => clearInterval(t);
      });
    this.rebuild();
    model.subscribe((e) => this.onModel(e));
  }

  subscribe(fn: (e: FlockEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: FlockEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  get size(): number {
    return this.chickens.size;
  }

  // --- the world as chickens see it --------------------------------------------------------------

  private rebuild(): void {
    this.solid = new Set();
    this.tops = new Map();
    this.bounds = null;
    for (const k of this.model.klossar) this.addSolid(k);
  }

  private addSolid(k: PlacedKloss): void {
    const { w, d } = SIZES[k.size];
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < d; j++) {
        this.solid.add(key(k.level, k.x + i, k.y + j));
        const col = key(0, k.x + i, k.y + j);
        this.tops.set(col, Math.max(this.tops.get(col) ?? 0, k.level + 1));
      }
    }
    const b = this.bounds ?? { x0: k.x, y0: k.y, x1: k.x + w, y1: k.y + d };
    this.bounds = {
      x0: Math.min(b.x0, k.x),
      y0: Math.min(b.y0, k.y),
      x1: Math.max(b.x1, k.x + w),
      y1: Math.max(b.y1, k.y + d),
    };
  }

  private isSolid(level: number, x: number, y: number): boolean {
    return level >= 0 && this.solid.has(key(level, x, y));
  }

  private top(x: number, y: number): number {
    return this.tops.get(key(0, x, y)) ?? 0;
  }

  /** A chicken fits here: two free levels, on something (or the floor). */
  private canStand(c: Cell): boolean {
    return (
      !this.isSolid(c.level, c.x, c.y) &&
      !this.isSolid(c.level + 1, c.x, c.y) &&
      (c.level === 0 || this.isSolid(c.level - 1, c.x, c.y))
    );
  }

  /** Where a chicken at `from` ends up stepping to (nx, ny), or null when it cannot. */
  private stepTo(from: Cell, nx: number, ny: number): Cell | null {
    const L = from.level;
    if (!this.isSolid(L, nx, ny) && !this.isSolid(L + 1, nx, ny)) {
      let k = L;
      while (k > 0 && !this.isSolid(k - 1, nx, ny)) k--;
      return { x: nx, y: ny, level: k };
    }
    if (
      this.isSolid(L, nx, ny) &&
      !this.isSolid(L + 1, nx, ny) &&
      !this.isSolid(L + 2, nx, ny) &&
      !this.isSolid(L + 2, from.x, from.y)
    ) {
      return { x: nx, y: ny, level: L + 1 };
    }
    return null;
  }

  private allowed(c: Chicken, x: number, y: number): boolean {
    const b = this.bounds;
    if (b && x >= b.x0 - LEASH && x < b.x1 + LEASH && y >= b.y0 - LEASH && y < b.y1 + LEASH) {
      return true;
    }
    return Math.hypot(x - c.home.x, y - c.home.y) <= LEASH + 1;
  }

  /** Cells taken by other chickens: where they stand, or where they are going. */
  private taken(except?: number): Set<string> {
    const out = new Set<string>();
    for (const c of this.chickens.values()) {
      if (c.id === except) continue;
      out.add(`${c.at.x},${c.at.y}`);
    }
    return out;
  }

  /** Where a chicken is right now: in the air while spawning, else nearer its move's start or end. */
  private where(c: Chicken, now: number): Cell | null {
    if (!c.move) return c.at;
    if (c.move.kind === "spawn") return null;
    const halfway = (c.move.start + c.move.end) / 2;
    return now < halfway && c.move.from ? c.move.from : c.at;
  }

  // --- spawning ----------------------------------------------------------------------------------

  /** Drops chickens from the sky, near (x, y) or else near the model. */
  spawn(o: { count?: number; x?: number; y?: number; by?: string }): ChickenInfo[] {
    const count = o.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > MAX_PER_CALL) {
      throw new FormatError(`count must be a whole number from 1 to ${MAX_PER_CALL}`);
    }
    for (const v of [o.x, o.y]) {
      if (v !== undefined && (!Number.isInteger(v) || Math.abs(v) > 10_000)) {
        throw new FormatError("x and y must be whole numbers from -10000 to 10000");
      }
    }
    if (this.chickens.size + count > MAX_CHICKENS) throw new FlockFullError();
    const b = this.bounds;
    const cx = o.x ?? (b ? Math.floor((b.x0 + b.x1) / 2) : 0);
    const cy = o.y ?? (b ? Math.floor((b.y0 + b.y1) / 2) : 0);
    const now = this.now();
    const taken = this.taken();
    const radius = 1.5 + Math.sqrt(count) * 1.2;
    const moves: ChickenMove[] = [];
    for (let n = 0; n < count; n++) {
      let x = cx;
      let y = cy;
      for (let tries = 0; tries < 30; tries++) {
        const a = this.random() * Math.PI * 2;
        const r = this.random() * radius;
        x = Math.round(cx + Math.cos(a) * r);
        y = Math.round(cy + Math.sin(a) * r);
        if (!taken.has(`${x},${y}`)) break;
      }
      taken.add(`${x},${y}`);
      const to: Cell = { x, y, level: this.top(x, y) };
      const duration = Math.round(2_800 + this.random() * 1_200);
      const c: Chicken = {
        id: this.nextId++,
        at: to,
        move: { kind: "spawn", from: null, start: now, end: now + duration },
        nextAt: now + duration,
        home: { x, y },
        visited: new Set(),
        lastDir: DIRS[Math.floor(this.random() * 4)] as [number, number],
      };
      if (o.by) c.by = o.by;
      this.chickens.set(c.id, c);
      const move: ChickenMove = { id: c.id, kind: "spawn", from: null, to, duration };
      if (o.by) move.by = o.by;
      moves.push(move);
    }
    this.emit({ type: "moves", moves });
    this.stopTimer ??= this.every(TICK_MS, () => this.step());
    return moves.map((m) => this.info(this.chickens.get(m.id) as Chicken, now));
  }

  // --- living --------------------------------------------------------------------------------------

  /** One tick: finished moves settle, and chickens that have rested choose where to go next. */
  step(): void {
    const now = this.now();
    const moves: ChickenMove[] = [];
    for (const c of this.chickens.values()) {
      if (c.move && now >= c.move.end) {
        c.move = undefined;
        c.visited.add(`${c.at.x},${c.at.y}`);
        if (c.visited.size > 40) c.visited.delete(c.visited.values().next().value as string);
        const fix = this.settle(c, now);
        if (fix) moves.push(fix);
        else c.nextAt = now + 300 + this.random() * 1_400;
      }
      if (!c.move && now >= c.nextAt) {
        const m = this.choose(c, now);
        if (m) moves.push(m);
        else c.nextAt = now + 600;
      }
    }
    if (moves.length) this.emit({ type: "moves", moves });
  }

  private begin(c: Chicken, kind: MoveKind, to: Cell, duration: number, now: number): ChickenMove {
    const from = c.at;
    c.at = to;
    c.move = { kind, from, start: now, end: now + duration };
    return { id: c.id, kind, from, to, duration };
  }

  private choose(c: Chicken, now: number): ChickenMove | null {
    const taken = this.taken(c.id);
    const here = c.at;
    const outside = !this.allowed(c, here.x, here.y);
    const b = this.bounds;
    const centre = b ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : c.home;
    let best: { to: Cell; dir: [number, number]; score: number } | null = null;
    for (const dir of DIRS) {
      const nx = here.x + dir[0];
      const ny = here.y + dir[1];
      if (taken.has(`${nx},${ny}`)) continue;
      if (!this.allowed(c, nx, ny)) {
        // a chicken outside its range may only head back
        const closer =
          Math.hypot(nx - centre.x, ny - centre.y) <
          Math.hypot(here.x - centre.x, here.y - centre.y);
        if (!(outside && closer)) continue;
      }
      const to = this.stepTo(here, nx, ny);
      if (!to) continue;
      const score =
        this.random() +
        (c.visited.has(`${nx},${ny}`) ? 0 : 1.2) +
        (dir[0] === c.lastDir[0] && dir[1] === c.lastDir[1] ? 0.6 : 0);
      if (!best || score > best.score) best = { to, dir, score };
    }
    if (!best) return null;
    c.lastDir = best.dir;
    const up = best.to.level - here.level;
    const kind: MoveKind = up === 0 ? "walk" : up === 1 || up === -1 ? "flutter" : "fall";
    const duration = kind === "walk" ? WALK_MS : kind === "flutter" ? FLUTTER_MS : fallMs(-up);
    return this.begin(c, kind, best.to, duration, now);
  }

  /** A chicken that is inside something pops up; one with nothing under it falls down. */
  private settle(c: Chicken, now: number): ChickenMove | null {
    if (this.canStand(c.at)) return null;
    const { x, y, level } = c.at;
    if (this.isSolid(level, x, y) || this.isSolid(level + 1, x, y)) {
      let k = level;
      while (!this.canStand({ x, y, level: k })) k++;
      return this.begin(c, "pop", { x, y, level: k }, POP_MS, now);
    }
    let k = level;
    while (k > 0 && !this.isSolid(k - 1, x, y)) k--;
    return this.begin(c, "fall", { x, y, level: k }, fallMs(level - k), now);
  }

  private onModel(e: ModelEvent): void {
    if (e.type === "deleted") {
      this.chickens.clear();
      this.stopTimer?.();
      this.stopTimer = null;
      return;
    }
    if (e.type === "drop") {
      this.addSolid(e.kloss);
      this.hit(e.kloss);
    } else {
      this.rebuild();
    }
    // anyone standing still where the world changed settles at once
    const now = this.now();
    const moves: ChickenMove[] = [];
    for (const c of this.chickens.values()) {
      if (c.move) continue;
      const m = this.settle(c, now);
      if (m) moves.push(m);
    }
    if (moves.length) this.emit({ type: "moves", moves });
  }

  /** A kloss that lands where a chicken is (its feet or its head) is the end of that chicken. */
  private hit(k: PlacedKloss): void {
    const { w, d } = SIZES[k.size];
    const now = this.now();
    for (const c of [...this.chickens.values()]) {
      const at = this.where(c, now);
      if (!at) continue;
      const under = at.x >= k.x && at.x < k.x + w && at.y >= k.y && at.y < k.y + d;
      if (!under || k.level > at.level + 1 || k.level < at.level) continue;
      this.chickens.delete(c.id);
      const gone: FlockEvent = { type: "gone", id: c.id, kloss: k.index };
      if (c.by) gone.by = c.by;
      if (k.by) gone.dropper = k.by;
      this.emit(gone);
    }
    if (this.chickens.size === 0) {
      this.stopTimer?.();
      this.stopTimer = null;
    }
  }

  // --- reading -----------------------------------------------------------------------------------

  private info(c: Chicken, now: number): ChickenInfo {
    const out: ChickenInfo = { id: c.id, ...c.at };
    if (c.by) out.by = c.by;
    if (c.move && now < c.move.end) {
      out.move = {
        kind: c.move.kind,
        from: c.move.from,
        to: c.at,
        duration: c.move.end - c.move.start,
        elapsed: now - c.move.start,
      };
    }
    return out;
  }

  /** Every chicken, where it is or is going (with any move in progress). */
  list(): ChickenInfo[] {
    const now = this.now();
    return [...this.chickens.values()].map((c) => this.info(c, now));
  }
}
