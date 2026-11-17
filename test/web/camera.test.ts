import { describe, expect, test } from "bun:test";
import { Box3, PerspectiveCamera, Vector3 } from "three";
import { CadController } from "../../src/web/camera.ts";
import type { KlossScene } from "../../src/web/scene.ts";

function fakeView(): KlossScene {
  const camera = new PerspectiveCamera(45, 16 / 9, 0.1, 5000);
  return {
    camera,
    target: new Vector3(),
    modelBounds: () => new Box3(new Vector3(-6, 0, -6), new Vector3(6, 2, 6)),
    requestRender() {},
    pickPoint: () => null,
  } as unknown as KlossScene;
}

function setup(reducedMotion: boolean, start = 0) {
  let now = start;
  const view = fakeView();
  const c = new CadController(view, { reducedMotion, now: () => now });
  c.frame(view.modelBounds(), true);
  return {
    c,
    view,
    tick(ms: number): boolean {
      now += ms;
      return c.update(ms);
    },
  };
}

describe("CadController rendering", () => {
  test("once fitted and still, it stops asking for frames", () => {
    const { tick } = setup(true);
    for (let i = 0; i < 30; i++) tick(16);
    const after = Array.from({ length: 20 }, () => tick(16));
    expect(after.every((moved) => !moved)).toBe(true);
  });

  test("breathing alone asks for about 30 frames a second", () => {
    const { tick } = setup(false, 10_000);
    for (let i = 0; i < 30; i++) tick(8);
    let frames = 0;
    for (let i = 0; i < 125; i++) if (tick(8)) frames++;
    expect(frames).toBeGreaterThanOrEqual(25);
    expect(frames).toBeLessThanOrEqual(33);
  });

  test("breathing fades out on input instead of snapping", () => {
    const { c, view, tick } = setup(false, 10_000);
    for (let i = 0; i < 60; i++) tick(16);
    const before = view.camera.position.clone();
    c.markInput();
    tick(16);
    const after = view.camera.position.clone();
    expect(before.distanceTo(after)).toBeLessThan(0.05);
  });
});

describe("CadController input", () => {
  test("a click without moving keeps auto-fit on", () => {
    const { c } = setup(true);
    const el = {
      setPointerCapture() {},
      focus() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      clientHeight: 600,
    };
    const internals = c as unknown as {
      el: unknown;
      onPointerDown(e: unknown): void;
      onPointerUp(e: unknown): void;
      onPointerMove(e: unknown): void;
    };
    internals.el = el;
    const down = { pointerId: 1, clientX: 100, clientY: 100, button: 0, shiftKey: false };
    internals.onPointerDown(down);
    internals.onPointerUp(down);
    expect(c.autoFit).toBe(true);
    internals.onPointerDown(down);
    internals.onPointerMove({ ...down, clientX: 140 });
    expect(c.autoFit).toBe(false);
  });
});

describe("pinch zoom", () => {
  test("pinching over the distant floor zooms without throwing the view toward it", () => {
    const view = fakeView();
    // the old behaviour anchored zoom on whatever the pointer hit, here the floor far away
    (view as unknown as { pickPoint: () => Vector3 }).pickPoint = () => new Vector3(500, 0, 500);
    const c = new CadController(view, { reducedMotion: true, now: () => 0 });
    c.frame(view.modelBounds(), true);
    c.update(16);
    const internals = c as unknown as {
      el: unknown;
      onWheel(e: unknown): void;
      sph: { radius: number };
    };
    internals.el = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }),
      clientHeight: 450,
    };
    const startTarget = view.target.clone();
    const startRadius = internals.sph.radius;
    for (let i = 0; i < 5; i++) {
      internals.onWheel({
        preventDefault() {},
        deltaX: 0,
        deltaY: -10,
        deltaMode: 0,
        ctrlKey: true,
        clientX: 760,
        clientY: 40,
      });
      c.update(16);
    }
    expect(internals.sph.radius).toBeLessThan(startRadius * 0.7);
    expect(view.target.distanceTo(startTarget)).toBeLessThan(startRadius * 0.5);
  });
});

describe("keyboard and gestures (Fusion 360 and Cities: Skylines II conventions)", () => {
  function controller() {
    let now = 0;
    const view = fakeView();
    const c = new CadController(view, { reducedMotion: true, now: () => now });
    c.frame(view.modelBounds(), true);
    c.update(16);
    const internals = c as unknown as {
      el: unknown;
      sph: { radius: number; theta: number; phi: number };
      onKeyDown(e: unknown): void;
      onKeyUp(e: unknown): void;
      onWheel(e: unknown): void;
    };
    internals.el = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }),
      clientHeight: 450,
    };
    const key = (code: string, key = "", extra: Record<string, unknown> = {}) => ({
      code,
      key,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() {},
      ...extra,
    });
    const hold = (code: string, keyName = "", ms = 500) => {
      internals.onKeyDown(key(code, keyName));
      for (let t = 0; t < ms; t += 16) {
        now += 16;
        c.update(16);
      }
      internals.onKeyUp(key(code, keyName));
    };
    return { c, view, internals, key, hold };
  }

  test("Q and E rotate around the model in opposite directions, without moving it", () => {
    const { view, internals, hold } = controller();
    const target = view.target.clone();
    const theta = internals.sph.theta;
    hold("KeyQ", "q");
    const afterQ = internals.sph.theta;
    expect(afterQ).not.toBeCloseTo(theta, 3);
    hold("KeyE", "e");
    hold("KeyE", "e");
    expect(Math.sign(internals.sph.theta - afterQ)).toBe(-Math.sign(afterQ - theta));
    expect(view.target.distanceTo(target)).toBeLessThan(1e-6);
  });

  test("+ zooms in and - zooms out, by the character typed (Swedish + sits on the Minus key)", () => {
    const { internals, hold } = controller();
    const r0 = internals.sph.radius;
    hold("Minus", "+");
    const r1 = internals.sph.radius;
    expect(r1).toBeLessThan(r0 * 0.8);
    hold("Slash", "-");
    expect(internals.sph.radius).toBeGreaterThan(r1 * 1.25);
  });

  test("F6 fits the model and turns auto-fit back on, like F", () => {
    const { c, internals, key } = controller();
    c.markInput();
    expect(c.autoFit).toBe(false);
    let prevented = false;
    internals.onKeyDown(key("F6", "F6", { preventDefault: () => (prevented = true) }));
    expect(c.autoFit).toBe(true);
    expect(prevented).toBe(true);
  });

  test("Shift + two-finger swipe rotates instead of panning", () => {
    const { view, internals } = controller();
    const target = view.target.clone();
    const theta = internals.sph.theta;
    internals.onWheel({
      preventDefault() {},
      deltaX: 30.5,
      deltaY: 0,
      deltaMode: 0,
      ctrlKey: false,
      shiftKey: true,
      clientX: 400,
      clientY: 225,
    });
    expect(internals.sph.theta).not.toBeCloseTo(theta, 3);
    expect(view.target.distanceTo(target)).toBeLessThan(1e-6);
  });
});
