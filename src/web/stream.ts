/**
 * Live updates for one session (Server-Sent Events). EventSource reconnects by itself, and the
 * server sends the full model on every (re)connect.
 */
import type { PlacedKloss } from "../core/types.ts";
import type { Merged } from "./merges.ts";

export type Status = "live" | "reconnecting";

export interface StreamHandlers {
  /**
   * A whole model (on connect, after a replace or an optimize); `note` says why, if anything, and
   * after an optimize `merged` says which old klossar became each new one.
   */
  onModel(klossar: PlacedKloss[], mcp: boolean, note?: string, merged?: Merged[]): void;
  onDrop(kloss: PlacedKloss): void;
  /** A kloss was taken back; `klossar` is the model that is left. */
  onUndo(kloss: PlacedKloss, klossar: PlacedKloss[]): void;
  onStatus(status: Status): void;
  onDeleted(): void;
}

export function connect(code: string, h: StreamHandlers): () => void {
  const source = new EventSource(`/api/sessions/${encodeURIComponent(code)}/events`);
  source.addEventListener("model", (e) => {
    h.onStatus("live");
    const data = JSON.parse((e as MessageEvent).data) as {
      klossar: PlacedKloss[];
      mcp?: boolean;
      note?: string;
      merged?: Merged[];
    };
    h.onModel(data.klossar, Boolean(data.mcp), data.note, data.merged);
  });
  source.addEventListener("drop", (e) => {
    h.onDrop(JSON.parse((e as MessageEvent).data) as PlacedKloss);
  });
  source.addEventListener("undo", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      kloss: PlacedKloss;
      klossar: PlacedKloss[];
    };
    h.onUndo(data.kloss, data.klossar);
  });
  source.addEventListener("deleted", () => {
    source.close();
    h.onDeleted();
  });
  source.addEventListener("open", () => h.onStatus("live"));
  source.addEventListener("error", () => h.onStatus("reconnecting"));
  return () => source.close();
}
