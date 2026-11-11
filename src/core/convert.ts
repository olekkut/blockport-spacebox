// Minecraft grid -> Spacebox grid: crop, map every state, optional hollowing, trim to the content.
import { createGrid, cellIndex, paletteIndex, trimGrid, type VoxelGrid } from './grid';
import type { GameSet } from './gameset';
import { Resolver, type MappingProfile } from './mapper';
import type { SourceGrid } from './minecraft';

export interface StateReport { key: string; target: string | null; reason: string; count: number }

export interface ConversionReport {
  inputBlocks: number;
  /** Blocks left inside the crop box. */
  croppedBlocks: number;
  outputBlocks: number;
  dropped: number;
  hollowed: number;
  states: StateReport[];
  /** Spacebox id -> number of blocks written. */
  targets: Record<string, number>;
}

export interface ConversionResult {
  grid: VoxelGrid;
  report: ConversionReport;
  /** Source palette index of the Minecraft block that produced the output cell (local output coordinates). */
  sourceAt(x: number, y: number, z: number): number;
  /** The crop window in the same world coordinates as `grid`: lowest corner and size in cells. */
  window: { min: [number, number, number]; size: [number, number, number] };
}

export function convert(src: SourceGrid, gameSet: GameSet, profile: MappingProfile): ConversionResult {
  const [sx, sy, sz] = src.size;
  const lo = profile.crop?.min ?? [], hi = profile.crop?.max ?? [];
  const x0 = Math.max(0, lo[0] ?? 0), y0 = Math.max(0, lo[1] ?? 0), z0 = Math.max(0, lo[2] ?? 0);
  const x1 = Math.min(sx - 1, hi[0] ?? sx - 1), y1 = Math.min(sy - 1, hi[1] ?? sy - 1), z1 = Math.min(sz - 1, hi[2] ?? sz - 1);
  const cw = Math.max(0, x1 - x0 + 1), ch = Math.max(0, y1 - y0 + 1), cd = Math.max(0, z1 - z0 + 1);

  const resolver = new Resolver(gameSet, profile);
  const counts = new Map<number, number>();
  let input = 0;
  for (const v of src.data) if (v !== 0) input++;

  // The grid is anchored to the full source size, so moving the crop never shifts the model under manual edits.
  const grid = createGrid([-Math.floor(sx / 2), 0, -Math.floor(sz / 2)], [Math.max(1, sx), Math.max(1, sy), Math.max(1, sz)]);
  const paletteMap = new Map<number, number>();
  const srcPal = new Uint16Array(grid.data.length);
  let cropped = 0;

  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const pi = src.data[((y * sz) + z) * sx + x]!;
    if (pi === 0) continue;
    cropped++;
    counts.set(pi, (counts.get(pi) ?? 0) + 1);
    let gi = paletteMap.get(pi);
    if (gi === undefined) {
      const target = resolver.resolve(src.palette[pi]!).target;
      gi = target ? paletteIndex(grid, target) : 0;
      paletteMap.set(pi, gi);
    }
    if (gi === 0) continue;
    const ci = cellIndex(grid, x, y, profile.flipZ ? sz - 1 - z : z);
    grid.data[ci] = gi;
    srcPal[ci] = pi;
    const si = ((y * sz) + z) * sx + x;
    if (src.orient?.[si]) grid.orient[ci] = src.orient[si]!;
    const off = src.offsets?.get(si);
    if (off !== undefined) grid.offsets.set(ci, off);
  }

  let hollowed = 0;
  if (profile.hollow.enabled) hollowed = hollowOut(grid, gameSet, Math.max(1, Math.round(profile.hollow.thickness)));

  const preMin = grid.min, preGrid = grid;
  const out = trimGrid(grid);
  const off = [out.min[0] - preMin[0], out.min[1] - preMin[1], out.min[2] - preMin[2]] as const;
  const targets: Record<string, number> = {};
  let written = 0;
  for (const v of out.data) if (v !== 0) { const n = out.palette[v]!; targets[n] = (targets[n] ?? 0) + 1; written++; }

  const states: StateReport[] = [...counts.entries()].map(([pi, count]) => {
    const st = src.palette[pi]!;
    const r = resolver.resolve(st);
    return { key: st.key, target: r.target, reason: r.reason, count };
  }).sort((a, b) => b.count - a.count);

  return {
    grid: out,
    window: {
      min: [preMin[0] + x0, preMin[1] + y0, preMin[2] + (profile.flipZ ? sz - 1 - z1 : z0)],
      size: [Math.max(1, cw), Math.max(1, ch), Math.max(1, cd)],
    },
    sourceAt: (x, y, z) => srcPal[cellIndex(preGrid, x + off[0], y + off[1], z + off[2])] ?? 0,
    report: { inputBlocks: input, croppedBlocks: cropped, outputBlocks: written, dropped: cropped - hollowed - written, hollowed, states, targets },
  };
}

/** Removes opaque blocks buried more than `thickness` layers deep, keeping an outer shell. Returns how many were removed. */
export function hollowOut(grid: VoxelGrid, gameSet: GameSet, thickness: number): number {
  const [sx, sy, sz] = grid.size;
  const opaquePal = grid.palette.map((n) => {
    const b = gameSet.byId.get(n);
    return n !== '' && !!b && !b.transparent && !b.model;
  });
  let solid = new Uint8Array(grid.data.length);
  for (let i = 0; i < solid.length; i++) solid[i] = opaquePal[grid.data[i]!] ? 1 : 0;

  for (let round = 0; round < thickness; round++) {
    const next = new Uint8Array(solid.length);
    for (let y = 1; y < sy - 1; y++) for (let z = 1; z < sz - 1; z++) for (let x = 1; x < sx - 1; x++) {
      const i = cellIndex(grid, x, y, z);
      if (solid[i] && solid[i - 1] && solid[i + 1] && solid[i - sx] && solid[i + sx] && solid[i - sx * sz] && solid[i + sx * sz]) next[i] = 1;
    }
    solid = next;
  }
  let removed = 0;
  for (let i = 0; i < solid.length; i++) if (solid[i]) { grid.data[i] = 0; removed++; }
  return removed;
}
