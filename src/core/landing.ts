/**
 * The landing rule: a kloss dropped from infinitely high stops on the highest thing under any
 * part of its footprint. One plupp of overlap is a strong enough joint, so it always stays.
 */
import { SIZES } from "./format.ts";
import type { KlossInput, PlacedKloss } from "./types.ts";

function* cells(k: KlossInput): Generator<string> {
  const { w, d } = SIZES[k.size];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) yield `${k.x + i},${k.y + j}`;
}

/** For each floor cell, how many levels are filled there. */
export class HeightMap {
  private readonly heights = new Map<string, number>();

  /** The level the kloss would land on. */
  level(k: KlossInput): number {
    let level = 0;
    for (const c of cells(k)) level = Math.max(level, this.heights.get(c) ?? 0);
    return level;
  }

  /** Lands the kloss and returns its level. */
  place(k: KlossInput): number {
    const level = this.level(k);
    for (const c of cells(k)) this.heights.set(c, level + 1);
    return level;
  }
}

export function placeAll(inputs: KlossInput[]): PlacedKloss[] {
  const map = new HeightMap();
  return inputs.map((k, index) => ({ index, ...k, level: map.place(k) }));
}
