/**
 * Plays the "poof" (see poof-timing.ts) for klossar that were taken back.
 */
import { IcosahedronGeometry, Mesh, type MeshPhysicalMaterial, MeshStandardMaterial } from "three";
import { SIZES } from "../core/format.ts";
import { KLOSS_HEIGHT, type PlacedKloss } from "../core/types.ts";
import { klossMaterial } from "./instances.ts";
import { klossGeometry } from "./kloss-geometry.ts";
import { poofState } from "./poof-timing.ts";
import type { KlossScene } from "./scene.ts";

const PUFFS = 10;

interface Poof {
  start: number;
  ghost: Mesh;
  ghostMaterial: MeshPhysicalMaterial;
  puffs: Mesh[];
  puffMaterial: MeshStandardMaterial;
  /** The kloss's center and footprint, for placing the puffs. */
  cx: number;
  cy: number;
  cz: number;
  w: number;
  d: number;
}

export class Poofs {
  private readonly active: Poof[] = [];
  private readonly puffGeometry = new IcosahedronGeometry(0.32, 1);

  constructor(private readonly view: KlossScene) {}

  add(k: PlacedKloss, now: number): void {
    const { w, d } = SIZES[k.size];
    const ghostMaterial = klossMaterial(k.color).clone();
    ghostMaterial.transparent = true;
    const ghost = new Mesh(klossGeometry(k.size), ghostMaterial);
    ghost.position.set(k.x, k.level * KLOSS_HEIGHT, k.y);
    const puffMaterial = new MeshStandardMaterial({
      color: "#ffffff",
      roughness: 1,
      transparent: true,
      depthWrite: false,
    });
    const puffs: Mesh[] = [];
    for (let i = 0; i < PUFFS; i++) {
      const p = new Mesh(this.puffGeometry, puffMaterial);
      puffs.push(p);
      this.view.scene.add(p);
    }
    this.view.scene.add(ghost);
    this.active.push({
      start: now,
      ghost,
      ghostMaterial,
      puffs,
      puffMaterial,
      cx: k.x + w / 2,
      cy: k.level * KLOSS_HEIGHT + KLOSS_HEIGHT / 2,
      cz: k.y + d / 2,
      w,
      d,
    });
    this.view.requestRender();
  }

  private remove(p: Poof): void {
    this.view.scene.remove(p.ghost, ...p.puffs);
    p.ghostMaterial.dispose();
    p.puffMaterial.dispose();
  }

  clear(): void {
    for (const p of this.active) this.remove(p);
    this.active.length = 0;
  }

  /** Advances every poof. Returns true while any is playing. */
  update(now: number): boolean {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      if (!p) continue;
      const s = poofState(now - p.start);
      if (!s) {
        this.remove(p);
        this.active.splice(i, 1);
        continue;
      }
      // the ghost swells around its own center
      p.ghost.scale.setScalar(s.ghostScale);
      p.ghost.position.set(
        p.cx - (p.w / 2) * s.ghostScale,
        p.cy - (KLOSS_HEIGHT / 2) * s.ghostScale,
        p.cz - (p.d / 2) * s.ghostScale,
      );
      p.ghostMaterial.opacity = s.ghostOpacity;
      p.ghost.visible = s.ghostOpacity > 0.01;
      // the puffs burst out in a ring, a little uneven so it looks like smoke
      p.puffs.forEach((puff, j) => {
        const a = (j / PUFFS) * Math.PI * 2 + (j % 2) * 0.3;
        const reach = Math.max(p.w, p.d) / 2 + s.puffSpread * (0.8 + (j % 3) * 0.15);
        puff.position.set(
          p.cx + Math.cos(a) * reach,
          p.cy + s.puffRise * (0.7 + (j % 4) * 0.12),
          p.cz + Math.sin(a) * reach,
        );
        puff.scale.setScalar(s.puffScale * (0.8 + (j % 3) * 0.2));
      });
      p.puffMaterial.opacity = s.puffOpacity;
    }
    const playing = this.active.length > 0;
    if (playing) this.view.requestRender();
    return playing;
  }
}
