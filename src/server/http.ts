/**
 * HTTP server: the start page and viewer, the REST API for sessions, login (page, cookie,
 * tokens), the admin page with the MCP switch, and, only while MCP is on, the MCP endpoint and
 * the OAuth endpoints MCP clients use to log in.
 */
import type { Server } from "bun";
import { FormatError, parseKlossJson } from "../core/format.ts";
import { MAX_BODY_BYTES } from "../core/types.ts";
import viewer from "../web/index.html";
import start from "../web/start.html";
import { ACCESS_TTL, type Auth, REFRESH_TTL } from "./auth.ts";
import { handleMcp, type RpcMessage } from "./mcp.ts";
import { LimitError, type ModelEvent, UndoError } from "./model.ts";
import { docsPage, openApi } from "./openapi.ts";
import { adminPage, loginPage, withStatus } from "./pages.ts";
import { renderModel, VIEWS, type View } from "./render.ts";
import type { Session, SessionStore } from "./sessions.ts";

export interface ServerOptions {
  sessions: SessionStore;
  auth: Auth;
  /** The MCP switch; flipped at runtime from /admin. */
  mcp: { enabled: boolean };
  port: number;
  hostname: string;
  version: string;
  /** The public base URL (for links), when it cannot be told from the request. */
  publicUrl?: string;
  /** How often idle sessions are swept (ms). */
  sweepMs?: number;
  /** Where log lines go (MCP tool calls, the MCP switch, expired sessions); default console.log. */
  log?: (line: string) => void;
}

type Req = Request & { params: Record<string, string> };
type Handler = (req: Req, server: Server<undefined>) => Response | Promise<Response>;

const PING_MS = 15_000;
const MAX_QUEUED_BYTES = 2_000_000;
const COOKIE = "kloss";
const ADMIN_COOKIE = "kloss_admin";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const notFound = () => Response.json({ error: "not found" }, { status: 404 });
const seeOther = (location: string, headers: Record<string, string> = {}) =>
  new Response(null, { status: 303, headers: { location, ...headers } });

function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    return Response.json({ error: e.message }, { status: e.status, headers: e.headers });
  }
  if (e instanceof FormatError) {
    const body: { error: string; line?: number } = { error: e.message };
    if (e.line !== undefined) body.line = e.line;
    return Response.json(body, { status: 400 });
  }
  if (e instanceof UndoError) return Response.json({ error: e.message }, { status: 409 });
  if (e instanceof LimitError) {
    // a full model is the request's fault (413); a full server is temporary (503)
    const status = e.message.includes("sessions") ? 503 : 413;
    return Response.json({ error: e.message }, { status });
  }
  console.error(e);
  return Response.json({ error: "something went wrong" }, { status: 500 });
}

async function readBody(req: Request): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "request body is larger than 1 MB");
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "request body is larger than 1 MB");
  }
  return new TextDecoder().decode(bytes);
}

/** Form fields, from a form post or a JSON body. */
async function readParams(req: Request): Promise<URLSearchParams> {
  const body = await readBody(req);
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const json = JSON.parse(body || "{}") as Record<string, unknown>;
    return new URLSearchParams(Object.entries(json).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(body);
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = JSON.parse((await readBody(req)) || "{}");
    if (typeof v === "object" && v !== null) return v as Record<string, unknown>;
  } catch {}
  throw new FormatError("the body is not valid JSON");
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const ANY_ADDRESS = new Set(["0.0.0.0", "::", "[::]"]);

/**
 * Refuses requests addressed to a host name that is not this machine (DNS rebinding). Serving on
 * 0.0.0.0 opens kloss to the network on purpose, so any name is accepted there.
 */
function checkHost(req: Request, bound: string): void {
  if (ANY_ADDRESS.has(bound)) return;
  const header = req.headers.get("host") ?? "";
  const name = header.startsWith("[")
    ? header.slice(0, header.indexOf("]") + 1)
    : header.split(":")[0];
  if (!name || !(LOOPBACK.has(name) || name === bound)) {
    throw new HttpError(403, `requests for host "${header}" are not allowed`);
  }
}

/** Refuses changes sent by a web page from another origin (curl and agents send no Origin). */
function checkOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (origin === null) return;
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto");
  const ok =
    origin === url.origin ||
    (host !== null && (origin === `${url.protocol}//${host}` || origin === `${proto}://${host}`));
  if (!ok) throw new HttpError(403, `changes from ${origin} are not allowed`);
}

function cookieValue(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function bearer(req: Request): string | undefined {
  const h = req.headers.get("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : undefined;
}

/** A local path to go to after login; anything else (another site) becomes "/". */
function safeNext(next: string | null): string {
  return next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

function clientKey(req: Request, server: Server<undefined>): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || server.requestIP(req)?.address || "unknown";
}

function retryHeaders(seconds?: number): Record<string, string> {
  return seconds ? { "retry-after": String(seconds) } : {};
}

/** A Server-Sent Events stream; `subscribe` gets `send` and returns how to stop. */
function sse(subscribe: (send: (event: string, data: unknown) => void) => () => void): Response {
  let cleanup = () => {};
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        let stop = () => {};
        let ping: ReturnType<typeof setInterval> | undefined;
        let closed = false;
        const close = () => {
          try {
            controller.close();
          } catch {}
        };
        cleanup = () => {
          if (closed) return;
          closed = true;
          stop();
          if (ping) clearInterval(ping);
        };
        const send = (event: string, data: unknown) => {
          if (closed) return;
          if ((controller.desiredSize ?? 0) < -MAX_QUEUED_BYTES) {
            cleanup();
            close();
            return;
          }
          try {
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            cleanup();
          }
          if (event === "deleted") {
            cleanup();
            close();
          }
        };
        stop = subscribe(send);
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

export function startServer(opts: ServerOptions): Server<undefined> {
  const { sessions, auth, mcp } = opts;
  const log = opts.log ?? ((line: string) => console.log(line));

  const baseUrl = (req: Request) => {
    if (opts.publicUrl) return opts.publicUrl.replace(/\/+$/, "");
    const url = new URL(req.url);
    const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
    return `${proto}://${host}`;
  };

  const cookie = (req: Request, name: string, value: string, maxAge: number) =>
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
      baseUrl(req).startsWith("https://") ? "; Secure" : ""
    }`;

  /** Who is calling: an e-mail address, "" (login is off), or null (not logged in). */
  const identify = (req: Request): string | null => {
    if (!auth.enabled) return "";
    const t = bearer(req) ?? cookieValue(req, COOKIE);
    return t ? auth.verify(t, "access") : null;
  };

  /** The 401 challenge; it points MCP clients at the OAuth metadata only while MCP is on. */
  const challenge = (req: Request) =>
    `Bearer realm="kloss"${
      mcp.enabled
        ? `, resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource/mcp"`
        : ""
    }`;

  /** Wraps an API handler: host check, login, origin check for changes, errors as JSON. */
  const api =
    (fn: (req: Req, email: string) => Response | Promise<Response>, changes = false): Handler =>
    async (req) => {
      try {
        checkHost(req, opts.hostname);
        const email = identify(req);
        if (email === null) {
          throw new HttpError(
            401,
            'log in first: POST /api/token with {"email": ..., "password": ...}, then send "Authorization: Bearer <token>"',
            { "www-authenticate": challenge(req) },
          );
        }
        if (changes) checkOrigin(req);
        return await fn(req, email);
      } catch (e) {
        return errorResponse(e);
      }
    };

  /** Wraps a form handler (login, admin): host and origin checks, errors as JSON. */
  const formHandler =
    (fn: Handler): Handler =>
    async (req, server) => {
      try {
        checkHost(req, opts.hostname);
        checkOrigin(req);
        return await fn(req, server);
      } catch (e) {
        return errorResponse(e);
      }
    };

  const session = (code: string | undefined): Session => {
    const s = code ? sessions.get(code) : undefined;
    if (!s) throw new HttpError(404, `no session "${code}" (it may have expired)`);
    return s;
  };

  const sessionInfo = (req: Request, s: Session) => ({
    code: s.code,
    url: `${baseUrl(req)}/s/${s.code}`,
    klossar: s.model.klossar.length,
  });

  // --- admin -----------------------------------------------------------------------------------

  /** The admin page exists when login is off (local) or an admin password is set. */
  const adminAvailable = () => !auth.enabled || auth.adminEnabled;
  const adminIdentity = (req: Request): string | null => {
    if (!auth.enabled) return "";
    const t = bearer(req) ?? cookieValue(req, ADMIN_COOKIE);
    return t ? auth.verify(t, "admin") : null;
  };
  const setMcp = (enabled: boolean, how: string) => {
    mcp.enabled = enabled;
    log(`MCP endpoint turned ${enabled ? "on" : "off"} ${how}`);
  };

  // --- MCP and OAuth (only while MCP is on) ------------------------------------------------------

  /** Routes that do not exist at all while MCP is off (and, for OAuth, while login is off). */
  const mcpOnly =
    (fn: Handler, oauth = false): Handler =>
    async (req, server) => {
      if (!mcp.enabled || (oauth && !auth.enabled)) return notFound();
      try {
        return await fn(req, server);
      } catch (e) {
        return errorResponse(e);
      }
    };

  interface Authorize {
    clientId: string;
    redirectUri: string;
    challenge: string;
    state: string | null;
    hidden: Record<string, string>;
  }

  const authorizeParams = (p: URLSearchParams): Authorize => {
    const clientId = p.get("client_id") ?? "";
    const redirectUri = p.get("redirect_uri") ?? "";
    const allowed = auth.clientRedirects(clientId);
    if (!allowed) throw new HttpError(400, "unknown client_id; register with /oauth/register");
    if (!allowed.includes(redirectUri)) throw new HttpError(400, "redirect_uri is not registered");
    if (p.get("response_type") !== "code") throw new HttpError(400, 'response_type must be "code"');
    if (p.get("code_challenge_method") !== "S256" || !p.get("code_challenge")) {
      throw new HttpError(400, "PKCE with code_challenge_method S256 is required");
    }
    const keep = [
      "response_type",
      "client_id",
      "redirect_uri",
      "code_challenge",
      "code_challenge_method",
      "state",
      "scope",
      "resource",
    ];
    return {
      clientId,
      redirectUri,
      challenge: p.get("code_challenge") ?? "",
      state: p.get("state"),
      hidden: Object.fromEntries(keep.filter((k) => p.has(k)).map((k) => [k, p.get(k) ?? ""])),
    };
  };

  const redirectWithCode = (a: Authorize, email: string, headers: Record<string, string> = {}) => {
    const target = new URL(a.redirectUri);
    target.searchParams.set("code", auth.issueCode({ email, ...a }));
    if (a.state) target.searchParams.set("state", a.state);
    return seeOther(target.toString(), headers);
  };

  const tokens = (email: string) =>
    Response.json(
      {
        access_token: auth.accessToken(email),
        token_type: "Bearer",
        expires_in: ACCESS_TTL,
        refresh_token: auth.refreshToken(email),
        refresh_expires_in: REFRESH_TTL,
      },
      { headers: { "cache-control": "no-store" } },
    );

  const oauthError = (error: string, description: string) =>
    Response.json({ error, error_description: description }, { status: 400 });

  const resourceMetadata: Handler = (req) =>
    Response.json({
      resource: `${baseUrl(req)}/mcp`,
      authorization_servers: [baseUrl(req)],
      bearer_methods_supported: ["header"],
      resource_name: "kloss",
    });

  const authorizeLogin = (a: Authorize, error?: string, email?: string) =>
    loginPage({
      action: "/oauth/authorize",
      intro:
        "An app wants to use kloss for you. Log in with your e-mail address and the password you were given.",
      hidden: a.hidden,
      button: "Log in and allow",
      error,
      email,
    });

  const routes: Record<string, unknown> = {
    "/": start,
    "/s/:code": viewer,

    "/healthz": () => Response.json({ status: "ok", version: opts.version, auth: auth.enabled }),

    // the REST API's documentation: public, and on purpose silent about MCP
    "/openapi.json": (req: Req) =>
      Response.json(openApi({ baseUrl: baseUrl(req), version: opts.version, auth: auth.enabled })),
    "/docs": () => docsPage(),

    // --- login ---------------------------------------------------------------------------------
    "/login": {
      GET: (req: Req) => {
        if (!auth.enabled) return seeOther("/");
        const next = safeNext(new URL(req.url).searchParams.get("next"));
        return loginPage({ action: "/login", hidden: { next } });
      },
      POST: formHandler(async (req, server) => {
        if (!auth.enabled) return seeOther("/");
        const p = await readParams(req);
        const next = safeNext(p.get("next"));
        const email = p.get("email") ?? "";
        const r = auth.login(email, p.get("password") ?? "", clientKey(req, server));
        if (!r.ok) {
          return withStatus(
            loginPage({ action: "/login", error: r.reason, email, hidden: { next } }),
            401,
            retryHeaders(r.retryAfterSeconds),
          );
        }
        return seeOther(next, {
          "set-cookie": cookie(req, COOKIE, auth.accessToken(r.email), ACCESS_TTL),
        });
      }),
    },
    "/logout": {
      POST: (req: Req) => seeOther("/login", { "set-cookie": cookie(req, COOKIE, "", 0) }),
    },
    "/api/me": (req: Req) =>
      Response.json({ auth: auth.enabled, email: identify(req) || null, version: opts.version }),
    "/api/token": {
      POST: async (req: Req, server: Server<undefined>) => {
        try {
          checkHost(req, opts.hostname);
          if (!auth.enabled) return notFound();
          const body = await readJson(req);
          const r = auth.login(
            String(body.email ?? ""),
            String(body.password ?? ""),
            clientKey(req, server),
          );
          if (!r.ok) {
            return Response.json(
              { error: r.reason },
              { status: 401, headers: retryHeaders(r.retryAfterSeconds) },
            );
          }
          return Response.json({
            access_token: auth.accessToken(r.email),
            token_type: "Bearer",
            expires_in: ACCESS_TTL,
          });
        } catch (e) {
          return errorResponse(e);
        }
      },
    },

    // --- sessions --------------------------------------------------------------------------------
    "/api/sessions": {
      POST: api(async (req, email) => {
        const s = sessions.create(await readBody(req), email || undefined);
        return Response.json(sessionInfo(req, s), { status: 201 });
      }, true),
    },
    "/api/sessions/:code": {
      GET: api((req) => Response.json(sessionInfo(req, session(req.params.code)))),
      DELETE: api((req) => {
        sessions.delete(session(req.params.code).code);
        return new Response(null, { status: 204 });
      }, true),
    },
    "/api/sessions/:code/klossar": {
      POST: api(async (req, email) => {
        const s = session(req.params.code);
        const body = (await readBody(req)).trim();
        const by = email || undefined;
        if (!body.startsWith("{")) {
          // a text line may leave out size and color, or be "." to repeat the last drop
          return Response.json(s.model.dropLine(body, by), { status: 201 });
        }
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          throw new FormatError("the body is not valid JSON");
        }
        return Response.json(s.model.drop(parseKlossJson(json), by), { status: 201 });
      }, true),
    },
    "/api/sessions/:code/klossar/last": {
      // take back the most recent kloss (with login on, only your own)
      DELETE: api((req, email) => {
        const s = session(req.params.code);
        const undone = s.model.undo(email || undefined);
        return Response.json({ code: s.code, undone, klossar: s.model.klossar.length });
      }, true),
    },
    "/api/sessions/:code/render.png": {
      // a picture of the model, rendered on the server (so an agent can "see" it)
      GET: api((req) => {
        const s = session(req.params.code);
        const q = new URL(req.url).searchParams;
        const view = (q.get("view") ?? "iso") as View;
        if (!VIEWS.includes(view)) {
          throw new FormatError(`unknown view "${view}" (use ${VIEWS.join(", ")})`);
        }
        const sizeText = q.get("size");
        const size = sizeText === null ? undefined : Number(sizeText);
        if (size !== undefined && !Number.isInteger(size)) {
          throw new FormatError("size must be a whole number of pixels (64 to 2048)");
        }
        return new Response(renderModel(s.model.klossar, { view, size }), {
          headers: { "content-type": "image/png", "cache-control": "no-store" },
        });
      }),
    },
    "/api/sessions/:code/optimize": {
      // merge klossar into bigger ones where the model stays exactly the same
      POST: api((req) => {
        const s = session(req.params.code);
        const preview = new URL(req.url).searchParams.get("preview") === "true";
        return Response.json({ code: s.code, ...s.model.optimize(preview) });
      }, true),
    },
    "/api/sessions/:code/model": {
      GET: api((req) => {
        const s = session(req.params.code);
        return Response.json({ code: s.code, klossar: s.model.klossar });
      }),
      PUT: api(async (req, email) => {
        const s = session(req.params.code);
        const klossar = s.model.replace(await readBody(req), email || undefined);
        return Response.json({ code: s.code, klossar });
      }, true),
    },
    "/api/sessions/:code/model.kl": {
      GET: api((req) => {
        const s = session(req.params.code);
        return new Response(s.model.text(), {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "content-disposition": `inline; filename="${s.code}.kl"`,
          },
        });
      }),
    },
    "/api/sessions/:code/events": {
      GET: api((req) => {
        const s = session(req.params.code);
        const model = (klossar: unknown) => ({ code: s.code, klossar, mcp: mcp.enabled });
        return sse((send) => {
          send("model", model(s.model.klossar));
          const leave = sessions.watch(s.code);
          const off = s.model.subscribe((e: ModelEvent) => {
            if (e.type === "drop") send("drop", e.kloss);
            else if (e.type === "undo") send("undo", { kloss: e.kloss, klossar: e.klossar });
            else if (e.type === "model") send("model", { ...model(e.klossar), note: e.note });
            else send("deleted", { code: s.code });
          });
          return () => {
            off();
            leave?.();
          };
        });
      }),
    },

    // --- admin -----------------------------------------------------------------------------------
    "/admin": {
      GET: (req: Req) => {
        if (!adminAvailable()) return notFound();
        const email = adminIdentity(req);
        if (email === null) {
          return loginPage({
            action: "/admin",
            heading: "kloss admin",
            intro: "Log in with your e-mail address and the admin password.",
          });
        }
        return adminPage({ mcp: mcp.enabled, email: email || undefined, loginOn: auth.enabled });
      },
      POST: async (req: Req, server: Server<undefined>) => {
        if (!adminAvailable()) return notFound();
        return formHandler(async () => {
          if (!auth.enabled) return seeOther("/admin");
          const p = await readParams(req);
          const email = p.get("email") ?? "";
          const r = auth.adminLogin(email, p.get("password") ?? "", clientKey(req, server));
          if (!r.ok) {
            return withStatus(
              loginPage({ action: "/admin", heading: "kloss admin", error: r.reason, email }),
              401,
              retryHeaders(r.retryAfterSeconds),
            );
          }
          return seeOther("/admin", {
            "set-cookie": cookie(req, ADMIN_COOKIE, auth.adminToken(r.email), ACCESS_TTL),
          });
        })(req, server);
      },
    },
    "/admin/mcp": {
      POST: async (req: Req, server: Server<undefined>) => {
        if (!adminAvailable()) return notFound();
        return formHandler(async () => {
          if (adminIdentity(req) === null) return seeOther("/admin");
          setMcp((await readParams(req)).get("enabled") === "true", "from /admin");
          return seeOther("/admin");
        })(req, server);
      },
    },
    "/admin/logout": {
      POST: (req: Req) => seeOther("/admin", { "set-cookie": cookie(req, ADMIN_COOKIE, "", 0) }),
    },
    "/api/admin/token": {
      POST: async (req: Req, server: Server<undefined>) => {
        try {
          if (!auth.enabled || !auth.adminEnabled) return notFound();
          checkHost(req, opts.hostname);
          const body = await readJson(req);
          const r = auth.adminLogin(
            String(body.email ?? ""),
            String(body.password ?? ""),
            clientKey(req, server),
          );
          if (!r.ok) {
            return Response.json(
              { error: r.reason },
              { status: 401, headers: retryHeaders(r.retryAfterSeconds) },
            );
          }
          return Response.json({
            access_token: auth.adminToken(r.email),
            token_type: "Bearer",
            expires_in: ACCESS_TTL,
          });
        } catch (e) {
          return errorResponse(e);
        }
      },
    },
    "/api/admin/mcp": {
      GET: (req: Req) => {
        if (!adminAvailable()) return notFound();
        if (adminIdentity(req) === null) {
          return Response.json({ error: "admin login required" }, { status: 401 });
        }
        return Response.json({ enabled: mcp.enabled });
      },
      PUT: async (req: Req) => {
        if (!adminAvailable()) return notFound();
        try {
          checkHost(req, opts.hostname);
          checkOrigin(req);
          if (adminIdentity(req) === null) throw new HttpError(401, "admin login required");
          const body = await readJson(req);
          if (typeof body.enabled !== "boolean") {
            throw new FormatError('expected {"enabled": true} or {"enabled": false}');
          }
          setMcp(body.enabled, "through the admin API");
          return Response.json({ enabled: mcp.enabled });
        } catch (e) {
          return errorResponse(e);
        }
      },
    },

    // --- MCP and OAuth: these addresses do not exist while MCP is off ----------------------------
    "/mcp": mcpOnly(async (req) => {
      checkHost(req, opts.hostname);
      if (req.method !== "POST") {
        return new Response("kloss's MCP endpoint takes POST (stateless, JSON answers)", {
          status: 405,
          headers: { allow: "POST" },
        });
      }
      const email = identify(req);
      if (email === null) {
        return Response.json(
          { error: "log in first (OAuth)" },
          { status: 401, headers: { "www-authenticate": challenge(req) } },
        );
      }
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return Response.json(
          { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
          { status: 400 },
        );
      }
      const ctx = {
        sessions,
        email: email || undefined,
        baseUrl: baseUrl(req),
        version: opts.version,
      };
      const messages = (Array.isArray(body) ? body : [body]) as RpcMessage[];
      const answers = messages
        .map((m) => {
          const answer = handleMcp(m, ctx);
          // the host sees what agents do: who called which tool, for which session, and
          // whether it was refused (and why)
          if (m?.method === "tools/call") {
            const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
            const code = typeof args.code === "string" ? ` ${args.code}` : "";
            const result = answer?.result as
              | { isError?: boolean; content?: { text?: string }[] }
              | undefined;
            const refused = result?.isError
              ? ` (refused: ${(result.content?.[0]?.text ?? "").slice(0, 120)})`
              : "";
            log(`mcp: ${email || "-"} ${String(m.params?.name ?? "?")}${code}${refused}`);
          }
          return answer;
        })
        .filter((a) => a !== null);
      if (!answers.length) return new Response(null, { status: 202 });
      return Response.json(Array.isArray(body) ? answers : answers[0]);
    }),
    "/.well-known/oauth-protected-resource": mcpOnly(resourceMetadata, true),
    "/.well-known/oauth-protected-resource/mcp": mcpOnly(resourceMetadata, true),
    "/.well-known/oauth-authorization-server": mcpOnly((req) => {
      const b = baseUrl(req);
      return Response.json({
        issuer: b,
        authorization_endpoint: `${b}/oauth/authorize`,
        token_endpoint: `${b}/oauth/token`,
        registration_endpoint: `${b}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }, true),
    "/oauth/register": mcpOnly(async (req) => {
      if (req.method !== "POST") return notFound();
      const body = await readJson(req);
      const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
      const valid =
        uris.length > 0 && uris.every((u) => /^https?:\/\/\S+$/.test(u) && URL.canParse(u));
      if (!valid) return oauthError("invalid_redirect_uri", "redirect_uris must be http(s) URLs");
      return Response.json(
        {
          client_id: auth.registerClient(uris),
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_name: typeof body.client_name === "string" ? body.client_name : undefined,
          redirect_uris: uris,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        },
        { status: 201 },
      );
    }, true),
    "/oauth/authorize": mcpOnly(async (req, server) => {
      if (req.method === "GET") {
        const a = authorizeParams(new URL(req.url).searchParams);
        // already logged in in this browser: no need to ask again
        const known = identify(req);
        return known ? redirectWithCode(a, known) : authorizeLogin(a);
      }
      if (req.method !== "POST") return notFound();
      checkOrigin(req);
      const p = await readParams(req);
      const a = authorizeParams(p);
      const email = p.get("email") ?? "";
      const r = auth.login(email, p.get("password") ?? "", clientKey(req, server));
      if (!r.ok) {
        return withStatus(
          authorizeLogin(a, r.reason, email),
          401,
          retryHeaders(r.retryAfterSeconds),
        );
      }
      return redirectWithCode(a, r.email, {
        "set-cookie": cookie(req, COOKIE, auth.accessToken(r.email), ACCESS_TTL),
      });
    }, true),
    "/oauth/token": mcpOnly(async (req) => {
      if (req.method !== "POST") return notFound();
      const p = await readParams(req);
      const grant = p.get("grant_type");
      if (grant === "authorization_code") {
        const email = auth.redeemCode(
          p.get("code") ?? "",
          p.get("client_id") ?? "",
          p.get("redirect_uri") ?? "",
          p.get("code_verifier") ?? "",
        );
        return email
          ? tokens(email)
          : oauthError("invalid_grant", "the code is wrong, used or expired");
      }
      if (grant === "refresh_token") {
        const email = auth.verify(p.get("refresh_token") ?? "", "refresh");
        return email
          ? tokens(email)
          : oauthError("invalid_grant", "the refresh token is wrong or expired");
      }
      return oauthError("unsupported_grant_type", "use authorization_code or refresh_token");
    }, true),
  };

  const server = Bun.serve({
    port: opts.port,
    hostname: opts.hostname,
    development: false,
    maxRequestBodySize: MAX_BODY_BYTES + 1024,
    // SSE connections stay open; pings every 15 s keep them inside this timeout.
    idleTimeout: 60,
    routes: routes as never,
    fetch: () => notFound(),
  });

  const sweep = setInterval(() => {
    for (const code of sessions.sweep()) log(`session ${code} expired (idle)`);
  }, opts.sweepMs ?? 60_000);
  sweep.unref?.();
  const stop = server.stop.bind(server);
  server.stop = ((closeActive?: boolean) => {
    clearInterval(sweep);
    return stop(closeActive);
  }) as typeof server.stop;
  return server;
}
