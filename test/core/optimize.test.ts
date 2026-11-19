import { describe, expect, test } from "bun:test";
import { formatModel, parseModel, SIZES } from "../../src/core/format.ts";
import { placeAll } from "../../src/core/landing.ts";
import { optimize } from "../../src/core/optimize.ts";
import type { KlossInput } from "../../src/core/types.ts";

/** Every filled unit cell with its color: what the model looks like. */
function voxels(klossar: readonly KlossInput[]): string[] {
  const out: string[] = [];
  for (const k of placeAll([...klossar])) {
    const { w, d } = SIZES[k.size];
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < d; j++) out.push(`${k.x + i},${k.y + j},${k.level},${k.color}`);
    }
  }
  return out.sort();
}

function run(text: string) {
  const before = parseModel(text);
  const r = optimize(before);
  expect(voxels(r.klossar)).toEqual(voxels(before));
  return r;
}

const sizes = (r: { klossar: KlossInput[] }) => r.klossar.map((k) => k.size).sort();

describe("optimize", () => {
  test("two 2x2 side by side become one 4x2, or one 2x4 front to back", () => {
    expect(sizes(run("0,0|2x2|red\n2,0|2x2|red\n"))).toEqual(["4x2"]);
    expect(sizes(run("0,0|2x2|red\n0,2|2x2|red\n"))).toEqual(["2x4"]);
  });

  test("four 1x1 in a row become one 4x1; in a square, one 2x2", () => {
    expect(sizes(run("0,0|1x1|red\n1,0\n2,0\n3,0\n"))).toEqual(["4x1"]);
    expect(sizes(run("0,0|1x1|red\n1,0\n0,1\n1,1\n"))).toEqual(["2x2"]);
  });

  test("long rows become the long sizes: 8x1, 6x2, 2x8", () => {
    expect(sizes(run("0,0|4x1|red\n4,0|4x1|red\n"))).toEqual(["8x1"]);
    expect(sizes(run("0,0|4x2|red\n4,0|2x2|red\n"))).toEqual(["6x2"]);
    expect(sizes(run("0,0|1x1|red\n" + "1,0\n2,0\n3,0\n4,0\n5,0\n6,0\n7,0\n"))).toEqual(["8x1"]);
    expect(sizes(run("0,0|2x4|blue\n0,4|2x4|blue\n"))).toEqual(["2x8"]);
  });

  test("two 1x4 long side to long side become one 2x4", () => {
    expect(sizes(run("0,0|1x4|blue\n1,0|1x4|blue\n"))).toEqual(["2x4"]);
  });

  test("different colors, levels or a half-overlapping edge are left alone", () => {
    expect(run("0,0|2x2|red\n2,0|2x2|blue\n").merges).toBe(0);
    expect(run("0,0|2x2|red\n0,0|2x2|red\n").merges).toBe(0);
    expect(run("0,0|2x2|red\n2,1|2x2|red\n").merges).toBe(0);
    expect(run("0,0|1x1|red\n2,0|1x1|red\n").merges).toBe(0);
  });

  test("a whole tower of pairs merges level by level", () => {
    const r = run("0,0|2x2|red\n2,0|2x2|red\n0,0|2x2|red\n2,0|2x2|red\n");
    expect(sizes(r)).toEqual(["4x2", "4x2"]);
    expect(r.before).toBe(4);
    expect(r.after).toBe(2);
    expect(r.merges).toBe(2);
  });

  test("a merge moves to where it keeps every landing the same", () => {
    // the red kloss at 1,0 only lands on level 1 because the gray one under it came first
    const r = run("0,0|1x1|gray\n0,0|1x1|red\n1,0|1x1|black\n1,0|1x1|red\n");
    expect(r.merges).toBe(1);
    expect(r.klossar).toHaveLength(3);
  });

  test("a merge that would change where anything lands is skipped", () => {
    // the blue kloss stands on the first red one before the second red one exists
    const r = run("0,0|1x1|gray\n0,0|1x1|red\n0,0|1x1|blue\n1,0|1x1|black\n1,0|1x1|red\n");
    expect(r.merges).toBe(0);
  });

  test("the result reads back as the same model", () => {
    const r = run("0,0|1x1|red\n1,0\n2,0\n3,0\n0,1|1x4|blue\n1,1|1x4|blue\n");
    expect(voxels(parseModel(formatModel(r.klossar)))).toEqual(voxels(r.klossar));
  });

  test("an empty model stays empty", () => {
    expect(optimize([])).toEqual({ klossar: [], before: 0, after: 0, merges: 0, from: [] });
  });

  test("says which klossar each new one was made from", () => {
    const r = run("0,0|1x1|red\n1,0\n2,0\n3,0\n9,9|2x2|blue\n");
    expect(r.klossar.map((k) => k.size)).toEqual(["4x1", "2x2"]);
    expect(r.from.map((f) => [...f].sort())).toEqual([[0, 1, 2, 3], [4]]);
    // every old kloss ends up in exactly one new one
    const all = r.from.flat().sort((a, b) => a - b);
    expect(all).toEqual([0, 1, 2, 3, 4]);
  });

  test("the old kloss at the new one's corner is listed first (it is the one that stays)", () => {
    const r = run("2,0|2x2|red\n0,0|2x2|red\n");
    expect(r.klossar).toHaveLength(1);
    expect(r.from[0]?.[0]).toBe(1);
  });

  test("a big model of 10,000 klossar optimizes fully, in well under a second", () => {
    const text = Array.from(
      { length: 10_000 },
      (_, i) => `${i % 100},${Math.floor(i / 100)}|1x1|red`,
    );
    const before = parseModel(text.join("\n"));
    const t = performance.now();
    const r = optimize(before);
    const ms = performance.now() - t;
    expect(voxels(r.klossar)).toEqual(voxels(before));
    // at least 625 (all 8x2); a 100-wide floor does not split evenly into 8-long klossar
    expect(r.after).toBeGreaterThanOrEqual(625);
    expect(r.after).toBeLessThanOrEqual(650);
    expect(ms).toBeLessThan(1_000);
  });

  test("a tall model stands the same after optimizing (the castle)", async () => {
    const before = parseModel(await Bun.file("examples/castle.kl").text());
    const r = optimize(before);
    expect(voxels(r.klossar)).toEqual(voxels(before));
    expect(r.after).toBeLessThan(before.length);
  });
});
