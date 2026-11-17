/**
 * The CAD camera, tuned for a Mac trackpad: swipe pans, pinch zooms toward the pointer, drag
 * rotates, double-click re-centers. Auto-fit keeps the whole model in view until the user moves
 * the camera, and the camera breathes ever so slightly while idle.
 *
 * Controllers sit behind CameraController so a walk mode can be added later.
 */
import { Box3, Plane, Raycaster, Sphere, Spherical, Vector2, Vector3 } from "three";
import {
  breathOffset,
  breathWeight,
  fitDistance,
  panPerPixel,
  WheelClassifier,
  zoomDistance,
} from "./gestures.ts";
import type { KlossScene } from "./scene.ts";

export interface CameraController {
  attach(el: HTMLElement): void;
  /** Advances the camera; returns true when the rendered camera changed. */
  update(dtMs: number): boolean;
  frame(box: Box3, instant?: boolean): void;
  home(): void;
  dispose(): void;
  autoFit: boolean;
  onAutoFitChange(fn: (on: boolean) => void): void;
  /** Widens auto-fit to a point (a drop's landing spot) before the model itself grows. */
  include(point: Vector3): void;
}

export interface CadOptions {
  /** Defaults to the system's prefers-reduced-motion setting. */
  reducedMotion?: boolean;
  /** Clock in milliseconds; defaults to performance.now. */
  now?: () => number;
}

const MIN_DISTANCE = 2;
const MAX_DISTANCE = 2000;
const HOME_THETA = Math.atan2(1, 1.35);
const HOME_PHI = 0.95;
const MIN_PHI = 0.05;
const MAX_PHI = Math.PI / 2 - 0.04;
const ROTATE_PER_PIXEL = 0.006;
/** A mouse wheel notch is about 100 units; this makes one notch about 28% zoom. */
const MOUSE_ZOOM_SCALE = 0.25;
const EASE_MS = 220;
/** Breathing alone renders at about 30 frames a second. */
const BREATH_FRAME_MS = 1000 / 30;
/** Breathing fades out over this long when the user starts moving the camera. */
const BREATH_FADE_MS = 300;
/** Safari reports a pinch as gesture events; ignore them if wheel pinches are also arriving. */
const PINCH_WHEEL_MS = 200;
const PAN_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyQ",
  "KeyE",
]);

interface SafariGestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

export class CadController implements CameraController {
  private el: HTMLElement | null = null;
  private readonly target = new Vector3();
  private readonly sph = new Spherical(30, HOME_PHI, HOME_THETA);
  /** Where easing (auto-fit, double-click, F) is heading; null when not easing. */
  private goal: { target: Vector3; radius: number | null } | null = null;
  private readonly extra = new Box3();
  private readonly wheel = new WheelClassifier();
  private readonly pointers = new Map<number, Vector2>();
  private drag: { mode: "rotate" | "pan"; last: Vector2 } | null = null;
  private pinchStart: { dist: number; radius: number; mid: Vector2 } | null = null;
  private gestureScale = 1;
  private lastWheelPinch = Number.NEGATIVE_INFINITY;
  private readonly keys = new Set<string>();
  private lastInput = Number.NEGATIVE_INFINITY;
  private auto = true;
  private readonly listeners: ((on: boolean) => void)[] = [];
  private readonly reducedMotion: boolean;
  private readonly now: () => number;
  private breath = 0;
  private nextBreathFrame = Number.NEGATIVE_INFINITY;
  private lastBase = "";
  private lastRendered = "";
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly view: KlossScene,
    opts: CadOptions = {},
  ) {
    this.reducedMotion =
      opts.reducedMotion ??
      (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.now = opts.now ?? (() => performance.now());
  }

  get autoFit(): boolean {
    return this.auto;
  }

  set autoFit(on: boolean) {
    if (on === this.auto) return;
    this.auto = on;
    if (on) this.fitGoal();
    else this.goal = null;
    for (const fn of this.listeners) fn(on);
    this.view.requestRender();
  }

  onAutoFitChange(fn: (on: boolean) => void): void {
    this.listeners.push(fn);
  }

  include(point: Vector3): void {
    this.extra.expandByPoint(point);
    if (this.auto) this.fitGoal();
  }

  /** Forgets included points (the model was replaced). */
  clearIncluded(): void {
    this.extra.makeEmpty();
  }

  /** The user moved the camera: auto-fit stops and breathing fades out. */
  markInput(): void {
    this.lastInput = this.now();
    if (this.auto) this.autoFit = false;
    this.goal = null;
  }

  private fitBounds(): Box3 {
    const b = this.view.modelBounds();
    if (!this.extra.isEmpty()) b.union(this.extra);
    return b;
  }

  private goalFor(box: Box3): { target: Vector3; radius: number } {
    const sphere = box.getBoundingSphere(new Sphere());
    const cam = this.view.camera;
    const radius = fitDistance(sphere.radius, cam.fov, cam.aspect);
    return {
      target: sphere.center.clone(),
      radius: Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, radius)),
    };
  }

  private fitGoal(): void {
    this.goal = this.goalFor(this.fitBounds());
  }

  frame(box: Box3, instant = false): void {
    const g = this.goalFor(box);
    if (instant) {
      this.target.copy(g.target);
      this.sph.radius = g.radius;
      this.goal = null;
    } else {
      this.goal = g;
    }
    this.view.requestRender();
  }

  home(): void {
    this.sph.theta = HOME_THETA;
    this.sph.phi = HOME_PHI;
    this.autoFit = true;
    this.fitGoal();
  }

  // --- input -------------------------------------------------------------------------------

  private ndc(clientX: number, clientY: number): Vector2 {
    const r = (this.el as HTMLElement).getBoundingClientRect();
    return new Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
  }

  /** Camera right and up vectors in world space. */
  private axes(): { right: Vector3; up: Vector3 } {
    const cam = this.view.camera;
    cam.updateMatrixWorld();
    const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    return { right, up };
  }

  /** Moves the view so the content follows the fingers (or the pointer) by dx, dy pixels. */
  private panPixels(dx: number, dy: number): void {
    const el = this.el as HTMLElement;
    const ppp = panPerPixel(this.sph.radius, this.view.camera.fov, el.clientHeight);
    const { right, up } = this.axes();
    this.target.addScaledVector(right, -dx * ppp).addScaledVector(up, dy * ppp);
  }

  /**
   * Zooms to `radius`, keeping the point under the cursor in place. The anchor is where the
   * cursor's ray crosses the plane through the target facing the camera (as CAD tools do), not
   * whatever the ray happens to hit, so zooming over the distant floor never lurches.
   */
  private zoomTo(radius: number, clientX: number, clientY: number): void {
    const next = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, radius));
    const cam = this.view.camera;
    cam.updateMatrixWorld();
    const ray = new Raycaster();
    ray.setFromCamera(this.ndc(clientX, clientY), cam);
    const plane = new Plane().setFromNormalAndCoplanarPoint(
      cam.getWorldDirection(new Vector3()),
      this.target,
    );
    const anchor = ray.ray.intersectPlane(plane, new Vector3());
    if (anchor) this.target.lerp(anchor, 1 - next / this.sph.radius);
    this.sph.radius = next;
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.markInput();
    const kind = this.wheel.classify(e, this.now());
    if (kind === "trackpad") {
      // A swipe moves the content with the fingers, like a map.
      this.panPixels(-e.deltaX, -e.deltaY);
    } else {
      if (kind === "pinch") this.lastWheelPinch = this.now();
      const lines = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const delta = e.deltaY * lines * (kind === "mouse" ? MOUSE_ZOOM_SCALE : 1);
      this.zoomTo(
        zoomDistance(this.sph.radius, delta, MIN_DISTANCE, MAX_DISTANCE),
        e.clientX,
        e.clientY,
      );
    }
    this.view.requestRender();
  };

  /** Safari: a trackpad pinch arrives as gesture events with a running scale. */
  private onGestureStart = (e: Event): void => {
    e.preventDefault();
    this.gestureScale = (e as SafariGestureEvent).scale || 1;
  };

  private onGestureChange = (e: Event): void => {
    e.preventDefault();
    const g = e as SafariGestureEvent;
    const ratio = g.scale / (this.gestureScale || 1);
    this.gestureScale = g.scale;
    if (
      this.now() - this.lastWheelPinch < PINCH_WHEEL_MS ||
      !Number.isFinite(ratio) ||
      ratio <= 0
    ) {
      return;
    }
    this.markInput();
    this.zoomTo(this.sph.radius / ratio, g.clientX, g.clientY);
    this.view.requestRender();
  };

  private onPointerDown = (e: PointerEvent): void => {
    const el = this.el as HTMLElement;
    el.setPointerCapture(e.pointerId);
    el.focus();
    this.pointers.set(e.pointerId, new Vector2(e.clientX, e.clientY));
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [Vector2, Vector2];
      this.drag = null;
      this.pinchStart = {
        dist: a.distanceTo(b),
        radius: this.sph.radius,
        mid: a.clone().add(b).multiplyScalar(0.5),
      };
      return;
    }
    const pan = e.shiftKey || e.button === 2 || e.button === 1;
    this.drag = { mode: pan ? "pan" : "rotate", last: new Vector2(e.clientX, e.clientY) };
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.set(e.clientX, e.clientY);
    if (this.pinchStart && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [Vector2, Vector2];
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const d = a.distanceTo(b);
      this.markInput();
      this.panPixels(mid.x - this.pinchStart.mid.x, mid.y - this.pinchStart.mid.y);
      this.pinchStart.mid = mid;
      this.zoomTo((this.pinchStart.radius * this.pinchStart.dist) / Math.max(1, d), mid.x, mid.y);
      this.view.requestRender();
      return;
    }
    if (!this.drag) return;
    const dx = e.clientX - this.drag.last.x;
    const dy = e.clientY - this.drag.last.y;
    if (dx === 0 && dy === 0) return;
    // Only an actual drag counts as camera input; a plain click leaves auto-fit alone.
    this.markInput();
    this.drag.last.set(e.clientX, e.clientY);
    if (this.drag.mode === "rotate") {
      this.sph.theta -= dx * ROTATE_PER_PIXEL;
      this.sph.phi = Math.min(MAX_PHI, Math.max(MIN_PHI, this.sph.phi - dy * ROTATE_PER_PIXEL));
    } else {
      this.panPixels(dx, dy);
    }
    this.view.requestRender();
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (this.pointers.size === 0) this.drag = null;
  };

  private onDoubleClick = (e: MouseEvent): void => {
    const p = this.view.pickPoint(this.ndc(e.clientX, e.clientY));
    if (!p) return;
    this.markInput();
    this.goal = { target: p, radius: null };
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "KeyF") {
      this.autoFit = true;
      this.fitGoal();
      return;
    }
    if (e.code === "Home") {
      this.home();
      return;
    }
    if (PAN_KEYS.has(e.code)) {
      e.preventDefault();
      this.keys.add(e.code);
      this.markInput();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  attach(el: HTMLElement): void {
    this.el = el;
    const on = (
      target: HTMLElement | Window,
      type: string,
      fn: (e: never) => void,
      options?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, options);
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, options));
    };
    on(el, "wheel", this.onWheel, { passive: false });
    on(el, "pointerdown", this.onPointerDown);
    on(el, "pointermove", this.onPointerMove);
    on(el, "pointerup", this.onPointerUp);
    on(el, "pointercancel", this.onPointerUp);
    on(el, "dblclick", this.onDoubleClick);
    on(el, "contextmenu", (e: Event) => e.preventDefault());
    on(window, "keydown", this.onKeyDown);
    on(window, "keyup", this.onKeyUp);
    on(window, "blur", this.onBlur);
    on(window, "gesturestart", this.onGestureStart, { passive: false });
    on(window, "gesturechange", this.onGestureChange, { passive: false });
    on(window, "gestureend", (e: Event) => e.preventDefault(), { passive: false });
  }

  dispose(): void {
    for (const c of this.cleanups) c();
    this.cleanups.length = 0;
  }

  // --- per frame ---------------------------------------------------------------------------

  private keyboard(dtMs: number): boolean {
    if (this.keys.size === 0) return false;
    const speed = this.sph.radius * 0.9 * (dtMs / 1000);
    const forward = new Vector3();
    this.view.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-9) forward.set(0, 0, -1);
    forward.normalize();
    const right = new Vector3(-forward.z, 0, forward.x);
    const move = new Vector3();
    const has = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    if (has("KeyW", "ArrowUp")) move.add(forward);
    if (has("KeyS", "ArrowDown")) move.sub(forward);
    if (has("KeyD", "ArrowRight")) move.add(right);
    if (has("KeyA", "ArrowLeft")) move.sub(right);
    if (has("KeyE")) move.y += 1;
    if (has("KeyQ")) move.y -= 1;
    if (move.lengthSq() === 0) return false;
    this.target.addScaledVector(move.normalize(), speed);
    this.lastInput = this.now();
    return true;
  }

  private ease(dtMs: number): void {
    if (this.auto && !this.goal) {
      // Only start easing when the fit actually differs, so a fitted view goes idle.
      const g = this.goalFor(this.fitBounds());
      if (g.target.distanceTo(this.target) > 1e-3 || Math.abs(g.radius - this.sph.radius) > 1e-3) {
        this.goal = g;
      }
    }
    if (!this.goal) return;
    const k = 1 - Math.exp(-dtMs / EASE_MS);
    this.target.lerp(this.goal.target, k);
    if (this.goal.radius !== null) this.sph.radius += (this.goal.radius - this.sph.radius) * k;
    const done =
      this.target.distanceTo(this.goal.target) < 1e-3 &&
      (this.goal.radius === null || Math.abs(this.goal.radius - this.sph.radius) < 1e-3);
    if (done) {
      this.target.copy(this.goal.target);
      if (this.goal.radius !== null) this.sph.radius = this.goal.radius;
      this.goal = null;
    }
  }

  update(dtMs: number): boolean {
    const now = this.now();
    this.keyboard(dtMs);
    this.ease(dtMs);

    // Breathing fades in by breathWeight and fades out over BREATH_FADE_MS, never snapping.
    const want = this.reducedMotion ? 0 : breathWeight(now - this.lastInput);
    this.breath = want >= this.breath ? want : Math.max(want, this.breath - dtMs / BREATH_FADE_MS);

    const base = `${this.target.toArray().join()}|${this.sph.radius}|${this.sph.theta}|${this.sph.phi}`;
    const baseChanged = base !== this.lastBase;
    this.lastBase = base;
    if (!baseChanged) {
      if (this.breath <= 0 && this.lastRendered !== "") return false;
      // Breathing alone renders at about 30 frames a second.
      if (now < this.nextBreathFrame) return false;
      this.nextBreathFrame =
        now - this.nextBreathFrame > 100
          ? now + BREATH_FRAME_MS
          : this.nextBreathFrame + BREATH_FRAME_MS;
    }

    const b = breathOffset(now);
    const rendered = new Spherical(
      this.sph.radius,
      Math.min(MAX_PHI, Math.max(MIN_PHI, this.sph.phi + this.breath * b.pitch)),
      this.sph.theta + this.breath * b.yaw,
    );
    const cam = this.view.camera;
    cam.position.setFromSpherical(rendered).add(this.target);
    cam.lookAt(this.target);
    this.view.target.copy(this.target);

    const key = cam.position.toArray().join();
    const changed = key !== this.lastRendered;
    this.lastRendered = key;
    if (changed) this.view.requestRender();
    return changed;
  }
}
