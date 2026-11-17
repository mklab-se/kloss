/**
 * The compass: a ghostly dial that looks as if it lies on the floor in the top-left corner. It is
 * drawn flat in the floor's own plane and transformed with the perspective of the floor right
 * behind it, so it turns and squashes exactly like the plupp rows there. Clicking it goes to the
 * start view.
 */
import { type Camera, type PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";

export interface ScreenDirection {
  /** Rightwards on screen. */
  dx: number;
  /** Upwards on screen. */
  dy: number;
}

const FLOOR = new Plane(new Vector3(0, 1, 0), 0);
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 0, 1);

/**
 * Where kloss +X (world +x) and +Y (world +z) point on screen. With `at` (a screen position in
 * normalised device coordinates), the directions are measured on the floor right behind that
 * spot, so they line up with the plupp rows there despite perspective; otherwise (or when that
 * spot shows sky) they are the directions at the centre of the view.
 */
export function compassArrows(
  camera: Camera,
  at?: Vector2,
): { x: ScreenDirection; y: ScreenDirection } {
  camera.updateMatrixWorld();
  if (at) {
    const ray = new Raycaster();
    ray.setFromCamera(at, camera);
    const p = ray.ray.intersectPlane(FLOOR, new Vector3());
    if (p) {
      const aspect = (camera as PerspectiveCamera).aspect ?? 1;
      const step = Math.max(1e-3, p.distanceTo(camera.position) * 1e-3);
      const s0 = p.clone().project(camera);
      const along = (axis: Vector3): ScreenDirection => {
        const s1 = p.clone().addScaledVector(axis, step).project(camera);
        return { dx: (s1.x - s0.x) * aspect, dy: s1.y - s0.y };
      };
      const x = along(AXIS_X);
      const y = along(AXIS_Y);
      // the longer arrow has length 1; the other keeps its length relative to it
      const scale = 1 / Math.max(1e-12, Math.hypot(x.dx, x.dy), Math.hypot(y.dx, y.dy));
      return {
        x: { dx: x.dx * scale, dy: x.dy * scale },
        y: { dx: y.dx * scale, dy: y.dy * scale },
      };
    }
  }
  const toView = camera.matrixWorldInverse;
  const on = (axis: Vector3): ScreenDirection => {
    // the axis in view space; its x/y part is how much of it lies across the screen
    const v = axis.clone().transformDirection(toView);
    return { dx: v.x, dy: v.y };
  };
  return { x: on(AXIS_X), y: on(AXIS_Y) };
}

/** An SVG matrix (without translation): dial units to screen pixels. */
export interface DialMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
}

/**
 * Maps the dial's own plane (u along kloss X, v along kloss Y) onto the screen the way the floor
 * behind the compass is seen, scaled so the dial's widest radius is `radiusPx`. Near the horizon
 * the floor is seen almost edge-on; the dial is never flatter than `minRatio` (its narrowest
 * radius relative to its widest), so it stays readable while still lying on the floor.
 */
export function dialMatrix(
  arrows: { x: ScreenDirection; y: ScreenDirection },
  radiusPx: number,
  minRatio = 0.5,
): DialMatrix {
  // columns (a, b) and (c, d): where u and v land; SVG y grows downwards
  let a = arrows.x.dx;
  let b = -arrows.x.dy;
  let c = arrows.y.dx;
  let d = -arrows.y.dy;
  // singular values: how far the unit circle reaches at its widest and narrowest
  const p = a * a + b * b;
  const q = a * c + b * d;
  const r = c * c + d * d;
  const det = a * d - b * c;
  const s = p + r;
  const widest = Math.sqrt((s + Math.sqrt(Math.max(0, s * s - 4 * det * det))) / 2);
  const narrowest = Math.abs(det) / Math.max(1e-12, widest);
  const wanted = minRatio * widest;
  if (narrowest < wanted) {
    // the narrow direction in dial space: eigenvector of [[p, q], [q, r]] for narrowest^2
    const l2 = narrowest * narrowest;
    let vx: number;
    let vy: number;
    if (Math.abs(q) > 1e-12) {
      vx = q;
      vy = l2 - p;
    } else if (p >= r) {
      vx = 0;
      vy = 1;
    } else {
      vx = 1;
      vy = 0;
    }
    const vl = Math.hypot(vx, vy);
    vx /= vl;
    vy /= vl;
    // where it lands on screen: M v, or (when flat) perpendicular to the wide direction
    let ux = a * vx + c * vy;
    let uy = b * vx + d * vy;
    let ul = Math.hypot(ux, uy);
    if (ul < 1e-9) {
      const wx = a * -vy + c * vx;
      const wy = b * -vy + d * vx;
      const sign = det < 0 ? -1 : 1;
      ux = -wy * sign;
      uy = wx * sign;
      ul = Math.hypot(ux, uy);
    }
    ux /= ul;
    uy /= ul;
    const grow = wanted - narrowest;
    a += grow * ux * vx;
    b += grow * uy * vx;
    c += grow * ux * vy;
    d += grow * uy * vy;
  }
  const k = radiusPx / Math.max(1e-9, widest);
  return { a: a * k, b: b * k, c: c * k, d: d * k };
}

const SVG = "http://www.w3.org/2000/svg";
/** The widget's box, and the dial's widest radius on screen, in pixels. */
const BOX = 200;
const RADIUS_PX = 74;
/** The dial is drawn in its own units: the rim is at 100. */
const RIM = 100;

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
}

/** A compass needle pointing along +u, from the centre to `length`. */
function needle(length: number, width: number): string {
  const head = length * 0.3;
  return [
    [0, -width / 2],
    [length - head, -width / 2],
    [length - head, -width * 1.5],
    [length, 0],
    [length - head, width * 1.5],
    [length - head, width / 2],
    [0, width / 2],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
}

export interface Compass {
  /** Lays the dial on the floor behind it, as seen by the camera. */
  update(camera: Camera, canvas: HTMLElement): void;
}

export function createCompass(root: HTMLElement, onClick: () => void): Compass {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "compass";
  button.title = "Compass: kloss X and Y on the floor. Click for the start view.";
  button.setAttribute("aria-label", "Compass. Click for the start view.");
  const box = svg("svg", { width: BOX, height: BOX, viewBox: `0 0 ${BOX} ${BOX}` });

  const defs = svg("defs", {}, box);
  const glass = svg(
    "radialGradient",
    { id: "compass-glass", cx: "40%", cy: "35%", r: "75%" },
    defs,
  );
  svg("stop", { offset: "0%", "stop-color": "#ffffff", "stop-opacity": 0.7 }, glass);
  svg("stop", { offset: "70%", "stop-color": "#ffffff", "stop-opacity": 0.38 }, glass);
  svg("stop", { offset: "100%", "stop-color": "#e8f0f4", "stop-opacity": 0.5 }, glass);

  // Everything inside `dial` is drawn flat in the floor's plane: u along X, v along Y.
  const dial = svg("g", { class: "compass-dial" }, box);
  svg("circle", { r: RIM, class: "compass-disc", fill: "url(#compass-glass)" }, dial);
  svg("circle", { r: RIM * 0.74, class: "compass-inner" }, dial);
  for (let deg = 0; deg < 360; deg += 5) {
    const major = deg % 30 === 0;
    const r0 = major ? RIM * 0.82 : RIM * 0.9;
    const a = (deg * Math.PI) / 180;
    svg(
      "line",
      {
        x1: Math.cos(a) * r0,
        y1: Math.sin(a) * r0,
        x2: Math.cos(a) * RIM * 0.97,
        y2: Math.sin(a) * RIM * 0.97,
        class: major ? "compass-tick major" : "compass-tick",
      },
      dial,
    );
  }
  svg("line", { x1: -RIM * 0.74, y1: 0, x2: RIM * 0.74, y2: 0, class: "compass-cross" }, dial);
  svg("line", { x1: 0, y1: -RIM * 0.74, x2: 0, y2: RIM * 0.74, class: "compass-cross" }, dial);
  // -X and -Y: short grey stubs
  svg(
    "polygon",
    { points: needle(RIM * 0.42, 7), class: "compass-stub", transform: "rotate(180)" },
    dial,
  );
  svg(
    "polygon",
    { points: needle(RIM * 0.42, 7), class: "compass-stub", transform: "rotate(270)" },
    dial,
  );
  // +Y points along v; +X along u
  svg(
    "polygon",
    { points: needle(RIM * 0.86, 9), class: "compass-needle axis-y", transform: "rotate(90)" },
    dial,
  );
  svg("polygon", { points: needle(RIM * 0.86, 9), class: "compass-needle axis-x" }, dial);
  // a plupp-shaped plus at the centre
  svg(
    "path",
    { d: "M-4,-12 H4 V-4 H12 V4 H4 V12 H-4 V4 H-12 V-4 H-4 Z", class: "compass-hub" },
    dial,
  );
  const label = (text: string, x: number, y: number, cls: string) => {
    const e = svg("text", { x, y, class: `compass-label ${cls}` }, dial);
    e.textContent = text;
  };
  label("X", RIM * 1.2, 9, "axis-x");
  label("Y", 0, RIM * 1.2 + 9, "axis-y");
  label("-X", -RIM * 1.18, 6, "minus");
  label("-Y", 0, -RIM * 1.13, "minus");

  button.append(box);
  button.addEventListener("click", onClick);
  root.append(button);

  let last = "";
  return {
    update(camera, canvas) {
      // the compass's centre in normalised device coordinates of the canvas
      const c = canvas.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      const at = new Vector2(
        ((b.left + b.width / 2 - c.left) / c.width) * 2 - 1,
        -(((b.top + b.height / 2 - c.top) / c.height) * 2 - 1),
      );
      const m = dialMatrix(compassArrows(camera, at), RADIUS_PX);
      const s = 1 / RIM;
      const matrix = [m.a * s, m.b * s, m.c * s, m.d * s, BOX / 2, BOX / 2]
        .map((v) => v.toFixed(4))
        .join(" ");
      if (matrix === last) return;
      last = matrix;
      dial.setAttribute("transform", `matrix(${matrix})`);
    },
  };
}
