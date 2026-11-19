/**
 * A picture of a model, rendered on the server without a browser: plain TypeScript filling
 * polygons into a pixel buffer, saved as PNG with the built-in zlib. Simpler than the 3D viewer,
 * but clear: klossar as solid blocks with three shades, raised plus-shaped pluppar on every visible
 * top, and thin dark seams where two klossar meet. Lets an AI agent "see" a model.
 */
import { deflateSync } from "node:zlib";
import { PALETTE, SIZES } from "../core/format.ts";
import type { ColorName, PlacedKloss } from "../core/types.ts";

export type View = "iso" | "top" | "front" | "side";
export const VIEWS: readonly View[] = ["iso", "top", "front", "side"];

export interface RenderOptions {
  view?: View;
  /** The longest side in pixels (64 to 2048; default 768). */
  size?: number;
}

type RGB = [number, number, number];
type Pt = [number, number];

const BACKGROUND: RGB = [238, 243, 247];
const MARGIN = 0.06;
/** A kloss's height relative to the spacing between pluppar. */
const HEIGHT = 1.2;
const PLUPP = 0.4;

// --- PNG -----------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, no filter method, no interlace
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// --- drawing -------------------------------------------------------------------------------------

class Canvas {
  readonly px: Uint8ClampedArray;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.px = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) this.px.set([...BACKGROUND, 255], i * 4);
  }

  /** Fills a convex polygon (scanline, pixel centres). */
  fill(points: Pt[], c: RGB): void {
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const [, y] of points) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const y0 = Math.max(0, Math.ceil(minY - 0.5));
    const y1 = Math.min(this.height - 1, Math.floor(maxY - 0.5));
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      let left = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i] as Pt;
        const [bx, by] = points[(i + 1) % points.length] as Pt;
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) {
          const x = ax + ((sy - ay) / (by - ay)) * (bx - ax);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
      if (left > right) continue;
      const x0 = Math.max(0, Math.ceil(left - 0.5));
      const x1 = Math.min(this.width - 1, Math.floor(right - 0.5));
      for (let x = x0; x <= x1; x++) this.px.set(c, (y * this.width + x) * 4);
    }
  }

  /** A line as a thin quad. */
  line(a: Pt, b: Pt, c: RGB, width: number): void {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (width / 2);
    const ny = (dx / len) * (width / 2);
    this.fill(
      [
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny],
      ],
      c,
    );
  }
}

const rgbOf = (color: ColorName): RGB => {
  const h = PALETTE[color].slice(1);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as RGB;
};
const shade = (c: RGB, f: number): RGB => c.map((v) => Math.max(0, Math.min(255, v * f))) as RGB;

// --- the model as unit cells ----------------------------------------------------------------------

interface Cell {
  id: number;
  color: ColorName;
}

function cellsOf(klossar: readonly PlacedKloss[]): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const k of klossar) {
    const { w, d } = SIZES[k.size];
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < d; j++) {
        cells.set(`${k.x + i},${k.y + j},${k.level}`, { id: k.index, color: k.color });
      }
    }
  }
  return cells;
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

// --- views ---------------------------------------------------------------------------------------

/** Projects a point in model space (x, y on the floor; z in kloss heights) to the picture plane. */
type Projection = (x: number, y: number, z: number) => Pt;

const PROJECT: Record<View, Projection> = {
  // from the front right and above, like the viewer's start view (x and y both towards you)
  iso: (x, y, z) => [(x - y) * 0.866, (x + y) * 0.5 - z * HEIGHT],
  top: (x, y) => [x, y],
  front: (x, _y, z) => [x, -z * HEIGHT],
  side: (_x, y, z) => [y, -z * HEIGHT],
};

interface Face {
  /** Polygon corners in model space. */
  corners: [number, number, number][];
  color: RGB;
  /** Draw order: lower first (farther away). */
  depth: number;
  /** Edges (as corner index pairs) where a seam line goes. */
  seams: [number, number][];
  /** For tops: draw a plupp on it. */
  plupp?: { x: number; y: number; z: number };
}

const SHADES = { top: 1, frontFace: 0.82, sideFace: 0.66 };

function facesFor(view: View, cells: Map<string, Cell>): Face[] {
  const faces: Face[] = [];
  const at = (x: number, y: number, z: number) => cells.get(key(x, y, z));
  const differs = (c: Cell, x: number, y: number, z: number) => at(x, y, z)?.id !== c.id;
  for (const [k, c] of cells) {
    const [x = 0, y = 0, z = 0] = k.split(",").map(Number);
    const base = rgbOf(c.color);
    const showTop = view !== "front" && view !== "side";
    if (showTop && !at(x, y, z + 1)) {
      // a top: seams on its four edges where the next cell is another kloss (or nothing)
      const seams: [number, number][] = [];
      if (differs(c, x, y - 1, z)) seams.push([0, 1]);
      if (differs(c, x + 1, y, z)) seams.push([1, 2]);
      if (differs(c, x, y + 1, z)) seams.push([2, 3]);
      if (differs(c, x - 1, y, z)) seams.push([3, 0]);
      const lift = view === "top" ? 0.72 + 0.28 * Math.min(1, z / 12) : SHADES.top;
      faces.push({
        corners: [
          [x, y, z + 1],
          [x + 1, y, z + 1],
          [x + 1, y + 1, z + 1],
          [x, y + 1, z + 1],
        ],
        color: shade(base, lift),
        depth: view === "top" ? z : x + y + z,
        seams,
        plupp: { x: x + 0.5, y: y + 0.5, z: z + 1 },
      });
    }
    // the face towards +y (the front)
    if ((view === "iso" || view === "front") && !at(x, y + 1, z)) {
      const seams: [number, number][] = [];
      if (differs(c, x, y, z - 1)) seams.push([0, 1]);
      if (differs(c, x + 1, y, z)) seams.push([1, 2]);
      if (differs(c, x, y, z + 1)) seams.push([2, 3]);
      if (differs(c, x - 1, y, z)) seams.push([3, 0]);
      faces.push({
        corners: [
          [x, y + 1, z],
          [x + 1, y + 1, z],
          [x + 1, y + 1, z + 1],
          [x, y + 1, z + 1],
        ],
        color: shade(base, view === "front" ? 1 : SHADES.frontFace),
        depth: view === "front" ? y : x + y + z,
        seams,
      });
    }
    // the face towards +x (the right side)
    if ((view === "iso" || view === "side") && !at(x + 1, y, z)) {
      const seams: [number, number][] = [];
      if (differs(c, x, y, z - 1)) seams.push([0, 1]);
      if (differs(c, x, y + 1, z)) seams.push([1, 2]);
      if (differs(c, x, y, z + 1)) seams.push([2, 3]);
      if (differs(c, x, y - 1, z)) seams.push([3, 0]);
      faces.push({
        corners: [
          [x + 1, y, z],
          [x + 1, y + 1, z],
          [x + 1, y + 1, z + 1],
          [x + 1, y, z + 1],
        ],
        color: shade(base, view === "side" ? 1 : SHADES.sideFace),
        depth: view === "side" ? x : x + y + z,
        seams,
      });
    }
  }
  // farther first; for equal depth, lower first
  return faces.sort(
    (a, b) => a.depth - b.depth || (a.corners[0]?.[2] ?? 0) - (b.corners[0]?.[2] ?? 0),
  );
}

/** The plus-shaped plupp on a top, as two raised bars (in model space). */
function pluppBars(p: { x: number; y: number; z: number }): [number, number, number][][] {
  const a = 0.3;
  const b = 0.11;
  const z = p.z + PLUPP / HEIGHT;
  const bar = (hx: number, hy: number): [number, number, number][] => [
    [p.x - hx, p.y - hy, z],
    [p.x + hx, p.y - hy, z],
    [p.x + hx, p.y + hy, z],
    [p.x - hx, p.y + hy, z],
  ];
  return [bar(a, b), bar(b, a)];
}

export function renderModel(
  klossar: readonly PlacedKloss[],
  opts: RenderOptions = {},
): Uint8Array<ArrayBuffer> {
  const view = opts.view ?? "iso";
  const size = Math.min(2048, Math.max(64, Math.round(opts.size ?? 768)));
  const project = PROJECT[view];
  const cells = cellsOf(klossar);
  const faces = facesFor(view, cells);

  // fit everything (including a little room for pluppar) into the picture
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const grow = ([px, py]: Pt) => {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  };
  for (const f of faces) for (const [x, y, z] of f.corners) grow(project(x, y, z + PLUPP / HEIGHT));
  for (const f of faces) for (const [x, y, z] of f.corners) grow(project(x, y, z));
  if (!faces.length) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const wide = spanX >= spanY;
  const width = wide ? size : Math.max(1, Math.round((size * spanX) / spanY));
  const height = wide ? Math.max(1, Math.round((size * spanY) / spanX)) : size;
  const scale = Math.min(width / spanX, height / spanY) * (1 - 2 * MARGIN);
  const offX = (width - spanX * scale) / 2 - minX * scale;
  const offY = (height - spanY * scale) / 2 - minY * scale;
  const toScreen = (x: number, y: number, z: number): Pt => {
    const [px, py] = project(x, y, z);
    return [px * scale + offX, py * scale + offY];
  };

  const canvas = new Canvas(width, height);
  const seamWidth = Math.max(1, scale / 28);
  for (const f of faces) {
    const poly = f.corners.map(([x, y, z]) => toScreen(x, y, z));
    canvas.fill(poly, f.color);
    const seam = shade(f.color, 0.55);
    for (const [i, j] of f.seams) canvas.line(poly[i] as Pt, poly[j] as Pt, seam, seamWidth);
    if (f.plupp) {
      const bars = pluppBars(f.plupp);
      // a darker base, then the raised top, so the plupp reads as a bump
      for (const bar of bars) {
        canvas.fill(
          bar.map(([x, y]) => toScreen(x, y, f.plupp?.z ?? 0)),
          shade(f.color, 0.78),
        );
      }
      for (const bar of bars)
        canvas.fill(
          bar.map(([x, y, z]) => toScreen(x, y, z)),
          shade(f.color, 1.12),
        );
    }
  }
  return encodePng(width, height, canvas.px);
}
