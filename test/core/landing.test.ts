import { describe, expect, test } from "bun:test";
import { parseModel } from "../../src/core/format.ts";
import { HeightMap, placeAll } from "../../src/core/landing.ts";

const levels = (model: string) => placeAll(parseModel(model)).map((k) => k.level);

describe("landing", () => {
  test("three 2x2 on the same spot make a tower", () => {
    expect(levels("0,0|2x2|red\n0,0|2x2|red\n0,0|2x2|red")).toEqual([0, 1, 2]);
  });

  test("a 2x4 beside the tower lands on the floor (the spec's wall)", () => {
    expect(levels("0,0|2x2|red\n0,0|2x2|red\n0,0|2x2|red\n2,0|2x4|blue")).toEqual([0, 1, 2, 0]);
  });

  test("one plupp of overlap holds, and overhangs carry klossar", () => {
    expect(levels("0,0|1x1|red\n0,0|2x4|blue\n1,3|1x1|red\n1,4|1x1|red")).toEqual([0, 1, 2, 0]);
  });

  test("negative coordinates", () => {
    expect(levels("-1,-1|2x2|red\n0,0|1x1|blue")).toEqual([0, 1]);
  });

  test("4x2 and 2x4 cover different cells", () => {
    expect(levels("0,0|4x2|red\n3,0|1x1|blue\n0,3|1x1|blue")).toEqual([0, 1, 0]);
  });

  test("placeAll numbers klossar in order", () => {
    const placed = placeAll(parseModel("0,0|1x1|red\n5,5|1x1|red"));
    expect(placed.map((k) => k.index)).toEqual([0, 1]);
    expect(placed[1]).toEqual({ index: 1, size: "1x1", color: "red", x: 5, y: 5, level: 0 });
  });

  test("HeightMap.level looks without placing", () => {
    const h = new HeightMap();
    const k = { size: "2x2" as const, color: "red" as const, x: 0, y: 0 };
    expect(h.level(k)).toBe(0);
    expect(h.place(k)).toBe(0);
    expect(h.level(k)).toBe(1);
  });
});
