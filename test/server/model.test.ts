import { describe, expect, test } from "bun:test";
import { FormatError } from "../../src/core/format.ts";
import { LimitError, Model, type ModelEvent } from "../../src/server/model.ts";

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected an error");
}

describe("Model", () => {
  test("starts empty, or from .kl text", () => {
    expect(new Model().klossar).toHaveLength(0);
    const m = Model.from("0,0|2x2|red\n.\n");
    expect(m.klossar.map((k) => k.level)).toEqual([0, 1]);
  });

  test("from refuses invalid text with its line number", () => {
    const e = thrown(() => Model.from("0,0|2x2|red\n0,0|2x2|teal\n"));
    expect(e).toBeInstanceOf(FormatError);
    expect((e as FormatError).line).toBe(2);
  });

  test("drop places a kloss, remembers who dropped it, and notifies", () => {
    const m = new Model();
    const events: ModelEvent[] = [];
    m.subscribe((e) => events.push(e));
    const k = m.drop({ size: "2x2", color: "red", x: 0, y: 0 }, "ada@example.com");
    expect(k).toEqual({
      index: 0,
      size: "2x2",
      color: "red",
      x: 0,
      y: 0,
      level: 0,
      by: "ada@example.com",
    });
    expect(events).toEqual([{ type: "drop", kloss: k }]);
  });

  test("dropLine fills in size and color from the last kloss, and repeats with a dot", () => {
    const m = Model.from("1,1|4x2|gray\n");
    expect(m.dropLine("1,1|2x2")).toMatchObject({ size: "2x2", color: "gray", level: 1 });
    expect(m.dropLine("5,1")).toMatchObject({ x: 5, y: 1, size: "2x2", color: "gray" });
    expect(m.dropLine(".")).toMatchObject({ x: 5, y: 1, level: 1 });
  });

  test("dropLine on an empty model needs a full line", () => {
    const m = new Model();
    expect(thrown(() => m.dropLine("."))).toBeInstanceOf(FormatError);
    expect(thrown(() => m.dropLine("5,1"))).toBeInstanceOf(FormatError);
    expect(thrown(() => m.dropLine("# only a comment"))).toBeInstanceOf(FormatError);
  });

  test("text() is the model as formatted .kl, which reads back to the same model", () => {
    const m = Model.from("1,1|4x2|gray\n1,1|2x2\n5,1\n.\n");
    expect(m.text()).toBe("  1,  1 | 4x2 | gray\n  1,  1 | 2x2\n  5,  1\n.\n");
    expect(Model.from(m.text()).klossar).toEqual(m.klossar);
  });

  test("replace swaps the model atomically, or changes nothing on error", () => {
    const m = Model.from("0,0|2x2|red\n");
    const events: ModelEvent[] = [];
    m.subscribe((e) => events.push(e));
    expect(thrown(() => m.replace("0,0|1x1|blue\n0,0|9x9|red\n"))).toBeInstanceOf(FormatError);
    expect(m.klossar).toHaveLength(1);
    const placed = m.replace("0,0|1x1|blue\n.\n");
    expect(placed.map((k) => k.level)).toEqual([0, 1]);
    expect(events).toEqual([{ type: "model", klossar: placed }]);
  });

  test("the kloss limit holds for drop and replace", () => {
    const full = `${Array.from({ length: 10_000 }, (_, i) => (i === 0 ? "0,0|1x1|red" : ".")).join("\n")}\n`;
    const m = Model.from(full);
    expect(thrown(() => m.drop({ size: "1x1", color: "red", x: 0, y: 0 }))).toBeInstanceOf(
      LimitError,
    );
    expect(thrown(() => m.replace(`${full}.\n`))).toBeInstanceOf(LimitError);
    expect(thrown(() => Model.from(`${full}.\n`))).toBeInstanceOf(LimitError);
  });

  test("unsubscribe stops events, and lastChange moves with every change", () => {
    let now = 1000;
    const m = new Model(() => now);
    const events: ModelEvent[] = [];
    const off = m.subscribe((e) => events.push(e));
    off();
    now = 5000;
    m.drop({ size: "1x1", color: "red", x: 0, y: 0 });
    expect(events).toHaveLength(0);
    expect(m.lastChange).toBe(5000);
  });
});
