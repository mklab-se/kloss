/**
 * The drop animation: klossar fall from the sky one after another, land with a small squash, and
 * leave a fading ring. The queue speeds up as it grows (see drop-timing.ts).
 */
import { DoubleSide, Mesh, MeshBasicMaterial, RingGeometry } from "three";
import { SIZES } from "../core/format.ts";
import { KLOSS_HEIGHT, type PlacedKloss } from "../core/types.ts";
import { dropTiming } from "./drop-timing.ts";
import { klossMaterial } from "./instances.ts";
import { klossGeometry } from "./kloss-geometry.ts";
import type { KlossScene } from "./scene.ts";

const FALL_HEIGHT = 30;
const RING_MS = 450;

interface Falling {
  kloss: PlacedKloss;
  mesh: Mesh;
  start: number;
  fallMs: number;
  settleMs: number;
  landed: boolean;
}

interface Ring {
  mesh: Mesh<RingGeometry, MeshBasicMaterial>;
  start: number;
  size: number;
}

export class DropQueue {
  private readonly waiting: PlacedKloss[] = [];
  private readonly active: Falling[] = [];
  private readonly rings: Ring[] = [];
  private readonly ringGeometry = new RingGeometry(0.8, 1, 48);

  constructor(private readonly view: KlossScene) {}

  push(k: PlacedKloss): void {
    this.waiting.push(k);
  }

  /**
   * Where kloss `index`'s underside is right now: high up while it waits or falls, and null when
   * it is not (or no longer) falling.
   */
  bottomOf(index: number): number | null {
    if (this.waiting.some((k) => k.index === index)) return Number.POSITIVE_INFINITY;
    const f = this.active.find((a) => a.kloss.index === index);
    if (!f || f.landed) return null;
    return f.mesh.position.y;
  }

  get pending(): number {
    return this.waiting.length + this.active.length;
  }

  clear(): void {
    this.waiting.length = 0;
    for (const f of this.active) this.view.scene.remove(f.mesh);
    this.active.length = 0;
    for (const r of this.rings) this.dispose(r);
    this.rings.length = 0;
  }

  private dispose(r: Ring): void {
    this.view.scene.remove(r.mesh);
    r.mesh.material.dispose();
  }

  private startNext(now: number): void {
    const k = this.waiting.shift();
    if (!k) return;
    const timing = dropTiming(this.waiting.length + 1);
    if (timing === "snap") {
      this.view.add(k);
      return;
    }
    const mesh = new Mesh(klossGeometry(k.size), klossMaterial(k.color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(k.x, k.level * KLOSS_HEIGHT + FALL_HEIGHT, k.y);
    this.view.scene.add(mesh);
    this.active.push({ kloss: k, mesh, start: now, ...timing, landed: false });
  }

  private ring(k: PlacedKloss, now: number): void {
    const { w, d } = SIZES[k.size];
    const mesh = new Mesh(
      this.ringGeometry,
      new MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(k.x + w / 2, k.level * KLOSS_HEIGHT + 0.02, k.y + d / 2);
    this.view.scene.add(mesh);
    this.rings.push({ mesh, start: now, size: Math.max(w, d) * 0.6 });
  }

  /** Advances the animation. Returns true while anything is moving. */
  update(now: number): boolean {
    // Above the snap limit, the oldest waiting drops go straight into place.
    while (this.waiting.length > 200) {
      const k = this.waiting.shift();
      if (k) this.view.add(k);
    }
    // The next drop starts once the current one has landed (its settle overlaps).
    if (this.waiting.length > 0 && this.active.every((f) => f.landed)) this.startNext(now);

    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i];
      if (!f) continue;
      const { w, d } = SIZES[f.kloss.size];
      const land = f.kloss.level * KLOSS_HEIGHT;
      const t = now - f.start;
      if (t < f.fallMs) {
        const p = t / f.fallMs;
        f.mesh.position.y = land + FALL_HEIGHT * (1 - p * p);
        continue;
      }
      if (!f.landed) {
        f.landed = true;
        this.ring(f.kloss, now);
      }
      const q = Math.min(1, (t - f.fallMs) / Math.max(1, f.settleMs));
      const squash = Math.sin(Math.PI * q) * (1 - q);
      const sy = 1 - 0.14 * squash;
      const sxz = 1 + 0.05 * squash;
      f.mesh.scale.set(sxz, sy, sxz);
      f.mesh.position.set(f.kloss.x - ((sxz - 1) * w) / 2, land, f.kloss.y - ((sxz - 1) * d) / 2);
      if (q >= 1) {
        this.view.scene.remove(f.mesh);
        this.active.splice(i, 1);
        this.view.add(f.kloss);
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      if (!r) continue;
      const p = (now - r.start) / RING_MS;
      if (p >= 1) {
        this.dispose(r);
        this.rings.splice(i, 1);
        continue;
      }
      const s = r.size * (1 + 0.8 * p);
      r.mesh.scale.set(s, s, 1);
      r.mesh.material.opacity = 0.6 * (1 - p);
    }

    const moving = this.active.length > 0 || this.rings.length > 0 || this.waiting.length > 0;
    if (moving) this.view.requestRender();
    return moving;
  }
}
