// Spacebox structure (.sbs) reader and writer. The file is GZIP-compressed NBT in the chunked layout:
// root { format, id, name, author, description, game_version, created, blocks, bounds, gamesets, picture,
//        entity { chunks: [ { index_x/y/z, blocks[32768], palette_blocks, palette_items, directions,
//                             rotations, multiblock_offsets, storages } ] } }
// Chunks are 32x32x32 and cell flat index = lx * 1024 + ly * 32 + lz. Air is the block named "<gameset>:void",
// which may sit at any palette index. `bounds` is [min, max + 1] per axis.
import { Tag, comp, get, list, nbt, num, readNbt, str, writeNbt, type NbtCompound, type NbtValue } from './nbt';
import { cellIndex, createGrid, encodeOrient, paletteIndex, type VoxelGrid, type Vec3 } from './grid';

export const CHUNK = 32;

export interface SbsMeta {
  id: string;
  name: string;
  author: string;
  description: string;
  gameVersion: string;
  created: string;
  gamesets: string[];
  /** Block count stored in the file. */
  blocks: number;
  /** [minX, minY, minZ, maxX, maxY, maxZ] as stored in the file. */
  bounds: number[];
  /** JPEG thumbnail, if present. */
  picture?: Uint8Array;
}

export interface SbsFile { meta: SbsMeta; grid: VoxelGrid }

function isVoid(name: string): boolean {
  const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
  return local === 'void' || local === 'air';
}

function strList(v: NbtValue | undefined): string[] {
  return (list(v)?.value ?? []).map((x) => str(x) ?? '');
}

function intArray(v: NbtValue | undefined): Int32Array {
  return v?.type === Tag.IntArray ? v.value : new Int32Array(0);
}

interface RawCell { x: number; y: number; z: number; name: string; dir: number; rot: number; offset?: number }

export function readSbs(bytes: Uint8Array): SbsFile {
  const root = readNbt(bytes).value;
  if (num(get(root, 'format')) !== 1) throw new Error("Not a Spacebox structure: 'format' must be 1");
  const chunks = list(get(comp(get(root, 'entity')), 'chunks'));
  if (!chunks) throw new Error("Not a Spacebox structure: missing 'entity.chunks'");

  const cells: RawCell[] = [];
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const cv of chunks.value) {
    const c = comp(cv);
    if (!c) continue;
    const cx = num(get(c, 'index_x')) ?? 0, cy = num(get(c, 'index_y')) ?? 0, cz = num(get(c, 'index_z')) ?? 0;
    const blocksTag = get(c, 'blocks');
    if (blocksTag?.type !== Tag.ByteArray) continue;
    const blocks = blocksTag.value;
    const names = strList(get(c, 'palette_blocks'));
    const dirs = new Map<number, number>(), rots = new Map<number, number>(), offs = new Map<number, number>();
    const d = intArray(get(c, 'directions')), r = intArray(get(c, 'rotations')), o = intArray(get(c, 'multiblock_offsets'));
    for (let i = 0; i + 1 < d.length; i += 2) dirs.set(d[i]!, d[i + 1]!);
    for (let i = 0; i + 1 < r.length; i += 2) rots.set(r[i]!, r[i + 1]!);
    for (let i = 0; i + 1 < o.length; i += 2) offs.set(o[i]!, o[i + 1]!);

    for (let idx = 0; idx < blocks.length; idx++) {
      // Palette index 0 is not always void (asteroid.sbs puts a rock there), so decide by name only.
      const pi = blocks[idx]! & 0xff;
      const name = names[pi];
      if (name === undefined || isVoid(name)) continue;
      const x = cx * CHUNK + Math.floor(idx / 1024), y = cy * CHUNK + (Math.floor(idx / 32) % 32), z = cz * CHUNK + (idx % 32);
      cells.push({ x, y, z, name, dir: dirs.get(idx) ?? -1, rot: rots.get(idx) ?? 0, offset: offs.get(idx) });
      if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
    }
  }

  if (cells.length === 0) { min = [0, 0, 0]; max = [0, 0, 0]; }
  const grid = createGrid(min, [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1]);
  for (const cell of cells) {
    const i = cellIndex(grid, cell.x - min[0], cell.y - min[1], cell.z - min[2]);
    grid.data[i] = paletteIndex(grid, cell.name);
    if (cell.dir >= 0) grid.orient[i] = encodeOrient(cell.dir, cell.rot);
    if (cell.offset !== undefined) grid.offsets.set(i, cell.offset);
  }

  const pic = get(root, 'picture');
  const meta: SbsMeta = {
    id: str(get(root, 'id')) ?? 'structure',
    name: str(get(root, 'name')) ?? 'Structure',
    author: str(get(root, 'author')) ?? '',
    description: str(get(root, 'description')) ?? '',
    gameVersion: str(get(root, 'game_version')) ?? '',
    created: str(get(root, 'created')) ?? '',
    gamesets: strList(get(root, 'gamesets')),
    blocks: num(get(root, 'blocks')) ?? cells.length,
    bounds: Array.from(intArray(get(root, 'bounds'))),
    picture: pic?.type === Tag.ByteArray ? new Uint8Array(pic.value.buffer.slice(pic.value.byteOffset, pic.value.byteOffset + pic.value.byteLength)) : undefined,
  };
  return { meta, grid };
}

/** Number of 32x32x32 chunks the grid's blocks occupy, as written to the file. */
export function chunkCount(grid: VoxelGrid): number {
  const keys = new Set<string>();
  const [sx, sy, sz] = grid.size;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    if (grid.data[cellIndex(grid, x, y, z)] === 0) continue;
    keys.add(`${Math.floor((grid.min[0] + x) / CHUNK)},${Math.floor((grid.min[1] + y) / CHUNK)},${Math.floor((grid.min[2] + z) / CHUNK)}`);
  }
  return keys.size;
}

export interface WriteOptions {
  id?: string;
  name?: string;
  author?: string;
  description?: string;
  gameVersion?: string;
  gamesets?: string[];
  /** Namespace used for the void entry that opens every chunk palette. */
  voidName?: string;
  created?: string;
  picture?: Uint8Array;
}

/** Writes the grid as a real Spacebox structure. Blocks must be full names such as "default:iron_block_light". */
export function writeSbs(grid: VoxelGrid, opts: WriteOptions = {}): Uint8Array {
  const voidName = opts.voidName ?? 'default:void';
  const byChunk = new Map<string, { cx: number; cy: number; cz: number; cells: number[] }>();
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let count = 0;

  const [sx, sy, sz] = grid.size;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const i = cellIndex(grid, x, y, z);
    if (grid.data[i] === 0) continue;
    const wx = grid.min[0] + x, wy = grid.min[1] + y, wz = grid.min[2] + z;
    const cx = Math.floor(wx / CHUNK), cy = Math.floor(wy / CHUNK), cz = Math.floor(wz / CHUNK);
    if (cx < -128 || cx > 127 || cy < -128 || cy > 127 || cz < -128 || cz > 127) throw new Error('Structure is too large for .sbs chunk indices');
    const key = `${cx},${cy},${cz}`;
    let ch = byChunk.get(key);
    if (!ch) { ch = { cx, cy, cz, cells: [] }; byChunk.set(key, ch); }
    ch.cells.push(i);
    count++;
    if (wx < min[0]) min[0] = wx; if (wy < min[1]) min[1] = wy; if (wz < min[2]) min[2] = wz;
    if (wx > max[0]) max[0] = wx; if (wy > max[1]) max[1] = wy; if (wz > max[2]) max[2] = wz;
  }
  if (count === 0) { min = [0, 0, 0]; max = [0, 0, 0]; }

  const chunkTags: NbtValue[] = [];
  for (const ch of [...byChunk.values()].sort((a, b) => a.cx - b.cx || a.cy - b.cy || a.cz - b.cz)) {
    const palette = [voidName];
    const blocks = new Int8Array(CHUNK * CHUNK * CHUNK);
    const dirs: number[] = [], rots: number[] = [], offs: number[] = [];
    for (const i of ch.cells) {
      const name = grid.palette[grid.data[i]!]!;
      let pi = palette.indexOf(name);
      if (pi < 0) {
        if (palette.length >= 256) throw new Error('More than 255 distinct blocks in one chunk');
        pi = palette.length; palette.push(name);
      }
      const lx = i % sx, lz = Math.floor(i / sx) % sz, ly = Math.floor(i / (sx * sz));
      const flat = (grid.min[0] + lx - ch.cx * CHUNK) * 1024 + (grid.min[1] + ly - ch.cy * CHUNK) * 32 + (grid.min[2] + lz - ch.cz * CHUNK);
      blocks[flat] = pi;
      const o = grid.orient[i]!;
      if (o !== 0) { dirs.push(flat, Math.floor((o - 1) / 4)); rots.push(flat, (o - 1) % 4); }
      const off = grid.offsets.get(i);
      if (off !== undefined) offs.push(flat, off);
    }
    const entries: Record<string, NbtValue> = {
      index_x: nbt.byte(ch.cx), index_y: nbt.byte(ch.cy), index_z: nbt.byte(ch.cz),
      blocks: nbt.byteArray(blocks),
      palette_blocks: nbt.list(Tag.String, palette.map(nbt.string)),
      palette_items: nbt.list(Tag.String, []),
      directions: nbt.intArray(Int32Array.from(dirs)),
      rotations: nbt.intArray(Int32Array.from(rots)),
    };
    if (offs.length) entries.multiblock_offsets = nbt.intArray(Int32Array.from(offs));
    entries.storages = nbt.list(Tag.Compound, []);
    chunkTags.push(nbt.compound(entries));
  }

  const rootEntries: Record<string, NbtValue> = {
    format: nbt.int(1),
    id: nbt.string(opts.id ?? 'structure'),
    name: nbt.string(opts.name ?? 'Structure'),
    author: nbt.string(opts.author ?? ''),
    description: nbt.string(opts.description ?? ''),
    game_version: nbt.string(opts.gameVersion ?? '0.1.5.1'),
    created: nbt.string(opts.created ?? new Date().toISOString()),
    blocks: nbt.int(count),
    // The game stores the exclusive upper corner (ship.sbs: cells reach x=3, bounds say 4).
    bounds: nbt.intArray(Int32Array.from([...min, max[0] + 1, max[1] + 1, max[2] + 1])),
    gamesets: nbt.list(Tag.String, (opts.gamesets ?? ['default']).map(nbt.string)),
  };
  if (opts.picture) rootEntries.picture = nbt.byteArray(new Int8Array(opts.picture.buffer, opts.picture.byteOffset, opts.picture.byteLength));
  rootEntries.entity = nbt.compound({ chunks: nbt.list(Tag.Compound, chunkTags) });
  const root: NbtCompound = nbt.compound(rootEntries);
  return writeNbt({ name: 'ship', value: root });
}
