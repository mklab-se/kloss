import { describe, expect, test } from "bun:test";
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { compassArrows, compassShift, dialMatrix, horizonNdcY } from "../../src/web/compass.ts";

function cameraAt(x: number, y: number, z: number): PerspectiveCamera {
  const c = new PerspectiveCamera(45, 16 / 9, 0.1, 1000);
  c.position.set(x, y, z);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

describe("compassArrows", () => {
  test("from the front, X points right and Y (towards the camera) points down the screen", () => {
    const a = compassArrows(cameraAt(0, 10, 10));
    expect(a.x.dx).toBeCloseTo(1, 5);
    expect(a.x.dy).toBeCloseTo(0, 5);
    expect(a.y.dx).toBeCloseTo(0, 5);
    expect(a.y.dy).toBeLessThan(0);
  });

  test("turned half a circle, both arrows flip", () => {
    const a = compassArrows(cameraAt(0, 10, -10));
    expect(a.x.dx).toBeCloseTo(-1, 5);
    expect(a.y.dy).toBeGreaterThan(0);
  });

  test("seen from low down, Y shortens while X stays full length", () => {
    const high = compassArrows(cameraAt(0, 30, 3));
    const low = compassArrows(cameraAt(0, 1, 30));
    const len = (v: { dx: number; dy: number }) => Math.hypot(v.dx, v.dy);
    expect(len(low.x)).toBeCloseTo(1, 5);
    expect(len(low.y)).toBeLessThan(0.2);
    expect(len(high.y)).toBeGreaterThan(0.9);
  });
});

describe("compassArrows at the compass's own spot", () => {
  test("in the bottom-left corner, Y leans with the floor's perspective; X stays level", () => {
    const camera = cameraAt(0, 10, 10);
    const centre = compassArrows(camera);
    const corner = compassArrows(camera, new Vector2(-0.8, -0.8));
    expect(centre.y.dx).toBeCloseTo(0, 5);
    // rows running towards the camera lean away from the vanishing point: down and to the left
    expect(corner.y.dx).toBeLessThan(-0.1);
    expect(corner.y.dy).toBeLessThan(0);
    expect(corner.x.dy).toBeCloseTo(0, 5);
    expect(corner.x.dx).toBeGreaterThan(0);
  });

  test("matches the floor: the arrow follows a projected plupp row through that spot", () => {
    const camera = cameraAt(6, 8, 12);
    const ndc = new Vector2(-0.7, -0.75);
    const a = compassArrows(camera, ndc);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, camera);
    const p = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
    if (!p) throw new Error("no floor");
    const s0 = p.clone().project(camera);
    const s1 = p
      .clone()
      .add(new Vector3(0, 0, 1))
      .project(camera);
    const expected = Math.atan2(s1.y - s0.y, (s1.x - s0.x) * camera.aspect);
    expect(Math.atan2(a.y.dy, a.y.dx)).toBeCloseTo(expected, 2);
  });

  test("looking at the sky there, it falls back to the directions at the centre", () => {
    const camera = cameraAt(0, 1, 30);
    expect(compassArrows(camera, new Vector2(-0.8, 0.95))).toEqual(compassArrows(camera));
  });
});

describe("dialMatrix (the compass lying on the floor)", () => {
  test("seen straight from above with X right and Y down the screen, it is a plain circle", () => {
    const m = dialMatrix({ x: { dx: 1, dy: 0 }, y: { dx: 0, dy: -1 } }, 60);
    expect(m.a).toBeCloseTo(60, 6);
    expect(m.b).toBeCloseTo(0, 6);
    expect(m.c).toBeCloseTo(0, 6);
    expect(m.d).toBeCloseTo(60, 6);
  });

  test("seen at a slant, the dial squashes along Y and keeps its widest radius", () => {
    const m = dialMatrix({ x: { dx: 1, dy: 0 }, y: { dx: 0, dy: -0.4 } }, 60, 0);
    expect(m.a).toBeCloseTo(60, 6);
    expect(m.d).toBeCloseTo(24, 6);
  });

  test("near the horizon it never gets flatter than half as tall as it is wide", () => {
    const m = dialMatrix({ x: { dx: 1, dy: 0 }, y: { dx: 0, dy: -0.1 } }, 60);
    expect(m.a).toBeCloseTo(60, 6);
    expect(m.d).toBeCloseTo(30, 6);
  });

  test("the squash limit keeps the direction of a turned, slanted dial", () => {
    const s = Math.SQRT1_2;
    // a 45 degree turn, very flat
    const m = dialMatrix({ x: { dx: s, dy: s * 0.1 }, y: { dx: s, dy: -s * 0.1 } }, 50);
    // the widest radius stays horizontal on screen, the narrow one is half of it
    const lengths = [Math.hypot(m.a + m.c, m.b + m.d), Math.hypot(m.a - m.c, m.b - m.d)].map(
      (l) => l / Math.SQRT2,
    );
    expect(Math.max(...lengths)).toBeCloseTo(50, 4);
    expect(Math.min(...lengths)).toBeCloseTo(25, 4);
    expect(Math.abs(m.b + m.d)).toBeLessThan(1e-6);
  });

  test("turned, the dial turns with the floor and its widest radius stays the same", () => {
    const s = Math.SQRT1_2;
    const m = dialMatrix({ x: { dx: s, dy: s }, y: { dx: s, dy: -s } }, 50);
    // SVG y grows downwards, so screen-up becomes negative b
    expect(m.a).toBeCloseTo(50 * s, 6);
    expect(m.b).toBeCloseTo(-50 * s, 6);
    const widest = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
    expect(widest).toBeCloseTo(50, 6);
  });
});

describe("keeping the compass on the floor", () => {
  test("horizonNdcY: low views put the horizon on screen, steep views above it", () => {
    const low = horizonNdcY(cameraAt(0, 2, 30));
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(0.3);
    expect(horizonNdcY(cameraAt(0, 30, 3))).toBeGreaterThan(1);
  });

  test("compassShift: no shift while the floor reaches the corner", () => {
    expect(compassShift({ centerY: 148, horizonY: -400, radius: 74 })).toBe(0);
    expect(compassShift({ centerY: 148, horizonY: 60, radius: 74 })).toBe(0);
  });

  test("compassShift: slides down so the dial sits on the floor just below the horizon", () => {
    const shift = compassShift({ centerY: 148, horizonY: 300, radius: 74 });
    expect(148 + shift).toBeGreaterThan(300);
    expect(148 + shift).toBeLessThan(300 + 74);
  });
});
