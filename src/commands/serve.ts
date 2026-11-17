/**
 * `kloss serve [file]`: the live 3D view and the REST API for one model file.
 */
import type { Server } from "bun";
import { dim } from "../color.ts";
import { FormatError } from "../core/format.ts";
import { startServer } from "../server/http.ts";
import { LimitError, ModelStore } from "../server/model-store.ts";

export interface ServeOptions {
  file: string;
  port: number;
  host: string;
  open: boolean;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    console.error(`Could not open a browser; visit ${url}`);
  }
}

export async function runServe(opts: ServeOptions): Promise<Server<undefined>> {
  let store: ModelStore;
  try {
    store = await ModelStore.open(opts.file);
  } catch (e) {
    if (e instanceof FormatError || e instanceof LimitError) {
      console.error(`${opts.file}: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
  const server = startServer({ store, port: opts.port, hostname: opts.host });
  const shownHost = opts.host === "0.0.0.0" ? "localhost" : opts.host;
  const url = `http://${shownHost}:${server.port}`;
  console.log(`kloss is serving ${opts.file} (${store.klossar.length} klossar) at ${url}`);
  console.log(dim("Drop a kloss:"));
  console.log(`  curl -X POST ${url}/api/klossar -d '2,0|2x4|blue'`);
  if (opts.open) openBrowser(url);
  return server;
}
