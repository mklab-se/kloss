/**
 * The model being served: kept in memory, persisted to its `.kl` file. Every change goes
 * through one queue, so concurrent drops land (and are written) in the order they arrive.
 */
import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
import { coordWidth, FormatError, formatLine, parseLine, parseModel } from "../core/format.ts";
import { HeightMap, placeAll } from "../core/landing.ts";
import { type KlossInput, MAX_KLOSSAR, type PlacedKloss } from "../core/types.ts";

export type ModelEvent =
  | { type: "model"; klossar: PlacedKloss[] }
  | { type: "drop"; kloss: PlacedKloss };

export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

function tooMany(): LimitError {
  return new LimitError(`a model holds at most ${MAX_KLOSSAR} klossar`);
}

export class ModelStore {
  private placed: PlacedKloss[];
  private heights: HeightMap;
  private endsWithNewline: boolean;
  /** Coordinate width that lines appends up with the file. */
  private width: number;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(e: ModelEvent) => void>();

  private constructor(
    readonly path: string,
    text: string,
    inputs: KlossInput[],
  ) {
    this.placed = placeAll(inputs);
    this.heights = ModelStore.heightsOf(this.placed);
    this.endsWithNewline = text === "" || text.endsWith("\n");
    this.width = coordWidth(inputs);
  }

  private static heightsOf(klossar: readonly KlossInput[]): HeightMap {
    const map = new HeightMap();
    for (const k of klossar) map.place(k);
    return map;
  }

  /** Opens (or creates) a model file. Throws FormatError for an invalid file. */
  static async open(path: string): Promise<ModelStore> {
    let text = "";
    try {
      text = await readFile(path, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      await writeFile(path, "");
    }
    const inputs = parseModel(text);
    if (inputs.length > MAX_KLOSSAR) throw tooMany();
    return new ModelStore(path, text, inputs);
  }

  get klossar(): readonly PlacedKloss[] {
    return this.placed;
  }

  text(): Promise<string> {
    return readFile(this.path, "utf8");
  }

  subscribe(fn: (e: ModelEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: ModelEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => {});
    return run;
  }

  drop(k: KlossInput): Promise<PlacedKloss> {
    return this.enqueue(() => this.append(k));
  }

  /**
   * Drops a kloss written as a line (`x,y|size|color`, `5,1`, `.`). A left-out size or color
   * comes from the last kloss in the model, resolved in the queue so concurrent drops each see
   * the one dropped just before them.
   */
  dropLine(text: string): Promise<PlacedKloss> {
    return this.enqueue(async () => {
      const k = parseLine(text, { last: this.placed.at(-1) });
      if (!k) throw new FormatError('expected a kloss line like "2,0|2x4|blue"');
      return this.append(k);
    });
  }

  /** Appends in compact form (what repeats is left out), lined up with the rest of the file. */
  private async append(k: KlossInput): Promise<PlacedKloss> {
    if (this.placed.length >= MAX_KLOSSAR) throw tooMany();
    const prefix = this.endsWithNewline ? "" : "\n";
    const width = Math.max(this.width, coordWidth([k]));
    await appendFile(this.path, `${prefix}${formatLine(k, this.placed.at(-1), width)}\n`);
    this.endsWithNewline = true;
    this.width = width;
    const kloss: PlacedKloss = { index: this.placed.length, ...k, level: this.heights.place(k) };
    this.placed = [...this.placed, kloss];
    this.emit({ type: "drop", kloss });
    return kloss;
  }

  /** Replaces the whole model. Validates everything first; on error nothing changes. */
  replace(text: string): Promise<PlacedKloss[]> {
    return this.enqueue(async () => {
      const inputs = parseModel(text);
      if (inputs.length > MAX_KLOSSAR) throw tooMany();
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, text);
      await rename(tmp, this.path);
      this.placed = placeAll(inputs);
      this.heights = ModelStore.heightsOf(this.placed);
      this.endsWithNewline = text === "" || text.endsWith("\n");
      this.width = coordWidth(inputs);
      this.emit({ type: "model", klossar: this.placed });
      return this.placed;
    });
  }
}
