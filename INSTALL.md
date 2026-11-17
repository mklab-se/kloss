# Installing bun-templ

## Homebrew (macOS / Linux)

```sh
brew install mklab-se/tap/bun-templ
```

Or add the tap once, then install:

```sh
brew tap mklab-se/tap
brew install bun-templ
```

Upgrade with `brew upgrade bun-templ`.

## npm / Bun (needs [Bun](https://bun.com) installed)

```sh
bun add -g @mklab-se/bun-templ     # installs the `bun-templ` command
bunx @mklab-se/bun-templ --help    # or run it without installing
```

The package runs its TypeScript sources with Bun, so `npm install -g` also works as long as `bun`
is on your `PATH`.

## Prebuilt binaries (GitHub Releases)

Download the archive for your platform from the
[latest release](https://github.com/mklab-se/bun-templ/releases/latest), extract it, and put the
`bun-templ` binary somewhere on your `PATH`. The binaries are self-contained (the Bun runtime is
embedded), so Bun does not need to be installed.

| Platform              | Archive                                            |
| --------------------- | -------------------------------------------------- |
| Linux (x86-64)        | `bun-templ-vX.Y.Z-x86_64-unknown-linux-gnu.tar.gz` |
| macOS (Apple Silicon) | `bun-templ-vX.Y.Z-aarch64-apple-darwin.tar.gz`     |
| macOS (Intel)         | `bun-templ-vX.Y.Z-x86_64-apple-darwin.tar.gz`      |
| Windows (x86-64)      | `bun-templ-vX.Y.Z-x86_64-pc-windows-msvc.zip`      |

## Software bill of materials (SBOM)

Every archive above has a matching CycloneDX 1.5 SBOM listing what is compiled into that binary:
the embedded Bun runtime version and the exact production dependencies from `bun.lock`.

```
bun-templ-vX.Y.Z-<target>.cdx.json
```

`syft`, `grype` and `trivy` understand this format, e.g. `grype sbom:./bun-templ-vX.Y.Z-<target>.cdx.json`.

## From source

```sh
git clone https://github.com/mklab-se/bun-templ
cd bun-templ
bun install
bun run build          # writes dist/bun-templ
```

## Shell completions

```sh
bun-templ completion zsh > ~/.zfunc/_bun-templ
bun-templ completion bash > ~/.local/share/bash-completion/completions/bun-templ
bun-templ completion fish > ~/.config/fish/completions/bun-templ.fish
```
