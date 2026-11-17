/**
 * Browser entry point: the scene, the live stream from the server, and the render loop.
 */
import { Vector3 } from "three";
import { DropQueue } from "./drops.ts";
import { KlossScene } from "./scene.ts";
import { connect } from "./stream.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#view");
if (!canvas) throw new Error("missing #view canvas");

const view = new KlossScene(canvas);
const drops = new DropQueue(view);

// Temporary framing until the CAD camera arrives: look at the whole model from above.
const HOME_DIRECTION = new Vector3(1, 0.85, 1.35).normalize();
function frameAll(): void {
  const b = view.modelBounds();
  const center = b.getCenter(new Vector3());
  const radius = Math.max(6, b.getSize(new Vector3()).length() / 2);
  const dist = (1.1 * radius) / Math.sin((view.camera.fov * Math.PI) / 360);
  view.target.copy(center);
  view.camera.position.copy(center).addScaledVector(HOME_DIRECTION, dist);
  view.camera.lookAt(center);
  view.requestRender();
}

function resize(): void {
  view.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);
resize();
frameAll();

connect({
  onModel(klossar) {
    drops.clear();
    view.setModel(klossar);
    frameAll();
  },
  onDrop(kloss) {
    drops.push(kloss);
    view.requestRender();
  },
  onStatus() {},
});

function loop(now: number): void {
  const moving = drops.update(now);
  if (moving || view.needsRender) view.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
