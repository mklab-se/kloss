import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "bun";
import { startServer } from "../../src/server/http.ts";
import { ModelStore } from "../../src/server/model-store.ts";

let dir = "";
let file = "";
let server: Server<undefined>;
let base = "";

async function serve(initial = ""): Promise<void> {
  await writeFile(file, initial);
  const store = await ModelStore.open(file);
  server = startServer({ store, port: 0, hostname: "127.0.0.1" });
  base = `http://127.0.0.1:${server.port}`;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kloss-http-"));
  file = join(dir, "castle.kl");
});

afterEach(async () => {
  server?.stop(true);
  await rm(dir, { recursive: true, force: true });
});

const post = (body: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/klossar`, { method: "POST", body, headers });

/** Reads SSE events (skipping pings) until `count` have arrived. */
async function readEvents(
  res: Response,
  count: number,
  onFirst?: () => Promise<unknown>,
): Promise<{ event: string; data: unknown }[]> {
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

describe("REST API", () => {
  test("POST a JSON kloss", async () => {
    await serve();
    const res = await post(JSON.stringify({ size: "2x4", color: "blue", x: 2, y: 0 }), {
      "content-type": "application/json",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      index: 0,
      size: "2x4",
      color: "blue",
      x: 2,
      y: 0,
      level: 0,
    });
  });

  test("POST a text line lands on top of what is there", async () => {
    await serve("2x2 red 0,0\n");
    const res = await post("2x2 red 0,0", { "content-type": "text/plain" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { level: number }).level).toBe(1);
    expect(await readFile(file, "utf8")).toBe("2x2 red 0,0\n2x2 red 0,0\n");
  });

  test("curl -d (form encoded) is read as a text line", async () => {
    await serve();
    const res = await post("2x4 blue 2,0", {
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(res.status).toBe(201);
  });

  test("a bad line is a 400 naming the problem", async () => {
    await serve();
    const res = await post("2x2 teal 0,0");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('"teal"');
  });

  test("bad JSON is a 400", async () => {
    await serve();
    expect((await post("{ nope")).status).toBe(400);
    expect((await post('{"size":"2x2"}')).status).toBe(400);
  });

  test("GET the model as JSON and as text", async () => {
    await serve("# c\n2x2 red 0,0\n");
    const json = (await (await fetch(`${base}/api/model`)).json()) as {
      file: string;
      klossar: unknown[];
    };
    expect(json.file).toBe("castle.kl");
    expect(json.klossar).toEqual([{ index: 0, size: "2x2", color: "red", x: 0, y: 0, level: 0 }]);
    const text = await fetch(`${base}/api/model.kl`);
    expect(text.headers.get("content-type")).toContain("text/plain");
    expect(await text.text()).toBe("# c\n2x2 red 0,0\n");
  });

  test("PUT replaces the model, or nothing on error", async () => {
    await serve("2x2 red 0,0\n");
    const ok = await fetch(`${base}/api/model`, {
      method: "PUT",
      body: "1x1 blue 0,0\n1x1 blue 0,0\n",
    });
    expect(ok.status).toBe(200);
    const model = (await ok.json()) as { klossar: { level: number }[] };
    expect(model.klossar.map((k) => k.level)).toEqual([0, 1]);

    const bad = await fetch(`${base}/api/model`, { method: "PUT", body: "1x1 blue 0,0\nnope\n" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { line: number }).line).toBe(2);
    expect(await readFile(file, "utf8")).toBe("1x1 blue 0,0\n1x1 blue 0,0\n");
  });

  test("bodies over 1 MB are a 413", async () => {
    await serve();
    const big = `# ${"x".repeat(1_000_001)}\n`;
    expect((await fetch(`${base}/api/model`, { method: "PUT", body: big })).status).toBe(413);
  });

  test("dropping past the kloss limit is a 413", async () => {
    await serve(`${Array.from({ length: 10_000 }, () => "1x1 red 0,0").join("\n")}\n`);
    expect((await post("1x1 red 0,0")).status).toBe(413);
  });

  test("changes from another web page are refused, our own page and curl are not", async () => {
    await serve();
    expect((await post("1x1 red 0,0", { origin: "https://evil.example" })).status).toBe(403);
    expect(
      (
        await fetch(`${base}/api/model`, {
          method: "PUT",
          body: "",
          headers: { origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect((await post("1x1 red 0,0", { origin: base })).status).toBe(201);
    expect((await post("1x1 red 0,0")).status).toBe(201);
  });

  test("health, the web app and wrong methods", async () => {
    await serve();
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect((await fetch(`${base}/api/klossar`, { method: "DELETE" })).status).toBe(405);
  });
});

describe("live events", () => {
  test("model on connect, then drop after a POST", async () => {
    await serve("2x2 red 0,0\n");
    const res = await fetch(`${base}/events`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await readEvents(res, 2, () => post("2x2 red 0,0"));
    expect(events[0]).toEqual({
      event: "model",
      data: { klossar: [{ index: 0, size: "2x2", color: "red", x: 0, y: 0, level: 0 }] },
    });
    expect(events[1]).toEqual({
      event: "drop",
      data: { index: 1, size: "2x2", color: "red", x: 0, y: 0, level: 1 },
    });
  });
});
