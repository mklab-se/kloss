/**
 * The "poof" when a kloss is taken back: the kloss swells a little and fades while a ring of
 * small puffs bursts outward and upward. Pure timing, so it is testable without a scene.
 */
export const POOF_MS = 650;

export interface PoofState {
  ghostScale: number;
  ghostOpacity: number;
  /** How far the puffs have moved out from the kloss, in units. */
  puffSpread: number;
  /** How far they have risen, in units. */
  puffRise: number;
  puffScale: number;
  puffOpacity: number;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** The poof at `tMs` after it started, or null when it is over. */
export function poofState(tMs: number): PoofState | null {
  if (tMs >= POOF_MS) return null;
  const t = Math.max(0, tMs) / POOF_MS;
  // the kloss itself is gone in the first 40%
  const g = Math.min(1, t / 0.4);
  return {
    ghostScale: 1 + 0.18 * easeOut(g),
    ghostOpacity: 1 - easeOut(g),
    puffSpread: 1.4 * easeOut(t),
    puffRise: 0.9 * easeOut(t),
    puffScale: 0.4 + 0.9 * easeOut(t),
    puffOpacity: 0.85 * (1 - t) ** 1.5,
  };
}
