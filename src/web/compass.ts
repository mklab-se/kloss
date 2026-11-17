/**
 * The compass: a small dial showing which way kloss X and Y point on screen. It turns with the
 * camera and foreshortens when the floor is seen from low down. Clicking it goes to the start view.
 */
import { type Camera, Vector3 } from "three";

export interface ScreenDirection {
  /** Rightwards on screen. */
  dx: number;
  /** Upwards on screen. */
  dy: number;
}

/** Where kloss +X (world +x) and +Y (world +z) point on screen, as unit-or-shorter vectors. */
export function compassArrows(camera: Camera): { x: ScreenDirection; y: ScreenDirection } {
  camera.updateMatrixWorld();
  const toView = camera.matrixWorldInverse;
  const on = (axis: Vector3): ScreenDirection => {
    // the axis in view space; its x/y part is how much of it lies across the screen
    const v = axis.clone().transformDirection(toView);
    return { dx: v.x, dy: v.y };
  };
  return { x: on(new Vector3(1, 0, 0)), y: on(new Vector3(0, 0, 1)) };
}

const SVG = "http://www.w3.org/2000/svg";
const SIZE = 76;
const R = 24;

export interface Compass {
  update(camera: Camera): void;
}

export function createCompass(root: HTMLElement, onClick: () => void): Compass {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hud compass";
  button.title = "Compass: kloss X and Y. Click for the start view.";
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`);
  svg.setAttribute("width", String(SIZE));
  svg.setAttribute("height", String(SIZE));
  const ring = document.createElementNS(SVG, "circle");
  ring.setAttribute("r", String(R + 6));
  ring.setAttribute("class", "compass-ring");
  svg.append(ring);

  const arrow = (cls: string, label: string) => {
    const line = document.createElementNS(SVG, "line");
    line.setAttribute("class", `compass-arrow ${cls}`);
    const head = document.createElementNS(SVG, "circle");
    head.setAttribute("r", "2.6");
    head.setAttribute("class", `compass-head ${cls}`);
    const text = document.createElementNS(SVG, "text");
    text.setAttribute("class", `compass-label ${cls}`);
    text.textContent = label;
    svg.append(line, head, text);
    return (d: ScreenDirection) => {
      // SVG y grows downwards
      const x = d.dx * R;
      const y = -d.dy * R;
      line.setAttribute("x1", "0");
      line.setAttribute("y1", "0");
      line.setAttribute("x2", x.toFixed(2));
      line.setAttribute("y2", y.toFixed(2));
      head.setAttribute("cx", x.toFixed(2));
      head.setAttribute("cy", y.toFixed(2));
      // the label sits just beyond the arrow's tip, and fades when the axis points at the viewer
      const len = Math.hypot(d.dx, d.dy) || 1;
      text.setAttribute("x", (x + (d.dx / len) * 8).toFixed(2));
      text.setAttribute("y", (y - (d.dy / len) * 8 + 3.5).toFixed(2));
      text.setAttribute("opacity", String(Math.min(1, 0.25 + len)));
    };
  };
  const setY = arrow("axis-y", "Y");
  const setX = arrow("axis-x", "X");
  const hub = document.createElementNS(SVG, "circle");
  hub.setAttribute("r", "2.4");
  hub.setAttribute("class", "compass-hub");
  svg.append(hub);
  button.append(svg);
  button.addEventListener("click", onClick);
  root.append(button);

  let last = "";
  return {
    update(camera) {
      const a = compassArrows(camera);
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
