#!/usr/bin/env bun
/**
 * kloss command-line entry point.
 *
 * `buildProgram()` defines the CLI (commander); `main()` runs it, wires the global
 * flags and the background update check. Add commands under `src/commands/` and
 * register them in `buildProgram()`.
 */
import { Argument, Command } from "commander";
import { printBannerWithVersion } from "./banner.ts";
import { dim, setColorEnabled, yellow } from "./color.ts";
import { generateCompletion, SHELLS, type Shell } from "./commands/completion.ts";
import { runServe } from "./commands/serve.ts";
import { DESCRIPTION, NO_UPDATE_CHECK_ENV, PACKAGE_NAME, TOOL, VERSION } from "./meta.ts";
import { checkForUpdate } from "./update.ts";

export interface GlobalOptions {
  verbose: number;
  quiet: boolean;
  color: boolean;
}

export function buildProgram(): Command {
  const program = new Command(TOOL)
    .description(DESCRIPTION)
    .version(VERSION, "-V, --version", "print the version")
    .option(
      "-v, --verbose",
      "increase output verbosity (repeatable)",
      (_: string, prev: number) => prev + 1,
      0,
    )
    .option("-q, --quiet", "suppress non-essential output")
    .option("--no-color", "disable colored output")
    .addHelpText(
      "after",
      `\nkloss (Swedish for "building block") builds models from klossar on an endless floor. Start the live 3D view with "kloss serve", then drop klossar into it through the REST API.`,
    )
    .hook("preAction", (cmd) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      if (!opts.color) setColorEnabled(false);
    })
    // No command: the banner and how to start. `--help` still works.
    .action(() => {
      printBannerWithVersion();
      console.log("Start building with: kloss serve");
    });

  program
    .command("serve")
    .description("serve the start page, the live 3D viewer and the REST API for kloss sessions")
    .option(
      "-p, --port <n>",
      "port to listen on (KLOSS_PORT)",
      (v) => Number.parseInt(v, 10),
      Number(process.env.KLOSS_PORT ?? 4321),
    )
    .option(
      "--host <host>",
      "address to listen on; 0.0.0.0 exposes it to the network (KLOSS_HOST)",
      process.env.KLOSS_HOST ?? "127.0.0.1",
    )
    .option("--mcp", "start with the MCP endpoint turned on (KLOSS_MCP=1)")
    .option(
      "--session-idle <time>",
      "remove sessions idle this long, like 30m or 2h (KLOSS_SESSION_IDLE)",
      process.env.KLOSS_SESSION_IDLE ?? "2h",
    )
    .option(
      "--max-sessions <n>",
      "how many sessions at most (KLOSS_MAX_SESSIONS)",
      (v) => Number.parseInt(v, 10),
      Number(process.env.KLOSS_MAX_SESSIONS ?? 100),
    )
    .option("--open", "open the start page in the browser")
    .addHelpText(
      "after",
      "\nLogin is on when KLOSS_PASSWORD (or KLOSS_PASSWORD_FILE) is set: any e-mail address plus that\npassword. KLOSS_ADMIN_PASSWORD enables /admin, where the MCP endpoint is turned on and off.\nKLOSS_TOKEN_SECRET keeps logins valid across restarts.",
    )
    .action(
      async (opts: {
        port: number;
        host: string;
        mcp?: boolean;
        sessionIdle: string;
        maxSessions: number;
        open?: boolean;
      }) => {
        const mcpEnv = (process.env.KLOSS_MCP ?? "").toLowerCase();
        await runServe({
          port: opts.port,
          host: opts.host,
          open: opts.open ?? false,
          mcp: Boolean(opts.mcp) || mcpEnv === "1" || mcpEnv === "true",
          sessionIdle: opts.sessionIdle,
          maxSessions: opts.maxSessions,
        });
      },
    );

  program
    .command("version")
    .description("show the banner and version")
    .action(() => printBannerWithVersion());

  program
    .command("completion")
    .description("generate a shell completion script")
    .addArgument(new Argument("<shell>", "target shell").choices(SHELLS))
    .action((shell: Shell) => {
      process.stdout.write(generateCompletion(shell, TOOL, program));
    });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  const args = argv.slice(2);
  const quiet = args.includes("-q") || args.includes("--quiet");
  const wantsUpdateCheck =
    !quiet && !process.env[NO_UPDATE_CHECK_ENV] && !args.includes("completion");
  const update = wantsUpdateCheck
    ? checkForUpdate({ packageName: PACKAGE_NAME, currentVersion: VERSION })
    : Promise.resolve(null);

  await program.parseAsync(argv);

  // Give a slow network at most a moment; never delay the user for long.
  const newer = await Promise.race([update, Bun.sleep(1500).then(() => null)]);
  if (newer) {
    console.error(
      `\n${yellow(`A new version of ${TOOL} is available: ${VERSION} -> ${newer}`)}\n${dim(
        `Upgrade with: brew upgrade ${TOOL}  (or: bun add -g ${PACKAGE_NAME})`,
      )}`,
    );
  }
}

if (import.meta.main) {
  await main();
}
