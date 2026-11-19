/**
 * Live updates for one session (Server-Sent Events). EventSource reconnects by itself, and the
 * server sends the full model on every (re)connect.
 */
import type { PlacedKloss } from "../core/types.ts";

export type Status = "live" | "reconnecting";

export interface StreamHandlers {
  onModel(klossar: PlacedKloss[], mcp: boolean): void;
  onDrop(kloss: PlacedKloss): void;
  onStatus(status: Status): void;
  onDeleted(): void;
}

export function connect(code: string, h: StreamHandlers): () => void {
  const source = new EventSource(`/api/sessions/${encodeURIComponent(code)}/events`);
  source.addEventListener("model", (e) => {
    h.onStatus("live");
    const data = JSON.parse((e as MessageEvent).data) as { klossar: PlacedKloss[]; mcp?: boolean };
    h.onModel(data.klossar, Boolean(data.mcp));
  });
  source.addEventListener("drop", (e) => {
    h.onDrop(JSON.parse((e as MessageEvent).data) as PlacedKloss);
  });
  source.addEventListener("deleted", () => {
    source.close();
    h.onDeleted();
  });
  source.addEventListener("open", () => h.onStatus("live"));
  source.addEventListener("error", () => h.onStatus("reconnecting"));
  return () => source.close();
}
