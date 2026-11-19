/**
 * The chicken: blocky, made of the same plastic as the klossar. A white body with a tail that
 * tips up, flat wings, a head with black eyes, an orange beak and feet, a red wattle, and on top
 * a red comb shaped like a plupp. 2 klossar tall, about one plupp wide and two long; it faces +z,
 * its feet at the origin. Geometry is built once and shared by every chicken.
 */
import { type BufferGeometry, Group, Mesh, type Object3D } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { klossMaterial } from "./instances.ts";

/** How tall a chicken is, comb included (a kloss is 1.2). */
export const CHICKEN_HEIGHT = 2.3;

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  tilt = 0,
): BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(0.035, Math.min(w, h, d) / 4));
  if (tilt) g.rotateX(tilt);
  return g.translate(x, y, z);
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error("could not build the chicken");
  return g;
}

let shared: Record<string, BufferGeometry> | undefined;

function geometries(): Record<string, BufferGeometry> {
  shared ??= {
    body: merge([
      box(0.84, 0.78, 1.25, 0, 1.0, -0.05),
      box(0.62, 0.55, 0.32, 0, 1.42, -0.68, -0.45),
    ]),
    leg: merge([box(0.11, 0.6, 0.11, 0, -0.3, 0), box(0.26, 0.06, 0.36, 0, -0.59, 0.08)]),
    wing: box(0.1, 0.55, 0.86, 0, -0.26, 0),
    head: box(0.6, 0.72, 0.62, 0, 0.38, 0.12),
    red: merge([
      box(0.42, 0.26, 0.12, 0, 0.86, 0.12),
      box(0.12, 0.26, 0.42, 0, 0.86, 0.12),
      box(0.12, 0.2, 0.08, 0, 0.24, 0.47),
    ]),
    beak: box(0.22, 0.16, 0.28, 0, 0.42, 0.55),
    eyes: merge([
      box(0.05, 0.11, 0.11, -0.305, 0.52, 0.26),
      box(0.05, 0.11, 0.11, 0.305, 0.52, 0.26),
    ]),
  };
  return shared;
}

export interface ChickenParts {
  root: Group;
  legs: [Group, Group];
  wings: [Group, Group];
  head: Group;
}

export function buildChicken(): ChickenParts {
  const g = geometries();
  const white = klossMaterial("white");
  const orange = klossMaterial("orange");
  const red = klossMaterial("red");
  const black = klossMaterial("black");
  const root = new Group();
  const mesh = (geometry: BufferGeometry, material: typeof white, parent: Object3D) => {
    const m = new Mesh(geometry, material);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const pivot = (x: number, y: number, z: number) => {
    const p = new Group();
    p.position.set(x, y, z);
    root.add(p);
    return p;
  };
  mesh(g.body as BufferGeometry, white, root);
  const legs = [-0.2, 0.2].map((x) => {
    const p = pivot(x, 0.62, 0);
    mesh(g.leg as BufferGeometry, orange, p);
    return p;
  }) as [Group, Group];
  const wings = [-0.44, 0.44].map((x) => {
    const p = pivot(x, 1.32, -0.05);
    mesh(g.wing as BufferGeometry, white, p);
    return p;
  }) as [Group, Group];
  const head = pivot(0, 1.3, 0.42);
  mesh(g.head as BufferGeometry, white, head);
  mesh(g.red as BufferGeometry, red, head);
  mesh(g.beak as BufferGeometry, orange, head);
  mesh(g.eyes as BufferGeometry, black, head);
  return { root, legs, wings, head };
}
