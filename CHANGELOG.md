# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial template: Bun + strict TypeScript CLI on commander, with `version` and `completion`
  (bash, zsh, fish) commands, global `-v`/`-q`/`--no-color` flags, a runtime-rendered block-letter
  banner, XDG paths, YAML config via `Bun.YAML`, and a cached npm update checker.
- `bun run rename <name> "<description>"` turns a copy of the template into a new tool in one pass.
- CI (em-dash check, Biome lint, `tsc` typecheck, `bun test`, compiled-binary smoke test) and a
  release workflow: single-file binaries for 4 targets with CycloneDX SBOMs, a GitHub Release, npm
  publish with provenance, and the Homebrew tap.
- `/release` skill.
