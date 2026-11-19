import { describe, expect, test } from "bun:test";
import {
  type Carry,
  coordWidth,
  FormatError,
  formatLine,
  formatModel,
  PALETTE,
  parseKlossJson,
  parseLine,
  parseModel,
  SIZES,
} from "../../src/core/format.ts";
import type { ColorName, KlossInput, Size } from "../../src/core/types.ts";

function errorOf(fn: () => unknown): FormatError {
  try {
    fn();
  } catch (e) {
    if (e instanceof FormatError) return e;
    throw e;
  }
  throw new Error("expected a FormatError");
}

const k = (x: number, y: number, size: Size, color: ColorName): KlossInput => ({
  size,
  color,
  x,
  y,
});
const after = (last: KlossInput): Carry => ({ last });

describe("parseLine", () => {
  test("reads x,y|size|color", () => {
    expect(parseLine("1,1|4x2|gray")).toEqual(k(1, 1, "4x2", "gray"));
  });

  test("allows whitespace around every separator, and is case-insensitive", () => {
    expect(parseLine("  -3 ,  12 |  2X4 | RED  ")).toEqual(k(-3, 12, "2x4", "red"));
  });

  test("a left-out color is the last one used", () => {
    expect(parseLine("1,1|2x2", after(k(1, 1, "4x2", "gray")))).toEqual(k(1, 1, "2x2", "gray"));
  });

  test("a left-out size and color are the last ones used", () => {
    expect(parseLine("5,1", after(k(1, 1, "2x2", "gray")))).toEqual(k(5, 1, "2x2", "gray"));
  });

  test("a color alone keeps the last size, with or without an empty size field", () => {
    const last = after(k(0, 0, "2x4", "blue"));
    expect(parseLine("3,3|red", last)).toEqual(k(3, 3, "2x4", "red"));
    expect(parseLine("3,3||red", last)).toEqual(k(3, 3, "2x4", "red"));
  });

  test("a dot repeats the last drop", () => {
    expect(parseLine(" . ", after(k(5, 1, "2x2", "gray")))).toEqual(k(5, 1, "2x2", "gray"));
  });

  test("blank and comment lines are null; a trailing comment is allowed", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("   ")).toBeNull();
    expect(parseLine("# hi")).toBeNull();
    expect(parseLine("1,2|1x1|red # a flag")).toEqual(k(1, 2, "1x1", "red"));
  });

  test("the first kloss must give both size and color", () => {
    expect(errorOf(() => parseLine("5,1")).message).toContain("size");
    expect(errorOf(() => parseLine("5,1|2x2")).message).toContain("color");
    expect(errorOf(() => parseLine("5,1|red")).message).toContain("size");
    expect(errorOf(() => parseLine(".")).message).toContain("nothing to repeat");
  });

  test("unknown size, unknown color, doubled fields", () => {
    expect(errorOf(() => parseLine("0,0|3x3|red")).message).toContain('"3x3"');
    expect(errorOf(() => parseLine("0,0|2x2|teal")).message).toContain('"teal"');
    expect(errorOf(() => parseLine("0,0|2x2|1x1")).message).toContain("two sizes");
    expect(errorOf(() => parseLine("0,0|red|blue")).message).toContain("two colors");
    expect(errorOf(() => parseLine("0,0|2x2|red|blue")).message).toContain("expected");
  });

  test("positions must be whole numbers within range", () => {
    expect(errorOf(() => parseLine("1.5,2|2x2|red")).message).toContain("position");
    expect(errorOf(() => parseLine("1|2x2|red")).message).toContain("position");
    expect(errorOf(() => parseLine("10001,0|2x2|red")).message).toContain("10000");
    expect(parseLine("-10000,10000|2x2|red")).toEqual(k(-10000, 10000, "2x2", "red"));
  });

  test("the old 0.1 format gets a message showing the new way to write it", () => {
    const e = errorOf(() => parseLine("2x4 blue 2,0"));
    expect(e.message).toContain('"2,0|2x4|blue"');
  });
});

describe("parseModel", () => {
  test("the example from the design: carry-over and repeat", () => {
    expect(parseModel("1,1|4x2|gray\n1,1|2x2\n5,1\n.\n")).toEqual([
      k(1, 1, "4x2", "gray"),
      k(1, 1, "2x2", "gray"),
      k(5, 1, "2x2", "gray"),
      k(5, 1, "2x2", "gray"),
    ]);
  });

  test("comments and blank lines keep the carried size and color", () => {
    expect(parseModel("0,0|1x1|red\n\n# tower\n0,0")).toEqual([
      k(0, 0, "1x1", "red"),
      k(0, 0, "1x1", "red"),
    ]);
  });

  test("reports the line number of the first error", () => {
    const e = errorOf(() => parseModel("# t\n0,0|2x2|red\n\n0,0|2x2|teal\n"));
    expect(e.line).toBe(4);
    expect(e.message.startsWith("line 4: ")).toBe(true);
  });

  test("reads CRLF files with a BOM", () => {
    expect(parseModel("﻿0,0|2x2|red\r\n1,1|1x1|blue\r\n")).toEqual([
      k(0, 0, "2x2", "red"),
      k(1, 1, "1x1", "blue"),
    ]);
  });

  test("an empty file is an empty model", () => {
    expect(parseModel("")).toEqual([]);
  });
});

describe("formatLine", () => {
  test("writes every field when there is nothing before it, right-aligned", () => {
    expect(formatLine(k(2, 0, "2x4", "blue"))).toBe("  2,  0 | 2x4 | blue");
  });

  test("leaves out what repeats, and writes a dot for an exact repeat", () => {
    const prev = k(1, 1, "4x2", "gray");
    expect(formatLine(k(1, 1, "2x2", "gray"), prev)).toBe("  1,  1 | 2x2");
    expect(formatLine(k(5, 1, "4x2", "gray"), prev)).toBe("  5,  1");
    expect(formatLine(k(5, 1, "4x2", "red"), prev)).toBe("  5,  1 | red");
    expect(formatLine(prev, prev)).toBe(".");
  });

  test("pads to the given width, and wider numbers still fit", () => {
    expect(formatLine(k(-12, 7, "1x1", "red"), undefined, 4)).toBe(" -12,   7 | 1x1 | red");
    expect(formatLine(k(12345, 0, "1x1", "red"), undefined, 3)).toBe("12345,  0 | 1x1 | red");
  });

  test("round-trips every size and color", () => {
    let prev: KlossInput | undefined;
    for (const size of Object.keys(SIZES) as Size[]) {
      for (const color of Object.keys(PALETTE) as ColorName[]) {
        const next = k(-7, 12, size, color);
        expect(parseLine(formatLine(next, prev), prev ? after(prev) : undefined)).toEqual(next);
        prev = next;
      }
    }
  });
});

describe("formatModel and coordWidth", () => {
  test("a whole model round-trips and lines up", () => {
    const model = [
      k(1, 1, "4x2", "gray"),
      k(1, 1, "2x2", "gray"),
      k(5, 1, "2x2", "gray"),
      k(5, 1, "2x2", "gray"),
      k(-120, 30, "1x1", "red"),
    ];
    const text = formatModel(model);
    expect(parseModel(text)).toEqual(model);
    expect(text).toBe(
      "   1,   1 | 4x2 | gray\n   1,   1 | 2x2\n   5,   1\n.\n-120,  30 | 1x1 | red\n",
    );
  });

  test("coordWidth is at least 3 and fits the widest coordinate", () => {
    expect(coordWidth([])).toBe(3);
    expect(coordWidth([k(1, 2, "1x1", "red")])).toBe(3);
    expect(coordWidth([k(-1000, 2, "1x1", "red")])).toBe(5);
  });
});

describe("parseKlossJson", () => {
  test("accepts a valid kloss", () => {
    expect(parseKlossJson({ size: "4x2", color: "tan", x: 1, y: -1 })).toEqual(
      k(1, -1, "4x2", "tan"),
    );
  });

  test("refuses wrong types and non-objects", () => {
    expect(() => parseKlossJson({ size: "4x2", color: "tan", x: "1", y: 0 })).toThrow(FormatError);
    expect(() => parseKlossJson(null)).toThrow(FormatError);
    expect(() => parseKlossJson({ size: "9x9", color: "tan", x: 0, y: 0 })).toThrow(FormatError);
  });
});

describe("palette and sizes", () => {
  test("14 colors, all hex", () => {
    expect(Object.keys(PALETTE)).toHaveLength(14);
    for (const hex of Object.values(PALETTE)) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("sixteen sizes, each both ways round, w along x and d along y", () => {
    expect(Object.keys(SIZES).sort()).toEqual(
      [
        "1x1",
        "1x2",
        "2x1",
        "1x4",
        "4x1",
        "2x2",
        "2x4",
        "4x2",
        "1x6",
        "6x1",
        "2x6",
        "6x2",
        "1x8",
        "8x1",
        "2x8",
        "8x2",
      ].sort(),
    );
    expect(SIZES["4x2"]).toEqual({ w: 4, d: 2 });
    expect(SIZES["1x4"]).toEqual({ w: 1, d: 4 });
    expect(SIZES["8x2"]).toEqual({ w: 8, d: 2 });
    expect(SIZES["1x6"]).toEqual({ w: 1, d: 6 });
    // every size has its turned twin
    for (const { w, d } of Object.values(SIZES))
      expect(Object.hasOwn(SIZES, `${d}x${w}`)).toBe(true);
  });

  test("the long klossar read and write like any other", () => {
    const text = "0,0|8x2|red\n0,2|6x1|blue\n9,0|1x8\n";
    const m = parseModel(text);
    expect(m.map((k) => k.size)).toEqual(["8x2", "6x1", "1x8"]);
    expect(parseModel(formatModel(m))).toEqual(m);
  });
});

test("a dot repeats only size, color and position, not anything else the last kloss carried", () => {
  const last = { size: "2x2", color: "red", x: 1, y: 2, index: 7, level: 3, by: "a@b.se" } as const;
  expect(parseLine(".", { last })).toEqual({ size: "2x2", color: "red", x: 1, y: 2 });
});
