/**
 * Pure camera math: telling a trackpad from a mouse wheel, pan and zoom amounts, fitting the
 * model in view, and the camera's idle breathing. No DOM or Three.js here, so it is all testable.
 */

export type WheelKind = "pinch" | "trackpad" | "mouse";

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
}

/** How long after a trackpad event a mouse-like event is still treated as trackpad. */
const TRACKPAD_STICKY_MS = 1000;

/**
 * Browsers deliver a two-finger swipe as `wheel` events and a pinch as `wheel` events with
 * `ctrlKey`. A classic mouse wheel sends line-based deltas, or large whole-number vertical steps.
 * The trackpad must never be misread as a mouse, so anything ambiguous counts as trackpad.
 */
export class WheelClassifier {
  private lastTrackpad = Number.NEGATIVE_INFINITY;

  classify(e: WheelLike, nowMs: number): WheelKind {
    if (e.ctrlKey) return "pinch";
    if (e.deltaMode !== 0) return "mouse";
    const mouseLike = e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50;
    if (mouseLike && nowMs - this.lastTrackpad > TRACKPAD_STICKY_MS) return "mouse";
    this.lastTrackpad = nowMs;
    return "trackpad";
  }
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** World units per screen pixel at the target, so a swipe feels the same at any distance. */
export function panPerPixel(distance: number, fovDeg: number, viewportHeight: number): number {
  return (2 * distance * Math.tan(rad(fovDeg) / 2)) / Math.max(1, viewportHeight);
}

/** Exponential zoom: equal pinches in and out cancel out. */
export function zoomDistance(distance: number, deltaY: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, distance * Math.exp(deltaY * 0.01)));
}

/** The smallest radius auto-fit frames (12 units across), so one kloss is not blown up. */
const MIN_FIT_RADIUS = 6;

/** Distance at which a sphere of `radius` fits the view with a 10% margin. */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const r = Math.max(radius, MIN_FIT_RADIUS);
  const vHalf = rad(fovDeg) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  return (1.1 * r) / Math.sin(Math.min(vHalf, hHalf));
}

/** The idle sway: two slow waves per axis, at most 0.6 degrees, at rest at t = 0. */
export function breathOffset(tMs: number): { yaw: number; pitch: number } {
  const wave = (period: number) => Math.sin((2 * Math.PI * tMs) / period);
  return {
    yaw: rad(0.4) * wave(8000) + rad(0.2) * wave(13_000),
    pitch: rad(0.25) * wave(11_000) + rad(0.1) * wave(7000),
  };
}

/** Breathing fades in between 3 and 4 seconds after the last camera input. */
export function breathWeight(msSinceInput: number): number {
  const t = Math.min(1, Math.max(0, (msSinceInput - 3000) / 1000));
  return t * t * (3 - 2 * t);
}
