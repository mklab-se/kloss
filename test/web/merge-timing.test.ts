import { describe, expect, test } from "bun:test";
import {
  GROW_START_MS,
  groupLength,
  growState,
  MAX_RIPPLE_MS,
  pluppRise,
  puffsPerKloss,
  schedule,
} from "../../src/web/merge-timing.ts";

describe("poof and grow timing", () => {
  test("the kloss that stays waits for the smoke, grows, then settles with a small squash", () => {
    expect(growState(0)).toEqual({ grow: 0, squash: 1 });
    expect(growState(GROW_START_MS).grow).toBe(0);
    const mid = growState(GROW_START_MS + 200);
    expect(mid.grow).toBeGreaterThan(0.3);
    expect(mid.grow).toBeLessThan(1);
    expect(growState(5_000)).toEqual({ grow: 1, squash: 1 });
    // squashed a little right after growing
    const squashed = Math.min(
      ...Array.from({ length: 40 }, (_, i) => growState(GROW_START_MS + 400 + i * 10).squash),
    );
    expect(squashed).toBeLessThan(0.95);
    expect(squashed).toBeGreaterThan(0.85);
  });

  test("new pluppar rise only once the kloss has its full size, the nearest first", () => {
    const fullSize = Array.from({ length: 200 }, (_, i) => i * 10).find(
      (t) => growState(t).grow === 1,
    ) as number;
    for (let t = 0; t <= fullSize; t += 10) expect(pluppRise(t, 1)).toBeNull();
    const near = Array.from({ length: 300 }, (_, i) => i * 10).find(
      (t) => pluppRise(t, 1) !== null,
    );
    const far = Array.from({ length: 300 }, (_, i) => i * 10).find((t) => pluppRise(t, 3) !== null);
    expect(far as number).toBeGreaterThan(near as number);
    // they overshoot a little, then stand at full height
    const peak = Math.max(...Array.from({ length: 300 }, (_, i) => pluppRise(i * 10, 1) ?? 0));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.25);
    expect(pluppRise(groupLength(1), 1)).toBe(1);
  });

  test("a group is done when its farthest plupp stands", () => {
    expect(groupLength(3)).toBeGreaterThan(groupLength(1));
    expect(pluppRise(groupLength(3), 3)).toBe(1);
  });

  test("levels ripple upward, and a level sweeps across in a few slots", () => {
    const starts = schedule([
      { level: 0, x: 0, y: 0 },
      { level: 0, x: 9, y: 9 },
      { level: 1, x: 0, y: 0 },
      { level: 3, x: 0, y: 0 },
    ]);
    expect(starts[0]).toBe(0);
    expect(starts[1] as number).toBeGreaterThan(0);
    expect(starts[2] as number).toBeGreaterThan(starts[0] as number);
    expect(starts[3] as number).toBeGreaterThan(starts[2] as number);
  });

  test("a tall model's ripple stays short, and a level uses few distinct start times", () => {
    const groups = Array.from({ length: 5_000 }, (_, i) => ({
      level: i % 100,
      x: (i * 7) % 60,
      y: (i * 13) % 60,
    }));
    const starts = schedule(groups);
    expect(Math.max(...starts)).toBeLessThanOrEqual(MAX_RIPPLE_MS);
    // klossar that start together share a material, so there must be few start times
    expect(new Set(starts).size).toBeLessThanOrEqual(100 * 4);
    expect(new Set(starts.filter((_, i) => groups[i]?.level === 5)).size).toBeLessThanOrEqual(4);
  });

  test("the smoke gets thinner per kloss when many klossar poof at once", () => {
    expect(puffsPerKloss(1)).toBe(10);
    expect(puffsPerKloss(50)).toBe(10);
    expect(puffsPerKloss(500)).toBeLessThan(10);
    expect(puffsPerKloss(5_000)).toBe(1);
    expect(puffsPerKloss(200) * 200).toBeLessThanOrEqual(1_000);
  });
});
