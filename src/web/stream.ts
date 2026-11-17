/**
 * Live updates from the server (Server-Sent Events). EventSource reconnects by itself, and the
 * server sends the full model on every (re)connect.
 */
import type { PlacedKloss } from "../core/types.ts";

export type Status = "live" | "reconnecting";

export interface StreamHandlers {
  onModel(klossar: PlacedKloss[]): void;
  onDrop(kloss: PlacedKloss): void;
  onStatus(status: Status): void;
}

export function connect(h: StreamHandlers): () => void {
  const source = new EventSource("/events");
  source.addEventListener("model", (e) => {
    h.onStatus("live");
    h.onModel((JSON.parse((e as MessageEvent).data) as { klossar: PlacedKloss[] }).klossar);
  });
  source.addEventListener("drop", (e) => {
    h.onDrop(JSON.parse((e as MessageEvent).data) as PlacedKloss);
  });
  source.addEventListener("open", () => h.onStatus("live"));
  source.addEventListener("error", () => h.onStatus("reconnecting"));
  return () => source.close();
}
