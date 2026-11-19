/**
 * Kloss geometry: a body with plus-shaped sockets underneath and a plus-shaped plupp on every
 * cell. Local coordinates: the kloss's corner at the origin, x along the kloss's x, z along its y,
 * y up. Built once per size and shared.
 */
import { type BufferGeometry, ExtrudeGeometry, Path, Shape, Vector2 } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SIZES } from "../core/format.ts";
import {
  KLOSS_HEIGHT,
  PLUPP_ARM_LENGTH,
  PLUPP_ARM_WIDTH,
  PLUPP_HEIGHT,
  type Size,
} from "../core/types.ts";

/** Gap so the seams between neighbours show (the footprint is drawn about 0.98 of a cell). */
const INSET = 0.01;
const BEVEL = 0.025;
/** The rounded upper body starts here; the lower slab (with the socket holes) reaches SLAB_TOP. */
const BODY_BOTTOM = 0.2;
const BODY_RADIUS = 0.04;
const SLAB_TOP = BODY_BOTTOM + BODY_RADIUS;
const SOCKET_HALF_WIDTH = 0.12;

/** The 12 corners of a plus sign centered on (cx, cy), in the shape's 2D plane. */
function plusPoints(cx: number, cy: number, half: number, halfWidth: number): Vector2[] {
  const a = half;
  const b = halfWidth;
  return [
    [b, a],
    [b, b],
    [a, b],
    [a, -b],
    [b, -b],
    [b, -a],
    [-b, -a],
    [-b, -b],
    [-a, -b],
    [-a, b],
    [-b, b],
    [-b, a],
  ].map(([x = 0, y = 0]) => new Vector2(cx + x, cy + y));
}

/** Shapes live in 2D (x, s) with s = -z, so rotating -90 degrees about x makes extrusions go up. */
function standUp(g: BufferGeometry): BufferGeometry {
  g.rotateX(-Math.PI / 2);
  return g;
}

export function buildPluppGeometry(): BufferGeometry {
  const half = PLUPP_ARM_LENGTH / 2 - BEVEL;
  const halfWidth = PLUPP_ARM_WIDTH / 2 - BEVEL;
  const shape = new Shape(plusPoints(0, 0, half, halfWidth));
  const g = new ExtrudeGeometry(shape, {
    depth: PLUPP_HEIGHT - 2 * BEVEL,
    bevelEnabled: true,
    bevelSize: BEVEL,
    bevelThickness: BEVEL,
    bevelSegments: 2,
    curveSegments: 1,
  });
  standUp(g);
  g.translate(0, BEVEL, 0);
  return g.toNonIndexed();
}

/** A cheaper plupp for the floor (no bevel), so thousands of them stay smooth. */
export function buildFloorPluppGeometry(): BufferGeometry {
  const shape = new Shape(plusPoints(0, 0, PLUPP_ARM_LENGTH / 2, PLUPP_ARM_WIDTH / 2));
  const g = new ExtrudeGeometry(shape, {
    depth: PLUPP_HEIGHT,
    bevelEnabled: false,
    curveSegments: 1,
  });
  return standUp(g).toNonIndexed();
}

function buildSlab(w: number, d: number): BufferGeometry {
  const shape = new Shape([
    new Vector2(INSET, -INSET),
    new Vector2(w - INSET, -INSET),
    new Vector2(w - INSET, -(d - INSET)),
    new Vector2(INSET, -(d - INSET)),
  ]);
  for (let i = 0; i < w; i++) {
    for (let k = 0; k < d; k++) {
      shape.holes.push(
        new Path(plusPoints(i + 0.5, -(k + 0.5), PLUPP_ARM_LENGTH / 2, SOCKET_HALF_WIDTH)),
      );
    }
  }
  const g = new ExtrudeGeometry(shape, { depth: SLAB_TOP, bevelEnabled: false });
  return standUp(g);
}

/** A kloss without its pluppar (the body and the slab with the sockets). */
export function buildKlossBodyGeometry(size: Size): BufferGeometry {
  const { w, d } = SIZES[size];
  const height = KLOSS_HEIGHT - BODY_BOTTOM;
  const body = new RoundedBoxGeometry(w - 2 * INSET, height, d - 2 * INSET, 2, BODY_RADIUS);
  body.translate(w / 2, BODY_BOTTOM + height / 2, d / 2);
  const merged = mergeGeometries([body.toNonIndexed(), buildSlab(w, d).toNonIndexed()]);
  if (!merged) throw new Error(`could not build the ${size} kloss body`);
  return merged;
}

export function buildKlossGeometry(size: Size): BufferGeometry {
  const { w, d } = SIZES[size];
  const parts: BufferGeometry[] = [buildKlossBodyGeometry(size)];
  const plupp = pluppGeometry();
  for (let i = 0; i < w; i++) {
    for (let k = 0; k < d; k++) {
      parts.push(plupp.clone().translate(i + 0.5, KLOSS_HEIGHT, k + 0.5));
    }
  }
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error(`could not build the ${size} kloss`);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

const cache = new Map<Size, BufferGeometry>();
const bodyCache = new Map<Size, BufferGeometry>();
let plupp: BufferGeometry | undefined;

export function klossGeometry(size: Size): BufferGeometry {
  let g = cache.get(size);
  if (!g) {
    g = buildKlossGeometry(size);
    cache.set(size, g);
  }
  return g;
}

/** Shared: a kloss's body without pluppar, its corner at the origin. */
export function klossBodyGeometry(size: Size): BufferGeometry {
  let g = bodyCache.get(size);
  if (!g) {
    g = buildKlossBodyGeometry(size);
    bodyCache.set(size, g);
  }
  return g;
}

/** Shared: one plupp, standing on the origin. */
export function pluppGeometry(): BufferGeometry {
  plupp ??= buildPluppGeometry();
  return plupp;
}
