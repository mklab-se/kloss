/**
 * HTTP server: the web app, the REST API that drops klossar, and the Server-Sent Events stream
 * that tells every open browser what changed.
 */
import { basename } from "node:path";
import type { Server } from "bun";
import { FormatError, parseKlossJson, parseLine } from "../core/format.ts";
import { MAX_BODY_BYTES } from "../core/types.ts";
import index from "../web/index.html";
import { LimitError, type ModelEvent, type ModelStore } from "./model-store.ts";

export interface ServerOptions {
  store: ModelStore;
  port: number;
  hostname: string;
}

const PING_MS = 15_000;
/** A client that has stopped reading: more than this many bytes queued and it is dropped. */
const MAX_QUEUED_BYTES = 2_000_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof FormatError) {
    const body: { error: string; line?: number } = { error: e.message };
    if (e.line !== undefined) body.line = e.line;
    return Response.json(body, { status: 400 });
  }
  if (e instanceof LimitError) return Response.json({ error: e.message }, { status: 413 });
  throw e;
}

async function readBody(req: Request): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "request body is larger than 1 MB");
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES)
    throw new HttpError(413, "request body is larger than 1 MB");
  return new TextDecoder().decode(bytes);
}

/** Refuses changes sent by a web page from another origin (curl sends no Origin at all). */
function checkOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (origin === null) return;
  const own = new URL(req.url).origin;
  const host = req.headers.get("host");
  const ok =
    origin === own || (host !== null && origin === `${new URL(req.url).protocol}//${host}`);
  if (!ok) throw new HttpError(403, `changes from ${origin} are not allowed`);
}

function events(store: ModelStore): Response {
  let cleanup = () => {};
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        let unsubscribe = () => {};
        let ping: ReturnType<typeof setInterval> | undefined;
        cleanup = () => {
          unsubscribe();
          if (ping) clearInterval(ping);
          ping = undefined;
        };
        const send = (event: string, data: unknown) => {
          if ((controller.desiredSize ?? 0) < -MAX_QUEUED_BYTES) {
            cleanup();
            try {
              controller.close();
            } catch {}
            return;
          }
          try {
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            cleanup();
          }
        };
        send("model", { klossar: store.klossar });
        unsubscribe = store.subscribe((e: ModelEvent) => {
          if (e.type === "drop") send("drop", e.kloss);
          else send("model", { klossar: e.klossar });
        });
        ping = setInterval(() => send("ping", { at: new Date().toISOString() }), PING_MS);
      },
      cancel() {
        cleanup();
      },
    },
    { highWaterMark: MAX_QUEUED_BYTES, size: (chunk) => chunk?.byteLength ?? 0 },
  );
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}

const notAllowed = () => Response.json({ error: "method not allowed" }, { status: 405 });

export function startServer(opts: ServerOptions): Server<undefined> {
  const { store } = opts;
  const model = () => ({ file: basename(store.path), klossar: store.klossar });
  return Bun.serve({
    port: opts.port,
    hostname: opts.hostname,
    // SSE connections stay open; pings every 15 s keep them inside this timeout.
    idleTimeout: 60,
    routes: {
      "/": index,
      "/events": () => events(store),
      "/healthz": () => new Response("ok"),
      "/api/klossar": {
        POST: async (req) => {
          try {
            checkOrigin(req);
            const body = (await readBody(req)).trim();
            let kloss: ReturnType<typeof parseLine>;
            if (body.startsWith("{")) {
              let json: unknown;
              try {
                json = JSON.parse(body);
              } catch {
                throw new FormatError("the body is not valid JSON");
              }
              kloss = parseKlossJson(json);
            } else {
              kloss = parseLine(body);
              if (!kloss) throw new FormatError('expected a kloss line like "2x4 blue 2,0"');
            }
            return Response.json(await store.drop(kloss), { status: 201 });
          } catch (e) {
            return errorResponse(e);
          }
        },
        GET: notAllowed,
        PUT: notAllowed,
        DELETE: notAllowed,
        PATCH: notAllowed,
      },
      "/api/model": {
        GET: () => Response.json(model()),
        PUT: async (req) => {
          try {
            checkOrigin(req);
            await store.replace(await readBody(req));
            return Response.json(model());
          } catch (e) {
            return errorResponse(e);
          }
        },
        POST: notAllowed,
        DELETE: notAllowed,
        PATCH: notAllowed,
      },
      "/api/model.kloss": {
        GET: async () =>
          new Response(await store.text(), {
            headers: { "content-type": "text/plain; charset=utf-8" },
          }),
      },
    },
    fetch: () => Response.json({ error: "not found" }, { status: 404 }),
  });
}
