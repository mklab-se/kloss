# kloss viewer: design

Date: 2026-11-17. Status: approved.

## Intent

`kloss` builds simple 3D models out of virtual bricks. Eventually it will demonstrate the power and
the potential risks of MCP servers: an AI agent builds a model by calling kloss, and an audience
watches the result appear. This first version is the foundation: a text format for models, a REST
API that drops klossar into a model, and a good-looking live 3D view in the browser.

The only way to change a model is the API (for example with `curl`). There is no editing UI. A CLI
for dropping klossar and the MCP server come later and will sit on top of the same API.

## Vocabulary

Our own words, never Lego's:

- **kloss** (plural **klossar**): a brick.
- **plupp** (plural **pluppar**): the plus-shaped connector bump on top of a kloss. Sizes are counted
  in pluppar.
- **socket**: the plus-shaped hole on the underside that a plupp fits into.
- **floor**: the endless ground, covered in pluppar.

## Goals

1. A plain-text **kloss model** format: one line drops one kloss.
2. **Landing rule:** each kloss is dropped from infinitely high above its x,y position and stops at
   the first thing it touches, the floor or another kloss. Any overlap of one plupp or more
   connects, so the kloss stays there.
3. `kloss serve [file]` serves a web app with the 3D view and the REST API for one model file.
4. Dropping a kloss through the API updates every open browser at once: the kloss falls fast from the
   sky and lands with a small impact.
5. A **CAD view** tuned for a Mac trackpad: rotate, pan (left/right, up/down) and zoom, with real lighting from above and
   shadows.
6. It looks really good: shiny plastic klossar, clearly visible plus-shaped pluppar, soft shadows.

## Non-goals (this version)

- Removing klossar, and the "unsupported klossar fall, tumble and are removed" rule. With drop-only
  building every kloss is supported, so that rule cannot happen yet. It arrives with removal.
- **Walk mode** (first-person, with Space jumping one kloss high). It is planned for later, so the
  camera code must be swappable (see Camera).
- A CLI for dropping klossar, and the MCP server.
- Editing in the browser, undo, several models per server, user accounts.
- Watching the model file for edits made outside kloss. Use `PUT /api/model` instead.

## Anti-goals

- Anything that looks or reads like Lego: no Lego names, logos, round studs or Lego's exact color
  table.
- A choppy or flat-looking view. Silent failures are just as bad: a bad line must be refused with a
  clear message, never skipped.

## Approaches considered

- **A. Three.js on Bun's built-in HTML serving (chosen).** The browser code is plain TypeScript with
  Three.js, bundled by Bun from an HTML import, like lykta's web app. It's embedded in the
  single-file binary. Live updates use Server-Sent Events. Three.js is the only new runtime
  dependency.
- **B. React Three Fiber.** Three.js wrapped in React. It adds two layers for what is one canvas
  and a tiny overlay.
- **C. Babylon.js.** A full engine with first-person controls built in. It's heavier, and for a CAD
  view it brings nothing Three.js lacks. Walk mode can be built on Three.js later.

Kristofer left the how to the builder's judgment and accepted A.

## The kloss model format

A UTF-8 text file, conventionally `*.kloss`. It is read top to bottom, and each kloss line is one
drop in order.

```text
# tower and the start of a wall
2x2 red 0,0
2x2 red 0,0
2x2 red 0,0
2x4 blue 2,0
```

Grammar, one line at a time:

- Blank lines and lines starting with `#` (after optional whitespace) are ignored but kept in the
  file.
- A kloss line is `<size> <color> <x>,<y>`, made of tokens separated by whitespace. A trailing
  `# comment` is allowed. Matching is case-insensitive, and the API writes lines in lowercase.
- **Size** `<w>x<d>`: `w` pluppar along x, `d` along y. The allowed sizes are `1x1`, `1x2`, `2x1`,
  `2x2`, `2x4`, `4x2`. The size carries the orientation (`4x2` is a `2x4` turned), so there is no
  orientation flag.
- **Position** `<x>,<y>`: whole numbers, negative allowed, no spaces around the comma. It is the
  kloss's corner with the smallest coordinates, so a `2x4` at `2,0` covers x 2..3 and y 0..3.
  Allowed range: -10000 to 10000 (keeps the numbers sane; the floor is endless in practice).
- **Color**: one name from the palette below.
- Anything else is an error that reports its line number, for example `line 7: unknown color "teal"`.

Height is never written: it comes from where the kloss lands.

### Palette (kloss's own values)

| name | hex | name | hex |
| --- | --- | --- | --- |
| white | `#f2f0ea` | blue | `#1f5fc4` |
| gray | `#9aa0a6` | azure | `#3fb0d0` |
| black | `#202124` | purple | `#7d2a8c` |
| red | `#d12a1f` | pink | `#f29ab5` |
| orange | `#f28a1e` | brown | `#6b4226` |
| yellow | `#f5c932` | tan | `#dcc79a` |
| lime | `#a8d63a` | green | `#2f8a4c` |

## Geometry

- 1 unit = the spacing between pluppar. A kloss is `w x d` units across and **1.2** units tall.
- A **plupp** is a plus sign seen from above: two crossed bars, each 0.6 long and 0.22 wide, centered
  in its cell, **0.4** tall (one third of a kloss's height). Edges slightly rounded or bevelled.
- A **socket** is the matching plus-shaped recess on the underside, one per cell. Sockets are only
  visible under overhangs, but they have to be there.
- Klossar are drawn a hair smaller than their footprint (about 0.98) so the seams between
  neighbours show.
- Klossar stack in whole **levels**: level 0 sits on the floor, and a kloss at level `n` has its
  bottom at height `n * 1.2`. The pluppar of the kloss below fit inside its sockets, so they don't
  add height.

## Landing rule

Keep a height map: for each floor cell (x, y), the number of levels already filled there (0 when
empty). A new kloss with footprint F lands at `level = max(height[c] for c in F)`. Then every cell
in F gets `level + 1`.

Since klossar only ever come from above, this is exact. A kloss lands on the highest thing under
any part of its footprint, it is always supported, and overhangs work. Nothing can ever be placed
underneath an overhang, and that is expected.

The landing logic is a pure function in `src/core/`, shared by the server and the browser, and
fully unit-tested.

## Server

`kloss serve [file]`:

- `file` defaults to `model.kloss` in the current directory and is created empty if missing. If it
  exists but has an invalid line, the server refuses to start and prints the error with its line
  number.
- `--port` (default `4321`) and `--host` (default `127.0.0.1`, so only this machine can reach it;
  exposing it is a conscious choice). `--open` opens the browser.
- It prints the URL and a ready-to-run `curl` example.

The server keeps the parsed model in memory and treats the file as its durable copy. Writes go
through one queue so concurrent drops land in the order they arrive.

### REST API

All JSON responses use `application/json`. Errors are `{ "error": "..." }`, with `"line": n` when it
comes from the format.

| Method and path | Body | Result |
| --- | --- | --- |
| `POST /api/klossar` | JSON `{"size":"2x4","color":"blue","x":2,"y":0}`, or the plain-text line `2x4 blue 2,0` | `201` with the placed kloss: `{ index, size, color, x, y, level }`. Appends the line to the file. `400` for an invalid kloss. |
| `GET /api/model` | | `{ klossar: [{ index, size, color, x, y, level }] }` |
| `GET /api/model.kloss` | | The file text, `text/plain`. |
| `PUT /api/model` | The whole model as `text/plain` | Validates everything first. If anything is invalid, `400` and nothing changes. Otherwise it replaces the file and returns the new model. |
| `GET /events` | | Server-Sent Events (see below). |
| `GET /healthz` | | `200 ok` |
| `GET /` | | The web app. |

`POST /api/klossar` decides between JSON and a text line by looking at the body (it starts with `{`
or not), not at `Content-Type`: `curl -d` sends form encoding by default.

Requests that change the model (`POST`, `PUT`) are refused with `403` when they carry an `Origin`
header that is not the server's own. Otherwise any web page open in the same browser could drop
klossar into a local kloss. `curl` and other tools send no `Origin` and are not affected.
(Builder's call.)

Request bodies are capped at 1 MB and a model at 10000 klossar. Above that the server answers `413`.

Example:

```sh
curl -X POST localhost:4321/api/klossar -d '2x4 blue 2,0'
```

### Live updates

`GET /events` sends:

- `model` on connect and after every `PUT`: the full list of placed klossar.
- `drop` after every `POST`: the one placed kloss, so the browser can animate it.
- `ping` every 15 seconds to keep proxies from closing the stream.

The browser reconnects by itself and gets a fresh `model` when it does.

## Web app

### Scene and look

- Three.js `WebGLRenderer` with antialiasing, ACES filmic tone mapping and sRGB output. The scene
  re-renders only when something changes (camera moves, animations), not continuously while idle.
- **Light from above:** a directional "sun" high above and slightly to one side, casting soft
  shadows (PCF soft shadows; the shadow camera follows the model's extent). It is helped by a
  hemisphere light (sky and ground tint) and a faint environment map so the plastic gets
  highlights.
- **Klossar:** a shiny plastic material (`MeshPhysicalMaterial` or a `MeshStandardMaterial` with low
  roughness and a slight clearcoat), one material per color. Body, pluppar and sockets are merged
  into one geometry per size, built once and shared. Placed klossar are drawn with one
  `InstancedMesh` per size and color, so 10000 klossar stay smooth. A falling kloss is drawn on its
  own and moves into its instanced mesh when it lands.
- **Floor:** an endless-looking plane in a neutral color, covered in floor pluppar. Only the area
  around the camera's target is drawn (instanced), and it fades into the background with distance
  fog so there is no visible edge. Draw a faint marker at the origin so `0,0` can be found.

### Drop animation

When a `drop` arrives, the kloss starts high above its landing spot (out of view, or about 30 units
up) and falls with gravity-like acceleration, taking about 0.5 to 0.7 seconds. On impact it does a
small squash and settle, with a puff of dust or a ring on the surface it landed on.

Several drops in quick succession play in order, one after another, so an agent firing many
requests looks like a building sequence. **As the queue grows, each drop speeds up** (shorter fall,
and the next one starts before the previous has settled), so the view never falls far behind the
API: with a few drops waiting it plays at full length, and with dozens waiting each takes about a
tenth of a second. Above about 200 waiting, the oldest ones snap into place without animation.
(Builder's call; the aim is a view a presenter can narrate live.)

A `model` event replaces everything instantly, without animation, and empties the queue. A tab
that connects late therefore shows the finished model straight away, which is fine.

### Camera: CAD view

Built first for a **Mac trackpad** (Kristofer's setup), with a mouse as a fallback:

| Gesture | Does |
| --- | --- |
| Two-finger swipe | Pans: left/right and up/down, following the fingers like a map. |
| Pinch | Zooms toward the point under the cursor. |
| Click and drag (press the pad, or three-finger drag if enabled) | Rotates around the target point. The angle is limited so the camera never goes under the floor. |
| Shift + click and drag | Pans, for those who prefer dragging. |
| Double-click a kloss or the floor | Smoothly moves the target there, so rotation pivots around what you're looking at. |
| WASD / arrow keys | Pan along the floor; **Q / E** move down and up. |
| F / Home | Frame the whole model and turn auto-fit back on / return to the starting view. |

How this works in the browser, and what must hold:

- A two-finger swipe arrives as `wheel` events and a pinch as `wheel` events with `ctrlKey` set
  (Safari, Chrome and Firefox on macOS alike). The listener is non-passive and calls
  `preventDefault`, so a pinch never zooms the page and a sideways swipe never triggers the
  browser's back/forward navigation (`overscroll-behavior: none` on the page as well).
- macOS already adds momentum to swipes, so the view follows the events directly with no extra
  inertia of its own, which would feel floaty. Pan speed scales with the distance to the target, so
  a swipe feels the same close up and far away. Zoom is exponential in the pinch amount and clamped
  between "one plupp fills the screen" and "the whole model is a speck".
- **Mouse fallback:** a classic mouse wheel (line-based `deltaMode`, or large stepped deltas with no
  sideways movement) zooms instead of panning, and right-drag pans. The detection heuristic is the
  builder's call; the trackpad must never be misread as a mouse.
- Touch screens (iPad): one finger rotates, two fingers pan and pinch.

#### Auto-fit (added 2026-11-17)

- **On by default.** The camera keeps the whole model in view at the current viewing angle, easing
  smoothly as the model changes. When a drop arrives, the framing includes its landing spot right
  away, so the kloss lands in view.
- It frames at least about 12 units across, so a model of one kloss is not blown up to fill the
  screen. An empty model shows the area around the origin.
- **Any camera input from the user** (zoom, pan, rotate, keyboard movement, double-click) turns
  auto-fit **off**; the camera then stays where the user puts it.
- **F** frames the whole model and turns auto-fit back **on**. The overlay shows an "Auto-fit"
  switch that shows the state and toggles it when clicked.

The camera controller lives behind a small interface (`attach`, `update(dt)`, `dispose`) so walk mode
can be added later as a second controller without touching the scene.

### Overlay

A minimal heads-up display: the model's file name, the kloss count, and a connection dot (green
when live, amber while reconnecting). When the model is empty, a centered hint shows the `curl`
example. A `?` key toggles a small help card listing the controls.

## Code layout

- `src/core/`: `format.ts` (parse and format lines, the palette), `landing.ts` (height map and
  landing), `types.ts`. No DOM or server APIs.
- `src/server/`: `model-store.ts` (in-memory model, file writes, the write queue, subscribers),
  `http.ts` (routes, SSE).
- `src/commands/serve.ts`: the `kloss serve` command.
- `src/web/`: `index.html`, `main.ts`, `scene.ts` (renderer, lights, floor), `kloss-geometry.ts`
  (pluppar and sockets), `camera.ts` (CAD controller), `drops.ts` (animation queue), `stream.ts`
  (SSE and reconnect), `overlay.ts`, `styles.css`.
- The CLI's no-command default stays as it is; `serve` is the first real command.
- `CLAUDE.md`, `README.md` and the changelog are updated to match this design (all six sizes, the
  format, the API). `CLAUDE.md`'s "falls, tumbles and is removed" rule is marked as coming with
  removal.

## Testing

- Unit tests for the format (valid lines, every error message, comments preserved), the landing
  rule (towers, walls, overhangs, negative coordinates), the palette and the kloss geometry builder
  (vertex counts and bounds).
- Server tests on a temporary file and a random port: POST appends and returns the right level,
  PUT validates atomically, bad input gets `400`, limits get `413`, SSE sends `model` then `drop`.
- The look and the controls are checked by running `kloss serve` and viewing it in the browser.
- The compiled binary must still serve the web app (Bun embeds the HTML import).

## Left to the builder

Exact light positions, colors of the floor and background, the dust effect, easing curves, the
shadow map size and how the floor's plupp patch follows the camera, so long as the result looks
polished and stays smooth on a laptop.
