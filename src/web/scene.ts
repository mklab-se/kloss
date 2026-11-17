/**
 * The 3D scene: renderer, light from above with soft shadows, the endless plupp-covered floor,
 * and the placed klossar.
 */
import {
  ACESFilmicToneMapping,
  BackSide,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  RepeatWrapping,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  type Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SIZES } from "../core/format.ts";
import { KLOSS_HEIGHT, PLUPP_HEIGHT, type PlacedKloss } from "../core/types.ts";
import { KlossInstances } from "./instances.ts";
import { buildFloorPluppGeometry } from "./kloss-geometry.ts";

/** The sky: deep blue overhead, pale at the horizon (also the fog's color, so the floor melts in). */
const SKY_TOP = "#2f80dc";
const HORIZON = "#c4e0f6";

/** A sky dome around the camera: a gradient from the horizon up to the top of the sky. */
function skyDome(): Mesh<SphereGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    // the sky keeps its colors: no tone mapping, which would wash the blue out
    toneMapped: false,
    uniforms: {
      top: { value: new Color(SKY_TOP) },
      horizon: { value: new Color(HORIZON) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, top, pow(h, 0.3)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new Mesh(new SphereGeometry(1, 32, 16), material);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  return dome;
}
const FLOOR = "#5c9a55";
const FLOOR_PLUPP = "#64a35d";
/** Floor pluppar drawn in 3D within this many cells of the target; beyond, a texture shows them. */
const FLOOR_PATCH_MAX = 64;
const FLOOR_PATCH_MIN = 20;
/** The sun's direction (from the target towards the sun). */
const SUN_DIRECTION = new Vector3(-0.6, 1, 0.35).normalize();

function floorTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("no 2D canvas");
  g.fillStyle = FLOOR;
  g.fillRect(0, 0, size, size);
  const plus = (dx: number, dy: number, color: string) => {
    const a = size * 0.3;
    const b = size * 0.11;
    const c = size / 2;
    g.fillStyle = color;
    g.fillRect(c - a + dx, c - b + dy, 2 * a, 2 * b);
    g.fillRect(c - b + dx, c - a + dy, 2 * b, 2 * a);
  };
  // shaded like the lit 3D pluppar, so the two meet without a visible line
  plus(size * 0.045, size * 0.045, "rgba(0,0,0,0.32)");
  plus(-size * 0.02, -size * 0.02, "rgba(255,255,255,0.28)");
  plus(0, 0, FLOOR_PLUPP);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}

export class KlossScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 1, 0.1, 5000);
  /** What the camera looks at; the floor patch and the sun follow it. */
  readonly target = new Vector3();
  readonly instances: KlossInstances;

  private readonly sun = new DirectionalLight("#fff4e2", 3.2);
  private readonly floor: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private readonly floorMap: CanvasTexture;
  private readonly floorPluppar: InstancedMesh;
  private readonly bounds = new Box3();
  private klossCount = 0;
  private dirty = true;
  private patch = { x: Number.NaN, z: Number.NaN, r: 0 };
  private floorSize = 0;
  private readonly raycaster = new Raycaster();
  private readonly sky = skyDome();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.scene.background = new Color(HORIZON);
    this.scene.fog = new Fog(HORIZON, 60, 200);
    this.scene.add(this.sky);
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    this.scene.add(new HemisphereLight("#ffffff", "#7d8f74", 0.55));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target);

    this.floorMap = floorTexture();
    this.floorMap.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.floor = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshStandardMaterial({ map: this.floorMap, roughness: 0.85 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    const side = 2 * FLOOR_PATCH_MAX + 1;
    this.floorPluppar = new InstancedMesh(
      buildFloorPluppGeometry().scale(1, 0.999, 1),
      new MeshStandardMaterial({ color: FLOOR_PLUPP, roughness: 0.7 }),
      side * side,
    );
    this.floorPluppar.receiveShadow = true;
    this.floorPluppar.castShadow = false;
    this.floorPluppar.frustumCulled = false;
    this.scene.add(this.floorPluppar);

    const origin = new Mesh(
      new RingGeometry(0.16, 0.24, 32),
      new MeshBasicMaterial({ color: "#7d8590", transparent: true, opacity: 0.55 }),
    );
    origin.rotation.x = -Math.PI / 2;
    origin.position.y = 0.002;
    this.scene.add(origin);

    this.instances = new KlossInstances(this.scene);
    this.resetBounds();
  }

  private resetBounds(): void {
    this.klossCount = 0;
    this.bounds.makeEmpty();
  }

  /** Grows the model's bounds by one kloss (top includes its pluppar). */
  private grow(k: PlacedKloss): void {
    const { w, d } = SIZES[k.size];
    this.bounds.expandByPoint(new Vector3(k.x, 0, k.y));
    this.bounds.expandByPoint(
      new Vector3(k.x + w, (k.level + 1) * KLOSS_HEIGHT + PLUPP_HEIGHT, k.y + d),
    );
    this.klossCount += 1;
  }

  setModel(klossar: readonly PlacedKloss[]): void {
    this.instances.clear();
    this.resetBounds();
    for (const k of klossar) {
      this.instances.add(k);
      this.grow(k);
    }
    this.requestRender();
  }

  /** Adds a kloss that has landed. */
  add(k: PlacedKloss): void {
    this.instances.add(k);
    this.grow(k);
    this.requestRender();
  }

  get count(): number {
    return this.klossCount;
  }

  /** The model's bounds; an empty model gives the area around the origin. */
  modelBounds(): Box3 {
    if (this.bounds.isEmpty()) return new Box3(new Vector3(-6, 0, -6), new Vector3(6, 2, 6));
    return this.bounds.clone();
  }

  requestRender(): void {
    this.dirty = true;
  }

  get needsRender(): boolean {
    return this.dirty;
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** The point under normalized device coordinates: a kloss, else the floor. */
  pickPoint(ndc: Vector2): Vector3 | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.instances.objects, false)[0];
    if (hit) return hit.point.clone();
    const p = new Vector3();
    return this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), p) ? p : null;
  }

  /** Keeps the floor, the floor pluppar, the fog and the sun around what the camera looks at. */
  private follow(): void {
    // the sky dome stays centred on the camera, just inside its far plane
    this.sky.position.copy(this.camera.position);
    const dist = this.camera.position.distanceTo(this.target);
    this.camera.near = Math.max(0.05, dist / 200);
    this.camera.far = Math.max(1000, dist * 40);
    this.sky.scale.setScalar(this.camera.far * 0.9);
    this.camera.updateProjectionMatrix();
    const fog = this.scene.fog as Fog;
    // Fog only softens the horizon, far beyond the model.
    fog.near = dist * 4 + 60;
    fog.far = dist * 12 + 200;

    const size = Math.max(1000, Math.ceil(dist * 40));
    const cx = Math.round(this.target.x);
    const cz = Math.round(this.target.z);
    if (size !== this.floorSize || cx !== this.floor.position.x || cz !== this.floor.position.z) {
      this.floorSize = size;
      this.floor.scale.set(size, size, 1);
      this.floor.position.set(cx, 0, cz);
      this.floorMap.repeat.set(size, size);
      // keep the texture's pluses on the cell centers wherever the plane sits
      this.floorMap.offset.set(((cx - size / 2) % 1) + 0, ((-cz - size / 2) % 1) + 0);
    }

    const showPatch = dist < 160;
    this.floorPluppar.visible = showPatch;
    // The 3D patch grows with the view, in steps of 4 cells so it is not rebuilt every frame.
    const patchR = Math.min(
      FLOOR_PATCH_MAX,
      Math.max(FLOOR_PATCH_MIN, Math.ceil((dist * 1.1) / 4) * 4),
    );
    const p = this.patch;
    if (showPatch && (cx !== p.x || cz !== p.z || patchR !== p.r)) {
      this.patch = { x: cx, z: cz, r: patchR };
      const m = new Matrix4();
      let i = 0;
      for (let dx = -patchR; dx <= patchR; dx++) {
        for (let dz = -patchR; dz <= patchR; dz++) {
          // Pluppar flatten gradually over most of the patch, so the floor texture takes over
          // without a visible edge.
          const r = Math.hypot(dx, dz) / patchR;
          const t = Math.min(1, Math.max(0, (1 - r) / 0.75));
          const h = t * t * (3 - 2 * t);
          if (h <= 0.02) continue;
          m.makeScale(1, h, 1).setPosition(cx + dx + 0.5, 0, cz + dz + 0.5);
          this.floorPluppar.setMatrixAt(i++, m);
        }
      }
      this.floorPluppar.count = i;
      this.floorPluppar.instanceMatrix.needsUpdate = true;
    }

    const b = this.modelBounds();
    const center = b.getCenter(new Vector3());
    const radius = Math.max(b.getSize(new Vector3()).length() / 2, 8) + 8;
    const reach = radius + 40; // room for klossar falling from above
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(SUN_DIRECTION, reach);
    const cam = this.sun.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 0.5;
    cam.far = reach * 2;
    cam.updateProjectionMatrix();
  }

  render(): void {
    this.follow();
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
  }
}
