// Three.js voxel viewer: one instanced mesh per block type, textured with the user's own Spacebox textures.
// Multi-block blocks (2x2x2 thrusters, doors, ...) are drawn as one box over their whole footprint.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { cellIndex, decodeOrient, type Vec3, type VoxelGrid } from '../core/grid';
import { DIR_VECTORS, footprint, orientationMatrix } from '../core/orientation';

export interface BlockLook {
  color: [number, number, number] | null;
  /** Blob URLs of the block's textures. `all` is used for any face without its own texture. */
  faces: { all?: string; up?: string; down?: string; forward?: string };
  transparent: boolean;
  size: Vec3;
}

export interface SetGridOptions {
  /** Only show these cell indexes (isolate mode). */
  visible?: Set<number> | null;
  /** Move the camera to frame the model. */
  refit?: boolean;
}

/** A face under the cursor: the cell that was hit and the outward normal of the face. */
export interface Hit { cell: Vec3; normal: Vec3 }
export type Tool = 'remap' | 'place' | 'erase';
export type ViewName = 'front' | 'top' | 'side' | 'iso';
export interface GhostSpec { min: Vec3; size: Vec3; direction: number; valid: boolean }

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
  private controls: OrbitControls;
  private root = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private overlay: THREE.InstancedMesh | null = null;
  private cropBox: THREE.LineSegments | null = null;
  private ghost = new THREE.Group();
  private unitBox = new THREE.BoxGeometry(1, 1, 1);
  private textures = new Map<string, THREE.Texture>();
  private grid: VoxelGrid | null = null;
  private frame = 0;
  private spin = 0;
  private downAt: [number, number] | null = null;
  private hoverQueued = false;
  private lastPointer: PointerEvent | null = null;
  private center = new THREE.Vector3();
  private radius = 10;

  tool: Tool = 'remap';
  /** Click in the view. `null` means empty space. */
  onPick: (hit: Hit | null) => void = () => {};
  /** Pointer moved over the model while the Place or Erase tool is active. */
  onHover: (hit: Hit | null) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x0b0e14);
    this.scene.add(this.root, this.ghost);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(0.6, 1, 0.4);
    this.scene.add(sun);
    const back = new THREE.DirectionalLight(0x8899bb, 0.8);
    back.position.set(-0.7, -0.3, -0.6);
    this.scene.add(back);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.autoRotateSpeed = 2;
    this.controls.addEventListener('change', () => this.requestRender());

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { this.downAt = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      if (!this.downAt) return;
      const moved = Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]);
      this.downAt = null;
      if (moved < 5 && e.button === 0) this.onPick(this.hitAt(e));
    });
    el.addEventListener('pointermove', (e) => {
      if (this.tool === 'remap' || e.buttons !== 0) return;
      this.lastPointer = e;
      if (this.hoverQueued) return;
      this.hoverQueued = true;
      requestAnimationFrame(() => { this.hoverQueued = false; if (this.lastPointer) this.onHover(this.hitAt(this.lastPointer)); });
    });
    el.addEventListener('pointerleave', () => { if (this.tool !== 'remap') this.onHover(null); });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.renderer.render(this.scene, this.camera); });
  }

  // ---------- materials ----------
  private texture(url: string): THREE.Texture {
    let t = this.textures.get(url);
    if (!t) {
      t = new THREE.TextureLoader().load(url, () => this.requestRender());
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(url, t);
    }
    return t;
  }

  private single(look: BlockLook | undefined, url: string | undefined): THREE.MeshLambertMaterial {
    const c = look?.color ?? [200, 0, 200];
    const params: THREE.MeshLambertMaterialParameters = url
      ? { map: this.texture(url) }
      : { color: new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255) };
    if (look?.transparent) { params.transparent = true; params.opacity = 0.55; }
    return new THREE.MeshLambertMaterial(params);
  }

  /** One material, or six when the block has its own top, bottom or front texture (+X, -X, +Y, -Y, +Z, -Z). */
  private material(look: BlockLook | undefined): THREE.Material | THREE.Material[] {
    const f = look?.faces;
    if (!f || (!f.up && !f.down && !f.forward)) return this.single(look, f?.all);
    const side = f.all;
    return [this.single(look, side), this.single(look, side), this.single(look, f.up ?? side), this.single(look, f.down ?? side),
      this.single(look, f.forward ?? side), this.single(look, side)];
  }

  private disposeMaterial(m: THREE.Material | THREE.Material[]) {
    for (const x of Array.isArray(m) ? m : [m]) x.dispose();
  }

  // ---------- model ----------
  setGrid(grid: VoxelGrid, looks: Map<string, BlockLook>, opts: SetGridOptions = {}) {
    this.grid = grid;
    for (const m of this.meshes) { this.root.remove(m); this.disposeMaterial(m.material); }
    this.meshes = [];
    const [sx, sy, sz] = grid.size;
    const lists = new Map<number, number[]>();
    for (let i = 0; i < grid.data.length; i++) {
      const p = grid.data[i]!;
      if (p === 0 || (opts.visible && !opts.visible.has(i))) continue;
      const size = looks.get(grid.palette[p]!)?.size;
      if (size && size[0] * size[1] * size[2] > 1 && grid.offsets.has(i)) continue; // drawn with its anchor
      let l = lists.get(p);
      if (!l) { l = []; lists.set(p, l); }
      l.push(i);
    }
    const geo = this.unitBox;
    const m4 = new THREE.Matrix4(), rot = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), quat = new THREE.Quaternion();
    for (const [p, cells] of lists) {
      const look = looks.get(grid.palette[p]!);
      const mesh = new THREE.InstancedMesh(geo, this.material(look), cells.length);
      cells.forEach((ci, n) => {
        const x = ci % sx, z = Math.floor(ci / sx) % sz, y = Math.floor(ci / (sx * sz));
        const world: Vec3 = [grid.min[0] + x, grid.min[1] + y, grid.min[2] + z];
        const size = look?.size ?? [1, 1, 1];
        const o = grid.orient[ci] ? decodeOrient(grid.orient[ci]!) : null;
        if (size[0] * size[1] * size[2] > 1) {
          const od = o ?? { direction: 5, rotation: 0 };
          const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
          for (const c of footprint(world, size, od.direction, od.rotation)) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, c.pos[a]!); hi[a] = Math.max(hi[a]!, c.pos[a]!); }
          pos.set((lo[0] + hi[0] + 1) / 2, (lo[1] + hi[1] + 1) / 2, (lo[2] + hi[2] + 1) / 2);
          scl.set(size[0], size[1], size[2]);
        } else {
          pos.set(world[0] + 0.5, world[1] + 0.5, world[2] + 0.5);
          scl.set(1, 1, 1);
        }
        if (o) {
          const m = orientationMatrix(o.direction, o.rotation);
          quat.setFromRotationMatrix(rot.makeBasis(new THREE.Vector3(...m[0]), new THREE.Vector3(...m[1]), new THREE.Vector3(...m[2])));
        } else quat.identity();
        m4.compose(pos, quat, scl);
        mesh.setMatrixAt(n, m4);
      });
      mesh.userData.cells = Int32Array.from(cells);
      mesh.instanceMatrix.needsUpdate = true;
      this.root.add(mesh);
      this.meshes.push(mesh);
    }
    this.center.set(grid.min[0] + sx / 2, grid.min[1] + sy / 2, grid.min[2] + sz / 2);
    this.radius = Math.max(1, Math.hypot(sx, sy, sz) / 2);
    if (opts.refit) this.fit();
    this.requestRender();
  }

  /** Draws a yellow wireframe around the given output cells (null clears it). */
  setHighlight(cells: Iterable<number> | null, color = 0xffd23f) {
    if (this.overlay) { this.root.remove(this.overlay); this.overlay.geometry.dispose(); (this.overlay.material as THREE.Material).dispose(); this.overlay = null; }
    if (cells && this.grid) {
      const list = [...cells];
      if (list.length) {
        const g = this.grid, [sx, sy, sz] = g.size;
        const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.06, 1.06, 1.06), new THREE.MeshBasicMaterial({ color, wireframe: true }), list.length);
        const m4 = new THREE.Matrix4();
        list.forEach((ci, n) => {
          const x = ci % sx, z = Math.floor(ci / sx) % sz, y = Math.floor(ci / (sx * sz));
          m4.setPosition(g.min[0] + x + 0.5, g.min[1] + y + 0.5, g.min[2] + z + 0.5);
          mesh.setMatrixAt(n, m4);
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.root.add(mesh);
        this.overlay = mesh;
      }
    }
    this.requestRender();
  }

  /** Shows the crop window as a thin blue box (null hides it). */
  setCropBox(box: { min: Vec3; size: Vec3 } | null) {
    if (this.cropBox) { this.root.remove(this.cropBox); this.cropBox.geometry.dispose(); (this.cropBox.material as THREE.Material).dispose(); this.cropBox = null; }
    if (box) {
      const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(box.size[0], box.size[1], box.size[2]));
      const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x59c2ff, transparent: true, opacity: 0.75 }));
      lines.position.set(box.min[0] + box.size[0] / 2, box.min[1] + box.size[1] / 2, box.min[2] + box.size[2] / 2);
      this.root.add(lines);
      this.cropBox = lines;
    }
    this.requestRender();
  }

  /** Translucent preview of the block about to be placed, with an arrow along its direction. */
  setGhost(spec: GhostSpec | null) {
    for (const c of [...this.ghost.children]) {
      this.ghost.remove(c);
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose?.();
    }
    if (spec) {
      const color = spec.valid ? 0x5ec27a : 0xe0686b;
      const center = new THREE.Vector3(spec.min[0] + spec.size[0] / 2, spec.min[1] + spec.size[1] / 2, spec.min[2] + spec.size[2] / 2);
      const box = new THREE.Mesh(new THREE.BoxGeometry(spec.size[0] * 1.01, spec.size[1] * 1.01, spec.size[2] * 1.01),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false }));
      box.position.copy(center);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color }));
      edges.position.copy(center);
      const d = DIR_VECTORS[spec.direction] ?? [0, 0, 1];
      const len = Math.max(...spec.size) / 2 + 1.6;
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(d[0], d[1], d[2]), center, len, 0xffd23f, 0.7, 0.45);
      this.ghost.add(box, edges, arrow);
    }
    this.requestRender();
  }

  // ---------- camera ----------
  private distance(): number {
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    return (this.radius / Math.sin(Math.min(vfov, hfov) / 2)) * 1.05;
  }

  private place(dir: THREE.Vector3) {
    const dist = this.distance();
    this.camera.near = Math.max(0.1, dist / 200);
    this.camera.far = dist * 20;
    this.camera.position.copy(this.center).add(dir.clone().normalize().multiplyScalar(dist));
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(this.center);
    this.controls.update();
    this.requestRender();
  }

  fit() { this.place(new THREE.Vector3(0.8, 0.6, 1)); }

  snap(view: ViewName) {
    const dirs: Record<ViewName, THREE.Vector3> = {
      front: new THREE.Vector3(0, 0, 1), top: new THREE.Vector3(0, 1, 0.0001), side: new THREE.Vector3(1, 0, 0), iso: new THREE.Vector3(0.8, 0.6, 1),
    };
    this.place(dirs[view]);
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on;
    cancelAnimationFrame(this.spin);
    if (on) {
      const loop = () => { this.controls.update(); this.spin = requestAnimationFrame(loop); };
      loop();
    }
  }

  // ---------- picking ----------
  private hitAt(e: PointerEvent): Hit | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(this.meshes, false)[0];
    if (!hit || !hit.face) return null;
        const n = hit.face.normal.clone();
    if (hit.instanceId !== undefined && hit.object instanceof THREE.InstancedMesh) {
      const im = new THREE.Matrix4();
      hit.object.getMatrixAt(hit.instanceId, im);
      n.transformDirection(im); // rotated blocks: bring the face normal into world space
    }
    const normal: Vec3 = [Math.round(n.x), Math.round(n.y), Math.round(n.z)];
    const p = hit.point;
    return { cell: [Math.floor(p.x - normal[0] * 0.01), Math.floor(p.y - normal[1] * 0.01), Math.floor(p.z - normal[2] * 0.01)], normal };
  }

  /** Output grid index of a world cell, or -1 when outside the grid. */
  indexOfCell(cell: Vec3): number {
    const g = this.grid;
    if (!g) return -1;
    const x = cell[0] - g.min[0], y = cell[1] - g.min[1], z = cell[2] - g.min[2];
    return x < 0 || y < 0 || z < 0 || x >= g.size[0] || y >= g.size[1] || z >= g.size[2] ? -1 : cellIndex(g, x, y, z);
  }

  /**
   * Renders one frame without helper overlays (crop box, highlights, placement ghost) and hands the canvas to `use`
   * while it still holds that frame.
   */
  captureClean<T>(use: (canvas: HTMLCanvasElement) => T): T {
    const hidden = ([this.overlay, this.cropBox, this.ghost] as (THREE.Object3D | null)[]).filter((o): o is THREE.Object3D => !!o && o.visible);
    for (const o of hidden) o.visible = false;
    this.renderer.render(this.scene, this.camera);
    try { return use(this.renderer.domElement); }
    finally {
      for (const o of hidden) o.visible = true;
      this.requestRender();
    }
  }

  /** JPEG data URL of the current view, for the structure thumbnail. */
  snapshot(): string {
    return this.captureClean((c) => c.toDataURL('image/jpeg', 0.85));
  }
}
