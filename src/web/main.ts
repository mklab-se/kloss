/**
 * Browser entry point: the scene, the CAD camera, the live stream from the server, and the
 * render loop (which renders only when something moves).
 */
import { Vector3 } from "three";
import { SIZES } from "../core/format.ts";
import { KLOSS_HEIGHT, PLUPP_HEIGHT } from "../core/types.ts";
import { apiFetch } from "./api.ts";
import { CadController } from "./camera.ts";
import { createCompass } from "./compass.ts";
import { DropQueue } from "./drops.ts";
import { guardedFrame } from "./frame.ts";
import { Merges } from "./merges.ts";
import { createOverlay } from "./overlay.ts";
import { Poofs } from "./poofs.ts";
import { KlossScene } from "./scene.ts";
import { connect } from "./stream.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#view");
if (!canvas) throw new Error("missing #view canvas");

const view = new KlossScene(canvas);
const drops = new DropQueue(view);
const poofs = new Poofs(view);
const merges = new Merges(view);
const camera = new CadController(view);
camera.attach(canvas);

const overlayRoot = document.querySelector<HTMLElement>("#overlay");
if (!overlayRoot) throw new Error("missing #overlay");
// the session is in the URL: /s/<code>
const code = decodeURIComponent(location.pathname.split("/")[2] ?? "");
document.title = `${code} · kloss`;
const overlay = createOverlay(overlayRoot, code);
overlay.setAutoFit(camera.autoFit);
camera.onAutoFitChange((on) => overlay.setAutoFit(on));
overlay.onAutoFitClick(() => {
  camera.autoFit = !camera.autoFit;
});

const compass = createCompass(overlayRoot, () => camera.home());

function resize(): void {
  view.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);
resize();
camera.frame(view.modelBounds(), true);

let firstModel = true;
/** Logged in (when login is on) and the session exists: then connect. */
async function begin(): Promise<void> {
  const me = (await (await fetch("/api/me")).json()) as {
    auth: boolean;
    email: string | null;
    version: string;
  };
  if (me.auth && !me.email) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    return;
  }
  overlay.setAbout(me);
  const check = await apiFetch(`/api/sessions/${encodeURIComponent(code)}`);
  if (check.status === 404) {
    overlay.gone(`There is no session "${code}". It may have expired.`);
    return;
  }
  if (!check.ok) return;
  start();
}

function start(): void {
  connect(code, {
    onModel(klossar, mcp, note, merged) {
      overlay.setMcp(mcp);
      if (note) overlay.activity(note);
      drops.clear();
      camera.clearIncluded();
      // after an optimize, "poof and grow" shows what merged (not on the first model shown)
      if (merged?.length && !firstModel) merges.start(klossar, merged, performance.now());
      else {
        merges.clear();
        view.setModel(klossar);
      }
      if (firstModel) camera.frame(view.modelBounds(), true);
      firstModel = false;
    },
    onDrop(kloss) {
      merges.finish();
      drops.push(kloss);
      if (kloss.by) overlay.activity(`${kloss.by} dropped a ${kloss.color} ${kloss.size}`);
      // Auto-fit frames the landing spot right away, so the kloss lands in view.
      const { w, d } = SIZES[kloss.size];
      camera.include(new Vector3(kloss.x, kloss.level * KLOSS_HEIGHT, kloss.y));
      camera.include(
        new Vector3(kloss.x + w, (kloss.level + 1) * KLOSS_HEIGHT + PLUPP_HEIGHT, kloss.y + d),
      );
    },
    onStatus(s) {
      overlay.setStatus(s);
    },
    onUndo(kloss, klossar) {
      // the model without it, at once; a ghost of it goes "poof" where it was
      merges.clear();
      drops.clear();
      camera.clearIncluded();
      view.setModel(klossar);
      poofs.add(kloss, performance.now());
      if (kloss.by) overlay.activity(`${kloss.by} took back a ${kloss.color} ${kloss.size}`);
    },
    onDeleted() {
      overlay.gone("This session was removed.");
    },
  });
}
void begin();

let last = performance.now();
let shownCount = -1;
function step(now: number): void {
  // The count follows what has landed, so it ticks up as klossar arrive.
  // while an optimize plays, the klossar still to poof are counted until they go
  const count = view.count + merges.pendingPoofs(now);
  if (count !== shownCount) {
    shownCount = count;
    overlay.setCount(shownCount);
  }
  const dt = Math.min(100, now - last);
  last = now;
  const falling = drops.update(now);
  const poofing = poofs.update(now);
  const merging = merges.update(now);
  const dropping = falling || poofing || merging;
  const moving = camera.update(dt);
  if (dropping || moving || view.needsRender) {
    view.render();
    compass.update(view.camera, view.renderer.domElement);
  }
}
requestAnimationFrame(
  guardedFrame(step, requestAnimationFrame, (e) => console.error("kloss: frame failed", e)),
);

// For debugging in the browser console.
Object.assign(window, { kloss: { view, camera, drops, merges } });
