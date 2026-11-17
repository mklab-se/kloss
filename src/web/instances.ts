/**
 * Placed klossar, drawn with one InstancedMesh per size and color so thousands stay smooth.
 */
import {
  Color,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshPhysicalMaterial,
  type Object3D,
} from "three";
import { PALETTE } from "../core/format.ts";
import { type ColorName, KLOSS_HEIGHT, type PlacedKloss, type Size } from "../core/types.ts";
import { klossGeometry } from "./kloss-geometry.ts";

const materials = new Map<ColorName, MeshPhysicalMaterial>();

/** Shiny plastic, one material per color, shared everywhere. */
export function klossMaterial(color: ColorName): MeshPhysicalMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new MeshPhysicalMaterial({
      color: new Color(PALETTE[color]),
      roughness: 0.3,
      metalness: 0,
      clearcoat: 0.4,
      clearcoatRoughness: 0.25,
    });
    materials.set(color, m);
  }
  return m;
}

/** Where a placed kloss sits in the world: kloss x -> x, kloss y -> z, level -> height. */
export function klossMatrix(k: PlacedKloss, out = new Matrix4()): Matrix4 {
  return out.makeTranslation(k.x, k.level * KLOSS_HEIGHT, k.y);
}

export class KlossInstances {
  private readonly meshes = new Map<string, InstancedMesh>();
  private readonly scratch = new Matrix4();

  constructor(private readonly parent: Object3D) {}

  private meshFor(size: Size, color: ColorName, needed: number): InstancedMesh {
    const key = `${size}:${color}`;
    const old = this.meshes.get(key);
    if (old && old.instanceMatrix.count >= needed) return old;
    const capacity = Math.max(16, (old?.instanceMatrix.count ?? 8) * 2, needed);
    const mesh = new InstancedMesh(klossGeometry(size), klossMaterial(color) as Material, capacity);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    if (old) {
      mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, old.count * 16));
      mesh.count = old.count;
      this.parent.remove(old);
      old.dispose();
    }
    this.parent.add(mesh);
    this.meshes.set(key, mesh);
    return mesh;
  }

  add(k: PlacedKloss): void {
    const existing = this.meshes.get(`${k.size}:${k.color}`);
    const mesh = this.meshFor(k.size, k.color, (existing?.count ?? 0) + 1);
    mesh.setMatrixAt(mesh.count, klossMatrix(k, this.scratch));
    mesh.count += 1;
    mesh.instanceMatrix.needsUpdate = true;
    // Three caches these for raycasting; a new instance must invalidate them.
    mesh.boundingSphere = null;
    mesh.boundingBox = null;
  }

  clear(): void {
    for (const mesh of this.meshes.values()) {
      this.parent.remove(mesh);
      mesh.dispose();
    }
    this.meshes.clear();
  }

  /** The meshes, for picking. */
  get objects(): InstancedMesh[] {
    return [...this.meshes.values()];
  }
}
