/**
 * The kloss model format: one line drops one kloss, `<size> <color> <x>,<y>`.
 * Blank lines and `#` comments are allowed. Height is never written; it comes from landing.
 */
import { COORD_LIMIT, type ColorName, type KlossInput, type Size } from "./types.ts";

export const SIZES: Record<Size, { w: number; d: number }> = {
  "1x1": { w: 1, d: 1 },
  "1x2": { w: 1, d: 2 },
  "2x1": { w: 2, d: 1 },
  "2x2": { w: 2, d: 2 },
  "2x4": { w: 2, d: 4 },
  "4x2": { w: 4, d: 2 },
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

const POSITION = /^(-?\d+),(-?\d+)$/;

/** Parses one line. Returns null for blank and comment lines; throws FormatError otherwise. */
export function parseLine(text: string): KlossInput | null {
  const hash = text.indexOf("#");
  const body = (hash >= 0 ? text.slice(0, hash) : text).trim().toLowerCase();
  if (body === "") return null;
  const tokens = body.split(/\s+/);
  if (tokens.length === 4 && (tokens[2]?.endsWith(",") || tokens[3]?.startsWith(","))) {
    throw new FormatError(
      `bad position "${tokens.slice(2).join(" ")}": write x,y with no spaces, like 2,0`,
    );
  }
  if (tokens.length !== 3) {
    throw new FormatError(
      `expected "<size> <color> <x>,<y>" (for example "2x4 blue 2,0"), got "${body}"`,
    );
  }
  const [size = "", color = "", pos = ""] = tokens;
  const m = POSITION.exec(pos);
  if (!m) {
    throw new FormatError(`bad position "${pos}": write whole numbers as x,y with no spaces`);
  }
  return validate(size, color, Number(m[1]), Number(m[2]));
}

/** Parses a whole model. Errors carry the 1-based line number. */
export function parseModel(text: string): KlossInput[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const out: KlossInput[] = [];
  lines.forEach((line, i) => {
    try {
      const k = parseLine(line);
      if (k) out.push(k);
    } catch (e) {
      if (e instanceof FormatError) throw new FormatError(`line ${i + 1}: ${e.message}`, i + 1);
      throw e;
    }
  });
  return out;
}

export function formatLine(k: KlossInput): string {
  return `${k.size} ${k.color} ${k.x},${k.y}`;
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
