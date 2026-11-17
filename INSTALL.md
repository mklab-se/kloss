# Installing kloss

## Homebrew (macOS / Linux)

```sh
brew install mklab-se/tap/kloss
```

Or add the tap once, then install:

```sh
brew tap mklab-se/tap
brew install kloss
```

Upgrade with `brew upgrade kloss`.

## npm / Bun (needs [Bun](https://bun.com) installed)

```sh
bun add -g @mklab-se/kloss     # installs the `kloss` command
bunx @mklab-se/kloss --help    # or run it without installing
```

The package runs its TypeScript sources with Bun, so `npm install -g` also works as long as `bun`
is on your `PATH`.

## Prebuilt binaries (GitHub Releases)

Download the archive for your platform from the
[latest release](https://github.com/mklab-se/kloss/releases/latest), extract it, and put the
`kloss` binary somewhere on your `PATH`. The binaries are self-contained (the Bun runtime is
embedded), so Bun does not need to be installed.

| Platform              | Archive                                            |
| --------------------- | -------------------------------------------------- |
| Linux (x86-64)        | `kloss-vX.Y.Z-x86_64-unknown-linux-gnu.tar.gz` |
| macOS (Apple Silicon) | `kloss-vX.Y.Z-aarch64-apple-darwin.tar.gz`     |
| macOS (Intel)         | `kloss-vX.Y.Z-x86_64-apple-darwin.tar.gz`      |
| Windows (x86-64)      | `kloss-vX.Y.Z-x86_64-pc-windows-msvc.zip`      |

## Software bill of materials (SBOM)

Every archive above has a matching CycloneDX 1.5 SBOM listing what is compiled into that binary:
the embedded Bun runtime version and the exact production dependencies from `bun.lock`.

```
kloss-vX.Y.Z-<target>.cdx.json
```

`syft`, `grype` and `trivy` understand this format, e.g. `grype sbom:./kloss-vX.Y.Z-<target>.cdx.json`.

## From source

```sh
git clone https://github.com/mklab-se/kloss
cd kloss
bun install
bun run build          # writes dist/kloss
```

## Shell completions

```sh
kloss completion zsh > ~/.zfunc/_kloss
kloss completion bash > ~/.local/share/bash-completion/completions/kloss
kloss completion fish > ~/.config/fish/completions/kloss.fish
```
