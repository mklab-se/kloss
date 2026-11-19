/**
 * `kloss serve`: the start page, the live 3D viewer and the REST API for many sessions at once,
 * all in memory. Login is on when KLOSS_PASSWORD is set; the MCP endpoint is off unless asked.
 */
import type { Server } from "bun";
import { dim } from "../color.ts";
import { VERSION } from "../meta.ts";
import { Auth, readSecret, tokenSecret } from "../server/auth.ts";
import { startServer } from "../server/http.ts";
import { SessionStore } from "../server/sessions.ts";

export interface ServeOptions {
  port: number;
  host: string;
  open: boolean;
  mcp: boolean;
  /** Idle time before a session is removed, like "2h", "30m" or "90s". */
  sessionIdle: string;
  maxSessions: number;
}

/** "2h", "30m", "90s" or plain milliseconds, as milliseconds. */
export function parseDuration(s: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/.exec(s.trim());
  if (!m) throw new Error(`not a duration: "${s}" (use for example 30m, 2h or 90s)`);
  const n = Number(m[1]);
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] ?? "ms"] ?? 1;
  return Math.round(n * unit);
}

/** The version as shown by /healthz: the release, plus the build when it is not exactly one. */
export function buildVersion(env: Record<string, string | undefined> = process.env): string {
  const build = env.KLOSS_BUILD?.trim();
  return build && build !== VERSION ? `${VERSION}+${build}` : VERSION;
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

export async function runServe(
  opts: ServeOptions,
  env: Record<string, string | undefined> = process.env,
): Promise<Server<undefined>> {
  const password = await readSecret(env, "KLOSS_PASSWORD");
  const adminPassword = await readSecret(env, "KLOSS_ADMIN_PASSWORD");
  const auth = new Auth({ password, adminPassword, secret: await tokenSecret(env) });
  const sessions = new SessionStore({
    idleMs: parseDuration(opts.sessionIdle),
    maxSessions: opts.maxSessions,
  });
  const version = buildVersion(env);
  const server = startServer({
    sessions,
    auth,
    mcp: { enabled: opts.mcp },
    port: opts.port,
    hostname: opts.host,
    version,
    publicUrl: env.KLOSS_PUBLIC_URL,
  });
  const shownHost = opts.host === "0.0.0.0" ? "localhost" : opts.host;
  const url = env.KLOSS_PUBLIC_URL ?? `http://${shownHost}:${server.port}`;
  console.log(`kloss ${version} is serving at ${url}`);
  console.log(
    dim(
      `login ${auth.enabled ? "on" : "off"}, admin ${auth.enabled && !auth.adminEnabled ? "off" : "on"}, MCP ${opts.mcp ? "on" : "off"}, sessions expire after ${opts.sessionIdle} idle`,
    ),
  );
  console.log(dim("Start a session and drop a kloss:"));
  console.log(`  curl -X POST ${url}/api/sessions`);
  console.log(`  curl -X POST ${url}/api/sessions/<code>/klossar -d '2,0|2x4|blue'`);
  if (opts.open) openBrowser(url);
  return server;
}
