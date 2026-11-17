import { describe, expect, test } from "bun:test";
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
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
