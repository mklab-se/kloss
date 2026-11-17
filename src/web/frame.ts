/**
 * The render loop's safety net: an error in one frame is reported, and the next frame still
 * comes, so a single bad frame can never freeze the viewer.
 */
export function guardedFrame(
  step: (now: number) => void,
  schedule: (cb: (now: number) => void) => void,
  onError: (e: unknown) => void,
): (now: number) => void {
  const frame = (now: number): void => {
    try {
      step(now);
    } catch (e) {
      onError(e);
    }
    schedule(frame);
  };
  return frame;
}
