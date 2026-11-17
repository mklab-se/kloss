#!/usr/bin/env bun
/**
 * bun-templ command-line entry point.
 *
 * `buildProgram()` defines the CLI (commander); `main()` runs it, wires the global
 * flags and the background update check. Add commands under `src/commands/` and
 * register them in `buildProgram()`.
 */
import { Argument, Command } from "commander";
import { printBannerWithVersion } from "./banner.ts";
import { dim, setColorEnabled, yellow } from "./color.ts";
import { generateCompletion, SHELLS, type Shell } from "./commands/completion.ts";
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
      `\nRun without a command to print "Hello world!". The reusable plumbing (completions, update checks, config paths and releases) is wired up so you can focus on your tool's own commands.`,
    )
    .hook("preAction", (cmd) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      if (!opts.color) setColorEnabled(false);
    })
    // No command: the almost-empty default. Replace this with your tool's
    // behaviour, or route to a real command. `--help` still works.
    .action(() => {
      console.log("Hello world!");
    });

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
