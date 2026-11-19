import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Server } from "bun";
import { Auth } from "../../src/server/auth.ts";
import { startServer } from "../../src/server/http.ts";
import { SessionStore } from "../../src/server/sessions.ts";

const secret = new TextEncoder().encode("http-test-secret-http-test-secret");

let server: Server<undefined> | undefined;
let base = "";

function serve(o: { password?: string; adminPassword?: string; mcp?: boolean } = {}) {
  const sessions = new SessionStore({ idleMs: 60_000, maxSessions: 5 });
  const auth = new Auth({ password: o.password, adminPassword: o.adminPassword, secret });
  server = startServer({
    sessions,
    auth,
    mcp: { enabled: o.mcp ?? false },
    port: 0,
    hostname: "127.0.0.1",
    version: "1.2.3",
  });
  base = `http://127.0.0.1:${server.port}`;
  return { sessions, auth };
}

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

const req = (path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, { redirect: "manual", ...init });
const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  req(path, { method: "POST", body, headers });
const form = { "content-type": "application/x-www-form-urlencoded" };

async function newSession(headers: Record<string, string> = {}, body = ""): Promise<string> {
  const res = await post("/api/sessions", body, headers);
  expect(res.status).toBe(201);
  return ((await res.json()) as { code: string }).code;
}

async function token(email = "ada@example.com", password = "letmein"): Promise<string> {
  const res = await post("/api/token", JSON.stringify({ email, password }), {
    "content-type": "application/json",
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Reads SSE events (skipping pings) until `count` have arrived. */
async function readEvents(res: Response, count: number, onFirst?: () => Promise<unknown>) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  const out: { event: string; data: unknown }[] = [];
  let buf = "";
  let triggered = false;
  while (out.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i = buf.indexOf("\n\n");
    while (i >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1] ?? "";
      const data = /^data: (.*)$/m.exec(chunk)?.[1] ?? "null";
      if (event !== "ping") out.push({ event, data: JSON.parse(data) });
      i = buf.indexOf("\n\n");
    }
    if (!triggered && out.length > 0 && onFirst) {
      triggered = true;
      await onFirst();
    }
  }
  await reader.cancel();
  return out;
}

describe("health", () => {
  test("public, with the version and whether login is on, and no trace of MCP", async () => {
    serve({ password: "letmein" });
    const res = await req("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: "1.2.3", auth: true });
  });
});

describe("sessions (login off)", () => {
  test("create, drop, read as JSON and as .kl, delete", async () => {
    serve();
    const res = await post("/api/sessions", "");
    expect(res.status).toBe(201);
    const made = (await res.json()) as { code: string; url: string };
    expect(made.url).toBe(`${base}/s/${made.code}`);
    const s = `/api/sessions/${made.code}`;

    expect((await post(`${s}/klossar`, "0,0|2x2|red")).status).toBe(201);
    const again = await post(`${s}/klossar`, ".", form);
    expect(((await again.json()) as { level: number }).level).toBe(1);
    const json = await post(
      `${s}/klossar`,
      JSON.stringify({ size: "2x4", color: "blue", x: 2, y: 0 }),
    );
    expect(json.status).toBe(201);

    const model = (await (await req(`${s}/model`)).json()) as { code: string; klossar: unknown[] };
    expect(model.code).toBe(made.code);
    expect(model.klossar).toHaveLength(3);
    const kl = await req(`${s}/model.kl`);
    expect(kl.headers.get("content-type")).toContain("text/plain");
    expect(await kl.text()).toBe("  0,  0 | 2x2 | red\n.\n  2,  0 | 2x4 | blue\n");

    const info = (await (await req(s)).json()) as { klossar: number };
    expect(info.klossar).toBe(3);
    expect((await req(s, { method: "DELETE" })).status).toBe(204);
    expect((await req(`${s}/model`)).status).toBe(404);
  });

  test("a session can start from a .kl body; an invalid one is a 400 with its line", async () => {
    serve();
    const code = await newSession({}, "0,0|2x2|red\n.\n");
    const model = (await (await req(`/api/sessions/${code}/model`)).json()) as {
      klossar: unknown[];
    };
    expect(model.klossar).toHaveLength(2);
    const bad = await post("/api/sessions", "0,0|2x2|red\n0,0|9x9|red\n");
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { line: number }).line).toBe(2);
  });

  test("PUT replaces the model; bad lines and unknown sessions are refused", async () => {
    serve();
    const code = await newSession();
    const s = `/api/sessions/${code}`;
    expect((await req(`${s}/model`, { method: "PUT", body: "0,0|1x1|blue\n.\n" })).status).toBe(
      200,
    );
    expect((await req(`${s}/model`, { method: "PUT", body: "nope\n" })).status).toBe(400);
    expect((await post(`${s}/klossar`, "0,0|2x2|teal")).status).toBe(400);
    expect((await post("/api/sessions/no-such-42/klossar", "0,0|1x1|red")).status).toBe(404);
  });

  test("the session limit is a 503", async () => {
    serve();
    for (let i = 0; i < 5; i++) await newSession();
    expect((await post("/api/sessions", "")).status).toBe(503);
  });

  test("live events: model on connect, then drop, then deleted", async () => {
    serve();
    const code = await newSession({}, "0,0|2x2|red\n");
    const s = `/api/sessions/${code}`;
    const res = await req(`${s}/events`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await readEvents(res, 3, async () => {
      await post(`${s}/klossar`, ".");
      await req(s, { method: "DELETE" });
    });
    expect(events.map((e) => e.event)).toEqual(["model", "drop", "deleted"]);
  });

  test("changes from another web page are refused", async () => {
    serve();
    expect((await post("/api/sessions", "", { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("/api/sessions", "", { origin: base })).status).toBe(201);
  });

  test("the start page and the viewer are served", async () => {
    serve();
    for (const path of ["/", "/s/otter-maple-42"]) {
      const page = await req(path);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
    }
  });

  test("/api/token is not there when login is off", async () => {
    serve();
    expect((await post("/api/token", "{}")).status).toBe(404);
  });
});

describe("login on", () => {
  test("everything but health needs login; a bearer token from /api/token works", async () => {
    serve({ password: "letmein" });
    const denied = await post("/api/sessions", "");
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain("Bearer");
    expect(denied.headers.get("www-authenticate")).not.toContain("resource_metadata");
    const t = await token();
    const code = await newSession({ authorization: `Bearer ${t}` });
    const drop = await post(`/api/sessions/${code}/klossar`, "0,0|2x2|red", {
      authorization: `Bearer ${t}`,
    });
    expect(((await drop.json()) as { by: string }).by).toBe("ada@example.com");
    expect((await req(`/api/sessions/${code}/model`)).status).toBe(401);
    expect((await req(`/api/sessions/${code}/events`)).status).toBe(401);
  });

  test("a wrong password gets no token", async () => {
    serve({ password: "letmein" });
    const res = await post(
      "/api/token",
      JSON.stringify({ email: "ada@example.com", password: "x" }),
    );
    expect(res.status).toBe(401);
  });

  test("the browser logs in on /login and gets a cookie that opens the API", async () => {
    serve({ password: "letmein" });
    const page = await req("/login?next=/s/otter-maple-42");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<form");
    const res = await post(
      "/login",
      new URLSearchParams({
        email: "ada@example.com",
        password: "letmein",
        next: "/s/otter-maple-42",
      }).toString(),
      { ...form, origin: base },
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/s/otter-maple-42");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const code = await newSession({ cookie, origin: base });
    expect((await req(`/api/sessions/${code}/model`, { headers: { cookie } })).status).toBe(200);
    const me = (await (await req("/api/me", { headers: { cookie } })).json()) as {
      email: string;
    };
    expect(me.email).toBe("ada@example.com");
  });

  test("login refuses to send people to another site", async () => {
    serve({ password: "letmein" });
    const res = await post(
      "/login",
      new URLSearchParams({
        email: "ada@example.com",
        password: "letmein",
        next: "//evil.example",
      }).toString(),
      { ...form, origin: base },
    );
    expect(res.headers.get("location")).toBe("/");
  });
});

describe("admin and the MCP switch", () => {
  test("with login on, /admin needs the admin password; without one it does not exist", async () => {
    serve({ password: "letmein" });
    expect((await req("/admin")).status).toBe(404);
    server?.stop(true);
    serve({ password: "letmein", adminPassword: "boss" });
    const page = await req("/admin");
    expect(page.status).toBe(200);
    expect(await page.text()).not.toContain("MCP");
    const put = await req("/api/admin/mcp", {
      method: "PUT",
      body: JSON.stringify({ enabled: true }),
    });
    expect(put.status).toBe(401);
  });

  test("an admin token turns MCP on and off at runtime", async () => {
    serve({ password: "letmein", adminPassword: "boss" });
    const res = await post(
      "/api/admin/token",
      JSON.stringify({ email: "me@example.com", password: "boss" }),
    );
    const admin = ((await res.json()) as { access_token: string }).access_token;
    const flip = (enabled: boolean) =>
      req("/api/admin/mcp", {
        method: "PUT",
        headers: { authorization: `Bearer ${admin}` },
        body: JSON.stringify({ enabled }),
      });
    expect(await (await flip(true)).json()).toEqual({ enabled: true });
    expect((await post("/mcp", "{}")).status).toBe(401);
    await flip(false);
    expect((await post("/mcp", "{}")).status).toBe(404);
  });

  test("an ordinary user's token cannot flip the switch", async () => {
    serve({ password: "letmein", adminPassword: "boss" });
    const t = await token();
    const res = await req("/api/admin/mcp", {
      method: "PUT",
      headers: { authorization: `Bearer ${t}` },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(401);
  });

  test("with login off (local), the admin API is open", async () => {
    serve();
    const res = await req("/api/admin/mcp", {
      method: "PUT",
      body: JSON.stringify({ enabled: true }),
    });
    expect(await res.json()).toEqual({ enabled: true });
  });
});

describe("MCP endpoint", () => {
  const rpc = (method: string, params: Record<string, unknown> = {}, id = 1) =>
    JSON.stringify({ jsonrpc: "2.0", id, method, params });

  test("while off there is no trace: the same 404 as any unknown address", async () => {
    serve({ password: "letmein" });
    const unknown = await (await req("/no-such-thing")).text();
    for (const path of [
      "/mcp",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-authorization-server",
      "/oauth/register",
      "/oauth/authorize",
      "/oauth/token",
    ]) {
      const res = await req(
        path,
        path.startsWith("/.well-known") ? {} : { method: "POST", body: "{}" },
      );
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(unknown);
    }
  });

  test("locally with MCP on and login off, it just works", async () => {
    serve({ mcp: true });
    const init = await post("/mcp", rpc("initialize", { protocolVersion: "2025-06-18" }));
    const info = (await init.json()) as { result: { serverInfo: { name: string } } };
    expect(info.result.serverInfo.name).toBe("kloss");
    const made = await post(
      "/mcp",
      rpc("tools/call", { name: "create_session", arguments: {} }, 2),
    );
    const result = (await made.json()) as { result: { content: { text: string }[] } };
    expect(JSON.parse(result.result.content[0]?.text ?? "{}").url).toContain("/s/");
    const note = await post(
      "/mcp",
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
    expect(note.status).toBe(202);
  });

  test("with login on: 401 pointing at the resource metadata, then the whole OAuth flow", async () => {
    serve({ password: "letmein", mcp: true });
    const denied = await post("/mcp", rpc("ping"));
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate") ?? "").toContain(
      `resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
    );

    const resource = (await (await req("/.well-known/oauth-protected-resource/mcp")).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(resource.resource).toBe(`${base}/mcp`);
    expect(resource.authorization_servers).toEqual([base]);
    const meta = (await (await req("/.well-known/oauth-authorization-server")).json()) as Record<
      string,
      string
    >;
    expect(meta.issuer).toBe(base);

    const reg = await post(
      "/oauth/register",
      JSON.stringify({ redirect_uris: ["http://localhost:33418/callback"], client_name: "test" }),
      { "content-type": "application/json" },
    );
    expect(reg.status).toBe(201);
    const clientId = ((await reg.json()) as { client_id: string }).client_id;

    const verifier = "a-long-random-verifier-a-long-random-verifier-1234";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "http://localhost:33418/callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
    });
    const page = await req(`/oauth/authorize?${params}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<form");

    const login = await post(
      "/oauth/authorize",
      new URLSearchParams({
        ...Object.fromEntries(params),
        email: "ada@example.com",
        password: "letmein",
      }).toString(),
      { ...form, origin: base },
    );
    expect(login.status).toBe(303);
    const redirect = new URL(login.headers.get("location") ?? "");
    expect(redirect.searchParams.get("state")).toBe("xyz");
    const code = redirect.searchParams.get("code") ?? "";

    const tok = await post(
      "/oauth/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: "http://localhost:33418/callback",
        code_verifier: verifier,
      }).toString(),
      form,
    );
    expect(tok.status).toBe(200);
    const tokens = (await tok.json()) as { access_token: string; refresh_token: string };
    const ok = await post("/mcp", rpc("ping"), { authorization: `Bearer ${tokens.access_token}` });
    expect(ok.status).toBe(200);

    const refreshed = await post(
      "/oauth/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      }).toString(),
      form,
    );
    expect(((await refreshed.json()) as { access_token: string }).access_token).toBeTruthy();
  });
});

describe("undo", () => {
  test("DELETE …/klossar/last takes back the latest kloss; with nothing left it is a 409", async () => {
    serve();
    const code = await newSession({}, "0,0|2x2|red\n2,0|2x4|blue\n");
    const s = `/api/sessions/${code}`;
    const res = await req(`${s}/klossar/last`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ undone: { color: "blue" }, klossar: 1 });
    await req(`${s}/klossar/last`, { method: "DELETE" });
    const empty = await req(`${s}/klossar/last`, { method: "DELETE" });
    expect(empty.status).toBe(409);
  });

  test("with login on, you can only take back your own kloss", async () => {
    serve({ password: "letmein" });
    const ada = await token("ada@example.com");
    const bob = await token("bob@example.com");
    const code = await newSession({ authorization: `Bearer ${ada}` });
    await post(`/api/sessions/${code}/klossar`, "0,0|2x2|red", { authorization: `Bearer ${ada}` });
    const denied = await req(`/api/sessions/${code}/klossar/last`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${bob}` },
    });
    expect(denied.status).toBe(409);
    expect(((await denied.json()) as { error: string }).error).toContain("ada@example.com");
    const ok = await req(`/api/sessions/${code}/klossar/last`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${ada}` },
    });
    expect(ok.status).toBe(200);
  });

  test("viewers get an undo event with the kloss and the model that is left", async () => {
    serve();
    const code = await newSession({}, "0,0|2x2|red\n.\n");
    const s = `/api/sessions/${code}`;
    const events = await readEvents(await req(`${s}/events`), 2, () =>
      req(`${s}/klossar/last`, { method: "DELETE" }),
    );
    expect(events[1]?.event).toBe("undo");
    expect(events[1]?.data).toMatchObject({ kloss: { level: 1 }, klossar: [{ level: 0 }] });
  });
});

describe("optimize", () => {
  test("POST …/optimize merges klossar; ?preview=true only reports", async () => {
    serve();
    const code = await newSession({}, "0,0|1x1|red\n1,0\n2,0\n3,0\n");
    const s = `/api/sessions/${code}`;
    const preview = await post(`${s}/optimize?preview=true`, "");
    expect(await preview.json()).toMatchObject({ before: 4, after: 1, applied: false });
    const done = await post(`${s}/optimize`, "");
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ before: 4, after: 1, applied: true });
    expect(await (await req(`${s}/model.kl`)).text()).toBe("  0,  0 | 4x1 | red\n");
  });
});

describe("render", () => {
  test("GET …/render.png returns a PNG; the view and size can be chosen", async () => {
    serve();
    const code = await newSession({}, "0,0|2x4|red\n");
    const res = await req(`/api/sessions/${code}/render.png?view=top&size=200`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(1, 4)]).toEqual([80, 78, 71]);
    expect((await req(`/api/sessions/${code}/render.png?view=sideways`)).status).toBe(400);
    expect((await req(`/api/sessions/${code}/render.png?size=big`)).status).toBe(400);
  });

  test("with login on, a picture needs login too", async () => {
    serve({ password: "letmein" });
    const t = await token();
    const code = await newSession({ authorization: `Bearer ${t}` });
    expect((await req(`/api/sessions/${code}/render.png`)).status).toBe(401);
  });
});

test("viewers see the optimized model at once, with a note saying what changed", async () => {
  serve();
  const code = await newSession({}, "0,0|1x1|red\n1,0\n2,0\n3,0\n");
  const s = `/api/sessions/${code}`;
  const events = await readEvents(await req(`${s}/events`), 2, () => post(`${s}/optimize`, ""));
  expect(events[1]?.event).toBe("model");
  expect(events[1]?.data).toMatchObject({
    klossar: [{ size: "4x1" }],
    note: "Optimized: 4 → 1 klossar",
  });
});

test("every MCP tool call is logged with who made it and for which session", async () => {
  const lines: string[] = [];
  const sessions = new SessionStore({ idleMs: 60_000, maxSessions: 5 });
  const auth = new Auth({ secret });
  server = startServer({
    sessions,
    auth,
    mcp: { enabled: true },
    port: 0,
    hostname: "127.0.0.1",
    version: "1.2.3",
    log: (line) => lines.push(line),
  });
  base = `http://127.0.0.1:${server.port}`;
  const rpc = (name: string, args: Record<string, unknown>) =>
    post(
      "/mcp",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    );
  const made = await rpc("create_session", {});
  const text = ((await made.json()) as { result: { content: { text: string }[] } }).result
    .content[0]?.text;
  const code = JSON.parse(text ?? "{}").code;
  await rpc("drop_klossar", { code, lines: ["0,0|2x2|red"] });
  await rpc("drop_klossar", { code, lines: ["0,0|2x2|teal"] });
  expect(lines.slice(0, 2)).toEqual([`mcp: - create_session`, `mcp: - drop_klossar ${code}`]);
  expect(lines[2]).toStartWith(`mcp: - drop_klossar ${code} (refused: line 1`);
});

describe("API docs", () => {
  test("/openapi.json and /docs are public, and never mention MCP, even while it is on", async () => {
    serve({ password: "letmein", mcp: true });
    const spec = await req("/openapi.json");
    expect(spec.status).toBe(200);
    const body = await spec.text();
    expect(JSON.parse(body).servers).toEqual([{ url: base }]);
    expect(body.toLowerCase()).not.toContain("mcp");
    const docs = await req("/docs");
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toContain("text/html");
    const html = await docs.text();
    expect(html).toContain("/openapi.json");
    expect(html.toLowerCase()).not.toContain("mcp");
  });
});
