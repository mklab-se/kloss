/**
 * Plays the everyday requests through a real AI agent (Claude Code, headless) against a local
 * kloss with MCP on, and checks each result. It costs real tokens and a model's answers vary, so it
 * is a script to run before a class, not a CI test.
 *
 *   bun scripts/agent-check.ts                 # with Claude Code's default model
 *   KLOSS_AGENT_MODEL=sonnet bun scripts/agent-check.ts
 *
 * One conversation, like a user's: each step continues the previous one (--resume), so "the open
 * model" means what it would to a person. The server's log ("mcp: - drop_klossar <code>") shows
 * which tools the agent called.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseModel } from "../src/core/format.ts";

const CAR = `# a small car: four wheels, a body and a cabin
0,0|1x1|black
1,0
0,3
1,3
0,0|2x4|red
0,1|2x1|azure
0,2
`;

const port = 19_500 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const dir = await mkdtemp(join(tmpdir(), "kloss-agent-"));
await Bun.write(join(dir, "castle.kl"), Bun.file("examples/castle.kl"));
await Bun.write(join(dir, "car.kl"), CAR);
await Bun.write(
  join(dir, "mcp.json"),
  JSON.stringify({ mcpServers: { kloss: { type: "http", url: `${base}/mcp` } } }),
);

// the kloss server, with MCP on and login off (the agent's login is OAuth, tested elsewhere)
const server = Bun.spawn(["bun", "src/cli.ts", "serve", "--port", String(port), "--mcp"], {
  env: { ...process.env, KLOSS_NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
  stdout: "pipe",
  stderr: "inherit",
});
const log: string[] = [];
(async () => {
  const reader = (server.stdout as ReadableStream<Uint8Array>).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += new TextDecoder().decode(value);
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    log.push(...lines);
  }
})();
for (let i = 0; i < 100; i++) {
  if (
    await fetch(`${base}/healthz`).then(
      (r) => r.ok,
      () => false,
    )
  )
    break;
  await Bun.sleep(100);
}

let sessionId: string | undefined;

/** Asks the agent, continuing the same conversation; returns its answer and the tools it called. */
async function ask(prompt: string): Promise<{ text: string; tools: string[] }> {
  const before = log.length;
  const args = [
    "claude",
    "-p",
    prompt,
    "--output-format",
    "json",
    "--mcp-config",
    join(dir, "mcp.json"),
    "--strict-mcp-config",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    "mcp__kloss",
    "Read",
    "Write",
  ];
  if (process.env.KLOSS_AGENT_MODEL) args.push("--model", process.env.KLOSS_AGENT_MODEL);
  if (sessionId) args.push("--resume", sessionId);
  const proc = Bun.spawn(args, { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  await Bun.sleep(200);
  let text = out;
  try {
    const json = JSON.parse(out) as { result?: string; session_id?: string };
    text = json.result ?? "";
    sessionId = json.session_id ?? sessionId;
  } catch {}
  const tools = log
    .slice(before)
    .filter((l) => l.startsWith("mcp: "))
    .map((l) => {
      const [, , name = "", , ...rest] = l.split(" ");
      return rest.join(" ").startsWith("(refused") ? `${name} (refused)` : name;
    });
  return { text, tools };
}

const results: { step: string; ok: boolean; why: string }[] = [];
function check(step: string, ok: boolean, why: string, answer: string): void {
  results.push({ step, ok, why });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}: ${why}`);
  if (!ok) console.log(`      agent said: ${answer.replace(/\s+/g, " ").slice(0, 400)}`);
}

const codeIn = (text: string) => /\/s\/([a-z]+-[a-z]+-\d{2})/.exec(text)?.[1];
const model = async (code: string) =>
  (await (await fetch(`${base}/api/sessions/${code}/model`)).json()) as {
    klossar: { size: string; color: string; x: number; y: number }[];
  };

try {
  // 1. "Visualize": broad, so the agent should ask which kind
  let r = await ask("Visualize castle.kl that I have in this folder please");
  const asked =
    /3d|live|interactive/i.test(r.text) && /picture|image|render|snapshot/i.test(r.text);
  check(
    "visualize asks: live 3D view or picture",
    asked && r.text.includes("?"),
    r.tools.join(", ") || "no tools",
    r.text,
  );

  r = await ask("Just a rendered picture please");
  check(
    "a picture is rendered",
    r.tools.includes("render_model"),
    `tools: ${r.tools.join(", ") || "none"}`,
    r.text,
  );

  // 2. "Open": the live view, with a link
  r = await ask("Open model car.kl");
  const car = codeIn(r.text);
  check(
    "open shares a link to the live view",
    r.tools.includes("create_session") && Boolean(car),
    car ? `session ${car}` : "no session link in the answer",
    r.text,
  );

  if (car) {
    // 3. "Optimize the open model": the car session
    r = await ask("Optimize the open model");
    const after = (await model(car)).klossar.length;
    check(
      "optimize uses the open model",
      r.tools.includes("optimize_model") && after < parseModel(CAR).length,
      `tools: ${r.tools.join(", ") || "none"}; ${parseModel(CAR).length} -> ${after} klossar`,
      r.text,
    );

    // 4. "Save": the session's model, written to the file
    r = await ask("Save the model to house.kl");
    const file = Bun.file(join(dir, "house.kl"));
    const saved = (await file.exists()) ? parseModel(await file.text()) : [];
    const current = (await model(car)).klossar;
    check(
      "save writes the open model to house.kl",
      saved.length === current.length && saved.length > 0,
      `house.kl has ${saved.length} klossar, the session ${current.length}`,
      r.text,
    );

    // 5. "Add": one kloss, as described
    const countBefore = (await model(car)).klossar.length;
    r = await ask("Add a blue 2x4 at 1,0");
    const now = (await model(car)).klossar;
    const blue = now.filter(
      (k) => k.size === "2x4" && k.color === "blue" && k.x === 1 && k.y === 0,
    );
    check(
      "add drops exactly one blue 2x4 at 1,0",
      blue.length === 1 && now.length === countBefore + 1,
      `tools: ${r.tools.join(", ") || "none"}; ${countBefore} -> ${now.length} klossar`,
      r.text,
    );
  }
} finally {
  server.kill();
  await rm(dir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
