import { describe, expect, test } from "bun:test";
import { dropTiming } from "../../src/web/drop-timing.ts";

describe("dropTiming", () => {
  test("a few waiting drops play at full length", () => {
    expect(dropTiming(1)).toEqual({ fallMs: 600, settleMs: 200 });
    expect(dropTiming(3)).toEqual({ fallMs: 600, settleMs: 200 });
  });

  test("dozens waiting play at about a tenth of a second", () => {
    expect(dropTiming(40)).toEqual({ fallMs: 100, settleMs: 33 });
    expect(dropTiming(100)).toEqual({ fallMs: 100, settleMs: 33 });
  });

  test("in between it speeds up", () => {
    const t = dropTiming(21);
    if (t === "snap") throw new Error("unexpected snap");
    expect(t.fallMs).toBeLessThan(600);
    expect(t.fallMs).toBeGreaterThan(100);
  });

  test("above 200 waiting, drops snap into place", () => {
    expect(dropTiming(200)).not.toBe("snap");
    expect(dropTiming(201)).toBe("snap");
  });

  test("never slows down as the queue grows", () => {
    let last = Number.POSITIVE_INFINITY;
    for (let n = 1; n <= 200; n++) {
      const t = dropTiming(n);
      if (t === "snap") throw new Error("unexpected snap");
      expect(t.fallMs).toBeLessThanOrEqual(last);
      last = t.fallMs;
    }
  });
});
