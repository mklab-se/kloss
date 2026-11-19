/**
 * Plays "poof and grow" after an optimize (see merge-timing.ts): in every merged group, the
 * klossar that go away vanish in a poof, the one that stays grows into their place, and then its
 * new pluppar rise. Built for big models: everything is instanced, groups that start together
 * share one material, the smoke thins out when thousands poof at once, and each finished kloss is
 * handed to the scene's own instances right away.
 */
import {
  type BufferGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  type MeshPhysicalMaterial,
  MeshStandardMaterial,
} from "three";
import { SIZES } from "../core/format.ts";
import { type ColorName, KLOSS_HEIGHT, type PlacedKloss, type Size } from "../core/types.ts";
import { klossMaterial } from "./instances.ts";
import { klossBodyGeometry, klossGeometry, pluppGeometry } from "./kloss-geometry.ts";
import { groupLength, growState, pluppRise, puffsPerKloss, schedule } from "./merge-timing.ts";
import { poofState } from "./poof-timing.ts";
import type { KlossScene } from "./scene.ts";

/** What the server sends after an optimize: the new kloss at `index` was made from `from`. */
export interface Merged {
  index: number;
  from: PlacedKloss[];
}

interface Plupp {
  x: number;
  z: number;
  /** Cells from the kloss that stays; 0 for its own pluppar. */
  distance: number;
}

interface Group {
  final: PlacedKloss;
  keeper: PlacedKloss;
  start: number;
  length: number;
  pluppar: Plupp[];
  done: boolean;
}

/** Everything that starts at the same moment: its poofs share one material per color. */
interface Wave {
  start: number;
  gone: PlacedKloss[];
  ghosts: InstancedMesh[];
  ghostMaterials: MeshPhysicalMaterial[];
  puffs: InstancedMesh;
  puffMaterial: MeshStandardMaterial;
  puffsEach: number;
  over: boolean;
}

const key = (size: Size, color: ColorName) => `${size}:${color}`;

export class Merges {
  private groups: Group[] = [];
  private waves: Wave[] = [];
  /** Growing bodies, one mesh per size and color; and pluppar, one mesh per color. */
  private bodies = new Map<string, InstancedMesh>();
  private pluppar = new Map<ColorName, InstancedMesh>();
  private t0 = 0;
  private readonly m = new Matrix4();
  private readonly puffGeometry = new IcosahedronGeometry(0.32, 1);

  constructor(private readonly view: KlossScene) {}

  get active(): boolean {
    return this.groups.length > 0;
  }

  /** Klossar that are still to poof: the counter shows them until they go. */
  pendingPoofs(now: number): number {
    let n = 0;
    for (const w of this.waves) if (now - this.t0 < w.start) n += w.gone.length;
    return n;
  }

  /** Shows the optimized model `klossar`, animating how `merged` came about. */
  start(klossar: readonly PlacedKloss[], merged: readonly Merged[], now: number): void {
    this.clear();
    this.t0 = now;
    const groups = merged.flatMap((g): Group[] => {
      const final = klossar[g.index];
      const [keeper, ...gone] = g.from;
      if (!final || !keeper || gone.length === 0) return [];
      return [{ final, keeper, start: 0, length: 0, pluppar: pluppar(final, keeper), done: false }];
    });
    const starts = schedule(
      groups.map((g) => ({ level: g.final.level, x: g.final.x, y: g.final.y })),
    );
    groups.forEach((g, i) => {
      g.start = starts[i] ?? 0;
      g.length = groupLength(Math.max(1, ...g.pluppar.map((p) => p.distance)));
    });
    this.groups = groups;
    this.view.setModel(klossar, new Set(groups.map((g) => g.final.index)));

    // the poofs, by start time
    const startOf = new Map(groups.map((g, i) => [g.final.index, starts[i] ?? 0]));
    const byStart = new Map<number, PlacedKloss[]>();
    for (const g of merged) {
      const start = startOf.get(g.index);
      if (start === undefined) continue;
      const list = byStart.get(start) ?? [];
      list.push(...g.from.slice(1));
      byStart.set(start, list);
    }
    this.waves = [...byStart].map(([start, gone]) => this.wave(start, gone));

    // the growing bodies and their pluppar
    const bodyCount = new Map<string, number>();
    const pluppCount = new Map<ColorName, number>();
    for (const g of groups) {
      const k = key(g.final.size, g.final.color);
      bodyCount.set(k, (bodyCount.get(k) ?? 0) + 1);
      pluppCount.set(g.final.color, (pluppCount.get(g.final.color) ?? 0) + g.pluppar.length);
    }
    for (const [k, n] of bodyCount) {
      const [size, color] = k.split(":") as [Size, ColorName];
      this.bodies.set(k, this.mesh(klossBodyGeometry(size), klossMaterial(color), n));
    }
    for (const [color, n] of pluppCount) {
      this.pluppar.set(color, this.mesh(pluppGeometry(), klossMaterial(color), n));
    }
    this.update(now);
  }

  private mesh(geometry: BufferGeometry, material: Material, capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, Math.max(1, capacity));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.view.scene.add(mesh);
    return mesh;
  }

  private wave(start: number, gone: PlacedKloss[]): Wave {
    const ghosts: InstancedMesh[] = [];
    const ghostMaterials: MeshPhysicalMaterial[] = [];
    const byColor = new Map<ColorName, Map<Size, PlacedKloss[]>>();
    for (const k of gone) {
      const sizes = byColor.get(k.color) ?? new Map<Size, PlacedKloss[]>();
      sizes.set(k.size, [...(sizes.get(k.size) ?? []), k]);
      byColor.set(k.color, sizes);
    }
    for (const [color, sizes] of byColor) {
      const material = klossMaterial(color).clone();
      ghostMaterials.push(material);
      for (const [size, list] of sizes) {
        const mesh = this.mesh(klossGeometry(size), material, list.length);
        mesh.userData.klossar = list;
        list.forEach((k, i) => {
          mesh.setMatrixAt(i, this.m.makeTranslation(k.x, k.level * KLOSS_HEIGHT, k.y));
        });
        mesh.count = list.length;
        ghosts.push(mesh);
      }
    }
    const puffsEach = puffsPerKloss(gone.length);
    const puffMaterial = new MeshStandardMaterial({
      color: "#ffffff",
      roughness: 1,
      transparent: true,
      depthWrite: false,
    });
    const puffs = this.mesh(this.puffGeometry, puffMaterial, gone.length * puffsEach);
    puffs.castShadow = false;
    puffs.visible = false;
    return { start, gone, ghosts, ghostMaterials, puffs, puffMaterial, puffsEach, over: false };
  }

  /** Advances the animation. Returns true while it plays. */
  update(now: number): boolean {
    if (!this.active) return false;
    const t = now - this.t0;
    for (const w of this.waves) if (!w.over) this.updateWave(w, t - w.start);

    const bodyN = new Map<InstancedMesh, number>();
    const pluppN = new Map<InstancedMesh, number>();
    let playing = false;
    for (const g of this.groups) {
      if (g.done) continue;
      const tg = t - g.start;
      if (tg >= g.length) {
        g.done = true;
        this.view.reveal(g.final);
        continue;
      }
      playing = true;
      const { grow, squash } = growState(tg);
      const { keeper: k, final: f } = g;
      const ks = SIZES[k.size];
      const fs = SIZES[f.size];
      const x0 = k.x + (f.x - k.x) * grow;
      const z0 = k.y + (f.y - k.y) * grow;
      const x1 = k.x + ks.w + (f.x + fs.w - k.x - ks.w) * grow;
      const z1 = k.y + ks.d + (f.y + fs.d - k.y - ks.d) * grow;
      const y = f.level * KLOSS_HEIGHT;
      const body = this.bodies.get(key(f.size, f.color)) as InstancedMesh;
      const n = bodyN.get(body) ?? 0;
      this.m.makeScale((x1 - x0) / fs.w, squash, (z1 - z0) / fs.d).setPosition(x0, y, z0);
      body.setMatrixAt(n, this.m);
      bodyN.set(body, n + 1);

      const plupps = this.pluppar.get(f.color) as InstancedMesh;
      let p = pluppN.get(plupps) ?? 0;
      const top = y + KLOSS_HEIGHT * squash;
      for (const pl of g.pluppar) {
        const rise = pl.distance === 0 ? 1 : pluppRise(tg, pl.distance);
        if (rise === null || rise <= 0) continue;
        this.m.makeScale(1, rise, 1).setPosition(pl.x, top, pl.z);
        plupps.setMatrixAt(p++, this.m);
      }
      pluppN.set(plupps, p);
    }
    for (const mesh of [...this.bodies.values(), ...this.pluppar.values()]) {
      mesh.count = (bodyN.get(mesh) ?? 0) + (pluppN.get(mesh) ?? 0);
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.waves.some((w) => !w.over)) playing = true;
    if (!playing) this.clear();
    this.view.requestRender();
    return playing;
  }

  private updateWave(w: Wave, tw: number): void {
    if (tw < 0) return; // still standing as they were
    const s = poofState(tw);
    if (!s) {
      w.over = true;
      this.disposeWave(w);
      return;
    }
    for (const material of w.ghostMaterials) {
      material.transparent = true;
      material.opacity = s.ghostOpacity;
    }
    let puff = 0;
    for (const mesh of w.ghosts) {
      mesh.visible = s.ghostOpacity > 0.01;
      const list = mesh.userData.klossar as PlacedKloss[];
      list.forEach((k, i) => {
        const { w: kw, d: kd } = SIZES[k.size];
        const cx = k.x + kw / 2;
        const cy = k.level * KLOSS_HEIGHT + KLOSS_HEIGHT / 2;
        const cz = k.y + kd / 2;
        const g = s.ghostScale;
        this.m
          .makeScale(g, g, g)
          .setPosition(cx - (kw / 2) * g, cy - (KLOSS_HEIGHT / 2) * g, cz - (kd / 2) * g);
        mesh.setMatrixAt(i, this.m);
        // the puffs burst out in a ring, a little uneven so it looks like smoke
        for (let j = 0; j < w.puffsEach; j++) {
          const a = (j / w.puffsEach) * Math.PI * 2 + (j % 2) * 0.3 + i;
          const reach = Math.max(kw, kd) / 2 + s.puffSpread * (0.8 + (j % 3) * 0.15);
          const size = s.puffScale * (0.8 + (j % 3) * 0.2);
          this.m
            .makeScale(size, size, size)
            .setPosition(
              cx + Math.cos(a) * reach,
              cy + s.puffRise * (0.7 + (j % 4) * 0.12),
              cz + Math.sin(a) * reach,
            );
          w.puffs.setMatrixAt(puff++, this.m);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    w.puffs.count = puff;
    w.puffs.visible = true;
    w.puffs.instanceMatrix.needsUpdate = true;
    w.puffMaterial.opacity = s.puffOpacity;
  }

  private disposeWave(w: Wave): void {
    this.view.scene.remove(...w.ghosts, w.puffs);
    for (const mesh of [...w.ghosts, w.puffs]) mesh.dispose();
    for (const material of w.ghostMaterials) material.dispose();
    w.puffMaterial.dispose();
  }

  /** Ends at once: every kloss in its final place (for when something else happens meanwhile). */
  finish(): void {
    for (const g of this.groups) if (!g.done) this.view.reveal(g.final);
    for (const g of this.groups) g.done = true;
    this.clear();
  }

  /** Removes the animation without revealing anything (the caller shows a new model). */
  clear(): void {
    for (const w of this.waves) if (!w.over) this.disposeWave(w);
    for (const mesh of [...this.bodies.values(), ...this.pluppar.values()]) {
      this.view.scene.remove(mesh);
      mesh.dispose();
    }
    this.waves = [];
    this.groups = [];
    this.bodies.clear();
    this.pluppar.clear();
    this.view.requestRender();
  }
}

/** The final kloss's pluppar: its own (distance 0, where the kloss that stays was) and new ones. */
function pluppar(f: PlacedKloss, k: PlacedKloss): Plupp[] {
  const fs = SIZES[f.size];
  const ks = SIZES[k.size];
  const out: Plupp[] = [];
  for (let i = 0; i < fs.w; i++) {
    for (let j = 0; j < fs.d; j++) {
      const x = f.x + i;
      const y = f.y + j;
      const dx = Math.max(k.x - x, x - (k.x + ks.w - 1), 0);
      const dy = Math.max(k.y - y, y - (k.y + ks.d - 1), 0);
      out.push({ x: x + 0.5, z: y + 0.5, distance: dx + dy });
    }
  }
  return out;
}
