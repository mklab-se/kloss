/**
 * The compass: a small dial showing which way kloss X and Y point on screen. It turns with the
 * camera and foreshortens when the floor is seen from low down. Clicking it goes to the start view.
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

const SVG = "http://www.w3.org/2000/svg";
const SIZE = 76;
const R = 24;

/** Arrowhead size, in dial units. */
const HEAD_LENGTH = 9;
const HEAD_HALF_WIDTH = 5;

export interface Compass {
  /** Points the arrows the way X and Y run on the floor right behind the compass. */
  update(camera: Camera, canvas: HTMLElement): void;
}

export function createCompass(root: HTMLElement, onClick: () => void): Compass {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hud compass";
  button.title = "Compass: kloss X and Y on the floor here. Click for the start view.";
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`);
  svg.setAttribute("width", String(SIZE));
  svg.setAttribute("height", String(SIZE));
  const ring = document.createElementNS(SVG, "circle");
  ring.setAttribute("r", String(R + 6));
  ring.setAttribute("class", "compass-ring");
  svg.append(ring);

  const arrow = (cls: string, label: string) => {
    const shaft = document.createElementNS(SVG, "line");
    shaft.setAttribute("class", `compass-arrow ${cls}`);
    const head = document.createElementNS(SVG, "polygon");
    head.setAttribute("class", `compass-head ${cls}`);
    const text = document.createElementNS(SVG, "text");
    text.setAttribute("class", `compass-label ${cls}`);
    text.textContent = label;
    svg.append(shaft, head, text);
    return (d: ScreenDirection) => {
      const len = Math.hypot(d.dx, d.dy);
      // unit direction in dial space (SVG y grows downwards)
      const ux = len > 1e-6 ? d.dx / len : 1;
      const uy = len > 1e-6 ? -d.dy / len : 0;
      const tip = Math.max(HEAD_LENGTH, len * R);
      const tx = ux * tip;
      const ty = uy * tip;
      const bx = tx - ux * HEAD_LENGTH;
      const by = ty - uy * HEAD_LENGTH;
      // the shaft stops inside the head so its round cap never pokes through the point
      shaft.setAttribute("x1", "0");
      shaft.setAttribute("y1", "0");
      shaft.setAttribute("x2", (bx + ux * 1.5).toFixed(2));
      shaft.setAttribute("y2", (by + uy * 1.5).toFixed(2));
      const px = -uy * HEAD_HALF_WIDTH;
      const py = ux * HEAD_HALF_WIDTH;
      head.setAttribute(
        "points",
        `${tx.toFixed(2)},${ty.toFixed(2)} ${(bx + px).toFixed(2)},${(by + py).toFixed(2)} ${(bx - px).toFixed(2)},${(by - py).toFixed(2)}`,
      );
      // the label sits just beyond the tip, and fades when the axis points at the viewer
      text.setAttribute("x", (tx + ux * 7).toFixed(2));
      text.setAttribute("y", (ty + uy * 7 + 4).toFixed(2));
      const opacity = String(Math.min(1, 0.3 + len));
      for (const el of [shaft, head, text]) el.setAttribute("opacity", opacity);
    };
  };
  const setY = arrow("axis-y", "Y");
  const setX = arrow("axis-x", "X");
  const hub = document.createElementNS(SVG, "circle");
  hub.setAttribute("r", "2.6");
  hub.setAttribute("class", "compass-hub");
  svg.append(hub);
  button.append(svg);
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
      const a = compassArrows(camera, at);
      // the longer arrow reaches the rim; the other keeps its length relative to it
      const scale = 1 / Math.max(1e-6, Math.hypot(a.x.dx, a.x.dy), Math.hypot(a.y.dx, a.y.dy));
      a.x = { dx: a.x.dx * scale, dy: a.x.dy * scale };
      a.y = { dx: a.y.dx * scale, dy: a.y.dy * scale };
      const key = `${a.x.dx.toFixed(3)},${a.x.dy.toFixed(3)},${a.y.dx.toFixed(3)},${a.y.dy.toFixed(3)}`;
      if (key === last) return;
      last = key;
      setX(a.x);
      setY(a.y);
    },
  };
}
