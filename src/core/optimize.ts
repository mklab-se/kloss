/**
 * Optimizing a model: klossar of the same color, on the same level, side by side, that together
 * form an existing size exactly are merged into one bigger kloss, again and again until nothing
 * more fits. The model must look and stand exactly the same afterwards.
 *
 * A model is a drop order, so a merged kloss has to take the place in the order of one of the two
 * it replaces. Say `a` was dropped before `b`. Dropping the merged kloss where `a` was is exact
 * when nothing dropped between the two touches `b`'s columns: then `b`'s cells were already free
 * of everything that came between, so the merged kloss lands on the same level and everything
 * after lands as before. If something in between does touch `b`'s columns, it would now land on
 * the merged kloss instead, so that place is ruled out. The same holds the other way round for
 * dropping it where `b` was. That check looks only at a few columns, never at the whole model, so
 * a model of thousands of klossar optimizes quickly.
 */
import { SIZES } from "./format.ts";
import { placeAll } from "./landing.ts";
import type { KlossInput, Size } from "./types.ts";

export interface OptimizeResult<T extends KlossInput> {
  klossar: T[];
  before: number;
  after: number;
  merges: number;
  /**
   * For each new kloss, the indices of the old klossar it was made from. The first is the old
   * kloss at the new one's corner (it stays; the others go). Unchanged klossar list only themselves.
   */
  from: number[][];
}

interface Item<T> {
  k: T;
  level: number;
  /** Its place in the drop order (an old index; a merged kloss takes one of its parts' places). */
  key: number;
  from: number[];
  alive: boolean;
}

// numeric keys for cells and columns: coordinates are within ±10000, plus a footprint
const OFFSET = 10_010;
const SPAN = 20_032;
const column = (x: number, y: number) => (x + OFFSET) * SPAN + (y + OFFSET);
const cell = (level: number, x: number, y: number) => level * SPAN * SPAN + column(x, y);

function sizeOf(w: number, d: number): Size | undefined {
  const s = `${w}x${d}`;
  return Object.hasOwn(SIZES, s) ? (s as Size) : undefined;
}

export function optimize<T extends KlossInput>(inputs: readonly T[]): OptimizeResult<T> {
  const placed = placeAll([...inputs]);
  const items: Item<T>[] = inputs.map((k, n) => ({
    k,
    level: placed[n]?.level ?? 0,
    key: n,
    from: [n],
    alive: true,
  }));
  /** Which item fills each cell (level, x, y). */
  const cells = new Map<number, number>();
  /** Which items stand in each column (x, y), at any level. */
  const columns = new Map<number, number[]>();

  const eachCell = (it: Item<T>, fn: (x: number, y: number) => boolean | undefined): boolean => {
    const { w, d } = SIZES[it.k.size];
    for (let i = 0; i < w; i++)
      for (let j = 0; j < d; j++) if (fn(it.k.x + i, it.k.y + j) === false) return false;
    return true;
  };
  const add = (id: number) => {
    const it = items[id] as Item<T>;
    eachCell(it, (x, y) => {
      cells.set(cell(it.level, x, y), id);
      const c = columns.get(column(x, y));
      if (c) c.push(id);
      else columns.set(column(x, y), [id]);
      return true;
    });
  };
  const remove = (id: number) => {
    const it = items[id] as Item<T>;
    it.alive = false;
    eachCell(it, (x, y) => {
      cells.delete(cell(it.level, x, y));
      const c = columns.get(column(x, y)) as number[];
      c.splice(c.indexOf(id), 1);
      return true;
    });
  };
  /** True when nothing dropped strictly between `lo` and `hi` stands in `of`'s columns. */
  const clearBetween = (lo: number, hi: number, of: Item<T>) =>
    eachCell(of, (x, y) => {
      for (const id of columns.get(column(x, y)) ?? []) {
        const key = (items[id] as Item<T>).key;
        if (key > lo && key < hi) return false;
      }
      return true;
    });

  /** Merges `id` with a neighbour if it can; returns the merged item's id, or -1. */
  const mergeFrom = (id: number): number => {
    const a = items[id] as Item<T>;
    const { w, d } = SIZES[a.k.size];
    for (const along of ["x", "y"] as const) {
      const m =
        along === "x"
          ? cells.get(cell(a.level, a.k.x + w, a.k.y))
          : cells.get(cell(a.level, a.k.x, a.k.y + d));
      if (m === undefined || m === id) continue;
      const b = items[m] as Item<T>;
      if (b.k.color !== a.k.color) continue;
      const bs = SIZES[b.k.size];
      const fits =
        along === "x"
          ? b.k.x === a.k.x + w && b.k.y === a.k.y && bs.d === d
          : b.k.y === a.k.y + d && b.k.x === a.k.x && bs.w === w;
      if (!fits) continue;
      const size = along === "x" ? sizeOf(w + bs.w, d) : sizeOf(w, d + bs.d);
      if (!size) continue;
      const [early, late] = a.key < b.key ? [a, b] : [b, a];
      // drop it where the first of the two was dropped, or else where the second was
      let key: number | undefined;
      if (clearBetween(early.key, late.key, late)) key = early.key;
      else if (clearBetween(early.key, late.key, early)) key = late.key;
      if (key === undefined) continue;
      remove(id);
      remove(m);
      items.push({
        k: { ...a.k, size },
        level: a.level,
        key,
        from: [...a.from, ...b.from],
        alive: true,
      });
      add(items.length - 1);
      return items.length - 1;
    }
    return -1;
  };

  items.forEach((_, id) => {
    add(id);
  });
  let merges = 0;
  // pass after pass, from the back corner outwards (so rows pair up from their start: 1+2, 3+4),
  // until a pass merges nothing
  for (let changed = true; changed; ) {
    changed = false;
    const order = items
      .map((_, id) => id)
      .filter((id) => (items[id] as Item<T>).alive)
      .sort((p, q) => {
        const a = items[p] as Item<T>;
        const b = items[q] as Item<T>;
        return a.level - b.level || a.k.y - b.k.y || a.k.x - b.k.x;
      });
    for (const id of order) {
      if (!(items[id] as Item<T>).alive) continue;
      for (let cur = mergeFrom(id); cur >= 0; cur = mergeFrom(cur)) {
        merges++;
        changed = true;
      }
    }
  }

  const result = items.filter((it) => it.alive).sort((a, b) => a.key - b.key);
  return {
    klossar: result.map((it) => it.k),
    before: inputs.length,
    after: result.length,
    merges,
    from: result.map((it) => it.from),
  };
}
