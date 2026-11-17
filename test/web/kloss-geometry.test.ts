import { describe, expect, test } from "bun:test";
import type { BufferGeometry } from "three";
import { SIZES } from "../../src/core/format.ts";
import type { Size } from "../../src/core/types.ts";
import {
  buildFloorPluppGeometry,
  buildKlossGeometry,
  buildPluppGeometry,
  klossGeometry,
} from "../../src/web/kloss-geometry.ts";

const EPS = 1e-6;

function bounds(g: BufferGeometry) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  if (!b) throw new Error("no bounding box");
  return b;
}

function positions(g: BufferGeometry): number[][] {
  const a = g.getAttribute("position");
  const out: number[][] = [];
  for (let i = 0; i < a.count; i++) out.push([a.getX(i), a.getY(i), a.getZ(i)]);
  return out;
}

describe("plupp", () => {
  test("a plus sign 0.6 across and 0.4 tall, base on y = 0", () => {
    const b = bounds(buildPluppGeometry());
    expect(b.min.x).toBeCloseTo(-0.3, 6);
    expect(b.max.x).toBeCloseTo(0.3, 6);
    expect(b.min.z).toBeCloseTo(-0.3, 6);
    expect(b.max.z).toBeCloseTo(0.3, 6);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(0.4, 6);
  });

  test("it is a plus, not a square: no vertex near the corners of its box", () => {
    for (const [x, , z] of positions(buildPluppGeometry())) {
      expect(Math.abs(x ?? 0) > 0.2 && Math.abs(z ?? 0) > 0.2).toBe(false);
    }
  });
});

describe("kloss", () => {
  for (const size of Object.keys(SIZES) as Size[]) {
    test(`${size} spans its footprint and stands 1.6 with pluppar`, () => {
      const { w, d } = SIZES[size];
      const b = bounds(buildKlossGeometry(size));
      expect(b.min.x).toBeGreaterThanOrEqual(0.01 - EPS);
      expect(b.min.x).toBeLessThanOrEqual(0.011);
      expect(b.max.x).toBeLessThanOrEqual(w - 0.01 + EPS);
      expect(b.max.x).toBeGreaterThanOrEqual(w - 0.011);
      expect(b.min.z).toBeGreaterThanOrEqual(0.01 - EPS);
      expect(b.max.z).toBeLessThanOrEqual(d - 0.01 + EPS);
      expect(b.min.y).toBeCloseTo(0, 6);
      expect(b.max.y).toBeCloseTo(1.6, 6);
    });
  }

  test("a 2x4 has one plupp on each of its 8 cells", () => {
    const centers: [number, number][] = [];
    for (let i = 0; i < 2; i++) for (let k = 0; k < 4; k++) centers.push([i + 0.5, k + 0.5]);
    const hits = new Set<number>();
    for (const [x = 0, y = 0, z = 0] of positions(buildKlossGeometry("2x4"))) {
      if (y <= 1.2 + EPS) continue;
      const c = centers.findIndex(
        ([cx, cz]) => Math.abs(x - cx) <= 0.31 && Math.abs(z - cz) <= 0.31,
      );
      expect(c).toBeGreaterThanOrEqual(0);
      hits.add(c);
    }
    expect(hits.size).toBe(8);
  });

  test("sockets: the underside has plus-shaped recesses inside the body", () => {
    const inside = positions(buildKlossGeometry("1x1")).filter(
      ([x = 0, y = 0, z = 0]) =>
        y > 0.05 && y < 0.6 && Math.abs(x - 0.5) < 0.31 && Math.abs(z - 0.5) < 0.31,
    );
    expect(inside.length).toBeGreaterThan(0);
  });

  test("geometry is cached per size and has normals and no NaN", () => {
    expect(klossGeometry("2x2")).toBe(klossGeometry("2x2"));
    const g = klossGeometry("4x2");
    expect(g.getAttribute("normal")).toBeDefined();
    for (const p of positions(g)) for (const v of p) expect(Number.isNaN(v)).toBe(false);
  });
});

describe("floor plupp", () => {
  test("same plus footprint and height as a kloss plupp, with far fewer vertices", () => {
    const floor = buildFloorPluppGeometry();
    const b = bounds(floor);
    expect(b.min.x).toBeCloseTo(-0.3, 6);
    expect(b.max.x).toBeCloseTo(0.3, 6);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(0.4, 6);
    const count = (g: BufferGeometry) => g.getAttribute("position").count;
    expect(count(floor) * 3).toBeLessThan(count(buildPluppGeometry()));
  });
});
