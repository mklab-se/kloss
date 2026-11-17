/**
 * Builds the single-file binary and checks it serves the whole web app with nothing next to it.
 * Slow, so it only runs with KLOSS_COMPILED_TEST=1 (CI's build job runs it).
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const enabled = process.env.KLOSS_COMPILED_TEST === "1";
let dir = "";
let proc: ReturnType<typeof Bun.spawn> | undefined;

afterAll(async () => {
  proc?.kill();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test.if(enabled)(
  "compiled binary serves the web app and the API",
  async () => {
    dir = await mkdtemp(join(tmpdir(), "kloss-bin-"));
    const out = join(dir, "kloss");
    const build = Bun.spawnSync([
      "bun",
      "build",
      "src/cli.ts",
      "--compile",
      "--minify",
      "--outfile",
      out,
    ]);
    expect(build.exitCode).toBe(0);
    const port = 18_000 + Math.floor(Math.random() * 1000);
    // run from an empty directory so nothing can be read from the source tree
    proc = Bun.spawn([out, "serve", "m.kl", "--port", String(port)], {
      cwd: dir,
      env: { ...process.env, KLOSS_NO_UPDATE_CHECK: "1" },
      stdout: "pipe",
    });
    const base = `http://127.0.0.1:${port}`;
    let html = "";
    for (let i = 0; i < 50 && !html; i++) {
      try {
        html = await (await fetch(base)).text();
      } catch {
        await Bun.sleep(100);
      }
    }
    expect(html).toContain("<canvas");
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
    expect(assets.length).toBeGreaterThanOrEqual(2);
    for (const a of assets) {
      const res = await fetch(new URL(a ?? "", base));
      expect(res.status).toBe(200);
    }
    const drop = await fetch(`${base}/api/klossar`, { method: "POST", body: "0,0|2x2|red" });
    expect(drop.status).toBe(201);
    const model = (await (await fetch(`${base}/api/model`)).json()) as { klossar: unknown[] };
    expect(model.klossar).toHaveLength(1);
    expect(await readFile(join(dir, "m.kl"), "utf8")).toBe("  0,  0 | 2x2 | red\n");
  },
  120_000,
);
