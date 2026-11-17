# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-11-18

### Changed

- A blue sky: deep blue overhead, fading to a pale blue at the horizon where the floor melts in.

### Fixed

- The compass now lies on the floor in the top-left corner: a bigger, more detailed, slightly
  transparent dial (ticks, needles, a plupp at the centre) hovering just above the ground. It is
  drawn with the perspective of the floor behind it, so it lines up with the plupp rows there.
  It casts a soft shadow on the floor, and slides down to stay on the floor when the horizon is
  low.

## [0.2.0] - 2026-11-18

### Added

- A compass in the bottom-left corner of the viewer: red X and green Y arrows turn with the camera,
  and a click goes back to the start view.

### Changed

- **New `.kl` format:** `x,y|size|color`. A left-out size or color is the last one used, and a line
  with just `.` repeats the drop before it. Whitespace is allowed around separators, and kloss
  writes models compactly with right-aligned coordinates. The 0.1 format (`2x4 blue 2,0`) is
  gone; kloss says how to rewrite such a line.
- `POST /api/klossar` accepts the short forms too: `-d '5,1'` and `-d '.'` reuse the last
  kloss's size and color.
- `examples/castle.kl` is written in the new format (and about 30% smaller).

## [0.1.0] - 2026-11-17

### Added

- `kloss serve [file]`: a live 3D view of a kloss model in the browser, and a REST API to build it
  (`POST /api/klossar`, `GET`/`PUT /api/model`, `GET /api/model.kl`, live updates on `/events`).
- The `.kl` model format: one line drops one kloss (`2x4 blue 2,0`); six sizes and 14 colors.
- The landing rule: a dropped kloss stops at the first thing it touches; one plupp holds.
- Klossar fall from the sky and land with a squash and a ring; bursts play in order and speed up.
- Shiny plastic klossar with plus-shaped pluppar and sockets, soft shadows from above, and an
  endless green floor that fades softly into the horizon.
- A CAD camera built for the Mac trackpad: swipe pans, pinch zooms toward the pointer, drag or
  Shift + swipe rotates, double-click sets the pivot; Q/E rotate, W/A/S/D move, +/- zoom, F or F6
  fits. Auto-fit keeps the whole model in view until you move the camera, and the camera breathes
  ever so slightly while idle.
- An overlay with the file name, kloss count, connection status, the Auto-fit switch and a help
  card (`?`).
- `examples/castle.kl`.

### Security

- The server listens on 127.0.0.1 by default, refuses changes from other web pages (Origin), and
  refuses requests for other host names (DNS rebinding) unless served on 0.0.0.0 on purpose.

## [0.0.2] - 2026-11-17

### Changed

- npm releases use Trusted Publishing (GitHub OIDC); no npm token is stored anymore.

## [0.0.1] - 2026-11-17

### Added

- Initial release, scaffolded from bun-templ: claims the `kloss` name on npm
  (`@mklab-se/kloss`), GitHub Releases and Homebrew. Building with bricks comes next.

[Unreleased]: https://github.com/mklab-se/kloss/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/mklab-se/kloss/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/mklab-se/kloss/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mklab-se/kloss/compare/v0.0.2...v0.1.0
[0.0.2]: https://github.com/mklab-se/kloss/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/mklab-se/kloss/releases/tag/v0.0.1
