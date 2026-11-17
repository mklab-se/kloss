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
