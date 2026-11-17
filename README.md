<p align="center"><img src="https://raw.githubusercontent.com/mklab-se/kloss/main/media/kloss-horizontal.png" width="600"></p>

<p align="center">
<a href="https://github.com/mklab-se/kloss/actions/workflows/ci.yml"><img src="https://github.com/mklab-se/kloss/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="https://www.npmjs.com/package/@mklab-se/kloss"><img src="https://img.shields.io/npm/v/@mklab-se/kloss.svg" alt="npm"></a>
<a href="https://github.com/mklab-se/kloss/releases/latest"><img src="https://img.shields.io/github/v/release/mklab-se/kloss" alt="GitHub Release"></a>
<a href="https://github.com/mklab-se/homebrew-tap/blob/main/Formula/kloss.rb"><img src="https://img.shields.io/badge/dynamic/regex?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmklab-se%2Fhomebrew-tap%2Fmain%2FFormula%2Fkloss.rb&search=%5Cd%2B%5C.%5Cd%2B%5C.%5Cd%2B&label=homebrew&prefix=v&color=orange" alt="Homebrew"></a>
<a href="https://github.com/mklab-se/kloss/blob/main/LICENSE"><img src="https://img.shields.io/github/license/mklab-se/kloss" alt="License"></a>
</p>

<!-- "What's new" callout: keep it right after the badges and refresh it on every minor/major
     release (version and a one-line summary of the headline changes). Only link CHANGELOG.md. -->
<p align="center">
  <strong>kloss 0.0.1</strong> is here: the name is claimed, and the bricks are on their way.<br>
  <a href="CHANGELOG.md"><strong>What's new</strong></a>
</p>

# kloss

**kloss** (Swedish for "building block") is a tool for building simple models out of virtual
bricks on an endless floor. You can build by hand, or let an AI agent build through kloss's MCP
server, which also makes kloss a hands-on way to show both the power and the risks of MCP.

> **Status:** 0.0.1 claims the name on npm, GitHub Releases and Homebrew. Building is coming in the
> next releases.

### Planned

- **Klossar** (bricks) in four sizes, counted in pluppar: 1x1, 1x2, 2x2 and 2x4, in all the usual
  colors.
- **Pluppar**: plus-shaped connector bumps on top of every kloss, one third of a brick's height,
  with matching plus-shaped sockets underneath.
- **One plupp is enough:** two klossar joined by a single plupp hold together.
- **An endless floor** covered in pluppar to build on.
- **Gravity:** a kloss that is not held by the floor or another kloss falls, tumbles and is removed.
- **Removing** klossar, by hand or through MCP.


## Build & run

```sh
bun install                    # install dependencies
bun start                      # banner + a coming-soon note
bun start --help               # show the CLI help
bun start version              # banner + version
bun start completion zsh       # generate a zsh completion script
bun test                       # run the tests
bun run build                  # compile dist/kloss (single-file binary)
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
4. Publishes `@mklab-se/kloss` to npm with provenance
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
organization `mklab-se`, repository `kloss`, workflow `release.yml`, environment `npm`, and tick
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
