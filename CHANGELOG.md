# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `kloss serve [file]`: a live 3D view of a kloss model in the browser, and a REST API to build it.
- The `.kl` model format: one line drops one kloss (`2x4 blue 2,0`); six sizes and 14 colors.
- The landing rule: a dropped kloss stops at the first thing it touches; one plupp holds.
- `examples/castle.kl`.

## [0.0.2] - 2026-11-17

### Changed

- npm releases use Trusted Publishing (GitHub OIDC); no npm token is stored anymore.

## [0.0.1] - 2026-11-17

### Added

- Initial release, scaffolded from bun-templ: claims the `kloss` name on npm
  (`@mklab-se/kloss`), GitHub Releases and Homebrew. Building with bricks comes next.

[Unreleased]: https://github.com/mklab-se/kloss/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/mklab-se/kloss/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/mklab-se/kloss/releases/tag/v0.0.1
