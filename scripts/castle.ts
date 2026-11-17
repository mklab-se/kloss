/**
 * Generates examples/castle.kl: a big castle with corner towers, walls you can walk on, a
 * gatehouse, and a great hall for feasts.
 *
 * The model is emitted one level at a time, and every kloss is checked against the landing rule
 * before it is written, so a lintel that would fall through a gate (or any other mistake) stops
 * the script instead of ending up in the file. Run: bun scripts/castle.ts
 */
import { formatLine } from "../src/core/format.ts";
import { HeightMap } from "../src/core/landing.ts";
import type { ColorName, KlossInput, Size } from "../src/core/types.ts";

interface Rect {
  x: number;
  y: number;
  w: number;
  d: number;
}
type Along = "x" | "y";
type Hole = (x: number, y: number) => boolean;

const heights = new HeightMap();
const lines: string[] = [];
let count = 0;

/**
 * The plan is drawn with the gate at the low y side; the file mirrors it so the gate faces the
 * viewer's starting camera. Mirroring keeps every landing the same.
 */
function facingViewer(k: KlossInput): KlossInput {
  const d = Number(k.size.split("x")[1]);
  return { ...k, y: 47 - (k.y + d - 1) };
}

function place(k: KlossInput, level: number, what: string): void {
  const landed = heights.level(k);
  if (landed !== level) {
    throw new Error(`${what}: ${formatLine(k)} would land on level ${landed}, not ${level}`);
  }
  heights.place(k);
  lines.push(formatLine(facingViewer(k)));
  count++;
}

/** Pieces for one level of a rectangle, two rows thick, bonded by `offset`. */
function tile(r: Rect, along: Along, color: ColorName, offset: number, hole?: Hole): KlossInput[] {
  const out: KlossInput[] = [];
  const length = along === "x" ? r.w : r.d;
  const thick = along === "x" ? r.d : r.w;
  if (thick % 2 !== 0) throw new Error(`rect ${JSON.stringify(r)} must be an even thickness`);
  const sizes: Record<number, Size> =
    along === "x" ? { 4: "4x2", 2: "2x2", 1: "1x2" } : { 4: "2x4", 2: "2x2", 1: "2x1" };
  const at = (i: number, s: number) =>
    along === "x" ? { x: r.x + i, y: r.y + s } : { x: r.x + s, y: r.y + i };
  const blocked = (i: number, s: number) => {
    if (!hole) return false;
    const a = at(i, s);
    const b = at(i, s + 1);
    return hole(a.x, a.y) || hole(b.x, b.y);
  };
  for (let s = 0; s < thick; s += 2) {
    let i = 0;
    while (i < length) {
      if (blocked(i, s)) {
        i++;
        continue;
      }
      // a chunk runs to the next bond boundary, the next hole, or the end
      let j = i + 1;
      while (j < length && !blocked(j, s) && (j + offset) % 4 !== 0) j++;
      let n = j - i;
      let k = i;
      for (const len of [4, 2, 1]) {
        while (n >= len) {
          const p = at(k, s);
          out.push({ size: sizes[len] as Size, color, x: p.x, y: p.y });
          k += len;
          n -= len;
        }
      }
      i = j;
    }
  }
  return out;
}

/** Fills one level of a rectangle, trying bond offsets until every kloss lands where it should. */
function layer(
  what: string,
  r: Rect,
  level: number,
  color: ColorName,
  along: Along,
  hole?: Hole,
): void {
  const preferred = (level % 2) * 2;
  for (const delta of [0, 2, 1, 3]) {
    const pieces = tile(r, along, color, (preferred + delta) % 4, hole);
    if (pieces.every((k) => heights.level(k) === level)) {
      for (const k of pieces) place(k, level, what);
      return;
    }
  }
  throw new Error(`${what}: no bond lands every kloss of level ${level} in ${JSON.stringify(r)}`);
}

function one(what: string, size: Size, color: ColorName, x: number, y: number, level: number) {
  place({ size, color, x, y }, level, what);
}

/** Merlons: every other cell along the outer ring of a rectangle. */
function merlons(what: string, r: Rect, level: number, color: ColorName, sides = "nesw"): void {
  const cells = new Set<string>();
  for (let x = r.x; x < r.x + r.w; x++) {
    if (sides.includes("s")) cells.add(`${x},${r.y}`);
    if (sides.includes("n")) cells.add(`${x},${r.y + r.d - 1}`);
  }
  for (let y = r.y; y < r.y + r.d; y++) {
    if (sides.includes("w")) cells.add(`${r.x},${y}`);
    if (sides.includes("e")) cells.add(`${r.x + r.w - 1},${y}`);
  }
  for (const c of cells) {
    const [x = 0, y = 0] = c.split(",").map(Number);
    if ((x + y) % 2 === 0) one(what, "1x1", color, x, y, level);
  }
}

// --- the plan ----------------------------------------------------------------------------------

const WALL_TOP = 10; // curtain walls are levels 0..9; their top is a walkway
const TOWER_TOP = 16;
const GATE_TOP = 14;
const GATE_OPEN = 6; // the gate passage is open for levels 0..5
const HALL_TOP = 8; // hall walls are levels 0..7, then the roof

const towers: Rect[] = [
  { x: 0, y: 0, w: 8, d: 8 },
  { x: 48, y: 0, w: 8, d: 8 },
  { x: 0, y: 40, w: 8, d: 8 },
  { x: 48, y: 40, w: 8, d: 8 },
];
const walls: { r: Rect; along: Along; outer: string }[] = [
  { r: { x: 8, y: 0, w: 12, d: 4 }, along: "x", outer: "s" },
  { r: { x: 36, y: 0, w: 12, d: 4 }, along: "x", outer: "s" },
  { r: { x: 8, y: 44, w: 40, d: 4 }, along: "x", outer: "n" },
  { r: { x: 0, y: 8, w: 4, d: 32 }, along: "y", outer: "w" },
  { r: { x: 52, y: 8, w: 4, d: 32 }, along: "y", outer: "e" },
];
const gatehouse: Rect = { x: 20, y: -4, w: 16, d: 8 };
const gatePassage = (x: number) => x >= 26 && x <= 29;

const hall: Rect = { x: 14, y: 26, w: 28, d: 14 };
const doorX = (x: number) => x >= 26 && x <= 29;
const windowX = (x: number) => [17, 18, 22, 23, 33, 34, 37, 38].includes(x);
const windowY = (y: number) => y === 32 || y === 33;
const trees: [number, number][] = [
  [10, 10],
  [18, 12],
  [44, 16],
  [8, 20],
  [20, 19],
  [38, 20],
  [9, 33],
  [46, 32],
];

function stone(level: number, base: ColorName, top: number): ColorName {
  if (level < 2) return "tan";
  return level === top - 1 ? "white" : base;
}

const MAX_LEVEL = 23;
for (let level = 0; level <= MAX_LEVEL; level++) {
  lines.push("", `# Level ${level}`);

  // Corner towers: solid, bonded by turning each level, crenellated, with stepped blue roofs.
  for (const t of towers) {
    if (level < TOWER_TOP) {
      layer("tower", t, level, stone(level, "gray", TOWER_TOP), level % 2 ? "y" : "x");
    } else if (level === TOWER_TOP) {
      merlons("tower merlons", t, level, "gray");
      layer("tower roof", { x: t.x + 1, y: t.y + 1, w: 6, d: 6 }, level, "blue", "x");
    } else if (level === TOWER_TOP + 1) {
      layer("tower roof", { x: t.x + 2, y: t.y + 2, w: 4, d: 4 }, level, "blue", "y");
    } else if (level === TOWER_TOP + 2) {
      one("tower roof", "2x2", "blue", t.x + 3, t.y + 3, level);
    } else if (level <= TOWER_TOP + 5) {
      one("flagpole", "1x1", "white", t.x + 3, t.y + 3, level);
    } else if (level === TOWER_TOP + 6) {
      one("flag", "2x1", "red", t.x + 3, t.y + 3, level);
    }
  }

  // Curtain walls: four klossar thick; the top is a walkway with merlons on the outer edge.
  for (const w of walls) {
    if (level < WALL_TOP) layer("wall", w.r, level, stone(level, "gray", WALL_TOP), w.along);
    else if (level === WALL_TOP) merlons("wall merlons", w.r, level, "gray", w.outer);
  }

  // Gatehouse: two towers around an open gate, joined above it.
  if (level < GATE_OPEN) {
    layer("gatehouse", gatehouse, level, stone(level, "gray", GATE_TOP), "x", (x) =>
      gatePassage(x),
    );
  } else if (level < GATE_TOP) {
    layer("gatehouse", gatehouse, level, stone(level, "gray", GATE_TOP), "x");
  } else if (level === GATE_TOP) {
    merlons("gatehouse merlons", gatehouse, level, "gray");
  }

  // The great hall: walls with a door and windows, then a stepped red roof with white gables.
  if (level < HALL_TOP) {
    const color: ColorName = level < 2 ? "tan" : "white";
    const windows = level >= 2 && level <= 4;
    const south: Hole = (x) => (level <= 4 && doorX(x)) || (windows && windowX(x));
    const north: Hole = (x) => windows && windowX(x);
    const ends: Hole = (_x, y) => windows && windowY(y);
    layer("hall", { x: 14, y: 26, w: 28, d: 2 }, level, color, "x", south);
    layer("hall", { x: 14, y: 38, w: 28, d: 2 }, level, color, "x", north);
    layer("hall", { x: 14, y: 28, w: 2, d: 10 }, level, color, "y", ends);
    layer("hall", { x: 40, y: 28, w: 2, d: 10 }, level, color, "y", ends);
  } else {
    const k = level - HALL_TOP;
    const roof = { x: hall.x - 1, w: hall.w + 2 };
    if (k <= 6) {
      layer("hall roof", { ...roof, y: hall.y - 1 + k, d: 2 }, level, "red", "x");
      layer("hall roof", { ...roof, y: hall.y + hall.d - 1 - k, d: 2 }, level, "red", "x");
      const from = hall.y + 1 + k;
      const to = hall.y + hall.d - 2 - k;
      if (to >= from) {
        for (const gx of [hall.x, hall.x + hall.w - 2]) {
          for (const k2 of tile({ x: gx, y: from, w: 2, d: to - from + 1 }, "y", "white", 0)) {
            place(k2, level, "hall gable");
          }
        }
      }
    } else if (k === 7) {
      layer("hall ridge", { ...roof, y: hall.y + 6, d: 2 }, level, "red", "x");
    }
  }

  // Inside the hall: a long feast table with benches, plates and goblets, and a throne.
  if (level === 0) {
    layer("carpet", { x: 26, y: 28, w: 4, d: 2 }, level, "red", "x");
    for (let x = 18; x < 34; x += 2) {
      one("bench", "2x1", "brown", x, 30, level);
      one("bench", "2x1", "brown", x, 35, level);
    }
    for (const x of [19, 23, 27, 31]) {
      one("table leg", "1x1", "brown", x, 32, level);
      one("table leg", "1x1", "brown", x, 33, level);
    }
    one("throne", "2x2", "purple", 35, 32, level);
  } else if (level === 1) {
    for (const x of [18, 22, 26, 30]) one("table", "4x2", "tan", x, 32, level);
    one("throne back", "1x2", "purple", 36, 32, level);
  } else if (level === 2) {
    for (let x = 18; x < 34; x++) {
      if (x % 2 === 0) one("plate", "1x1", "white", x, 32, level);
      else one("goblet", "1x1", "yellow", x, 33, level);
    }
    one("throne back", "1x2", "purple", 36, 32, level);
  } else if (level === 3) {
    one("crown", "1x1", "yellow", 36, 32, level);
  }

  // The courtyard: a path from the drawbridge to the hall door, a pond, and trees.
  if (level === 0) {
    layer("drawbridge", { x: 26, y: -8, w: 4, d: 4 }, level, "brown", "x");
    layer("path", { x: 26, y: -4, w: 4, d: 30 }, level, "tan", "x");
    layer("pond", { x: 34, y: 10, w: 4, d: 4 }, level, "azure", "x");
  }
  for (const [x, y] of trees) {
    if (level <= 2) one("tree trunk", "1x1", "brown", x, y, level);
    else if (level === 3) one("tree", "2x2", "green", x, y, level);
    else if (level === 4) one("tree", "4x2", "green", x - 1, y, level);
    else if (level === 5) one("tree", "2x4", "lime", x, y - 1, level);
    else if (level === 6) one("tree", "2x2", "lime", x, y, level);
  }
}

const header = [
  "# A castle: four corner towers, walls you can walk on, a gatehouse with a drawbridge, and a",
  "# great hall for feasts (look in through the door and the windows).",
  "#",
  `# ${count} klossar, written level by level. Generated by scripts/castle.ts (bun scripts/castle.ts).`,
];
await Bun.write("examples/castle.kl", `${[...header, ...lines].join("\n")}\n`);
console.log(`examples/castle.kl: ${count} klossar`);
