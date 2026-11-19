/**
 * `kloss mcp`: kloss as a local MCP server that the agent starts itself. It speaks MCP on stdin
 * and stdout (one JSON-RPC message per line) and starts its own small web server on a free port,
 * so the links it hands out (the 3D view, the REST API) work in the browser. Everything lives as
 * long as the process. stdout belongs to the protocol: every log line goes to stderr.
 *
 * `kloss mcp --http` serves MCP over HTTP instead, at /mcp, turned on from the start.
 */
import { userInfo } from "node:os";
import type { Server } from "bun";
import { dim } from "../color.ts";
import { Auth, tokenSecret } from "../server/auth.ts";
import { startServer } from "../server/http.ts";
import { handleMcp, type McpContext, type RpcMessage, toolCallLine } from "../server/mcp.ts";
import { SessionStore } from "../server/sessions.ts";
import { buildVersionAsync } from "./serve.ts";

export interface McpStdioOptions {
  /** Port for the web server; 0 lets the system pick a free one. */
  port: number;
  host: string;
}

/**
 * Answers JSON-RPC lines from `lines`, one answer per line through `write`, until the input ends.
 * A line that is not JSON gets a parse error; notifications get no answer.
 */
export async function serveLines(
  lines: AsyncIterable<string>,
  ctx: McpContext,
  write: (line: string) => void,
  log: (line: string) => void,
): Promise<void> {
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let body: unknown;
    try {
      body = JSON.parse(line);
    } catch {
      write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }),
      );
      continue;
    }
    const messages = (Array.isArray(body) ? body : [body]) as RpcMessage[];
    const answers = messages
      .map((m) => {
        const answer = handleMcp(m, ctx);
        const note = toolCallLine(m, answer, ctx.email);
        if (note) log(note);
        return answer;
      })
      .filter((a) => a !== null);
    if (answers.length) write(JSON.stringify(Array.isArray(body) ? answers : answers[0]));
  }
}

/** Splits a byte stream into lines. */
async function* linesOf(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true });
    let at = buffered.indexOf("\n");
    while (at >= 0) {
      yield buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      at = buffered.indexOf("\n");
    }
  }
  if (buffered) yield buffered;
}

/** Who drops the klossar: the user running the agent. */
function whoAmI(): string {
  try {
    return userInfo().username;
  } catch {
    return "local";
  }
}

export async function runMcpStdio(
  opts: McpStdioOptions,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const log = (line: string) => console.error(line);
  const sessions = new SessionStore({ idleMs: 24 * 3_600_000, maxSessions: 100 });
  const version = await buildVersionAsync(env);
  const server: Server<undefined> = startServer({
    sessions,
    auth: new Auth({ secret: await tokenSecret(env) }),
    mcp: { enabled: false },
    port: opts.port,
    hostname: opts.host,
    version,
    log,
  });
  const shownHost = opts.host === "0.0.0.0" ? "localhost" : opts.host;
  const baseUrl = `http://${shownHost}:${server.port}`;
  log(`kloss ${version} speaks MCP on stdio; the 3D view and the REST API are at ${baseUrl}`);
  log(dim("Sessions last as long as this process."));
  const ctx: McpContext = { sessions, email: whoAmI(), baseUrl, version };
  await serveLines(
    linesOf(Bun.stdin.stream()),
    ctx,
    (line) => process.stdout.write(`${line}\n`),
    log,
  );
  server.stop(true);
}
