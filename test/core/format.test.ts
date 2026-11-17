import { describe, expect, test } from "bun:test";
import {
  FormatError,
  formatLine,
  PALETTE,
  parseKlossJson,
  parseLine,
  parseModel,
  SIZES,
} from "../../src/core/format.ts";
import type { ColorName, Size } from "../../src/core/types.ts";

function errorOf(fn: () => unknown): FormatError {
  try {
    fn();
  } catch (e) {
    if (e instanceof FormatError) return e;
    throw e;
  }
  throw new Error("expected a FormatError");
}

describe("parseLine", () => {
  test("reads size, color and corner", () => {
    expect(parseLine("2x4 blue 2,0")).toEqual({ size: "2x4", color: "blue", x: 2, y: 0 });
  });

  test("is case-insensitive and allows a trailing comment", () => {
    expect(parseLine("  2X2 RED -3,-4  # corner")).toEqual({
      size: "2x2",
      color: "red",
      x: -3,
      y: -4,
    });
  });

  test("blank and comment lines are null", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("   ")).toBeNull();
    expect(parseLine("# hi")).toBeNull();
  });

  test("unknown size", () => {
    expect(errorOf(() => parseLine("3x3 red 0,0")).message).toContain('unknown size "3x3"');
  });

  test("unknown color", () => {
    expect(errorOf(() => parseLine("2x2 teal 0,0")).message).toContain('unknown color "teal"');
  });

  test("position with a space is refused", () => {
    expect(errorOf(() => parseLine("2x2 red 1, 2")).message).toContain("position");
  });

  test("position must be whole numbers", () => {
    expect(errorOf(() => parseLine("2x2 red 1.5,2")).message).toContain('"1.5,2"');
  });

  test("position must be within range", () => {
    expect(errorOf(() => parseLine("2x2 red 10001,0")).message).toContain("10000");
    expect(parseLine("2x2 red -10000,10000")).toEqual({
      size: "2x2",
      color: "red",
      x: -10000,
      y: 10000,
    });
  });

  test("missing and extra tokens", () => {
    expect(errorOf(() => parseLine("2x2 red")).message).toContain("expected");
    expect(errorOf(() => parseLine("2x2 red 0,0 extra")).message).toContain("expected");
  });
});

describe("parseModel", () => {
  test("reports the line number of the first error", () => {
    const e = errorOf(() => parseModel("# t\n2x2 red 0,0\n\n2x2 bad 0,0\n"));
    expect(e.line).toBe(4);
    expect(e.message.startsWith("line 4: ")).toBe(true);
  });

  test("reads CRLF files with a BOM", () => {
    expect(parseModel("﻿2x2 red 0,0\r\n1x1 blue 1,1\r\n")).toEqual([
      { size: "2x2", color: "red", x: 0, y: 0 },
      { size: "1x1", color: "blue", x: 1, y: 1 },
    ]);
  });

  test("an empty file is an empty model", () => {
    expect(parseModel("")).toEqual([]);
  });
});

describe("formatLine", () => {
  test("round-trips every size and color", () => {
    for (const size of Object.keys(SIZES) as Size[]) {
      for (const color of Object.keys(PALETTE) as ColorName[]) {
        const k = { size, color, x: -7, y: 12 };
        expect(parseLine(formatLine(k))).toEqual(k);
      }
    }
  });

  test("writes lowercase", () => {
    expect(formatLine({ size: "2x4", color: "blue", x: 2, y: 0 })).toBe("2x4 blue 2,0");
  });
});

describe("parseKlossJson", () => {
  test("accepts a valid kloss", () => {
    expect(parseKlossJson({ size: "4x2", color: "tan", x: 1, y: -1 })).toEqual({
      size: "4x2",
      color: "tan",
      x: 1,
      y: -1,
    });
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

  test("six sizes, w along x and d along y", () => {
    expect(Object.keys(SIZES).sort()).toEqual(["1x1", "1x2", "2x1", "2x2", "2x4", "4x2"]);
    expect(SIZES["4x2"]).toEqual({ w: 4, d: 2 });
  });
});
