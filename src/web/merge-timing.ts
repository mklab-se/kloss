/**
 * Timing for "poof and grow", the optimize animation: in each merged group, the klossar that go
 * away vanish in a poof (poof-timing.ts), the one that stays grows into their place and settles
 * with a small squash, and then its new pluppar rise out of the top, the nearest first. Groups
 * ripple upward level by level, and sweep across a level in a few slots. Pure timing, so it is
 * testable without a scene.
 */

/** The kloss that stays starts growing once the poof's smoke has mostly cleared. */
export const GROW_START_MS = 240;
const GROW_MS = 460;
const SQUASH_MS = 160;
const SQUASH = 0.09;
const RISE_START_MS = GROW_START_MS + GROW_MS + 60;
const RISE_MS = 240;
const RISE_STAGGER_MS = 70;

/** Levels start this far apart, unless that would make the ripple longer than MAX_RIPPLE_MS. */
const LEVEL_STEP_MS = 520;
export const MAX_RIPPLE_MS = 2_400;
/** Within a level, groups start in at most this many slots, sweeping across it. */
const SLOTS = 4;
const SLOT_MS = 90;
/** About how many smoke puffs at once, at most, for all the poofs that start together. */
const PUFF_BUDGET = 1_000;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** Ease out with a small overshoot (a plupp pops up). */
const easeOutBack = (t: number) => {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

/** How far the kloss that stays has grown (0 to 1), and its height squash (1 is none). */
export function growState(tMs: number): { grow: number; squash: number } {
  const grow = easeOut(clamp01((tMs - GROW_START_MS) / GROW_MS));
  const s = tMs - (GROW_START_MS + GROW_MS);
  const squash = s > 0 && s < SQUASH_MS ? 1 - SQUASH * Math.sin((Math.PI * s) / SQUASH_MS) : 1;
  return { grow, squash };
}

/**
 * A new plupp's height (0 to a little over 1, then 1), or null while it has not started. `distance`
 * is how many cells it is from the kloss that stays (1 for its neighbours).
 */
export function pluppRise(tMs: number, distance: number): number | null {
  const start = RISE_START_MS + (distance - 1) * RISE_STAGGER_MS;
  if (tMs <= start) return null;
  const t = (tMs - start) / RISE_MS;
  return t >= 1 ? 1 : easeOutBack(t);
}

/** How long a group plays, given its farthest new plupp's distance. */
export function groupLength(maxDistance: number): number {
  return RISE_START_MS + (Math.max(1, maxDistance) - 1) * RISE_STAGGER_MS + RISE_MS;
}

/** When each group starts (ms after the optimize arrived): level by level, then across a level. */
export function schedule(groups: readonly { level: number; x: number; y: number }[]): number[] {
  const levels = [...new Set(groups.map((g) => g.level))].sort((a, b) => a - b);
  const step = levels.length > 1 ? Math.min(LEVEL_STEP_MS, MAX_RIPPLE_MS / (levels.length - 1)) : 0;
  const slotMs = Math.min(SLOT_MS, step / SLOTS);
  const levelIndex = new Map(levels.map((l, i) => [l, i]));
  // the sweep runs from the back corner across, along x + y, per level
  const range = new Map<number, { min: number; max: number }>();
  for (const g of groups) {
    const r = range.get(g.level) ?? { min: Infinity, max: -Infinity };
    r.min = Math.min(r.min, g.x + g.y);
    r.max = Math.max(r.max, g.x + g.y);
    range.set(g.level, r);
  }
  return groups.map((g) => {
    const r = range.get(g.level) as { min: number; max: number };
    const slot = Math.min(
      SLOTS - 1,
      Math.floor(((g.x + g.y - r.min) / (r.max - r.min + 1)) * SLOTS),
    );
    const base = (levelIndex.get(g.level) ?? 0) * step;
    return Math.min(MAX_RIPPLE_MS, Math.round(base + slot * slotMs));
  });
}

/** Smoke puffs per poof when `poofs` klossar poof at the same time: fewer when there are many. */
export function puffsPerKloss(poofs: number): number {
  return Math.max(1, Math.min(10, Math.floor(PUFF_BUDGET / Math.max(1, poofs))));
}
