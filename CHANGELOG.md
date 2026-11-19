# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Documentation for each reader:** the README is now written for people using kloss,
  `docs/TRAINER.md` covers running a class with it (hosting, passwords, the session flow, talking
  points) and `docs/DEVELOPMENT.md` covers building and releasing it.
- **API docs:** `/docs` (a readable reference with "try it", by Scalar) and `/openapi.json` (OpenAPI
  3.1), both public and linked from the start page and the help card. On purpose they describe only
  the REST API, not MCP.

- The MCP server's instructions cover what people typically ask ("visualize", "open", "optimize
  the open model", "save", "add"), `render_model` also gives a link to the picture, and an
  expired session says why and how to open it again.
- `KLOSS_MCP` for Azure (`azd env set KLOSS_MCP true`): start with MCP on, also after waking up.
- Every MCP tool call is logged on the server, with who made it and for which session.
- `scripts/agent-check.ts`: plays the everyday requests through Claude Code and checks the results.

- Two new sizes: **1x4** and **4x1**.
- **Optimize:** `POST /api/sessions/<code>/optimize` (and the MCP tool `optimize_model`) merges
  klossar of the same color that lie side by side on the same level into bigger ones, where the
  model looks and stands exactly the same. Viewers see the result at once. The castle goes from
  2,227 to 1,974 klossar.
- **Pictures:** `GET /api/sessions/<code>/render.png` (and the MCP tool `render_model`, which hands
  the agent the image) renders the model on the server, from an angle or the top, front or side.

- The viewer's first instructions (and its help card, and `kloss serve`'s output) show both steps
  when login is on: get a token, with your own e-mail address filled in, then drop a kloss.

- **Undo:** `DELETE /api/sessions/<code>/klossar/last` (and the MCP tool `undo_kloss`) takes back the
  most recent kloss; with login on, only your own. In the viewer it vanishes with a poof.

### Added

- **Sessions:** many models at once, in memory, each with a short readable code (`otter-maple-42`).
  `POST /api/sessions` (optionally with a `.kl` body), and per session `klossar`, `model`,
  `model.kl` (download), `events` and `DELETE`. A start page to join by code or start a session;
  the viewer is at `/s/<code>`. Idle sessions expire (`--session-idle`, default 2h).
- **Login** (`KLOSS_PASSWORD`): any e-mail address plus a shared password. A login page and cookie
  for browsers, `POST /api/token` for curl, and OAuth with PKCE for MCP clients. With login on,
  the viewer shows who dropped what.
- **MCP endpoint** at `/mcp`, with tools to create sessions, drop klossar and read, replace and
  delete models. Off by default; turned on at runtime from `/admin` (`KLOSS_ADMIN_PASSWORD`), and
  no trace of it while off.
- `/healthz` reports the version (with the build when it is not a release) and whether login is on.
- **Azure hosting** with `azd up` and `azd down`: a Container App that sleeps when unused.

### Changed

- `kloss serve` no longer takes a model file, and the old `/api/klossar` and `/api/model` routes
  moved under `/api/sessions/<code>`. Save a model by downloading `model.kl`.

### Fixed

- A `.` repeat no longer copies the previous kloss's index.

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
