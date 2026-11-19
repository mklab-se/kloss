/**
 * One session's model, in memory. Every change is synchronous, so concurrent requests can never
 * interleave inside one: drops land in the order they arrive.
 */
import { FormatError, formatModel, parseLine, parseModel } from "../core/format.ts";
import { HeightMap, placeAll } from "../core/landing.ts";
import { optimize } from "../core/optimize.ts";
import { type KlossInput, MAX_KLOSSAR, type PlacedKloss } from "../core/types.ts";

export type ModelEvent =
  | { type: "model"; klossar: PlacedKloss[]; note?: string }
  | { type: "drop"; kloss: PlacedKloss }
  | { type: "undo"; kloss: PlacedKloss; klossar: PlacedKloss[] }
  | { type: "deleted" };

export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

/** Nothing to undo, or the last kloss belongs to someone else. */
export class UndoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndoError";
  }
}

function tooMany(): LimitError {
  return new LimitError(`a model holds at most ${MAX_KLOSSAR} klossar`);
}

function heightsOf(klossar: readonly KlossInput[]): HeightMap {
  const map = new HeightMap();
  for (const k of klossar) map.place(k);
  return map;
}

export class Model {
  private placed: PlacedKloss[] = [];
  private heights = new HeightMap();
  private readonly listeners = new Set<(e: ModelEvent) => void>();
  /** When the model last changed (ms). */
  lastChange: number;

  constructor(private readonly now: () => number = Date.now) {
    this.lastChange = now();
  }

  /** A model built from .kl text. Throws FormatError (with the line) or LimitError. */
  static from(text: string, now?: () => number, by?: string): Model {
    const m = new Model(now);
    m.load(text, by);
    return m;
  }

  get klossar(): readonly PlacedKloss[] {
    return this.placed;
  }

  /** The model as formatted .kl text (compact, lined up). */
  text(): string {
    return formatModel(this.placed);
  }

  subscribe(fn: (e: ModelEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: ModelEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private load(text: string, by?: string): PlacedKloss[] {
    const inputs = parseModel(text);
    if (inputs.length > MAX_KLOSSAR) throw tooMany();
    this.placed = placeAll(inputs).map((k) => (by ? { ...k, by } : k));
    this.heights = heightsOf(this.placed);
    this.lastChange = this.now();
    return this.placed;
  }

  drop(k: KlossInput, by?: string): PlacedKloss {
    if (this.placed.length >= MAX_KLOSSAR) throw tooMany();
    // only what a drop says; never carry an index, level or author over from elsewhere
    const input: KlossInput = { size: k.size, color: k.color, x: k.x, y: k.y };
    const kloss: PlacedKloss = {
      index: this.placed.length,
      ...input,
      level: this.heights.place(input),
    };
    if (by) kloss.by = by;
    this.placed = [...this.placed, kloss];
    this.lastChange = this.now();
    this.emit({ type: "drop", kloss });
    return kloss;
  }

  /** Drops a kloss written as a line (`x,y|size|color`, `5,1`, `.`). */
  dropLine(text: string, by?: string): PlacedKloss {
    const k = parseLine(text, { last: this.placed.at(-1) });
    if (!k) throw new FormatError('expected a kloss line like "2,0|2x4|blue"');
    return this.drop(k, by);
  }

  /**
   * Takes back the most recent kloss (always safe: nothing has landed on it yet). With an
   * author, only the one who dropped it may take it back.
   */
  undo(by?: string): PlacedKloss {
    const last = this.placed.at(-1);
    if (!last) throw new UndoError("there is nothing to undo: the model is empty");
    if (by && last.by && last.by !== by) {
      throw new UndoError(`the last kloss was dropped by ${last.by}; only they can undo it`);
    }
    this.placed = this.placed.slice(0, -1);
    this.heights = heightsOf(this.placed);
    this.lastChange = this.now();
    this.emit({ type: "undo", kloss: last, klossar: this.placed });
    return last;
  }

  /**
   * Merges klossar into bigger ones where the model looks and stands exactly the same (see
   * core/optimize.ts). With `preview`, only reports what it would do.
   */
  optimize(preview = false): { before: number; after: number; merges: number; applied: boolean } {
    const inputs = this.placed.map(({ index: _i, level: _l, ...k }) => k);
    const r = optimize(inputs);
    const applied = !preview && r.merges > 0;
    if (applied) {
      this.placed = placeAll(r.klossar);
      this.heights = heightsOf(this.placed);
      this.lastChange = this.now();
      const note = `Optimized: ${r.before} → ${r.after} klossar`;
      this.emit({ type: "model", klossar: this.placed, note });
    }
    return { before: r.before, after: r.after, merges: r.merges, applied };
  }

  /** Replaces the whole model. Validates everything first; on error nothing changes. */
  replace(text: string, by?: string): PlacedKloss[] {
    const inputs = parseModel(text);
    if (inputs.length > MAX_KLOSSAR) throw tooMany();
    const placed = this.load(text, by);
    this.emit({ type: "model", klossar: placed });
    return placed;
  }
}
