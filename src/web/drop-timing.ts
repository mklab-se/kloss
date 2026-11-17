/**
 * How long a drop takes, given how many are waiting. A few play at full length; as the queue
 * grows each one speeds up, so the view never falls far behind the API. Above 200 waiting the
 * oldest snap into place without animation.
 */
export function dropTiming(waiting: number): { fallMs: number; settleMs: number } | "snap" {
  if (waiting > 200) return "snap";
  const t = Math.min(1, Math.max(0, (waiting - 3) / 37));
  const fallMs = Math.round(600 - 500 * t);
  return { fallMs, settleMs: Math.round(fallMs / 3) };
}
