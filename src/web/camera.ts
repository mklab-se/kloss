/**
 * The CAD camera, tuned for a Mac trackpad: swipe pans, pinch zooms toward the pointer, drag
 * rotates, double-click re-centers. Auto-fit keeps the whole model in view until the user moves
 * the camera, and the camera breathes ever so slightly while idle.
 *
 * Controllers sit behind CameraController so a walk mode can be added later.
 */
import { Box3, Sphere, Spherical, Vector2, Vector3 } from "three";
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
  /** Advances the camera; returns true when it moved (or is breathing). */
  update(dtMs: number): boolean;
  frame(box: Box3, instant?: boolean): void;
  home(): void;
  dispose(): void;
  autoFit: boolean;
  onAutoFitChange(fn: (on: boolean) => void): void;
  /** Widens auto-fit to a point (a drop's landing spot) before the model itself grows. */
  include(point: Vector3): void;
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
  private readonly keys = new Set<string>();
  private lastInput = Number.NEGATIVE_INFINITY;
  private auto = true;
  private readonly listeners: ((on: boolean) => void)[] = [];
  private readonly reducedMotion: boolean;
  private lastRendered = "";
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly view: KlossScene) {
    this.reducedMotion =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
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

  /** Called by the user's own camera input: auto-fit stops, breathing pauses. */
  private userInput(): void {
    this.lastInput = performance.now();
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
    return {
      target: sphere.center.clone(),
      radius: fitDistance(sphere.radius, cam.fov, cam.aspect),
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
    this.lastInput = performance.now();
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

  /** Zooms to `radius`, keeping the point under the cursor in place. */
  private zoomTo(radius: number, clientX: number, clientY: number): void {
    const next = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, radius));
    const p = this.view.pickPoint(this.ndc(clientX, clientY));
    if (p && p.distanceTo(this.view.camera.position) < this.sph.radius * 20) {
      this.target.lerp(p, 1 - next / this.sph.radius);
    }
    this.sph.radius = next;
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.userInput();
    const kind = this.wheel.classify(e, performance.now());
    if (kind === "trackpad") {
      // A swipe moves the content with the fingers, like a map.
      this.panPixels(-e.deltaX, -e.deltaY);
    } else {
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

  private onPointerDown = (e: PointerEvent): void => {
    const el = this.el as HTMLElement;
    el.setPointerCapture(e.pointerId);
    el.focus();
    this.pointers.set(e.pointerId, new Vector2(e.clientX, e.clientY));
    this.userInput();
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
      this.panPixels(mid.x - this.pinchStart.mid.x, mid.y - this.pinchStart.mid.y);
      this.pinchStart.mid = mid;
      this.zoomTo((this.pinchStart.radius * this.pinchStart.dist) / Math.max(1, d), mid.x, mid.y);
      this.lastInput = performance.now();
      this.view.requestRender();
      return;
    }
    if (!this.drag) return;
    const dx = e.clientX - this.drag.last.x;
    const dy = e.clientY - this.drag.last.y;
    this.drag.last.set(e.clientX, e.clientY);
    if (this.drag.mode === "rotate") {
      this.sph.theta -= dx * ROTATE_PER_PIXEL;
      this.sph.phi = Math.min(MAX_PHI, Math.max(MIN_PHI, this.sph.phi - dy * ROTATE_PER_PIXEL));
    } else {
      this.panPixels(dx, dy);
    }
    this.lastInput = performance.now();
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
    this.userInput();
    this.goal = { target: p, radius: null };
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "KeyF") {
      this.lastInput = performance.now();
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
      this.userInput();
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
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
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
    on(el, "contextmenu", (e) => e.preventDefault());
    on(window, "keydown", this.onKeyDown);
    on(window, "keyup", this.onKeyUp);
    on(window, "blur", this.onBlur);
    // Safari's own pinch gesture would zoom the page; the wheel events already handle it.
    for (const type of ["gesturestart", "gesturechange"]) {
      const stop = (e: Event) => e.preventDefault();
      window.addEventListener(type, stop);
      this.cleanups.push(() => window.removeEventListener(type, stop));
    }
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
    this.lastInput = performance.now();
    return true;
  }

  update(dtMs: number): boolean {
    let moved = this.keyboard(dtMs);
    if (this.auto && !this.goal) this.fitGoal();
    if (this.goal) {
      const k = 1 - Math.exp(-dtMs / EASE_MS);
      this.target.lerp(this.goal.target, k);
      if (this.goal.radius !== null) {
        this.sph.radius += (this.goal.radius - this.sph.radius) * k;
      }
      const done =
        this.target.distanceTo(this.goal.target) < 1e-3 &&
        (this.goal.radius === null || Math.abs(this.goal.radius - this.sph.radius) < 1e-3);
      if (done) {
        this.target.copy(this.goal.target);
        if (this.goal.radius !== null) this.sph.radius = this.goal.radius;
        this.goal = null;
      }
      moved = true;
    }

    // Breathing: a tiny sway applied to the rendered camera only.
    const weight = this.reducedMotion ? 0 : breathWeight(performance.now() - this.lastInput);
    const b = breathOffset(performance.now());
    const rendered = new Spherical(
      this.sph.radius,
      Math.min(MAX_PHI, Math.max(MIN_PHI, this.sph.phi + weight * b.pitch)),
      this.sph.theta + weight * b.yaw,
    );
    const cam = this.view.camera;
    cam.position.setFromSpherical(rendered).add(this.target);
    cam.lookAt(this.target);
    this.view.target.copy(this.target);

    const key = `${cam.position.toArray().join()}`;
    const changed = key !== this.lastRendered;
    this.lastRendered = key;
    if (changed) this.view.requestRender();
    return moved || changed;
  }
}
