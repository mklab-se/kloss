import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { PALETTE, parseModel } from "../../src/core/format.ts";
import { placeAll } from "../../src/core/landing.ts";
import type { ColorName } from "../../src/core/types.ts";
import { renderModel } from "../../src/server/render.ts";

/** A small PNG reader for the tests: RGBA, 8 bits, filter 0 rows (what the renderer writes). */
function readPng(png: Uint8Array) {
  expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (pos < png.length) {
    const len = view.getUint32(pos);
    const type = new TextDecoder().decode(png.slice(pos + 4, pos + 8));
    const data = png.slice(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = new DataView(data.buffer, data.byteOffset).getUint32(0);
      height = new DataView(data.buffer, data.byteOffset).getUint32(4);
    }
    if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const pixel = (x: number, y: number) => {
    const at = y * (width * 4 + 1) + 1 + x * 4;
    return [raw[at] ?? 0, raw[at + 1] ?? 0, raw[at + 2] ?? 0];
  };
  return { width, height, pixel };
}

function hex(c: ColorName): number[] {
  const h = PALETTE[c].slice(1);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
}

/** Whether a pixel is a (possibly shaded) version of a palette color. */
function isShadeOf(p: number[], c: ColorName): boolean {
  const base = hex(c);
  const ratios = p.map((v, i) => v / Math.max(1, base[i] ?? 1));
  const avg = ratios.reduce((a, b) => a + b, 0) / 3;
  return avg > 0.45 && avg < 1.35 && ratios.every((r) => Math.abs(r - avg) < 0.2);
}

const model = (text: string) => placeAll(parseModel(text));

describe("renderModel", () => {
  test("a PNG with the longest side as asked", () => {
    const png = readPng(renderModel(model("0,0|2x4|red\n"), { view: "iso", size: 300 }));
    expect(Math.max(png.width, png.height)).toBe(300);
  });

  test("top view: a red kloss in the middle, background at the edge", () => {
    const png = readPng(renderModel(model("0,0|2x2|red\n"), { view: "top", size: 200 }));
    // the middle of the plupp is lighter, so look at a spot between pluppar
    expect(
      isShadeOf(png.pixel(Math.round(png.width / 2), Math.round(png.height / 2) - 2), "red"),
    ).toBe(true);
    expect(isShadeOf(png.pixel(2, 2), "red")).toBe(false);
  });

  test("front view: a blue kloss on top of a red one", () => {
    const png = readPng(
      renderModel(model("0,0|2x2|red\n0,0|2x2|blue\n"), { view: "front", size: 240 }),
    );
    const x = Math.round(png.width / 2);
    let blueAbove = -1;
    let redBelow = -1;
    for (let y = 0; y < png.height; y++) {
      if (blueAbove < 0 && isShadeOf(png.pixel(x, y), "blue")) blueAbove = y;
      if (isShadeOf(png.pixel(x, y), "red")) redBelow = y;
    }
    expect(blueAbove).toBeGreaterThanOrEqual(0);
    expect(redBelow).toBeGreaterThan(blueAbove);
  });

  test("iso view shows the kloss's color", () => {
    const png = readPng(renderModel(model("0,0|2x4|green\n"), { view: "iso", size: 200 }));
    let green = 0;
    for (let y = 0; y < png.height; y += 4) {
      for (let x = 0; x < png.width; x += 4) if (isShadeOf(png.pixel(x, y), "green")) green++;
    }
    expect(green).toBeGreaterThan(50);
  });

  test("the size is kept within 64..2048, and an empty model still renders", () => {
    const small = readPng(renderModel([], { size: 10 }));
    expect(Math.max(small.width, small.height)).toBe(64);
    const big = readPng(renderModel(model("0,0|1x1|red\n"), { size: 99_999 }));
    expect(Math.max(big.width, big.height)).toBe(2048);
  });

  test("the castle renders in reasonable time", async () => {
    const castle = placeAll(parseModel(await Bun.file("examples/castle.kl").text()));
    const t0 = performance.now();
    const png = renderModel(castle, { view: "iso", size: 800 });
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(readPng(png).width).toBeGreaterThan(0);
  });
});
