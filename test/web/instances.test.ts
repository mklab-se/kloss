import { expect, test } from "bun:test";
import { Raycaster, Scene, Vector3 } from "three";
import type { PlacedKloss } from "../../src/core/types.ts";
import { KlossInstances } from "../../src/web/instances.ts";

const kloss = (index: number, x: number, y: number): PlacedKloss => ({
  index,
  size: "2x2",
  color: "red",
  x,
  y,
  level: 0,
});

test("klossar added after a pick can still be picked", () => {
  const instances = new KlossInstances(new Scene());
  const down = new Vector3(0, -1, 0);
  instances.add(kloss(0, 0, 0));
  const ray = new Raycaster(new Vector3(1, 10, 1), down);
  expect(ray.intersectObjects(instances.objects, false).length).toBeGreaterThan(0);

  instances.add(kloss(1, 30, 30));
  ray.set(new Vector3(31, 10, 31), down);
  expect(ray.intersectObjects(instances.objects, false).length).toBeGreaterThan(0);
});
