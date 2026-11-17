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
  <strong>kloss 0.1</strong> is here: drop klossar through a REST API and watch them fall into a live
  3D model in your browser.<br>
  <a href="CHANGELOG.md"><strong>What's new</strong></a>
</p>

# kloss

**kloss** (Swedish for "building block") is a tool for building simple models out of virtual
bricks on an endless floor. You can build by hand, or let an AI agent build through kloss's MCP
server, which also makes kloss a hands-on way to show both the power and the risks of MCP.

## Quick start

```sh
kloss serve castle.kl --open
```

This serves a live 3D view of `castle.kl` at http://127.0.0.1:4321 (the file is created if it
does not exist). Now drop klossar into it from another terminal and watch them fall from the sky:

```sh
curl -X POST localhost:4321/api/klossar -d '2x2 red 0,0'
curl -X POST localhost:4321/api/klossar -d '2x2 red 0,0'
curl -X POST localhost:4321/api/klossar -d '2x4 blue 2,0'
```

The first two make a small tower; the 2x4 lands next to it, the start of a wall. Every drop is also
appended to the model file. [`examples/castle.kl`](examples/castle.kl) is a bigger example.

## The kloss model

A model is a `.kl` text file (for kloss, and a nod to Kristofer Liljeblad and MKLab), read from
the top down. Each line drops one kloss from infinitely high, and
it stops at the first thing it touches: the floor or another kloss. One plupp of overlap is enough
to hold.

```text
# tower and the start of a wall
2x2 red 0,0
2x2 red 0,0
2x4 blue 2,0
```

- **Size** `<w>x<d>`: `w` pluppar along x, `d` along y. Sizes: `1x1`, `1x2`, `2x1`, `2x2`,
  `2x4`, `4x2` (a `4x2` is a `2x4` turned).
- **Color**: white, gray, black, red, orange, yellow, lime, green, blue, azure, purple, pink, brown,
  tan.
- **Position** `x,y`: the kloss's corner with the smallest coordinates, whole numbers from -10000
  to 10000. Height is never written; it comes from where the kloss lands.
- `#` starts a comment. A model holds at most 10000 klossar.

## REST API

| Request | Does |
| --- | --- |
| `POST /api/klossar` | Drops one kloss. Body: a line (`2x4 blue 2,0`) or JSON (`{"size":"2x4","color":"blue","x":2,"y":0}`). Returns where it landed (`level`). |
| `GET /api/model` | The model as JSON: `{ file, klossar: [{ index, size, color, x, y, level }] }`. |
| `GET /api/model.kl` | The model file as text. |
| `PUT /api/model` | Replaces the whole model with a text body; nothing changes if any line is invalid. |
| `GET /events` | Live updates (Server-Sent Events): `model`, `drop`, `ping`. |

Errors come back as `{ "error": "..." }` (with `"line"` for model errors). The server listens on
127.0.0.1 only unless you pass `--host 0.0.0.0`, and refuses changes sent by other web pages.

## The 3D view

Built for a Mac trackpad:

| Gesture | Does |
| --- | --- |
| Two-finger swipe | Pans left/right and up/down |
| Pinch | Zooms toward the pointer |
| Click and drag | Rotates around the model |
| Shift + two-finger swipe | Rotates (as in Fusion 360) |
| Shift + drag | Pans |
| Double-click | Rotate around that point from now on |
| WASD / arrows | Move along the floor (as in Cities: Skylines II) |
| Q / E | Rotate left / right (as in Cities: Skylines II) |
| + / - | Zoom in / out |
| F or F6 | Fit the whole model and turn auto-fit back on (F6 as in Fusion 360) |
| Home | Back to the starting view |
| ? | Show the controls |

The view keeps the whole model in sight (auto-fit) until you move the camera yourself. With a mouse,
the wheel (or + / -) zooms and right-drag pans.

### Coming later

- Removing klossar, and the rule that an unsupported kloss falls, tumbles and is removed.
- Walk mode: walk around inside your model and jump one kloss high.
- An MCP server, to let an AI agent build (and to show what that can mean).

## Build & run

```sh
bun install                    # install dependencies
bun start serve --open         # serve model.kl and open the 3D view
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
