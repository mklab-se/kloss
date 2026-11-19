/**
 * The chickens in the viewer. The server decides where each one goes; this follows its moves
 * (chicken-motion.ts), adds what only matters to the eye (legs that walk, wings that flap, a
 * peck now and then, a squash on landing), and plays a burst of feathers when a kloss lands on
 * one: at the moment the falling kloss reaches it, not before.
 */
import {
  DoubleSide,
  type Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
} from "three";
import { buildChicken, CHICKEN_HEIGHT, type ChickenParts } from "./chicken-model.ts";
import { type Cell, cellPoint, type Move, poseAt } from "./chicken-motion.ts";
import type { KlossScene } from "./scene.ts";

export interface ChickenInfo extends Cell {
  id: number;
  by?: string;
  move?: Move & { elapsed: number };
}

export interface ChickenMoveEvent extends Move {
  id: number;
  by?: string;
}

/** Asks the drop animation where a kloss's underside is now: null once it has landed. */
export type KlossBottom = (index: number) => number | null;

interface Chicken {
  id: number;
  parts: ChickenParts;
  cell: Cell;
  move?: { m: Move; start: number };
  facing: number;
  seed: number;
  phase: number;
  peckStart: number;
  nextPeck: number;
  landedAt: number;
  /** A kloss is on its way down onto it. */
  doomed?: number;
  /** Called when it bursts. */
  onBurst?: () => void;
  last: { x: number; y: number; z: number };
}

interface Burst {
  start: number;
  puffs: Mesh[];
  feathers: { mesh: Mesh; v: Vector3; spin: Vector3 }[];
  puffMaterial: MeshStandardMaterial;
  featherMaterial: MeshStandardMaterial;
  origin: Vector3;
}

const PECK_MS = 600;
const BURST_MS = 2_400;

export class Chickens {
  private readonly chickens = new Map<number, Chicken>();
  private readonly bursts: Burst[] = [];
  private readonly puffGeometry = new IcosahedronGeometry(0.3, 1);
  private readonly featherGeometry = new PlaneGeometry(0.34, 0.13);
  private last = 0;

  constructor(
    private readonly view: KlossScene,
    private readonly bottomOf: KlossBottom,
  ) {}

  get count(): number {
    return this.chickens.size;
  }

  /** Every chicken, as the server has them now (on connect). */
  reset(list: ChickenInfo[], now: number): void {
    for (const c of this.chickens.values()) this.view.scene.remove(c.parts.root);
    this.chickens.clear();
    for (const info of list) {
      const c = this.add(info.id, info, now);
      if (info.move) {
        const { elapsed, ...m } = info.move;
        c.move = { m, start: now - elapsed };
      }
    }
    this.view.requestRender();
  }

  private add(id: number, cell: Cell, now: number): Chicken {
    const parts = buildChicken();
    const p = cellPoint(cell);
    parts.root.position.set(p.x, p.y, p.z);
    this.view.scene.add(parts.root);
    const c: Chicken = {
      id,
      parts,
      cell: { x: cell.x, y: cell.y, level: cell.level },
      facing: (id * 2.39996) % (Math.PI * 2),
      seed: id * 1.618,
      phase: 0,
      peckStart: -1e9,
      nextPeck: now + 1_000 + Math.random() * 3_000,
      landedAt: -1e9,
      last: p,
    };
    this.chickens.set(id, c);
    return c;
  }

  /** Moves from the server: spawns, walks, flutters, falls and pops. */
  apply(moves: ChickenMoveEvent[], now: number): void {
    for (const ev of moves) {
      const { id, by: _by, ...m } = ev;
      const c = this.chickens.get(id) ?? this.add(id, m.to, now);
      if (c.doomed !== undefined) continue;
      c.move = { m, start: now };
      c.cell = m.to;
    }
    this.view.requestRender();
  }

  /**
   * A kloss is landing on chicken `id`: it stops, and bursts when the kloss reaches it (then
   * `onBurst` is called).
   */
  doom(id: number, klossIndex: number, onBurst?: () => void): void {
    const c = this.chickens.get(id);
    if (!c) return;
    c.doomed = klossIndex;
    c.move = undefined;
    if (onBurst) c.onBurst = onBurst;
  }

  /** Advances every chicken and burst. Returns true while there is anything to animate. */
  update(now: number): boolean {
    const dt = Math.min(0.1, Math.max(0, (now - (this.last || now)) / 1000));
    this.last = now;
    for (const c of [...this.chickens.values()]) {
      if (c.doomed !== undefined) {
        const bottom = this.bottomOf(c.doomed);
        if (bottom === null || bottom <= c.last.y + CHICKEN_HEIGHT) {
          this.burst(c, now);
          continue;
        }
      }
      this.pose(c, now, dt);
    }
    this.updateBursts(now, dt);
    const busy = this.chickens.size > 0 || this.bursts.length > 0;
    if (busy) this.view.requestRender();
    return busy;
  }

  private pose(c: Chicken, now: number, dt: number): void {
    const { parts } = c;
    let walking = false;
    let flapping = false;
    let p = c.last;
    if (c.move) {
      const t = (now - c.move.start) / Math.max(1, c.move.m.duration);
      const pose = poseAt(c.move.m, t, c.seed);
      p = pose;
      walking = pose.walking;
      flapping = pose.flapping;
      if (pose.facing !== undefined) c.facing = pose.facing;
      if (t >= 1) {
        if (c.move.m.kind !== "walk") c.landedAt = now;
        c.move = undefined;
        p = cellPoint(c.cell);
      }
    } else if (c.doomed === undefined) {
      p = cellPoint(c.cell);
      if (now >= c.nextPeck) {
        c.peckStart = now;
        c.nextPeck = now + 1_500 + Math.random() * 4_000;
      }
    }
    c.last = p;
    c.phase += dt * (walking ? 14 : flapping ? 30 : 0);
    const swing = walking ? Math.sin(c.phase) * 0.6 : 0;
    parts.legs[0].rotation.x = swing;
    parts.legs[1].rotation.x = -swing;
    const wing = flapping ? 0.25 + 0.7 * Math.abs(Math.sin(c.phase)) : 0.02;
    parts.wings[0].rotation.z = -wing;
    parts.wings[1].rotation.z = wing;
    const pk = (now - c.peckStart) / PECK_MS;
    parts.head.rotation.x = pk >= 0 && pk < 1 ? Math.max(0, Math.sin(Math.PI * pk * 2)) * 0.9 : 0;
    const bob = walking ? Math.abs(Math.sin(c.phase)) * 0.06 : 0;
    parts.root.position.set(p.x, p.y + bob, p.z);
    // turn smoothly toward where it faces
    const root: Group = parts.root;
    const diff = Math.atan2(
      Math.sin(c.facing - root.rotation.y),
      Math.cos(c.facing - root.rotation.y),
    );
    root.rotation.y += diff * Math.min(1, dt * 10);
    const s = Math.max(0, 1 - (now - c.landedAt) / 200);
    const squash = Math.sin(Math.PI * (1 - s)) * s > 0 ? Math.sin(Math.PI * (1 - s)) : 0;
    root.scale.set(1 + 0.1 * squash, 1 - 0.18 * squash, 1 + 0.1 * squash);
  }

  private burst(c: Chicken, now: number): void {
    c.onBurst?.();
    this.view.scene.remove(c.parts.root);
    this.chickens.delete(c.id);
    const puffMaterial = new MeshStandardMaterial({
      color: "#ffffff",
      roughness: 1,
      transparent: true,
      depthWrite: false,
    });
    const featherMaterial = new MeshStandardMaterial({
      color: "#f7f4ec",
      roughness: 0.8,
      transparent: true,
      side: DoubleSide,
    });
    const origin = new Vector3(c.last.x, c.last.y + 1.1, c.last.z);
    const puffs = Array.from({ length: 9 }, () => {
      const m = new Mesh(this.puffGeometry, puffMaterial);
      this.view.scene.add(m);
      return m;
    });
    const feathers = Array.from({ length: 14 }, () => {
      const mesh = new Mesh(this.featherGeometry, featherMaterial);
      mesh.position.copy(origin);
      mesh.castShadow = true;
      this.view.scene.add(mesh);
      return {
        mesh,
        v: new Vector3(
          (Math.random() - 0.5) * 4,
          2.5 + Math.random() * 3,
          (Math.random() - 0.5) * 4,
        ),
        spin: new Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      };
    });
    this.bursts.push({ start: now, puffs, feathers, puffMaterial, featherMaterial, origin });
  }

  private updateBursts(now: number, dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i] as Burst;
      const t = (now - b.start) / 1000;
      const pt = Math.min(1, t / 0.7);
      const eo = 1 - (1 - pt) ** 3;
      b.puffMaterial.opacity = 0.85 * (1 - pt) ** 1.5;
      b.featherMaterial.opacity = Math.max(0, 1 - Math.max(0, t - 1.2) / 1.2);
      b.puffs.forEach((m, j) => {
        const a = (j / b.puffs.length) * Math.PI * 2;
        const r = 0.5 + 1.3 * eo;
        m.position.set(
          b.origin.x + Math.cos(a) * r,
          b.origin.y + 0.8 * eo,
          b.origin.z + Math.sin(a) * r,
        );
        m.scale.setScalar(0.5 + eo);
        m.visible = pt < 1;
      });
      for (const f of b.feathers) {
        f.v.y -= 4.5 * dt;
        f.v.multiplyScalar(1 - 1.8 * dt);
        f.v.y = Math.max(f.v.y, -0.9);
        f.mesh.position.addScaledVector(f.v, dt);
        f.mesh.rotation.x += f.spin.x * dt;
        f.mesh.rotation.y += f.spin.y * dt;
        f.mesh.rotation.z += f.spin.z * dt;
      }
      if (now - b.start > BURST_MS) {
        this.view.scene.remove(...b.puffs, ...b.feathers.map((f) => f.mesh));
        b.puffMaterial.dispose();
        b.featherMaterial.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  /** All chickens gone (the session was removed). */
  clear(): void {
    for (const c of this.chickens.values()) this.view.scene.remove(c.parts.root);
    this.chickens.clear();
    this.view.requestRender();
  }
}
