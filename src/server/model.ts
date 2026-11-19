/**
 * One session's model, in memory. Every change is synchronous, so concurrent requests can never
 * interleave inside one: drops land in the order they arrive.
 */
import { FormatError, formatModel, parseLine, parseModel } from "../core/format.ts";
import { HeightMap, placeAll } from "../core/landing.ts";
import { type KlossInput, MAX_KLOSSAR, type PlacedKloss } from "../core/types.ts";

export type ModelEvent =
  | { type: "model"; klossar: PlacedKloss[] }
  | { type: "drop"; kloss: PlacedKloss }
  | { type: "deleted" };

export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
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
    const kloss: PlacedKloss = { index: this.placed.length, ...k, level: this.heights.place(k) };
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

  /** Replaces the whole model. Validates everything first; on error nothing changes. */
  replace(text: string, by?: string): PlacedKloss[] {
    const inputs = parseModel(text);
    if (inputs.length > MAX_KLOSSAR) throw tooMany();
    const placed = this.load(text, by);
    this.emit({ type: "model", klossar: placed });
    return placed;
  }
}
