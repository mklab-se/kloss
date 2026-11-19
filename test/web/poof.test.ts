import { describe, expect, test } from "bun:test";
import { POOF_MS, poofState } from "../../src/web/poof-timing.ts";

describe("poofState", () => {
  test("starts as the kloss itself, and is over after POOF_MS", () => {
    const start = poofState(0);
    expect(start?.ghostScale).toBeCloseTo(1, 6);
    expect(start?.ghostOpacity).toBeCloseTo(1, 6);
    expect(poofState(POOF_MS)).toBeNull();
    expect(poofState(POOF_MS + 100)).toBeNull();
  });

  test("the ghost swells and fades; the puffs spread, rise and fade", () => {
    let last = poofState(0);
    for (let t = 20; t < POOF_MS; t += 20) {
      const s = poofState(t);
      if (!s || !last) throw new Error("ended early");
      expect(s.ghostScale).toBeGreaterThanOrEqual(last.ghostScale);
      expect(s.ghostOpacity).toBeLessThanOrEqual(last.ghostOpacity);
      expect(s.puffSpread).toBeGreaterThanOrEqual(last.puffSpread);
      expect(s.puffRise).toBeGreaterThanOrEqual(last.puffRise);
      last = s;
    }
    expect(last?.ghostOpacity).toBeLessThan(0.1);
    expect(last?.puffOpacity).toBeLessThan(0.2);
  });
});
