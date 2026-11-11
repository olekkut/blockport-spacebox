// Dense voxel grid shared by the .sbs reader/writer and the converter. No DOM or Three.js imports.

export type Vec3 = [number, number, number];

/**
 * A box of cells. Palette index 0 is always air (name ''). Coordinates are local (0..size-1); the world
 * position of a cell is min + local. Layout is y-major: ((y * sz) + z) * sx + x.
 */
export interface VoxelGrid {
  min: Vec3;
  size: Vec3;
  palette: string[];
  data: Uint16Array;
  /** 0 = no orientation, otherwise 1 + direction * 4 + rotation (direction 0..5, rotation 0..3). */
  orient: Uint8Array;
  /** Cell index -> packed multi-block offset, kept so vanilla files round-trip. */
  offsets: Map<number, number>;
}

export function createGrid(min: Vec3, size: Vec3): VoxelGrid {
  const n = size[0] * size[1] * size[2];
  return { min, size, palette: [''], data: new Uint16Array(n), orient: new Uint8Array(n), offsets: new Map() };
}

export function cellIndex(g: Pick<VoxelGrid, 'size'>, x: number, y: number, z: number): number {
  return (y * g.size[2] + z) * g.size[0] + x;
}

export function paletteIndex(g: VoxelGrid, name: string): number {
  if (name === '') return 0;
  let i = g.palette.indexOf(name);
  if (i < 0) { i = g.palette.length; g.palette.push(name); }
  return i;
}

export function countBlocks(g: VoxelGrid): number {
  let n = 0;
  for (let i = 0; i < g.data.length; i++) if (g.data[i] !== 0) n++;
  return n;
}

/** Name of the block at local coordinates ('' = air or outside). */
export function blockAt(g: VoxelGrid, x: number, y: number, z: number): string {
  if (x < 0 || y < 0 || z < 0 || x >= g.size[0] || y >= g.size[1] || z >= g.size[2]) return '';
  return g.palette[g.data[cellIndex(g, x, y, z)]!] ?? '';
}

export function encodeOrient(direction: number, rotation: number): number { return 1 + direction * 4 + rotation; }
export function decodeOrient(o: number): { direction: number; rotation: number } | null {
  return o === 0 ? null : { direction: Math.floor((o - 1) / 4), rotation: (o - 1) % 4 };
}

/** Shrinks the grid to the tight bounding box of its non-air cells. Returns a new grid. */
export function trimGrid(g: VoxelGrid): VoxelGrid {
  const [sx, sy, sz] = g.size;
  let x0 = sx, y0 = sy, z0 = sz, x1 = -1, y1 = -1, z1 = -1;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    if (g.data[cellIndex(g, x, y, z)] === 0) continue;
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
    if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
  }
  if (x1 < 0) return createGrid(g.min, [1, 1, 1]);
  const out = createGrid([g.min[0] + x0, g.min[1] + y0, g.min[2] + z0], [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1]);
  out.palette = g.palette.slice();
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const src = cellIndex(g, x, y, z);
    const dst = cellIndex(out, x - x0, y - y0, z - z0);
    out.data[dst] = g.data[src]!;
    out.orient[dst] = g.orient[src]!;
    const off = g.offsets.get(src);
    if (off !== undefined) out.offsets.set(dst, off);
  }
  return out;
}
