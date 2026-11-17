import { expect, test } from "bun:test";
import { guardedFrame } from "../../src/web/frame.ts";

test("an error in one frame is reported and the next frame still comes", () => {
  const scheduled: ((now: number) => void)[] = [];
  const errors: unknown[] = [];
  let calls = 0;
  const frame = guardedFrame(
    () => {
      calls++;
      if (calls === 1) throw new Error("boom");
    },
    (cb) => scheduled.push(cb),
    (e) => errors.push(e),
  );
  frame(0);
  expect(errors).toHaveLength(1);
  expect(scheduled).toHaveLength(1);
  scheduled[0]?.(16);
  expect(calls).toBe(2);
  expect(scheduled).toHaveLength(2);
});
