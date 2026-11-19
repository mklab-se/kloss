import { describe, expect, test } from "bun:test";
import { cellPoint, type Move, poseAt, SKY } from "../../src/web/chicken-motion.ts";

const at = (x: number, y: number, level: number) => ({ x, y, level });

describe("chicken poses", () => {
  test("a walk goes from cell centre to cell centre, legs moving, wings still", () => {
    const m: Move = { kind: "walk", from: at(0, 0, 1), to: at(1, 0, 1), duration: 450 };
    const start = poseAt(m, 0, 1);
    const end = poseAt(m, 1, 1);
    expect([start.x, start.y, start.z]).toEqual([0.5, 1.2, 0.5]);
    expect([end.x, end.y, end.z]).toEqual([1.5, 1.2, 0.5]);
    expect(poseAt(m, 0.5, 1)).toMatchObject({ walking: true, flapping: false });
    // it faces where it goes (+x)
    expect(start.facing).toBeCloseTo(Math.PI / 2);
  });

  test("a flutter up arcs above both ends, flapping", () => {
    const m: Move = { kind: "flutter", from: at(0, 0, 0), to: at(0, 1, 1), duration: 700 };
    const mid = poseAt(m, 0.5, 1);
    expect(mid.y).toBeGreaterThan(1.2);
    expect(mid.flapping).toBe(true);
    expect(poseAt(m, 1, 1).y).toBeCloseTo(1.2);
  });

  test("a spawn comes from high in the sky, drifts, and lands exactly on its cell", () => {
    const m: Move = { kind: "spawn", from: null, to: at(3, -2, 2), duration: 3000 };
    const first = poseAt(m, 0, 7);
    expect(first.y).toBeGreaterThan(2 * 1.2 + SKY - 1);
    const end = poseAt(m, 1, 7);
    expect([end.x, end.y, end.z]).toEqual([3.5, 2.4, -1.5]);
    // two chickens with different seeds take different paths down
    const a = poseAt(m, 0.4, 1);
    const b = poseAt(m, 0.4, 2);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.1);
    expect(poseAt(m, 0.5, 7).flapping).toBe(true);
  });

  test("a fall drops faster and faster, and a pop rises to the top", () => {
    const fall: Move = { kind: "fall", from: at(0, 0, 3), to: at(0, 0, 0), duration: 800 };
    const quarter = poseAt(fall, 0.25, 1).y;
    const half = poseAt(fall, 0.5, 1).y;
    expect(3.6 - quarter).toBeLessThan(quarter - half);
    expect(poseAt(fall, 1, 1).y).toBeCloseTo(0);
    const pop: Move = { kind: "pop", from: at(0, 0, 0), to: at(0, 0, 2), duration: 350 };
    expect(poseAt(pop, 1, 1).y).toBeCloseTo(2.4);
  });

  test("cell centres", () => {
    expect(cellPoint(at(-1, 4, 3))).toEqual({ x: -0.5, y: 3.5999999999999996, z: 4.5 });
  });
});
