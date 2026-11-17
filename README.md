<p align="center"><img src="https://raw.githubusercontent.com/mklab-se/bun-templ/main/media/bun-templ-horizontal.png" width="600"></p>

<p align="center">
<a href="https://github.com/mklab-se/bun-templ/actions/workflows/ci.yml"><img src="https://github.com/mklab-se/bun-templ/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="https://www.npmjs.com/package/@mklab-se/bun-templ"><img src="https://img.shields.io/npm/v/@mklab-se/bun-templ.svg" alt="npm"></a>
<a href="https://github.com/mklab-se/bun-templ/releases/latest"><img src="https://img.shields.io/github/v/release/mklab-se/bun-templ" alt="GitHub Release"></a>
<a href="https://github.com/mklab-se/homebrew-tap/blob/main/Formula/bun-templ.rb"><img src="https://img.shields.io/badge/dynamic/regex?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmklab-se%2Fhomebrew-tap%2Fmain%2FFormula%2Fbun-templ.rb&search=%5Cd%2B%5C.%5Cd%2B%5C.%5Cd%2B&label=homebrew&prefix=v&color=orange" alt="Homebrew"></a>
<a href="https://github.com/mklab-se/bun-templ/blob/main/LICENSE"><img src="https://img.shields.io/github/license/mklab-se/bun-templ" alt="License"></a>
</p>

<!-- "What's new" callout: keep it right after the badges and refresh it on every minor/major
     release (version and a one-line summary of the headline changes). Only link CHANGELOG.md. -->
<p align="center">
  <strong>bun-templ 0.1</strong> is here: a ready-to-scaffold Bun + TypeScript CLI with shell
  completions, an update checker and single-file binary releases with SBOMs.<br>
  <a href="CHANGELOG.md"><strong>What's new</strong></a>
</p>

# bun-templ

<!-- template-only:start -->
A **template repository** for building command-line tools on [Bun](https://bun.com) and
TypeScript, pre-wired with the conventions used across MKLab's tools (the Bun counterpart of
[rusty-tmpl](https://github.com/mklab-se/rusty-tmpl)):

- 🥟 TypeScript run directly by Bun, strict `tsc` type checking, [Biome](https://biomejs.dev) lint and format
- 🧰 A [commander](https://github.com/tj/commander.js) CLI with global flags (`-v`, `-q`, `--no-color`), `--help` and `--version`
- 🐚 bash, zsh and fish completions generated from the CLI definition
- 🔔 A background **npm update checker** with a 24-hour cache
- 📁 XDG config and cache paths, YAML config via `Bun.YAML`
- 📦 Single-file executables (`bun build --compile`) for Linux, macOS (Intel + ARM) and Windows
- ⚙️ **GitHub Actions** CI (lint / typecheck / test / build) and a release pipeline
- 🍺 Automated publishing to **npm** (with provenance), **GitHub Releases** (with SBOMs) and **Homebrew**
- 🪄 A `/release` skill that drives the whole release flow

Run with no command, it just prints `Hello world!`. Everything else is plumbing waiting for your logic.

Tools built from bun-templ: [lykta](https://github.com/mklab-se/lykta).

## Using this template

1. Click **"Use this template"** on GitHub to create a new repository, and clone it.
2. Rename everything in one pass (the name is lowercase kebab-case):

   ```sh
   bun install
   bun run rename mytool "One line on what mytool does"
   bun install && bun run check
   ```

   The script replaces every spelling of the name (`bun-templ`, `bun_templ`, `BUN_TEMPL`,
   `BunTempl`) and the description in all tracked files, renames the logo file, sets the version
   to 0.0.1, empties the changelog, drops the template-only sections (like this one), keeps the
   "Template lineage" section of `CLAUDE.md` pointing here, and finally deletes itself. The banner
   is drawn from the tool name at runtime, so there is no ASCII art to redraw.
3. Replace `media/<tool>-horizontal.png` with your own artwork, rewrite this README's intro and the
   "What this is" section of `CLAUDE.md`. Keep the "What's new" callout right after the badges.
4. Set up the release secrets (see [Releasing](#releasing)).
<!-- template-only:end -->

## Build & run

```sh
bun install                    # install dependencies
bun start                      # prints "Hello world!"
bun start --help               # show the CLI help
bun start version              # banner + version
bun start completion zsh       # generate a zsh completion script
bun test                       # run the tests
bun run build                  # compile dist/bun-templ (single-file binary)
```

### Install

See [INSTALL.md](INSTALL.md) for Homebrew, npm/bun, prebuilt binaries and from-source instructions.

## Releasing

Releases are driven by the [`/release`](.claude/skills/release/SKILL.md) skill (run it in Claude
Code with `major`, `minor`, or `patch`). It upgrades Bun and every dependency to the latest
version, runs the CI gates, bumps the version, updates the changelog, then commits, pushes, and
tags `vX.Y.Z`. Pushing the tag triggers `.github/workflows/release.yml`, which:

1. Re-runs the full CI suite and checks the tag matches `package.json`
2. Compiles single-file binaries for Linux, macOS (Intel + ARM, ad-hoc signed) and Windows, with a
   CycloneDX SBOM per target
3. Creates a GitHub Release with the archives and SBOMs
4. Publishes `@mklab-se/bun-templ` to npm with provenance
5. Updates the Homebrew formula in [`mklab-se/homebrew-tap`](https://github.com/mklab-se/homebrew-tap)

### Required secrets

| Secret               | Where                 | Purpose                     | How to create                                                                           |
| -------------------- | --------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| `HOMEBREW_TAP_TOKEN` | Repository secret     | Push the formula to the tap | A GitHub PAT with `repo` scope for `mklab-se/homebrew-tap`                              |

If `HOMEBREW_TAP_TOKEN` is missing, the release still succeeds; the Homebrew step just logs a warning.

### npm: Trusted Publishing

npm publishing needs **no stored secret**. The workflow proves its identity to npm with GitHub's
OIDC token (Trusted Publishing), and npm attaches a signed provenance statement to every version.
On npmjs.com, under the package's **Settings > Trusted Publisher**, add GitHub Actions with
organization `mklab-se`, repository `bun-templ`, workflow `release.yml`, environment `npm`, and tick
**Allow npm publish**. The GitHub repository needs an environment named `npm` (it may be empty).

npm can only attach a trusted publisher to a package that already exists, so a **brand-new**
package is published once with a token: put a short-lived granular token (read and write on the
`@mklab-se` scope) in the `npm` environment as `NPM_TOKEN`, release, set up Trusted Publishing as
above, then delete the secret and revoke the token.

## Development

```sh
bun run format                 # format and fix with Biome
bun run check                  # typecheck + lint + test (matches CI)
bun run build                  # compile the binary
```

The CLI is defined in `src/cli.ts`; commands live in `src/commands/`. See [CLAUDE.md](CLAUDE.md)
for the architecture in more detail.

## License

[MIT](LICENSE) © Kristofer Liljeblad
