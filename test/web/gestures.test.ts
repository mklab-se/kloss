import { describe, expect, test } from "bun:test";
import {
  breathOffset,
  breathWeight,
  fitDistance,
  panPerPixel,
  WheelClassifier,
  zoomDistance,
} from "../../src/web/gestures.ts";

const wheel = (
  deltaX: number,
  deltaY: number,
  extra: { deltaMode?: number; ctrlKey?: boolean } = {},
) => ({
  deltaX,
  deltaY,
  deltaMode: extra.deltaMode ?? 0,
  ctrlKey: extra.ctrlKey ?? false,
});
const deg = (d: number) => (d * Math.PI) / 180;

describe("WheelClassifier", () => {
  test("a pinch arrives with ctrlKey and is always a pinch", () => {
    const c = new WheelClassifier();
    expect(c.classify(wheel(0, 100, { ctrlKey: true }), 0)).toBe("pinch");
    expect(c.classify(wheel(0, 1, { deltaMode: 1, ctrlKey: true }), 0)).toBe("pinch");
  });

  test("line-based deltas come from a mouse wheel", () => {
    expect(new WheelClassifier().classify(wheel(0, 3, { deltaMode: 1 }), 0)).toBe("mouse");
  });

  test("trackpad swipes are never misread: fractional deltas, or any sideways movement", () => {
    expect(new WheelClassifier().classify(wheel(0, 3.5), 0)).toBe("trackpad");
    expect(new WheelClassifier().classify(wheel(2, 100), 0)).toBe("trackpad");
    expect(new WheelClassifier().classify(wheel(0, 4), 0)).toBe("trackpad");
  });

  test("a large whole vertical step with no recent trackpad events is a mouse", () => {
    expect(new WheelClassifier().classify(wheel(0, 100), 0)).toBe("mouse");
    expect(new WheelClassifier().classify(wheel(0, -120), 0)).toBe("mouse");
  });

  test("trackpad is sticky for a second", () => {
    const c = new WheelClassifier();
    expect(c.classify(wheel(0, 3.5), 0)).toBe("trackpad");
    expect(c.classify(wheel(0, 100), 500)).toBe("trackpad");
    expect(c.classify(wheel(0, 100), 1500)).toBe("trackpad");
    expect(c.classify(wheel(0, 100), 2600)).toBe("mouse");
  });
});

describe("camera math", () => {
  test("panPerPixel matches the visible height at the target", () => {
    expect(panPerPixel(10, 50, 1000)).toBeCloseTo((2 * 10 * Math.tan(deg(25))) / 1000, 10);
  });

  test("zoomDistance is exponential and clamped", () => {
    expect(zoomDistance(10, 100, 2, 2000)).toBeGreaterThan(10);
    expect(zoomDistance(10, -100, 2, 2000)).toBeLessThan(10);
    expect(zoomDistance(10, 100, 2, 2000) / 10).toBeCloseTo(
      10 / zoomDistance(10, -100, 2, 2000),
      10,
    );
    expect(zoomDistance(3, -100_000, 2, 2000)).toBe(2);
    expect(zoomDistance(1000, 100_000, 2, 2000)).toBe(2000);
  });

  test("fitDistance frames a sphere with a margin and a minimum size", () => {
    expect(fitDistance(1, 50, 16 / 9)).toBe(fitDistance(6, 50, 16 / 9));
    expect(fitDistance(20, 50, 16 / 9)).toBeCloseTo((1.1 * 20) / Math.sin(deg(25)), 10);
    expect(fitDistance(20, 50, 0.5)).toBeGreaterThan(fitDistance(20, 50, 16 / 9));
  });
});

describe("breathing", () => {
  test("stays within 0.6 degrees, starts at rest, and moves", () => {
    const limit = deg(0.6) + 1e-12;
    for (let t = 0; t <= 120_000; t += 50) {
      const o = breathOffset(t);
      expect(Math.abs(o.yaw)).toBeLessThanOrEqual(limit);
      expect(Math.abs(o.pitch)).toBeLessThanOrEqual(limit);
    }
    expect(breathOffset(0)).toEqual({ yaw: 0, pitch: 0 });
    expect(breathOffset(2000)).not.toEqual(breathOffset(4000));
  });

  test("fades in after three seconds of stillness", () => {
    expect(breathWeight(0)).toBe(0);
    expect(breathWeight(2999)).toBe(0);
    expect(breathWeight(3500)).toBeGreaterThan(0);
    expect(breathWeight(3500)).toBeLessThan(1);
    expect(breathWeight(4000)).toBe(1);
    expect(breathWeight(1e9)).toBe(1);
  });
});
