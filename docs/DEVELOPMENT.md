# Developing kloss

For people working on kloss itself. Using kloss is in the [README](../README.md), running a
class in [TRAINER.md](TRAINER.md), and the architecture in [CLAUDE.md](../CLAUDE.md).

## Build and run

kloss is TypeScript run directly by [Bun](https://bun.com); there is no build step for
development.

```sh
bun install                    # install dependencies
bun start serve --open         # serve kloss and open the start page
KLOSS_PASSWORD=try-it bun start serve --mcp   # with login and MCP on
bun start --help               # show the CLI help
bun start completion zsh       # generate a zsh completion script
bun test                       # run the tests
bun run build                  # compile dist/kloss (single-file binary)
```

## Checks

```sh
bun run format                 # format and fix with Biome
bun run check                  # typecheck + lint + test (matches CI)
bun run build                  # compile the binary
```

Run `bun run check && bun run build` before pushing; CI runs the same.

After changing the MCP tools, their descriptions or the server's instructions, also run the
agent check (`bun scripts/agent-check.ts`, see [TRAINER.md](TRAINER.md#check-it)).

## Examples

[`examples/castle.kl`](../examples/castle.kl) is generated level by level by
[`scripts/castle.ts`](../scripts/castle.ts), which checks every kloss against the landing rule.
Edit the script, not the file.

## Releasing

Releases are driven by the [`/release`](../.claude/skills/release/SKILL.md) skill (run it in
Claude Code with `major`, `minor`, or `patch`). It upgrades Bun and every dependency to the
latest version, runs the CI gates, bumps the version, updates the changelog, then commits,
pushes, and tags `vX.Y.Z`. Pushing the tag triggers `.github/workflows/release.yml`, which:

1. Re-runs the full CI suite and checks the tag matches `package.json`
2. Compiles single-file binaries for Linux, macOS (Intel + ARM, ad-hoc signed) and Windows, with
   a CycloneDX SBOM per target
3. Creates a GitHub Release with the archives and SBOMs
4. Publishes `@mklab-se/kloss` to npm with provenance
5. Updates the Homebrew formula in [`mklab-se/homebrew-tap`](https://github.com/mklab-se/homebrew-tap)

Refresh the "What's new" callout at the top of the README on every minor or major release.

### Required secrets

| Secret               | Where             | Purpose                     | How to create                                              |
| -------------------- | ----------------- | --------------------------- | ---------------------------------------------------------- |
| `HOMEBREW_TAP_TOKEN` | Repository secret | Push the formula to the tap | A GitHub PAT with `repo` scope for `mklab-se/homebrew-tap` |

If `HOMEBREW_TAP_TOKEN` is missing, the release still succeeds; the Homebrew step just logs a
warning.

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
