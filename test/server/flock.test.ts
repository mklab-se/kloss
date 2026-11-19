import { describe, expect, test } from "bun:test";
import { type ChickenMove, Flock, type FlockEvent, MAX_CHICKENS } from "../../src/server/flock.ts";
import { Model } from "../../src/server/model.ts";

/** A seeded random, so every run is the same. */
function seeded(seed = 1): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setup(text = "", seed = 1) {
  let now = 1_000;
  const model = text ? Model.from(text, () => now) : new Model(() => now);
  const flock = new Flock(model, { now: () => now, random: seeded(seed), every: () => () => {} });
  const events: FlockEvent[] = [];
  flock.subscribe((e) => events.push(e));
  /** Moves the clock on, stepping the flock as its timer would. */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      now += 100;
      flock.step();
    }
  };
  const moves = () => events.flatMap((e) => (e.type === "moves" ? e.moves : [])) as ChickenMove[];
  return { model, flock, events, run, moves, time: () => now };
}

describe("spawning chickens", () => {
  test("chickens fall from the sky onto the top of the model, spread out", () => {
    const { flock } = setup("0,0|8x2|gray\n0,2\n0,4\n0,6\n");
    const spawned = flock.spawn({ count: 5, by: "ada@example.com" });
    expect(spawned).toHaveLength(5);
    for (const c of spawned) {
      expect(c.by).toBe("ada@example.com");
      expect(c.move?.kind).toBe("spawn");
      expect(c.move?.from).toBeNull();
    }
    const cells = new Set(spawned.map((c) => `${c.x},${c.y}`));
    expect(cells.size).toBe(5);
    // on the gray kloss they land on level 1, beside it on the floor
    for (const c of spawned) {
      const onIt = c.x >= 0 && c.x < 8 && c.y >= 0 && c.y < 8;
      expect(c.level).toBe(onIt ? 1 : 0);
    }
  });

  test("they can be dropped near a chosen spot", () => {
    const { flock } = setup();
    const [c] = flock.spawn({ count: 1, x: 100, y: -50 });
    expect(Math.abs((c?.x ?? 0) - 100)).toBeLessThanOrEqual(3);
    expect(Math.abs((c?.y ?? 0) + 50)).toBeLessThanOrEqual(3);
  });

  test("a call spawns 1 to 10, and a session holds at most 50", () => {
    const { flock } = setup();
    expect(() => flock.spawn({ count: 0 })).toThrow(/1 to 10/);
    expect(() => flock.spawn({ count: 11 })).toThrow(/1 to 10/);
    expect(() => flock.spawn({ count: 1.5 })).toThrow(/1 to 10/);
    for (let i = 0; i < MAX_CHICKENS / 10; i++) flock.spawn({ count: 10 });
    expect(flock.list()).toHaveLength(MAX_CHICKENS);
    expect(() => flock.spawn({ count: 1 })).toThrow(/at most 50/);
  });

  test("spawning tells viewers, and never changes the model", () => {
    const { flock, events, model } = setup("0,0|2x2|red\n");
    const before = model.lastChange;
    flock.spawn({ count: 2 });
    expect(events[0]?.type).toBe("moves");
    expect(model.lastChange).toBe(before);
    expect(model.klossar).toHaveLength(1);
  });
});

describe("chickens roaming", () => {
  test("after landing they walk to neighbouring cells, one at a time", () => {
    const { flock, run, moves } = setup("0,0|4x2|gray\n0,2\n");
    flock.spawn({ count: 3 });
    run(20_000);
    const steps = moves().filter((m) => m.kind !== "spawn");
    expect(steps.length).toBeGreaterThan(20);
    for (const m of steps) {
      const from = m.from as { x: number; y: number; level: number };
      expect(Math.abs(m.to.x - from.x) + Math.abs(m.to.y - from.y)).toBeLessThanOrEqual(1);
    }
  });

  test("they flutter up one kloss at most, and hop down any height", () => {
    // a step of 1 next to a wall of 2
    const { flock, run, moves } = setup("0,0|1x8|gray\n3,0|1x8|gray\n.\n", 7);
    flock.spawn({ count: 6, x: 1, y: 4 });
    run(60_000);
    for (const m of moves().filter((x) => x.kind !== "spawn")) {
      const from = m.from as { level: number };
      expect(m.to.level - from.level).toBeLessThanOrEqual(1);
      if (m.to.level === from.level + 1) expect(m.kind).toBe("flutter");
    }
    expect(moves().some((m) => m.kind === "flutter")).toBe(true);
  });

  test("they never stand inside a kloss, and two never share a cell", () => {
    const { flock, run, model } = setup("0,0|4x2|gray\n0,2\n2,2|2x2|red\n6,0|2x8|blue\n", 3);
    flock.spawn({ count: 8 });
    const solid = new Set<string>();
    for (const k of model.klossar) {
      const [w, d] = k.size.split("x").map(Number) as [number, number];
      for (let i = 0; i < w; i++)
        for (let j = 0; j < d; j++) solid.add(`${k.level},${k.x + i},${k.y + j}`);
    }
    for (let i = 0; i < 100; i++) {
      run(500);
      const list = flock.list();
      for (const c of list) {
        expect(solid.has(`${c.level},${c.x},${c.y}`)).toBe(false);
        expect(solid.has(`${c.level + 1},${c.x},${c.y}`)).toBe(false);
      }
      const settled = list.filter((c) => !c.move).map((c) => `${c.x},${c.y}`);
      expect(new Set(settled).size).toBe(settled.length);
    }
  });

  test("they stay near the model instead of wandering off across the floor", () => {
    const { flock, run } = setup("0,0|4x2|gray\n0,2\n", 5);
    flock.spawn({ count: 5 });
    run(120_000);
    for (const c of flock.list()) {
      expect(c.x).toBeGreaterThan(-12);
      expect(c.x).toBeLessThan(16);
      expect(c.y).toBeGreaterThan(-12);
      expect(c.y).toBeLessThan(16);
    }
  });
});

describe("klossar and chickens", () => {
  test("a kloss that lands on a chicken: the chicken is no more, and viewers hear who did it", () => {
    const { flock, events, model, run } = setup("", 2);
    flock.spawn({ count: 1, by: "ada@example.com", x: 0, y: 0 });
    run(5_000);
    const c = flock.list()[0];
    if (!c) throw new Error("expected a chicken");
    // wait for it to stand still, then drop on it
    for (let i = 0; i < 50 && flock.list()[0]?.move; i++) run(100);
    const at = flock.list()[0] as { x: number; y: number };
    model.dropLine(`${at.x},${at.y}|1x1|red`, "bob@example.com");
    expect(flock.list()).toHaveLength(0);
    const gone = events.find((e) => e.type === "gone");
    expect(gone).toMatchObject({
      type: "gone",
      id: c.id,
      by: "ada@example.com",
      dropper: "bob@example.com",
      kloss: 0,
    });
  });

  test("a kloss that lands high above a chicken leaves it alone, under a new roof", () => {
    const { flock, model, run } = setup("", 4);
    flock.spawn({ count: 1, x: 0, y: 0 });
    run(5_000);
    for (let i = 0; i < 50 && flock.list()[0]?.move; i++) run(100);
    const at = flock.list()[0] as { x: number; y: number; level: number };
    expect(at.level).toBe(0);
    // a tower three klossar high beside it, then a 2x1 across both: it rests on the tower
    for (let i = 0; i < 3; i++) model.dropLine(`${at.x + 1},${at.y}|1x1|gray`);
    model.dropLine(`${at.x},${at.y}|2x1|blue`);
    expect(model.klossar.at(-1)?.level).toBe(3);
    expect(flock.list()).toHaveLength(1);
  });

  test("a kloss that lands on its head is just as fatal as one on its feet", () => {
    const { flock, model, run } = setup("", 4);
    flock.spawn({ count: 1, x: 0, y: 0 });
    run(5_000);
    for (let i = 0; i < 50 && flock.list()[0]?.move; i++) run(100);
    const at = flock.list()[0] as { x: number; y: number };
    // a tower one kloss high beside it: a 2x1 across both lands at chicken head height
    model.dropLine(`${at.x + 1},${at.y}|1x1|gray`);
    model.dropLine(`${at.x},${at.y}|2x1|blue`);
    expect(flock.list()).toHaveLength(0);
  });

  test("a chicken in the air while spawning is never hit", () => {
    const { flock, model } = setup();
    const [c] = flock.spawn({ count: 1, x: 0, y: 0 });
    model.dropLine(`${c?.x},${c?.y}|1x1|red`);
    expect(flock.list()).toHaveLength(1);
  });

  test("when its ground is taken away, a chicken falls down", () => {
    const { flock, model, run, moves } = setup("0,0|8x2|gray\n0,2\n0,4\n0,6\n", 6);
    flock.spawn({ count: 1, x: 3, y: 3 });
    run(4_500);
    for (let i = 0; i < 50 && flock.list()[0]?.move; i++) run(100);
    expect(flock.list()[0]?.level).toBe(1);
    // take the whole floor away, kloss by kloss
    while (model.klossar.length) model.undo();
    const fall = moves().at(-1);
    expect(fall?.kind).toBe("fall");
    expect(fall?.to.level).toBe(0);
  });

  test("when a new model is put where a chicken stands, it pops up on top", () => {
    const { flock, model, run, moves } = setup("", 6);
    flock.spawn({ count: 1, x: 3, y: 3 });
    run(4_500);
    for (let i = 0; i < 50 && flock.list()[0]?.move; i++) run(100);
    model.replace("0,0|8x2|gray\n0,2\n0,4\n0,6\n0,0\n0,2\n0,4\n0,6\n");
    const pop = moves().at(-1);
    expect(pop?.kind).toBe("pop");
    expect(pop?.to.level).toBe(2);
  });

  test("a removed session takes its chickens with it", () => {
    const { flock, model } = setup();
    flock.spawn({ count: 3 });
    model.emit({ type: "deleted" });
    expect(flock.list()).toHaveLength(0);
  });

  test("a viewer that connects late gets every chicken, with any move in progress", () => {
    const { flock, run } = setup("0,0|4x2|gray\n0,2\n");
    flock.spawn({ count: 2 });
    run(1_000);
    const snap = flock.list();
    expect(snap).toHaveLength(2);
    for (const c of snap) {
      expect(c.move?.kind).toBe("spawn");
      expect(c.move?.elapsed).toBeGreaterThan(0);
    }
  });
});
