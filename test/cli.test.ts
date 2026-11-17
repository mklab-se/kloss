import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgram } from "../src/cli.ts";
import { generateCompletion } from "../src/commands/completion.ts";
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
  let dir = "";
  let proc: ReturnType<typeof Bun.spawn> | undefined;

  afterAll(async () => {
    proc?.kill();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("--help lists the file argument and the options", async () => {
    const r = await run("serve", "--help");
    expect(r.code).toBe(0);
    for (const word of ["[file]", "--port", "--host", "--open"]) expect(r.stdout).toContain(word);
  });

  test("an invalid model file stops with its line number", async () => {
    dir ||= await mkdtemp(join(tmpdir(), "kloss-cli-"));
    const bad = join(dir, "bad.kl");
    await writeFile(bad, "0,0|2x2|red\n0,0|2x2|teal\n");
    const r = await run("serve", bad, "--port", "0");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("line 2:");
  });

  test("serves the model and appends drops to the file", async () => {
    dir ||= await mkdtemp(join(tmpdir(), "kloss-cli-"));
    const file = join(dir, "m.kl");
    const port = 19_000 + Math.floor(Math.random() * 1000);
    proc = Bun.spawn(["bun", "src/cli.ts", "serve", file, "--port", String(port)], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    let out = "";
    while (!out.includes("curl")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    expect(out).toContain(`http://127.0.0.1:${port}`);
    expect(out).toContain("curl -X POST");
    const res = await fetch(`http://127.0.0.1:${port}/api/klossar`, {
      method: "POST",
      body: "2,0|2x4|blue",
    });
    expect(res.status).toBe(201);
    expect(await readFile(file, "utf8")).toBe("  2,  0 | 2x4 | blue\n");
  });
});
