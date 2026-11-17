/**
 * Browser entry point: the scene, the CAD camera, the live stream from the server, and the
 * render loop (which renders only when something moves).
 */
import { Vector3 } from "three";
import { SIZES } from "../core/format.ts";
import { KLOSS_HEIGHT, PLUPP_HEIGHT } from "../core/types.ts";
import { CadController } from "./camera.ts";
import { DropQueue } from "./drops.ts";
import { KlossScene } from "./scene.ts";
import { connect } from "./stream.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#view");
if (!canvas) throw new Error("missing #view canvas");

const view = new KlossScene(canvas);
const drops = new DropQueue(view);
const camera = new CadController(view);
camera.attach(canvas);

function resize(): void {
  view.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);
resize();
camera.frame(view.modelBounds(), true);

let firstModel = true;
connect({
  onModel(klossar) {
    drops.clear();
    camera.clearIncluded();
    view.setModel(klossar);
    if (firstModel) camera.frame(view.modelBounds(), true);
    firstModel = false;
  },
  onDrop(kloss) {
    drops.push(kloss);
    // Auto-fit frames the landing spot right away, so the kloss lands in view.
    const { w, d } = SIZES[kloss.size];
    camera.include(new Vector3(kloss.x, kloss.level * KLOSS_HEIGHT, kloss.y));
    camera.include(
      new Vector3(kloss.x + w, (kloss.level + 1) * KLOSS_HEIGHT + PLUPP_HEIGHT, kloss.y + d),
    );
  },
  onStatus() {},
});

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(100, now - last);
  last = now;
  const dropping = drops.update(now);
  const moving = camera.update(dt);
  if (dropping || moving || view.needsRender) view.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// For debugging in the browser console.
Object.assign(window, { kloss: { view, camera, drops } });
