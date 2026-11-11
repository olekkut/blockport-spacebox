// Manual edits applied on top of a converted grid: place a block (single or multi-block) or erase one.
// Positions are world cell coordinates of the grid (grid.min + local). No DOM or Three.js imports.
import { cellIndex, createGrid, decodeOrient, encodeOrient, paletteIndex, trimGrid, type Vec3, type VoxelGrid } from './grid';
import { anchorFromCell, footprint } from './orientation';

export type ManualEdit =
  | { type: 'place'; pos: Vec3; blockId: string; direction: number; rotation: number }
  | { type: 'erase'; pos: Vec3 };

export type SizeOf = (blockId: string) => Vec3;

interface Bounds { min: Vec3; max: Vec3 }

function unionBounds(grid: VoxelGrid, edits: ManualEdit[], sizeOf: SizeOf): Bounds {
  const min: Vec3 = [...grid.min], max: Vec3 = [grid.min[0] + grid.size[0] - 1, grid.min[1] + grid.size[1] - 1, grid.min[2] + grid.size[2] - 1];
  for (const e of edits) {
    if (e.type !== 'place') continue;
    for (const c of footprint(e.pos, sizeOf(e.blockId), Math.max(0, e.direction), e.rotation)) {
      for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, c.pos[a]!); max[a] = Math.max(max[a]!, c.pos[a]!); }
    }
  }
  return { min, max };
}

/** Returns a new grid with the edits applied, trimmed to its content. The input grid is not changed. */
export function applyEdits(grid: VoxelGrid, edits: ManualEdit[], sizeOf: SizeOf): VoxelGrid {
  if (edits.length === 0) return grid;
  const { min, max } = unionBounds(grid, edits, sizeOf);
  const out = createGrid(min, [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1]);
  out.palette = grid.palette.slice();

  const inside = (p: Vec3) => p[0] >= min[0] && p[1] >= min[1] && p[2] >= min[2] && p[0] <= max[0] && p[1] <= max[1] && p[2] <= max[2];
  const idx = (p: Vec3) => cellIndex(out, p[0] - min[0], p[1] - min[1], p[2] - min[2]);

  for (let y = 0; y < grid.size[1]; y++) for (let z = 0; z < grid.size[2]; z++) for (let x = 0; x < grid.size[0]; x++) {
    const src = cellIndex(grid, x, y, z);
    if (grid.data[src] === 0) continue;
    const dst = idx([grid.min[0] + x, grid.min[1] + y, grid.min[2] + z]);
    out.data[dst] = grid.data[src]!;
    out.orient[dst] = grid.orient[src]!;
    const off = grid.offsets.get(src);
    if (off !== undefined) out.offsets.set(dst, off);
  }

  const clearCell = (i: number) => { out.data[i] = 0; out.orient[i] = 0; out.offsets.delete(i); };

  /** Removes the whole block that occupies `p` (all cells of a multi-block). */
  const eraseAt = (p: Vec3) => {
    if (!inside(p)) return;
    const i = idx(p);
    if (out.data[i] === 0) return;
    const size = sizeOf(out.palette[out.data[i]!]!);
    if (size[0] * size[1] * size[2] === 1) { clearCell(i); return; }
    const o = decodeOrient(out.orient[i]!) ?? { direction: 0, rotation: 0 };
    const off = out.offsets.get(i);
    const anchor = off === undefined ? p : anchorFromCell(p, off, o.direction, o.rotation);
    for (const c of footprint(anchor, size, o.direction, o.rotation)) if (inside(c.pos)) clearCell(idx(c.pos));
  };

  for (const e of edits) {
    if (e.type === 'erase') { eraseAt(e.pos); continue; }
    const size = sizeOf(e.blockId);
    const multi = size[0] * size[1] * size[2] > 1;
    const dir = Math.max(0, e.direction);
    const cells = footprint(e.pos, size, dir, e.rotation);
    for (const c of cells) eraseAt(c.pos); // replace whatever was there, whole blocks at a time
    const pi = paletteIndex(out, e.blockId);
    for (const c of cells) {
      const i = idx(c.pos);
      out.data[i] = pi;
      if (e.direction >= 0 || multi) out.orient[i] = encodeOrient(dir, e.rotation);
      if (multi && (c.local[0] | c.local[1] | c.local[2]) !== 0) out.offsets.set(i, c.offset);
    }
  }
  return trimGrid(out);
}
