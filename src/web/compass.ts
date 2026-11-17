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
const AXIS_UP = new Vector3(0, 1, 0);

export interface CompassArrows {
  x: ScreenDirection;
  y: ScreenDirection;
  /** World up at the same spot, on the same scale (for lifting the dial above its shadow). */
  up: ScreenDirection;
}

/**
 * Where kloss +X (world +x) and +Y (world +z) point on screen. With `at` (a screen position in
 * normalised device coordinates), the directions are measured on the floor right behind that
 * spot, so they line up with the plupp rows there despite perspective; otherwise (or when that
 * spot shows sky) they are the directions at the centre of the view.
 */
export function compassArrows(camera: Camera, at?: Vector2): CompassArrows {
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
      const up = along(AXIS_UP);
      // the longer arrow has length 1; the other (and up) keep their lengths relative to it
      const scale = 1 / Math.max(1e-12, Math.hypot(x.dx, x.dy), Math.hypot(y.dx, y.dy));
      const scaled = (v: ScreenDirection) => ({ dx: v.dx * scale, dy: v.dy * scale });
      return { x: scaled(x), y: scaled(y), up: scaled(up) };
    }
  }
  const toView = camera.matrixWorldInverse;
  const on = (axis: Vector3): ScreenDirection => {
    // the axis in view space; its x/y part is how much of it lies across the screen
    const v = axis.clone().transformDirection(toView);
    return { dx: v.x, dy: v.y };
  };
  return { x: on(AXIS_X), y: on(AXIS_Y), up: on(AXIS_UP) };
}

/**
 * Where the horizon is, in normalised device coordinates (y; 1 is the top edge). Above 1 when the
 * view looks down so steeply that the floor fills the whole screen.
 */
export function horizonNdcY(camera: Camera): number {
  camera.updateMatrixWorld();
  const forward = camera.getWorldDirection(new Vector3());
  forward.y = 0;
  if (forward.lengthSq() < 1e-12) return Number.POSITIVE_INFINITY;
  const far = camera.position.clone().addScaledVector(forward.normalize(), 1e6);
  far.y = 0;
  return far.project(camera).y;
}

/**
 * How far (in pixels) to slide the compass down so it lies on the floor: zero while the floor
 * reaches its usual spot, otherwise just enough to sit below the horizon.
 */
export function compassShift(o: { centerY: number; horizonY: number; radius: number }): number {
  const needed = o.horizonY + o.radius * 0.55 + 12;
  return Math.max(0, needed - o.centerY);
}

/** An SVG matrix (without translation): dial units to screen pixels. */
export interface DialMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  /** Pixels per arrow unit, to scale anything else measured like the arrows (such as up). */
  k: number;
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
  return { a: a * k, b: b * k, c: c * k, d: d * k, k };
}

const SVG = "http://www.w3.org/2000/svg";
/** The widget's box, and the dial's widest radius on screen, in pixels. */
const BOX = 200;
const RADIUS_PX = 74;
/** The dial is drawn in its own units: the rim is at 100. */
const RIM = 100;
/** How high the dial hovers above its shadow, in dial units (a block or two). */
const HOVER = 14;
/** The scene's sun shines from (-0.6, 1, 0.35): shadows fall towards +X and -Y. */
const SHADOW_U = 0.6 * HOVER;
const SHADOW_V = -0.35 * HOVER;

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
  const blur = svg(
    "filter",
    { id: "compass-blur", x: "-50%", y: "-50%", width: "200%", height: "200%" },
    defs,
  );
  svg("feGaussianBlur", { stdDeviation: 7 }, blur);
  const glass = svg(
    "radialGradient",
    { id: "compass-glass", cx: "40%", cy: "35%", r: "75%" },
    defs,
  );
  svg("stop", { offset: "0%", "stop-color": "#ffffff", "stop-opacity": 0.7 }, glass);
  svg("stop", { offset: "70%", "stop-color": "#ffffff", "stop-opacity": 0.38 }, glass);
  svg("stop", { offset: "100%", "stop-color": "#e8f0f4", "stop-opacity": 0.5 }, glass);

  // The shadow lies on the floor; the dial hovers above it. Both are drawn flat in the floor's
  // plane: u along X, v along Y.
  const ground = svg("g", {}, box);
  svg(
    "circle",
    {
      cx: SHADOW_U,
      cy: SHADOW_V,
      r: RIM * 0.97,
      class: "compass-shadow",
      filter: "url(#compass-blur)",
    },
    ground,
  );
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
      const c = canvas.getBoundingClientRect();
      // keep the compass on the floor: below the horizon when the horizon is low
      const centerX = button.offsetLeft + BOX / 2;
      const baseCenterY = button.offsetTop + BOX / 2;
      const horizonY = c.top + ((1 - horizonNdcY(camera)) / 2) * c.height;
      const shift = compassShift({ centerY: baseCenterY, horizonY, radius: RADIUS_PX });
      const centerY = baseCenterY + shift;
      // the compass's centre in normalised device coordinates of the canvas
      const at = new Vector2(
        ((centerX - c.left) / c.width) * 2 - 1,
        -(((centerY - c.top) / c.height) * 2 - 1),
      );
      const arrows = compassArrows(camera, at);
      const m = dialMatrix(arrows, RADIUS_PX);
      const s = 1 / RIM;
      // the dial is lifted along the scene's up direction, by HOVER dial units
      const liftX = arrows.up.dx * m.k * s * HOVER;
      const liftY = -arrows.up.dy * m.k * s * HOVER;
      const fmt = (v: number[]) => v.map((n) => n.toFixed(3)).join(" ");
      const floor = fmt([m.a * s, m.b * s, m.c * s, m.d * s, BOX / 2, BOX / 2]);
      const lifted = fmt([m.a * s, m.b * s, m.c * s, m.d * s, BOX / 2 + liftX, BOX / 2 + liftY]);
      const key = `${shift.toFixed(1)}|${floor}|${lifted}`;
      if (key === last) return;
      last = key;
      button.style.transform = shift > 0 ? `translateY(${shift.toFixed(1)}px)` : "";
      ground.setAttribute("transform", `matrix(${floor})`);
      dial.setAttribute("transform", `matrix(${lifted})`);
    },
  };
}
