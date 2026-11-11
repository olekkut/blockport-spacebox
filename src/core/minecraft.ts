// Loads Minecraft structure files through the Nucleation WASM engine (MIT, https://github.com/Schem-at/Nucleation).
// Nucleation reads .schem (Sponge v2/v3), .litematic, .schematic, .mcstructure and vanilla structure .nbt.
import { Schematic } from 'nucleation';

export interface SourceState {
  /** "minecraft:oak_stairs" */
  id: string;
  props: Record<string, string>;
  /** "minecraft:oak_stairs[facing=north,half=bottom]" */
  key: string;
}

/** Cells hold palette indexes; index 0 is air. */
export interface SourceGrid {
  size: [number, number, number];
  palette: SourceState[];
  data: Uint16Array;
  /** Only for opened .sbs files: per-cell orientation (see VoxelGrid.orient) and multi-block offsets, same cell indexes as `data`. */
  orient?: Uint8Array;
  offsets?: Map<number, number>;
}

export function stateKey(id: string, props: Record<string, string>): string {
  const keys = Object.keys(props).sort();
  return keys.length ? `${id}[${keys.map((k) => `${k}=${props[k]}`).join(',')}]` : id;
}

export function parseStateKey(key: string): SourceState {
  const i = key.indexOf('[');
  const id = i < 0 ? key : key.slice(0, i);
  const props: Record<string, string> = {};
  if (i >= 0) for (const kv of key.slice(i + 1, -1).split(',')) { const [k, v] = kv.split('='); if (k) props[k] = v ?? ''; }
  return { id, props, key };
}

export type McFormat = 'schem' | 'litematic' | 'schematic' | 'mcstructure' | 'nbt';

export function detectFormat(fileName: string): McFormat {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'litematic' || ext === 'schematic' || ext === 'mcstructure' || ext === 'nbt') return ext;
  return 'schem';
}

export function loadMinecraft(bytes: Uint8Array, fileName: string): SourceGrid {
  const arr = Array.from(bytes);
  const fmt = detectFormat(fileName);
  const s = fmt === 'litematic' ? Schematic.fromLitematic(arr)
    : fmt === 'schematic' ? Schematic.fromSchematic(arr)
    : fmt === 'mcstructure' ? Schematic.fromMcstructure(arr)
    : Schematic.fromData(arr);

  if (s.blockCount() === 0) return { size: [1, 1, 1], palette: [{ id: 'minecraft:air', props: {}, key: 'minecraft:air' }], data: new Uint16Array(1) };

  const lo = s.tightBoundsMin(), hi = s.tightBoundsMax();
  const ox = lo.x, oy = lo.y, oz = lo.z;
  const sx = hi.x - lo.x + 1, sy = hi.y - lo.y + 1, sz = hi.z - lo.z + 1;
  const blocks = JSON.parse(s.getNonAirBlocksJson()) as { name: string; properties?: [string, string][]; x: number; y: number; z: number }[];

  const palette: SourceState[] = [{ id: 'minecraft:air', props: {}, key: 'minecraft:air' }];
  const index = new Map<string, number>();
  const data = new Uint16Array(sx * sy * sz);
  for (const b of blocks) {
    const props: Record<string, string> = {};
    for (const [k, v] of b.properties ?? []) props[k] = v;
    const key = stateKey(b.name, props);
    let pi = index.get(key);
    if (pi === undefined) {
      pi = palette.length;
      if (pi > 65535) throw new Error('Too many distinct block states');
      palette.push({ id: b.name, props, key });
      index.set(key, pi);
    }
    data[((b.y - oy) * sz + (b.z - oz)) * sx + (b.x - ox)] = pi;
  }
  return { size: [sx, sy, sz], palette, data };
}
