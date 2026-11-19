import { afterAll, describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";
import { generateCompletion } from "../src/commands/completion.ts";
import { buildVersion, buildVersionAsync, parseDuration } from "../src/commands/serve.ts";
import { TOOL, VERSION } from "../src/meta.ts";

const env = { ...process.env, KLOSS_NO_UPDATE_CHECK: "1", NO_COLOR: "1" };

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", "src/cli.ts", ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("cli", () => {
  test("no command shows the banner and points at kloss serve", async () => {
    const r = await run();
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`v${VERSION}`);
    expect(r.stdout).toContain("kloss serve");
  });

  test("--version prints the package version", async () => {
    expect((await run("--version")).stdout.trim()).toBe(VERSION);
  });

  test("version shows the banner and version", async () => {
    const r = await run("version");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`v${VERSION}`);
  });

  test("an unknown shell is rejected", async () => {
    const r = await run("completion", "nope");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("Allowed choices are bash, zsh, fish");
  });
});

describe("completion", () => {
  test("every shell script names the tool and its commands", () => {
    const program = buildProgram();
    for (const shell of ["bash", "zsh", "fish"] as const) {
      const script = generateCompletion(shell, TOOL, program);
      expect(script).toContain(TOOL);
      expect(script).toContain("version");
      expect(script).toContain("completion");
    }
  });
});

describe("serve", () => {
  const procs: ReturnType<typeof Bun.spawn>[] = [];

  afterAll(() => {
    for (const p of procs) p.kill();
  });

  async function start(extra: string[] = [], extraEnv: Record<string, string> = {}) {
    const port = 19_000 + Math.floor(Math.random() * 1000);
    const proc = Bun.spawn(["bun", "src/cli.ts", "serve", "--port", String(port), ...extra], {
      env: { ...env, ...extraEnv },
      stdout: "pipe",
      stderr: "pipe",
    });
    procs.push(proc);
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    let out = "";
    while (!out.includes("curl")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    return { base: `http://127.0.0.1:${port}`, out };
  }

  test("--help lists the options and how login works", async () => {
    const r = await run("serve", "--help");
    expect(r.code).toBe(0);
    for (const word of [
      "--port",
      "--host",
      "--mcp",
      "--session-idle",
      "--max-sessions",
      "KLOSS_PASSWORD",
    ]) {
      expect(r.stdout).toContain(word);
    }
  });

  test("serves sessions: start one, drop a kloss, download the model", async () => {
    const { base, out } = await start();
    expect(out).toContain(base);
    expect(out).toContain("login off");
    const made = await fetch(`${base}/api/sessions`, { method: "POST" });
    expect(made.status).toBe(201);
    const { code } = (await made.json()) as { code: string };
    const drop = await fetch(`${base}/api/sessions/${code}/klossar`, {
      method: "POST",
      body: "2,0|2x4|blue",
    });
    expect(drop.status).toBe(201);
    expect(await (await fetch(`${base}/api/sessions/${code}/model.kl`)).text()).toBe(
      "  2,  0 | 2x4 | blue\n",
    );
  });

  test("KLOSS_PASSWORD turns login on; --mcp turns the endpoint on", async () => {
    const { base } = await start(["--mcp"], { KLOSS_PASSWORD: "class" });
    const health = (await (await fetch(`${base}/healthz`)).json()) as { auth: boolean };
    expect(health.auth).toBe(true);
    expect((await fetch(`${base}/api/sessions`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${base}/mcp`, { method: "POST", body: "{}" })).status).toBe(401);
  });
});

describe("serve helpers", () => {
  test("parseDuration", () => {
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("30m")).toBe(1_800_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("1500")).toBe(1500);
    expect(() => parseDuration("soon")).toThrow();
  });

  test("buildVersion adds the build only when it is not the release itself", () => {
    expect(buildVersion({})).toBe(VERSION);
    expect(buildVersion({ KLOSS_BUILD: VERSION })).toBe(VERSION);
    expect(buildVersion({ KLOSS_BUILD: "3f2a1c9" })).toBe(`${VERSION}+3f2a1c9`);
  });
});

test("buildVersion reads the build from a file too (the container image carries one)", async () => {
  const file = `${process.env.TMPDIR ?? "/tmp"}/kloss-build-${Date.now()}`;
  await Bun.write(file, "3f2a1c9-dirty\n");
  expect(await buildVersionAsync({ KLOSS_BUILD_FILE: file })).toBe(`${VERSION}+3f2a1c9-dirty`);
  expect(await buildVersionAsync({ KLOSS_BUILD_FILE: "/no/such/file" })).toBe(VERSION);
});

test("with login on, kloss serve prints the token step too", async () => {
  const port = 19_000 + Math.floor(Math.random() * 1000);
  const proc = Bun.spawn(["bun", "src/cli.ts", "serve", "--port", String(port)], {
    env: { ...env, KLOSS_PASSWORD: "class" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  let out = "";
  while (!out.includes("/klossar")) {
    const { value, done } = await reader.read();
    if (done) break;
    out += new TextDecoder().decode(value);
  }
  proc.kill();
  expect(out).toContain("/api/token");
  expect(out).toContain("Authorization: Bearer $TOKEN");
});
