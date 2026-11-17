import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FormatError } from "../../src/core/format.ts";
import type { KlossInput } from "../../src/core/types.ts";
import { LimitError, type ModelEvent, ModelStore } from "../../src/server/model-store.ts";

let dir = "";
let file = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kloss-"));
  file = join(dir, "m.kl");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const red = (x: number, y: number): KlossInput => ({ size: "2x2", color: "red", x, y });

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection");
}

describe("ModelStore", () => {
  test("open creates a missing file and starts empty", async () => {
    const store = await ModelStore.open(file);
    expect(store.klossar).toHaveLength(0);
    expect(await readFile(file, "utf8")).toBe("");
    expect(store.path).toBe(file);
  });

  test("open refuses an invalid file with its line number", async () => {
    await writeFile(file, "0,0|2x2|red\n0,0|2x2|teal\n");
    const e = await rejection(ModelStore.open(file));
    expect(e).toBeInstanceOf(FormatError);
    expect((e as FormatError).line).toBe(2);
  });

  test("drop places, appends and notifies", async () => {
    const store = await ModelStore.open(file);
    const events: ModelEvent[] = [];
    store.subscribe((e) => events.push(e));
    const placed = await store.drop(red(0, 0));
    expect(placed).toEqual({ index: 0, size: "2x2", color: "red", x: 0, y: 0, level: 0 });
    expect(await readFile(file, "utf8")).toBe("  0,  0 | 2x2 | red\n");
    expect(events).toEqual([{ type: "drop", kloss: placed }]);
  });

  test("a file without a trailing newline gets the new kloss on its own line", async () => {
    await writeFile(file, "0,0|2x2|red");
    const store = await ModelStore.open(file);
    await store.drop({ size: "1x1", color: "blue", x: 5, y: 5 });
    expect(await readFile(file, "utf8")).toBe("0,0|2x2|red\n  5,  5 | 1x1 | blue\n");
    expect((await ModelStore.open(file)).klossar).toHaveLength(2);
  });

  test("comments and blank lines survive a drop", async () => {
    await writeFile(file, "# castle\n\n0,0|2x2|red\n");
    const store = await ModelStore.open(file);
    await store.drop(red(0, 0));
    expect(await readFile(file, "utf8")).toBe("# castle\n\n0,0|2x2|red\n.\n");
  });

  test("concurrent drops land in call order, in memory and in the file", async () => {
    const store = await ModelStore.open(file);
    const placed = await Promise.all(
      Array.from({ length: 50 }, (_, i) => store.drop(red(i % 3, 0))),
    );
    expect(placed.map((k) => k.index)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    const reopened = await ModelStore.open(file);
    expect(reopened.klossar).toEqual(store.klossar);
    expect(reopened.klossar.map((k) => k.level)).toEqual(placed.map((k) => k.level));
  });

  test("replace rewrites the file verbatim and notifies", async () => {
    const store = await ModelStore.open(file);
    const events: ModelEvent[] = [];
    store.subscribe((e) => events.push(e));
    const text = "# new\n0,0|1x1|blue\n.\n";
    const klossar = await store.replace(text);
    expect(klossar.map((k) => k.level)).toEqual([0, 1]);
    expect(await readFile(file, "utf8")).toBe(text);
    expect(await store.text()).toBe(text);
    expect(events).toEqual([{ type: "model", klossar }]);
  });

  test("replace with an invalid line changes nothing", async () => {
    await writeFile(file, "0,0|2x2|red\n");
    const store = await ModelStore.open(file);
    const e = await rejection(store.replace("0,0|1x1|blue\n0,0|9x9|red\n"));
    expect((e as FormatError).line).toBe(2);
    expect(await readFile(file, "utf8")).toBe("0,0|2x2|red\n");
    expect(store.klossar).toHaveLength(1);
  });

  test("unsubscribe stops events", async () => {
    const store = await ModelStore.open(file);
    const events: ModelEvent[] = [];
    const off = store.subscribe((e) => events.push(e));
    off();
    await store.drop(red(0, 0));
    expect(events).toHaveLength(0);
  });

  test("the kloss limit is enforced for drop and replace", async () => {
    const full = `${Array.from({ length: 10_000 }, (_, i) => (i === 0 ? "0,0|1x1|red" : ".")).join("\n")}\n`;
    await writeFile(file, full);
    const store = await ModelStore.open(file);
    expect(await rejection(store.drop(red(0, 0)))).toBeInstanceOf(LimitError);
    expect(await rejection(store.replace(`${full}.\n`))).toBeInstanceOf(LimitError);
    expect(store.klossar).toHaveLength(10_000);
  });

  test("dropLine fills in a left-out size and color from the last kloss, or repeats it", async () => {
    await writeFile(file, "1,1|4x2|gray\n");
    const store = await ModelStore.open(file);
    expect(await store.dropLine("1,1|2x2")).toMatchObject({ size: "2x2", color: "gray", level: 1 });
    expect(await store.dropLine("5,1")).toMatchObject({ x: 5, y: 1, size: "2x2", color: "gray" });
    expect(await store.dropLine(".")).toMatchObject({ x: 5, y: 1, level: 1 });
    expect(await readFile(file, "utf8")).toBe("1,1|4x2|gray\n  1,  1 | 2x2\n  5,  1\n.\n");
  });

  test("dropLine on an empty model needs a full line", async () => {
    const store = await ModelStore.open(file);
    expect(await rejection(store.dropLine("."))).toBeInstanceOf(FormatError);
    expect(await rejection(store.dropLine("5,1"))).toBeInstanceOf(FormatError);
    expect(store.klossar).toHaveLength(0);
  });

  test("concurrent carry-over drops each use the kloss dropped just before them", async () => {
    const store = await ModelStore.open(file);
    await Promise.all([
      store.dropLine("0,0|2x2|red"),
      store.dropLine("5,5"),
      store.dropLine("9,9|blue"),
      store.dropLine("."),
    ]);
    expect(store.klossar.map((k) => `${k.x},${k.y} ${k.color}`)).toEqual([
      "0,0 red",
      "5,5 red",
      "9,9 blue",
      "9,9 blue",
    ]);
  });

  test("appends line up with the widest coordinate already in the file", async () => {
    await writeFile(file, "-1000,0|1x1|red\n");
    const store = await ModelStore.open(file);
    await store.drop({ size: "1x1", color: "red", x: 3, y: 4 });
    expect(await readFile(file, "utf8")).toBe("-1000,0|1x1|red\n    3,    4\n");
  });
});
