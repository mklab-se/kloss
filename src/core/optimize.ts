/**
 * Optimizing a model: klossar of the same color, on the same level, side by side, that together
 * form an existing size exactly are merged into one bigger kloss, again and again until nothing
 * more fits. The model must look and stand exactly the same afterwards, so every merge is checked
 * by replaying the whole model with the landing rule; a merge that would move anything is skipped.
 */
import { SIZES } from "./format.ts";
import { placeAll } from "./landing.ts";
import type { KlossInput, Size } from "./types.ts";

export interface OptimizeResult<T extends KlossInput> {
  klossar: T[];
  before: number;
  after: number;
  merges: number;
}

interface Item<T> {
  k: T;
  level: number;
}

function sizeOf(w: number, d: number): Size | undefined {
  const s = `${w}x${d}`;
  return Object.hasOwn(SIZES, s) ? (s as Size) : undefined;
}

/** True when every kloss in `items` lands on the level it is expected to. */
function landsTheSame<T extends KlossInput>(items: Item<T>[]): boolean {
  const placed = placeAll(items.map((i) => i.k));
  return placed.every((p, n) => p.level === items[n]?.level);
}

/** Finds one valid merge and returns the new list, or null when nothing more can be merged. */
function mergeOnce<T extends KlossInput>(items: Item<T>[]): Item<T>[] | null {
  // which kloss fills each unit cell, per level
  const at = new Map<string, number>();
  items.forEach(({ k, level }, n) => {
    const { w, d } = SIZES[k.size];
    for (let i = 0; i < w; i++)
      for (let j = 0; j < d; j++) at.set(`${level}|${k.x + i}|${k.y + j}`, n);
  });
  // scan from the back corner outwards, so rows pair up from their start (1+2, 3+4)
  const order = items
    .map((_, n) => n)
    .sort((p, q) => {
      const a = items[p] as Item<T>;
      const b = items[q] as Item<T>;
      return a.level - b.level || a.k.y - b.k.y || a.k.x - b.k.x;
    });
  for (const n of order) {
    const a = items[n] as Item<T>;
    const { w, d } = SIZES[a.k.size];
    const neighbours: { m: number | undefined; along: "x" | "y" }[] = [
      { m: at.get(`${a.level}|${a.k.x + w}|${a.k.y}`), along: "x" },
      { m: at.get(`${a.level}|${a.k.x}|${a.k.y + d}`), along: "y" },
    ];
    for (const { m, along } of neighbours) {
      if (m === undefined || m === n) continue;
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
      const merged: Item<T> = { k: { ...a.k, size }, level: a.level };
      // drop the merged kloss where the first of the two was dropped, or else the second
      for (const where of [Math.min(n, m), Math.max(n, m)]) {
        const next = items.flatMap((item, i) => {
          if (i === where) return [merged];
          return i === n || i === m ? [] : [item];
        });
        if (landsTheSame(next)) return next;
      }
    }
  }
  return null;
}

export function optimize<T extends KlossInput>(inputs: readonly T[]): OptimizeResult<T> {
  const placed = placeAll([...inputs]);
  let items: Item<T>[] = inputs.map((k, n) => ({ k, level: placed[n]?.level ?? 0 }));
  let merges = 0;
  for (;;) {
    const next = mergeOnce(items);
    if (!next) break;
    items = next;
    merges++;
  }
  return { klossar: items.map((i) => i.k), before: inputs.length, after: items.length, merges };
}
