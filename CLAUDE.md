# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this is

`kloss` (Swedish for "building block") builds simple models from virtual bricks on an endless
floor, by hand or through an MCP server. It will be used to demonstrate the power and the
potential risks of MCP servers.

Vocabulary (our own, not Lego's): a brick is a **kloss** (plural klossar); sizes 1x1, 1x2, 2x1,
1x4, 4x1, 2x2, 2x4, 4x2, 1x6, 6x1, 2x6, 6x2, 1x8, 8x1, 2x8 and 8x2 are counted in **pluppar**; a **plupp** is a plus-shaped connector bump on top, one third of a
brick's height, fitting a plus-shaped **socket** underneath. One plupp in a socket is a strong
enough joint. The **floor** is endless and covered in pluppar. A kloss not held by the floor or
another kloss falls, tumbles and is removed (this comes with removal; with drop-only building every
kloss is always supported).

Status (0.3): `kloss serve` serves many **sessions** (models in memory, each with a short code
like `otter-maple-42`), a live 3D viewer at `/s/<code>`, a REST API, optional **login** (any
e-mail + `KLOSS_PASSWORD`; kloss is its own small OAuth server), and an **MCP endpoint** that the
host turns on at runtime from `/admin` and that leaves no trace while off. Hosted on Azure with
`azd up` / `azd down` only (no deploy pipeline). The point is teaching what MCP is: participants
use the REST API first, then the host turns MCP on. Designs: `docs/superpowers/specs/`
(`2026-11-17-kloss-viewer-design.md`, `2026-11-19-kloss-sessions-auth-mcp-design.md`). On npm the
package is `@mklab-se/kloss` (bin `kloss`).


## Template lineage

<!-- lineage:start -->
> The references in this section intentionally point at the upstream template, not at this tool.

- **Upstream template:** https://github.com/mklab-se/bun-templ
- **Likely local clone:** `../bun-templ/` (sibling directory under the same parent)

Tools built from bun-templ share its conventions (layout, commander CLI, update checker, paths,
CI/release pipeline, `/release` skill). Use the lineage in both directions:

- **Pulling improvements in:** when the template gains a fix or new convention, compare against
  `../bun-templ/` and port the relevant change here, adapting the name to this tool.
- **Pushing improvements back:** if you find a fix or better pattern here that is _generic_ (not
  specific to this tool's domain), contribute it upstream to `mklab-se/bun-templ` so every future
  tool benefits. Strip tool-specific names and logic first.
<!-- lineage:end -->

## Architecture

TypeScript run directly by Bun (no build step for development); `bun build --compile` produces the
single-file release binaries.

- `src/cli.ts`: entry point (`#!/usr/bin/env bun`). `buildProgram()` defines the commander CLI;
  `main()` parses, applies global flags, and awaits the background update check for at most 1.5 s.
  The no-command action prints the banner and how to start (`kloss serve`). `--help`/`-h` and `--version`/`-V` come from commander.
- `src/commands/`: one module per command (`serve.ts`, `mcp.ts`, `completion.ts`). Add new commands here.
  `kloss mcp` is MCP on stdio (stdout is the protocol, logs go to stderr) plus its own web server
  on a free port for the viewer links; `kloss mcp --http` is `serve --mcp`.
- `src/core/` (shared by server and browser; no DOM or server APIs): `types.ts` (data model and
  dimensions), `format.ts` (the `.kl` line format `x,y|size|color` with carry-over and `.` repeats; parse, compact aligned writing; sizes, palette), `landing.ts` (height map:
  a kloss lands on the highest thing under its footprint), `optimize.ts` (merges klossar where
  every landing stays the same; each merge is checked against the columns of the klossar dropped
  between its two parts, never by replaying the whole model, so 10,000 klossar take milliseconds;
  it reports which old klossar became each new one).
- `src/server/`: `model.ts` (one session's model in memory; synchronous, so drops never interleave;
  emits `model`/`drop`/`deleted`), `sessions.ts` (the session store, idle sweep, limits),
  `flock.ts` (chickens: simulated on the server per session, never part of the model, spawned
  only through REST and on purpose never through MCP, which a test checks),
  `session-code.ts`, `auth.ts` (password check, HMAC-signed tokens, login slow-down, OAuth
  helpers: client ids and codes are signed, not stored), `mcp.ts` (hand-written JSON-RPC tools,
  like lykta), `pages.ts` (login and admin pages), `render.ts` (PNG
  pictures without a browser: unit cells, painter's order, own PNG encoder), `openapi.ts`
  (`/openapi.json` and the `/docs` page with Scalar from a CDN, pinned; on purpose it never
  mentions MCP, OAuth or admin, and a test checks that), `http.ts` (all routes; `mcpOnly` routes 404
  while MCP is off).
- `src/web/`: the viewer (`index.html`, Three.js) and the start page (`start.html`), bundled by
  Bun from HTML imports and embedded in the compiled binary. Animations keep their timing in
  pure, tested modules (`drop-timing.ts`, `poof-timing.ts`, `merge-timing.ts`); `merges.ts`
  plays "poof and grow" after an optimize, all instanced so thousands of merges stay smooth;
  `chickens.ts` follows the server's chicken moves (`chicken-motion.ts`, `chicken-model.ts`).
- `examples/castle.kl`: the example castle, generated level by level by `scripts/castle.ts` (every
  kloss is checked against the landing rule; edit the script, not the file). Run it locally with `bun src/cli.ts serve`
  (add `KLOSS_PASSWORD=...` to try login).
- Azure: `azure.yaml`, `infra/` (Bicep: Container App scale 0..1, registry, pull identity),
  `hooks/preprovision.sh` (generates secrets into the azd env), `hooks/prepackage.sh` (version
  check, writes `build-info.txt` for `/healthz`), `Dockerfile`.
- `src/meta.ts`: tool name, package name, version and description (version and description are
  read from `package.json`, the single source of truth).
- `src/banner.ts`: block-letter banner rendered at runtime from the tool name via a built-in 5-row
  font, so a rename needs no ASCII art.
- `src/color.ts`: tiny ANSI helpers; colour only on a TTY, off with `NO_COLOR` or `--no-color`.
- `src/paths.ts`: where the tool keeps files. Linux and macOS share the XDG layout (same as the
  Rust tools and Ailloy): `$XDG_CONFIG_HOME/<tool>` or `~/.config/<tool>`, `$XDG_CACHE_HOME/<tool>`
  or `~/.cache/<tool>`. Windows uses `%APPDATA%` / `%LOCALAPPDATA%`. Never `~/Library/...`.
- `src/config.ts`: YAML config in `configDir()/config.yaml` via the built-in `Bun.YAML`.
- `src/update.ts`: checks the npm registry for a newer version, caches the answer for 24 h in
  `cacheDir()`, never throws. Disabled by `-q` or the `<TOOL>_NO_UPDATE_CHECK` env var.
- `scripts/sbom.ts`: CycloneDX 1.5 SBOM per release target (Bun runtime + production deps from
  `bun.lock`).
- `test/`: `bun test` suites. Keep logic in pure functions with injectable inputs (env, clock,
  fetch) so it is testable without the network.

## Adding a command

1. Create `src/commands/<name>.ts` exporting the logic (pure where possible).
2. Register it in `buildProgram()` in `src/cli.ts` with `.command()`, `.description()` (becomes the
   help text) and `.action()`.
3. Add tests in `test/`. Completions pick the command up automatically.

## Conventions

- Bun **latest** (CI installs `bun-version: latest`; `engines.bun` is the floor), TypeScript strict
  (`tsc --noEmit`, TypeScript 7), Biome for lint and format (2 spaces, width 100, double quotes).
- Prefer Bun built-ins over dependencies (`Bun.YAML`, `Bun.JSONC`, `Bun.semver`, `Bun.file`,
  `Bun.spawn`, `fetch`). Runtime dependencies today: `commander` and `three`.
- Distribution: npm as `@mklab-se/<tool>` (the `bin` is the short name) via Trusted Publishing
  (GitHub OIDC, no stored token; see `docs/DEVELOPMENT.md` "Releasing"), single-file binaries for
  4 targets on GitHub Releases with CycloneDX SBOMs, and the Homebrew tap `mklab-se/homebrew-tap`.
- CI gates (run them locally before pushing): `bun run lint`, `bun run typecheck`, `bun test`,
  `bun run build` (all at once: `bun run check && bun run build`).
- Documentation has three audiences: `README.md` is for **participants** (kloss as a useful tool
  and MCP server; nothing about the class, the admin switch or the "no trace" idea),
  `docs/TRAINER.md` is for whoever runs the class (Azure, passwords, the MCP switch, the flow,
  talking points), and `docs/DEVELOPMENT.md` is for working on kloss (build, checks, releasing).
- `README.md` opens with the logo, the badges and then a centred "What's new" callout
  (`<strong>tool X.Y</strong> is here: ...` plus a `What's new` link to `CHANGELOG.md`). Refresh the
  callout on every minor/major release.
- Releases go through the `/release` skill (`.claude/skills/release/`) → tag push → `release.yml`.
  The tag must equal `package.json`'s version (the workflow checks).

## Writing style

- **No em-dashes (U+2014), anywhere:** docs, CHANGELOG, code comments, help text, error messages,
  test strings, commit messages and PR descriptions. Use a comma where it works; otherwise a colon,
  parentheses, or a new sentence. If code genuinely needs the character at runtime, write the
  escape `\u2014`. This is a writing habit, not a gate: there is deliberately no CI or release
  check for it (Kristofer prefers that a stray em-dash never blocks a build).

## Dependency Policy

Bun and every dependency run on their **latest** versions, not just versions that still work.
Letting them drift is how technical debt accumulates unnoticed until a security advisory or a
forced breaking upgrade makes it urgent. Every maintenance round and every release starts with
`bun upgrade` and `bun update --latest` (majors included), then the CI gates. A version may only be
held back with a concrete, documented reason next to it.
