# kloss viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `kloss serve model.kloss` serves a live 3D view of a kloss model and a REST API that drops
klossar into it, each one falling from the sky in every open browser.

**Architecture:** Pure model logic (format, palette, landing) in `src/core/`, shared by server and
browser. The server keeps the model in memory, persists it to the `.kloss` file through a serial
write queue, and pushes `model`/`drop` events over SSE. The browser is plain TypeScript + Three.js,
bundled by Bun from an HTML import and embedded in the compiled binary.

**Tech Stack:** Bun (latest), TypeScript strict, Biome, `bun test`, commander, Three.js (latest; the
only new runtime dependency).

**Spec:** `docs/superpowers/specs/2026-11-17-kloss-viewer-design.md` (read it first; this plan
argues from it).

## Global Constraints

- No em-dashes (U+2014) anywhere, including test strings and comments.
- Our vocabulary only: kloss/klossar, plupp/pluppar, socket, floor. Never "Lego", "brick" in UI copy,
  round studs, or Lego's color table.
- Sizes: `1x1`, `1x2`, `2x1`, `2x2`, `2x4`, `4x2` (`<w>x<d>`: w along x, d along y).
- Coordinates: integers in -10000..10000. Max 10000 klossar per model. Max request body 1 MB (`413`).
- Dimensions: 1 unit per plupp; kloss height 1.2; plupp height 0.4; plupp arms 0.6 long, 0.22
  wide; drawn footprint about 0.98 of the cell.
- World mapping (browser): kloss `x` -> three `x`, kloss `y` -> three `z`, `level` -> three
  `y = level * 1.2`. The kloss's corner (x, y) sits at the world origin of its geometry.
- Server defaults: file `model.kloss`, port `4321`, host `127.0.0.1`. SSE ping every 15 s.
- Mutating requests with an `Origin` header that is not the server's own get `403`.
- Runtime deps: `commander`, `three`. Dev: add `@types/three`. Latest versions only.
- Run `bun run check && bun run build` before every commit that touches code.

## Review Focus

1. **Model file without a trailing newline**, then a `POST`: the new line must go on its own line,
   not glued to the last one. Test in Task 3.
2. **`curl -d '2x4 blue 2,0'`** (form-encoded content type, plain body) must be accepted as a text
   line. Test in Task 4.
3. **Many concurrent `POST`s**: every one lands, in arrival order, and the file lines match the
   in-memory order. Test in Task 3.
4. **A model file saved on Windows** (CRLF line endings, or a UTF-8 BOM) must parse. Test in Task 1.
5. **Trackpad misread as a mouse** (fractional `deltaY`, any `deltaX`, `deltaMode` 0) would make
   swipes zoom. Test in Task 8.

---

### Task 1: Model format and palette

**Files:**
- Create: `src/core/types.ts`, `src/core/format.ts`
- Test: `test/core/format.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type Size = "1x1" | "1x2" | "2x1" | "2x2" | "2x4" | "4x2"`
  - `type ColorName = "white" | "gray" | "black" | "red" | "orange" | "yellow" | "lime" | "green" | "blue" | "azure" | "purple" | "pink" | "brown" | "tan"`
  - `interface KlossInput { size: Size; color: ColorName; x: number; y: number }`
  - `interface PlacedKloss extends KlossInput { index: number; level: number }`
  - Constants: `KLOSS_HEIGHT = 1.2`, `PLUPP_HEIGHT = 0.4`, `PLUPP_ARM_LENGTH = 0.6`,
    `PLUPP_ARM_WIDTH = 0.22`, `COORD_LIMIT = 10_000`, `MAX_KLOSSAR = 10_000`,
    `MAX_BODY_BYTES = 1_000_000`
- Produces (`format.ts`):
  - `SIZES: Record<Size, { w: number; d: number }>`
  - `PALETTE: Record<ColorName, string>` (hex values exactly as in the spec's palette table)
  - `class FormatError extends Error { line?: number }`
  - `parseLine(text: string): KlossInput | null` (null for blank/comment lines; throws `FormatError`
    without `line`)
  - `parseModel(text: string): KlossInput[]` (throws `FormatError` with `line`, 1-based, message
    prefixed `line N: `)
  - `formatLine(k: KlossInput): string` (lowercase, e.g. `2x4 blue 2,0`)
  - `parseKlossJson(body: unknown): KlossInput` (throws `FormatError`)

- [ ] **Step 1: Write the failing tests** in `test/core/format.test.ts`:
  - `parseLine("2x4 blue 2,0")` equals `{ size: "2x4", color: "blue", x: 2, y: 0 }`
  - case-insensitive and trailing comment: `parseLine("  2X2 RED -3,-4  # corner")` equals
    `{ size: "2x2", color: "red", x: -3, y: -4 }`
  - `parseLine("")`, `parseLine("   ")`, `parseLine("# hi")` are `null`
  - errors (assert message contains the quoted text): unknown size `3x3` -> `unknown size "3x3"`;
    unknown color `teal` -> `unknown color "teal"`; `2x2 red 1, 2` -> mentions position format;
    `2x2 red 1.5,2` (not an integer); `2x2 red 10001,0` (out of range); missing tokens; extra tokens
  - `parseModel("# t\n2x2 red 0,0\n\n2x2 bad 0,0\n")` throws `FormatError` with `line === 4` and
    message starting `line 4: `
  - Review Focus 4: `parseModel("﻿2x2 red 0,0\r\n1x1 blue 1,1\r\n")` returns two klossar
  - `formatLine` round-trips every size and color through `parseLine`
  - `parseKlossJson({ size: "4x2", color: "tan", x: 1, y: -1 })` works;
    `parseKlossJson({ size: "4x2", color: "tan", x: "1", y: 0 })` and `parseKlossJson(null)` throw
  - `Object.keys(PALETTE)` has the 14 names; every value matches `/^#[0-9a-f]{6}$/`

- [ ] **Step 2: Run** `bun test test/core/format.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `types.ts` and `format.ts` with the signatures above. Strip one leading
  BOM and split on `/\r?\n/`. A `#` anywhere starts a comment.

- [ ] **Step 4: Run** `bun test test/core/format.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `git add src/core test/core && git commit -m "Model format and palette"`

---

### Task 2: Landing rule

**Files:**
- Create: `src/core/landing.ts`
- Test: `test/core/landing.test.ts`

**Interfaces:**
- Consumes: `KlossInput`, `PlacedKloss`, `SIZES` (Task 1)
- Produces:
  - `class HeightMap { level(k: KlossInput): number; place(k: KlossInput): number }` (`place`
    returns the landing level and raises every cell of the footprint to `level + 1`)
  - `placeAll(inputs: KlossInput[]): PlacedKloss[]` (`index` = position in the list)

- [ ] **Step 1: Write the failing tests:**
  - three `2x2 red 0,0` land at levels 0, 1, 2
  - spec example: tower of three `2x2` at `0,0`, then `2x4 blue 2,0` lands at level 0 (beside it)
  - overhang: `1x1 0,0`, then `2x4 at 0,0` lands at level 1 (overlap of one plupp is enough), then
    `1x1 at 1,3` lands at level 2 (on the overhang) while `1x1 at 1,4` lands at 0
  - negative coordinates: `2x2 at -1,-1` then `1x1 at 0,0` lands at level 1
  - `4x2` and `2x4` cover different cells: `4x2 at 0,0` then `1x1 at 3,0` -> 1, `1x1 at 0,3` -> 0

- [ ] **Step 2: Run** `bun test test/core/landing.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** with a `Map<string, number>` keyed `"x,y"`; level = max over the
  footprint (0 if empty).

- [ ] **Step 4: Run** `bun test test/core`. Expected: PASS.

- [ ] **Step 5: Commit** `"Landing rule: klossar drop onto the highest thing below"`

---

### Task 3: Model store (memory, file, write queue, events)

**Files:**
- Create: `src/server/model-store.ts`
- Test: `test/server/model-store.test.ts`

**Interfaces:**
- Consumes: `parseModel`, `formatLine`, `FormatError` (Task 1); `HeightMap`, `placeAll` (Task 2)
- Produces:
  - `type ModelEvent = { type: "model"; klossar: PlacedKloss[] } | { type: "drop"; kloss: PlacedKloss }`
  - `class LimitError extends Error {}`
  - `class ModelStore`:
    - `static open(path: string): Promise<ModelStore>` (creates an empty file if missing; throws
      `FormatError` with `line` for an invalid file)
    - `readonly path: string`; `get klossar(): readonly PlacedKloss[]`
    - `text(): Promise<string>` (the file's current contents)
    - `drop(k: KlossInput): Promise<PlacedKloss>` (throws `LimitError` at `MAX_KLOSSAR`)
    - `replace(text: string): Promise<PlacedKloss[]>` (validates fully first; throws
      `FormatError`/`LimitError` and changes nothing)
    - `subscribe(fn: (e: ModelEvent) => void): () => void`

- [ ] **Step 1: Write the failing tests** (each on a file in `mkdtemp(join(tmpdir(), "kloss-"))`):
  - `open` on a missing path creates an empty file and has 0 klossar
  - `open` on an invalid file rejects with `FormatError` and `line` set
  - `drop` returns `{ index: 0, level: 0, ... }`, appends `2x2 red 0,0\n`, emits `drop`
  - Review Focus 1: a file containing `2x2 red 0,0` (no trailing newline), then `drop(1x1 blue 5,5)`:
    file text is `2x2 red 0,0\n1x1 blue 5,5\n` and it re-opens to 2 klossar
  - comments and blank lines in the file survive a `drop`
  - Review Focus 3: 50 concurrent `drop`s via `Promise.all` all resolve, indexes are 0..49 in call
    order, and re-opening the file yields the same order and levels
  - `replace` with a valid text rewrites the file verbatim and emits `model`; with an invalid line
    it rejects, and the file and klossar are unchanged
  - `drop` past `MAX_KLOSSAR` rejects with `LimitError` (build the start file with 10000 lines)

- [ ] **Step 2: Run** `bun test test/server/model-store.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Serialize every mutation through one promise chain
  (`this.queue = this.queue.then(...)`). Append with `node:fs/promises` `appendFile`, prefixing `\n`
  when the file is non-empty and does not end with one. `replace` writes to `path + ".tmp"`, then
  `rename` (atomic).

- [ ] **Step 4: Run** `bun test test/server`. Expected: PASS.

- [ ] **Step 5: Commit** `"Model store: file-backed model with an ordered write queue"`

---

### Task 4: HTTP server (REST API and SSE)

**Files:**
- Create: `src/server/http.ts`, `src/web/index.html`, `src/web/main.ts` (stub: logs "kloss"),
  `src/web/env.d.ts` (`declare module "*.css";`)
- Modify: `tsconfig.json` (`"lib": ["ESNext", "DOM", "DOM.Iterable"]`)
- Test: `test/server/http.test.ts`

**Interfaces:**
- Consumes: `ModelStore`, `ModelEvent`, `LimitError` (Task 3); `parseLine`, `parseKlossJson`,
  `FormatError` (Task 1)
- Produces: `startServer(opts: { store: ModelStore; port: number; hostname: string }): Server`
- Wire format (browser relies on it): SSE `event: model` data `{"klossar":[PlacedKloss...]}`;
  `event: drop` data `PlacedKloss`; `event: ping` data `{"at":"<iso>"}`.

Routes exactly as in the spec's REST API table. Follow lykta's `src/server/http.ts` for the SSE
`ReadableStream` (ping, slow-client drop, cleanup on cancel) and the `"/": index` HTML import.

- [ ] **Step 1: Write the failing tests** (server on port 0 with a temp store; use
  `server.port`):
  - `POST /api/klossar` JSON body -> `201` with `level`; text body `2x4 blue 2,0` -> `201`
  - Review Focus 2: body `2x4 blue 2,0` with `content-type: application/x-www-form-urlencoded`
    -> `201`
  - bad line -> `400` `{ error }` mentioning the bad token; bad JSON -> `400`
  - `GET /api/model` -> `{ file: "<basename of the model file>", klossar: [...] }`;
    `GET /api/model.kloss` -> the file text, `text/plain`
  - `PUT /api/model` valid -> `200` with the new model; invalid -> `400` with `line`, model unchanged
  - body over `MAX_BODY_BYTES` -> `413`; drop at the kloss limit -> `413`
  - `POST` with `origin: https://evil.example` -> `403`; with the server's own origin -> `201`;
    with no `Origin` -> `201`
  - `GET /events`: first event is `model`; after a `POST`, the next non-ping event is `drop` with the
    placed kloss
  - `GET /healthz` -> `200 ok`; `GET /` -> `200` HTML; `DELETE /api/klossar` -> `405`

- [ ] **Step 2: Run** `bun test test/server/http.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `startServer`. Read the body with a size check (`content-length` when
  present, and the actual length); a trimmed body starting with `{` is JSON, anything else is one
  text line. Map `FormatError` -> `400`, `LimitError` -> `413`. `idleTimeout: 60`.

- [ ] **Step 4: Run** `bun run check`. Expected: PASS.

- [ ] **Step 5: Commit** `"HTTP server: REST API, SSE events, origin check"`

---

### Task 5: `kloss serve` command and docs

**Files:**
- Create: `src/commands/serve.ts`, `examples/castle.kloss` (a small model, 20 to 40 lines, using
  all six sizes and several colors, with an overhang), `.claude/launch.json`
- Modify: `src/cli.ts` (register `serve`), `README.md`, `CLAUDE.md`, `CHANGELOG.md`
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `ModelStore.open` (Task 3), `startServer` (Task 4)
- Produces: `runServe(opts: { file: string; port: number; host: string; open: boolean }): Promise<Server>`

- [ ] **Step 1: Write the failing tests** in `test/cli.test.ts`:
  - `kloss serve --help` lists `--port`, `--host`, `--open` and the `[file]` argument
  - `kloss serve <tmp>/bad.kloss` with an invalid line 2 exits non-zero and stderr contains
    `line 2:`
  - spawn `kloss serve <tmp>/m.kloss --port <random>`; once stdout contains `http://127.0.0.1:<port>`
    and a `curl` example, `POST` a kloss and see it in `<tmp>/m.kloss`; kill the process

- [ ] **Step 2: Run** `bun test test/cli.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `runServe` and register
  `serve [file]` (default `model.kloss`), `--port <n>` (default 4321), `--host <h>` (default
  127.0.0.1), `--open` (macOS `open`, Linux `xdg-open`, Windows `start`). Print the URL and
  `curl -X POST http://<host>:<port>/api/klossar -d '2x4 blue 2,0'`. Format errors exit with code 2.
  `.claude/launch.json`: configuration `kloss` running `bun --hot src/cli.ts serve examples/castle.kloss --port 4321`.

- [ ] **Step 4: Update docs.** README: what kloss does now, the format, the API with curl examples,
  the controls table from the spec; refresh the "What's new" callout for 0.1. CLAUDE.md: all six
  sizes, the format, the architecture (`src/core`, `src/server`, `src/web`), the falls-and-tumbles
  rule marked "comes with removal". CHANGELOG `[Unreleased]`: `### Added` entries.

- [ ] **Step 5: Run** `bun run check && bun run build`. Expected: PASS. **Commit** `"kloss serve"`

---

### Task 6: Kloss geometry

**Files:**
- Modify: `package.json` (add `three`, dev `@types/three`, both latest)
- Create: `src/web/kloss-geometry.ts`
- Test: `test/web/kloss-geometry.test.ts`

**Interfaces:**
- Consumes: `SIZES`, dimension constants (Task 1)
- Produces:
  - `buildPluppGeometry(): BufferGeometry` (one plus-shaped plupp, base at y = 0, centered on x/z 0)
  - `buildKlossGeometry(size: Size): BufferGeometry` (body + pluppar on top + plus-shaped socket
    recesses underneath, merged, non-indexed or indexed consistently, with normals; spans
    x 0.01..w-0.01, z 0.01..d-0.01, y 0..1.6)
  - `klossGeometry(size: Size): BufferGeometry` (cached per size)

- [ ] **Step 1: Write the failing tests:**
  - for each size, the bounding box of `buildKlossGeometry` is x in [0.01, w - 0.01], y in [0, 1.6],
    z in [0.01, d - 0.01] (within 1e-6)
  - the plupp's bounding box: x and z in [-0.3, 0.3], y in [0, 0.4]
  - for `2x4`, every vertex with y > 1.2 lies within 0.31 (x and z) of one of the 8 cell centers
    `(i + 0.5, k + 0.5)`, and each of the 8 centers has such vertices (one plupp per cell)
  - `klossGeometry("2x2") === klossGeometry("2x2")`
  - no em-dash, no `NaN` in the position attribute

- [ ] **Step 2: Run** `bun test test/web`. Expected: FAIL.

- [ ] **Step 3: Implement.** Plupp: two crossed `ExtrudeGeometry`/box bars with a small bevel (or a
  plus `Shape` extruded with bevel). Body: a bevelled box. Sockets: the plus shape as a recess on
  the underside (inset faces, depth about 0.3, never below y = 0). Merge with
  `mergeGeometries` from `three/examples/jsm/utils/BufferGeometryUtils.js`.

- [ ] **Step 4: Run** `bun test test/web && bun run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `"Kloss geometry: plus-shaped pluppar and sockets"`

---

### Task 7: Scene, live model and drop animation

**Files:**
- Create: `src/web/scene.ts`, `src/web/instances.ts`, `src/web/stream.ts`, `src/web/drops.ts`,
  `src/web/styles.css`
- Modify: `src/web/main.ts`, `src/web/index.html`
- Test: `test/web/drops.test.ts`

**Interfaces:**
- Consumes: `klossGeometry`, `buildPluppGeometry` (Task 6); `PALETTE`, `KLOSS_HEIGHT` (Task 1); the
  SSE wire format (Task 4)
- Produces:
  - `dropTiming(waiting: number): { fallMs: number; settleMs: number } | "snap"`
  - `class KlossScene { constructor(canvas: HTMLCanvasElement); setModel(k: PlacedKloss[]): void; add(k: PlacedKloss): void; requestRender(): void; readonly camera: PerspectiveCamera; readonly scene: Scene; readonly renderer: WebGLRenderer; pickPoint(ndc: Vector2): Vector3 | null; modelBounds(): Box3 }`
  - `class KlossInstances` (one `InstancedMesh` per size + color, growing capacity by doubling)
  - `connect(h: { onModel(k: PlacedKloss[]): void; onDrop(k: PlacedKloss): void; onStatus(s: "live" | "reconnecting"): void }): () => void`
  - `class DropQueue { constructor(scene: KlossScene); push(k: PlacedKloss): void; clear(): void; update(nowMs: number): boolean }` (returns true while animating)

- [ ] **Step 1: Write the failing tests** for `dropTiming`: `1` and `3` -> `{ fallMs: 600, settleMs: 200 }`;
  `40` and `100` -> `{ fallMs: 100, settleMs: 33 }` (settle = round(fall / 3)); `21` is strictly
  between; `201` -> `"snap"`; monotone non-increasing for 1..200.

- [ ] **Step 2: Run** `bun test test/web/drops.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `dropTiming`:**

```ts
if (waiting > 200) return "snap";
const t = Math.min(1, Math.max(0, (waiting - 3) / 37));
const fallMs = Math.round(600 - 500 * t);
return { fallMs, settleMs: Math.round(fallMs / 3) };
```

- [ ] **Step 4: Implement the scene** per the spec's "Scene and look" (renderer settings, sun with
  PCF soft shadows fitted to `modelBounds()`, hemisphere light, `RoomEnvironment` env map via
  `PMREMGenerator`, physical plastic material per color, fog, instanced floor pluppar in a patch
  around the camera target, origin marker, render on demand). `DropQueue`: fall from 30 units above
  the landing height with `y = land + 30 * (1 - (t / fallMs) ** 2)`, then a squash-and-settle over
  `settleMs` and a fading ring at the impact; the next drop starts when the current one lands (its
  settle overlaps). `"snap"` adds straight to the instances. `model` events call `clear()` then
  `setModel`. `main.ts` wires `connect` -> scene/queue and a `requestAnimationFrame` loop that runs
  only while something animates or the camera moves.

- [ ] **Step 5: Verify in the browser:** start the `kloss` launch config; the castle renders with
  shadows and visible plus pluppar. Run
  `for i in $(seq 1 30); do curl -s -X POST localhost:4321/api/klossar -d "2x2 red 0,0" >/dev/null & done; wait`
  and watch a 30-high tower build quickly in order; no console errors.

- [ ] **Step 6: Run** `bun run check && bun run build`. **Commit** `"3D scene with live drops"`

---

### Task 8: CAD camera tuned for the trackpad

**Files:**
- Create: `src/web/gestures.ts`, `src/web/camera.ts`
- Modify: `src/web/main.ts`
- Test: `test/web/gestures.test.ts`

**Interfaces:**
- Consumes: `KlossScene` (`camera`, `pickPoint`, `modelBounds`, `requestRender`) (Task 7)
- Produces:
  - `type WheelKind = "pinch" | "trackpad" | "mouse"`
  - `class WheelClassifier { classify(e: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean }, nowMs: number): WheelKind }`
  - `panPerPixel(distance: number, fovDeg: number, viewportHeight: number): number`
  - `zoomDistance(distance: number, deltaY: number, min: number, max: number): number`
  - `fitDistance(radius: number, fovDeg: number, aspect: number): number` (distance at which a
    sphere of `radius` fits the view with a 10% margin; uses the smaller of the vertical and
    horizontal field of view; `radius` is raised to at least 6, the spec's 12 units across)
  - `interface CameraController { attach(el: HTMLElement): void; update(dtMs: number): boolean; frame(box: Box3): void; home(): void; dispose(): void; autoFit: boolean; onAutoFitChange(fn: (on: boolean) => void): void; include(point: Vector3): void }`
    (`include` widens the next auto-fit to a drop's landing spot)
  - `class CadController implements CameraController`

- [ ] **Step 1: Write the failing tests:**
  - `ctrlKey: true` -> `"pinch"` regardless of deltas
  - `deltaMode: 1` -> `"mouse"`
  - Review Focus 5: `{ deltaX: 0, deltaY: 3.5, deltaMode: 0 }` -> `"trackpad"`;
    `{ deltaX: 2, deltaY: 100, deltaMode: 0 }` -> `"trackpad"`
  - `{ deltaX: 0, deltaY: 100, deltaMode: 0 }` with no recent trackpad events -> `"mouse"`
  - sticky: after a `"trackpad"` event at t=0, `{ deltaX: 0, deltaY: 100 }` at t=500 is still
    `"trackpad"`; at t=1500 it is `"mouse"`
  - `panPerPixel(10, 50, 1000)` equals `2 * 10 * Math.tan(25 deg) / 1000`
  - `zoomDistance(10, 100, 2, 2000)` is greater than 10; `zoomDistance(10, -100, 2, 2000)` less;
    clamps at 2 and 2000
  - `fitDistance(1, 50, 16 / 9)` equals `fitDistance(6, 50, 16 / 9)` (minimum framing);
    `fitDistance(20, 50, 16 / 9)` equals `1.1 * 20 / Math.sin(25 deg)`; a portrait aspect `0.5`
    gives a larger distance than `16 / 9` for the same radius

- [ ] **Step 2: Run** `bun test test/web/gestures.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `gestures.ts`. Mouse = `deltaMode !== 0`, or (`deltaX === 0` and
  `Number.isInteger(deltaY)` and `Math.abs(deltaY) >= 50`) when no trackpad event in the last 1000 ms.
  `zoomDistance = clamp(distance * Math.exp(deltaY * 0.01), min, max)`.

- [ ] **Step 4: Implement `CadController`** with the gesture table from the spec: non-passive
  `wheel` listener with `preventDefault` (`pinch` zooms toward the point under the cursor, `trackpad`
  pans in screen space following the fingers, `mouse` zooms); pointer drag rotates (polar angle
  clamped to stay above the floor), Shift-drag or right-drag pans; double-click eases the target to
  `pickPoint`; WASD/arrows pan along the floor, Q/E down/up; F frames `modelBounds()`, Home resets.
  No extra inertia. Touch: one finger rotates, two pan and pinch.
  **Auto-fit** (spec "Auto-fit"): `autoFit` starts `true`; while on, each `update` eases the target
  to the center of `modelBounds()` widened by any `include`d points and the distance to
  `fitDistance` of its bounding sphere, keeping the current angles. Every user camera input sets it
  `false` (firing `onAutoFitChange`); F calls `frame(modelBounds())` and sets it `true`.
  `main.ts` calls `include(landing point)` when a drop is queued. Add
  `html, body { overscroll-behavior: none; touch-action: none; }` to `styles.css`. Zoom limits: 2 to
  2000.

- [ ] **Step 5: Verify in the browser** (Kristofer checks the feel on his trackpad; you check that
  wheel events with and without `ctrlKey` move the camera as specified, via `javascript_tool`
  dispatching `WheelEvent`s, and that the page itself never zooms or navigates).

- [ ] **Step 6: Run** `bun run check && bun run build`. **Commit** `"CAD camera tuned for the trackpad"`

---

### Task 9: Overlay, help card and the compiled binary

**Files:**
- Create: `src/web/overlay.ts`, `test/server/compiled.test.ts`
- Modify: `src/web/main.ts`, `src/web/index.html`, `src/web/styles.css`, `.github/workflows/ci.yml`
  (set `KLOSS_COMPILED_TEST=1` in the build job, as lykta does)

**Interfaces:**
- Consumes: `connect` status (Task 7), `ModelStore`/server (Tasks 3 to 5)
- Produces: `createOverlay(root: HTMLElement): { setFile(name: string): void; setCount(n: number): void; setStatus(s: "live" | "reconnecting"): void; setAutoFit(on: boolean): void; onAutoFitClick(fn: () => void): void; toggleHelp(): void }`
  (the Auto-fit switch reflects `CadController.autoFit` via `onAutoFitChange`; clicking it toggles
  `autoFit`, and turning it on frames immediately)

- [ ] **Step 1: Write the failing compiled test** (copy lykta's `test/server/compiled.test.ts`
  pattern, gated on `KLOSS_COMPILED_TEST=1`): build the binary into a temp dir, run
  `kloss serve m.kloss --port <random>` from that empty dir, and assert `GET /` returns HTML whose
  referenced JS and CSS assets load with `200`, and `POST` then `GET /api/model` shows the kloss.

- [ ] **Step 2: Run** `KLOSS_COMPILED_TEST=1 bun test test/server/compiled.test.ts`. Expected: PASS
  already, or FAIL pointing at a missing asset (fix the cause).

- [ ] **Step 3: Implement the overlay:** the file name (from `GET /api/model`'s `file`), the
  kloss count, a status dot (green live, amber reconnecting), the empty-model hint with the curl
  example, and the `?` help card listing the controls table.

- [ ] **Step 4: Verify in the browser:** empty model shows the hint; dropping removes it and updates
  the count; stopping the server turns the dot amber and restarting turns it green with the model
  reloaded; `?` toggles help; the Auto-fit switch turns off on a pinch and back on when clicked or
  on F; with it on, 20 drops spread over x 0..40 stay in view.

- [ ] **Step 5: Run** `bun run check && bun run build && KLOSS_COMPILED_TEST=1 bun test test/server/compiled.test.ts`
  and the em-dash grep. **Commit** `"Overlay, help card and compiled-binary test"`
