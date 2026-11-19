/**
 * The kloss model format (`.kl`): one line drops one kloss, `x,y|size|color`. A left-out size or
 * color is the last one used, and `.` repeats the last drop. Blank lines and `#` comments are
 * allowed. Height is never written; it comes from landing.
 */
import { COORD_LIMIT, type ColorName, type KlossInput, type Size } from "./types.ts";

export const SIZES: Record<Size, { w: number; d: number }> = {
  "1x1": { w: 1, d: 1 },
  "1x2": { w: 1, d: 2 },
  "2x1": { w: 2, d: 1 },
  "1x4": { w: 1, d: 4 },
  "4x1": { w: 4, d: 1 },
  "2x2": { w: 2, d: 2 },
  "2x4": { w: 2, d: 4 },
  "4x2": { w: 4, d: 2 },
  "1x6": { w: 1, d: 6 },
  "6x1": { w: 6, d: 1 },
  "2x6": { w: 2, d: 6 },
  "6x2": { w: 6, d: 2 },
  "1x8": { w: 1, d: 8 },
  "8x1": { w: 8, d: 1 },
  "2x8": { w: 2, d: 8 },
  "8x2": { w: 8, d: 2 },
};

/** kloss's own palette (not anyone else's color table). */
export const PALETTE: Record<ColorName, string> = {
  white: "#f2f0ea",
  gray: "#9aa0a6",
  black: "#202124",
  red: "#d12a1f",
  orange: "#f28a1e",
  yellow: "#f5c932",
  lime: "#a8d63a",
  green: "#2f8a4c",
  blue: "#1f5fc4",
  azure: "#3fb0d0",
  purple: "#7d2a8c",
  pink: "#f29ab5",
  brown: "#6b4226",
  tan: "#dcc79a",
};

export class FormatError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = "FormatError";
  }
}

function isSize(s: string): s is Size {
  return Object.hasOwn(SIZES, s);
}

function isColor(s: string): s is ColorName {
  return Object.hasOwn(PALETTE, s);
}

function checkCoord(n: number, label: string): void {
  if (!Number.isInteger(n) || Math.abs(n) > COORD_LIMIT) {
    throw new FormatError(`${label} must be a whole number from -${COORD_LIMIT} to ${COORD_LIMIT}`);
  }
}

function validate(size: string, color: string, x: number, y: number): KlossInput {
  if (!isSize(size)) {
    throw new FormatError(`unknown size "${size}" (use ${Object.keys(SIZES).join(", ")})`);
  }
  if (!isColor(color)) {
    throw new FormatError(`unknown color "${color}" (use ${Object.keys(PALETTE).join(", ")})`);
  }
  checkCoord(x, "x");
  checkCoord(y, "y");
  return { size, color, x, y };
}

/** What a line can leave out comes from the last kloss dropped before it. */
export interface Carry {
  last?: KlossInput;
}

const POSITION = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/;
/** The 0.1 format, `2x4 blue 2,0`, recognised only to explain how to rewrite it. */
const OLD_LINE = /^(\d+x\d+)\s+([a-z]+)\s+(-?\d+),(-?\d+)$/;

/**
 * Parses one line: `x,y|size|color`. A left-out size or color is the last one used, and `.`
 * repeats the last drop. Returns null for blank and comment lines; throws FormatError otherwise.
 */
export function parseLine(text: string, carry: Carry = {}): KlossInput | null {
  const hash = text.indexOf("#");
  const body = (hash >= 0 ? text.slice(0, hash) : text).trim().toLowerCase();
  if (body === "") return null;
  const { last } = carry;
  if (body === ".") {
    if (!last)
      throw new FormatError('nothing to repeat yet: "." repeats the kloss dropped before it');
    return { size: last.size, color: last.color, x: last.x, y: last.y };
  }
  const old = OLD_LINE.exec(body);
  if (old) {
    throw new FormatError(
      `this is the old 0.1 format; write it as "${old[3]},${old[4]}|${old[1]}|${old[2]}"`,
    );
  }
  const parts = body.split("|").map((p) => p.trim());
  if (parts.length > 3) {
    throw new FormatError(`expected "x,y|size|color" (for example "2,0|2x4|blue"), got "${body}"`);
  }
  const pos = POSITION.exec(parts[0] ?? "");
  if (!pos) {
    throw new FormatError(`bad position "${parts[0]}": write whole numbers as x,y, like 2,0`);
  }
  let size: Size | undefined;
  let color: ColorName | undefined;
  for (const field of parts.slice(1)) {
    if (field === "") continue;
    if (isSize(field)) {
      if (size) throw new FormatError(`two sizes in one line: "${size}" and "${field}"`);
      size = field;
    } else if (isColor(field)) {
      if (color) throw new FormatError(`two colors in one line: "${color}" and "${field}"`);
      color = field;
    } else if (/^\d+x\d+$/.test(field)) {
      throw new FormatError(`unknown size "${field}" (use ${Object.keys(SIZES).join(", ")})`);
    } else {
      throw new FormatError(`unknown color "${field}" (use ${Object.keys(PALETTE).join(", ")})`);
    }
  }
  size ??= last?.size;
  color ??= last?.color;
  if (!size) throw new FormatError('no size yet: the first kloss needs both, like "0,0|2x4|blue"');
  if (!color)
    throw new FormatError('no color yet: the first kloss needs both, like "0,0|2x4|blue"');
  const x = Number(pos[1]);
  const y = Number(pos[2]);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new FormatError(`bad position "${parts[0]}": write whole numbers as x,y, like 2,0`);
  }
  return validate(size, color, x, y);
}

/** Parses a whole model. Errors carry the 1-based line number. */
export function parseModel(text: string): KlossInput[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const out: KlossInput[] = [];
  lines.forEach((line, i) => {
    try {
      const k = parseLine(line, { last: out.at(-1) });
      if (k) out.push(k);
    } catch (e) {
      if (e instanceof FormatError) throw new FormatError(`line ${i + 1}: ${e.message}`, i + 1);
      throw e;
    }
  });
  return out;
}

/** The coordinate width that lines a model up: at least 3, wide enough for every number. */
export function coordWidth(klossar: readonly KlossInput[]): number {
  let width = 3;
  for (const k of klossar) width = Math.max(width, String(k.x).length, String(k.y).length);
  return width;
}

/**
 * Writes one line, leaving out what repeats from `prev` (a dot for an exact repeat), with the
 * coordinates right-aligned to `width`.
 */
export function formatLine(k: KlossInput, prev?: KlossInput, width = 3): string {
  if (prev && prev.x === k.x && prev.y === k.y && prev.size === k.size && prev.color === k.color) {
    return ".";
  }
  const pos = `${String(k.x).padStart(width)},${String(k.y).padStart(width)}`;
  const fields: string[] = [];
  if (!prev || prev.size !== k.size) fields.push(k.size);
  if (!prev || prev.color !== k.color) fields.push(k.color);
  return [pos, ...fields].join(" | ");
}

/** Writes a whole model, lined up. */
export function formatModel(klossar: readonly KlossInput[], width = coordWidth(klossar)): string {
  return klossar.map((k, i) => `${formatLine(k, klossar[i - 1], width)}\n`).join("");
}

/** Validates a JSON body such as `{"size":"2x4","color":"blue","x":2,"y":0}`. */
export function parseKlossJson(body: unknown): KlossInput {
  if (typeof body !== "object" || body === null) {
    throw new FormatError('expected a JSON object like {"size":"2x4","color":"blue","x":2,"y":0}');
  }
  const { size, color, x, y } = body as Record<string, unknown>;
  if (typeof size !== "string" || typeof color !== "string") {
    throw new FormatError('"size" and "color" must be strings');
  }
  if (typeof x !== "number" || typeof y !== "number") {
    throw new FormatError('"x" and "y" must be numbers');
  }
  return validate(size.toLowerCase(), color.toLowerCase(), x, y);
}
