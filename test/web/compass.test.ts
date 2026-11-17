import { describe, expect, test } from "bun:test";
import { PerspectiveCamera } from "three";
import { compassArrows } from "../../src/web/compass.ts";

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
