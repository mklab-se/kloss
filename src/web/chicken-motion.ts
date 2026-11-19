/**
 * Where a chicken is during a move the server told us about, and what it is doing (walking or
 * flapping). Pure, so it is testable without a scene. A spawn comes down from the sky on a
 * wandering path of its own (from a per-chicken seed) and ends exactly on its cell.
 */
import { KLOSS_HEIGHT } from "../core/types.ts";

export interface Cell {
  x: number;
  y: number;
  level: number;
}

export type MoveKind = "spawn" | "walk" | "flutter" | "fall" | "pop";

export interface Move {
  kind: MoveKind;
  from: Cell | null;
  to: Cell;
  duration: number;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** Which way it faces (radians about y; 0 is +z), when the move says. */
  facing?: number;
  walking: boolean;
  flapping: boolean;
}

/** How high above its landing spot a spawned chicken starts. */
export const SKY = 16;

export function cellPoint(c: Cell): { x: number; y: number; z: number } {
  return { x: c.x + 0.5, y: c.level * KLOSS_HEIGHT, z: c.y + 0.5 };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** The pose `t` (0 to 1) of the way through `m`. */
export function poseAt(m: Move, t: number, seed: number): Pose {
  const u = Math.min(1, Math.max(0, t));
  const to = cellPoint(m.to);
  if (m.kind === "spawn" || !m.from) {
    // a slow, flapping glide; the drift fades out so it lands right on its cell
    const fade = 1 - smooth(u);
    const dx = (Math.sin(seed * 1.7 + u * 5.3) * 1.8 + Math.sin(seed * 3.1 + u * 9.7) * 0.6) * fade;
    const dz = (Math.cos(seed * 2.3 + u * 4.1) * 1.8 + Math.cos(seed * 0.7 + u * 8.9) * 0.6) * fade;
    return {
      x: to.x + dx,
      y: to.y + SKY * (1 - u),
      z: to.z + dz,
      facing: seed + u * 5,
      walking: false,
      flapping: u < 1,
    };
  }
  const from = cellPoint(m.from);
  const facing =
    from.x !== to.x || from.z !== to.z ? Math.atan2(to.x - from.x, to.z - from.z) : undefined;
  const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
  const pose = (x: number, y: number, z: number, walking: boolean, flapping: boolean): Pose => {
    const p: Pose = { x, y, z, walking, flapping };
    if (facing !== undefined) p.facing = facing;
    return p;
  };
  switch (m.kind) {
    case "walk":
      return pose(lerp(from.x, to.x, u), from.y, lerp(from.z, to.z, u), u < 1, false);
    case "flutter": {
      const e = smooth(u);
      const lift = Math.sin(Math.PI * u) * (to.y > from.y ? 1.0 : 0.6);
      return pose(
        lerp(from.x, to.x, e),
        lerp(from.y, to.y, e) + lift,
        lerp(from.z, to.z, e),
        false,
        u < 1,
      );
    }
    case "fall": {
      // off the edge first, then down, faster and faster
      const h = smooth(Math.min(1, u / 0.4));
      return pose(
        lerp(from.x, to.x, h),
        lerp(from.y, to.y, u * u),
        lerp(from.z, to.z, h),
        false,
        u < 1,
      );
    }
    case "pop":
      return pose(to.x, lerp(from.y, to.y, 1 - (1 - u) ** 3), to.z, false, u < 1);
  }
}
