// Reads a Spacebox GameSet folder (Mods/GameSets/<Name>): block JSON files and their 32x32 textures.
// The files are read through a FileSource so the same code works with Node's fs and with a browser folder picker.
// Nothing from the GameSet is copied anywhere: colours are computed on the user's machine.
import { decode } from 'fast-png';

export interface FileSource {
  /** Every file below the GameSet root, as forward-slash relative paths. */
  list(): string[] | Promise<string[]>;
  read(path: string): Uint8Array | Promise<Uint8Array>;
}

export type RGB = [number, number, number];

export interface SpaceboxBlock {
  /** Full id as written in .sbs files, e.g. "default:iron_block_light". */
  id: string;
  localId: string;
  name: string;
  /** Folder path below Blocks/ without the block's own folder, e.g. "MetalBlocks" or "Ships/Thrusters". */
  category: string;
  size: [number, number, number];
  transparent: boolean;
  /** Uses a custom 3D model (for example the wall torch), so it is not a plain cube. */
  model?: string;
  type?: string;
  /** Average colour of the block's texture(s). */
  color: RGB | null;
  /** Texture file paths by face name, for the viewer. */
  textures: Record<string, string>;
  /** Source of the block's own JSON, relative to the GameSet root. */
  file: string;
}

export interface GameSet {
  modId: string;
  modName: string;
  version: string;
  blocks: SpaceboxBlock[];
  byId: Map<string, SpaceboxBlock>;
  categories: string[];
}

const NOT_ENTRY = new Set(['blueprint.json', 'recipes.json', 'order.json']);
const dec = new TextDecoder();

/** Spacebox accepts // and block comments and trailing commas in its JSON, so we do too. */
export function parseLooseJson(text: string): unknown {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inStr = false;
    } else if (c === '"') { inStr = true; out += c; }
    else if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; }
    else if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; }
    else out += c;
  }
  // Drop trailing commas outside strings.
  let res = '';
  inStr = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i]!;
    if (inStr) {
      res += c;
      if (c === '\\') res += out[++i] ?? '';
      else if (c === '"') inStr = false;
    } else if (c === '"') { inStr = true; res += c; }
    else if (c === ',') {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j]!)) j++;
      if (out[j] === '}' || out[j] === ']') continue;
      res += c;
    } else res += c;
  }
  return JSON.parse(res.replace(/^﻿/, ''));
}

/** Case-insensitive property lookup, because Spacebox treats "ID", "Id" and "id" alike. */
function prop(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const lk = key.toLowerCase();
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) if (k.toLowerCase() === lk) return v;
  return undefined;
}

export function averageColor(png: Uint8Array): RGB | null {
  const img = decode(png);
  const { width, height, channels, depth } = img;
  const data = img.data as ArrayLike<number>;
  const shift = depth === 16 ? 8 : 0;
  let r = 0, g = 0, b = 0, w = 0;
  const palette = (img as { palette?: number[][] }).palette;
  for (let i = 0; i < width * height; i++) {
    let pr: number, pg: number, pb: number, pa = 255;
    if (palette && channels === 1) {
      const p = palette[data[i]!] ?? [0, 0, 0];
      pr = p[0]!; pg = p[1]!; pb = p[2]!; pa = p[3] ?? 255;
    } else if (channels >= 3) {
      pr = data[i * channels]! >> shift; pg = data[i * channels + 1]! >> shift; pb = data[i * channels + 2]! >> shift;
      if (channels === 4) pa = data[i * channels + 3]! >> shift;
    } else {
      pr = pg = pb = data[i * channels]! >> shift;
      if (channels === 2) pa = data[i * channels + 1]! >> shift;
    }
    r += pr * pa; g += pg * pa; b += pb * pa; w += pa;
  }
  return w === 0 ? null : [Math.round(r / w), Math.round(g / w), Math.round(b / w)];
}

export async function loadGameSet(src: FileSource): Promise<GameSet> {
  const files = (await src.list()).map((f) => f.replace(/\\/g, '/'));
  const fileSet = new Set(files);
  if (!fileSet.has('config.json')) {
    throw new Error('config.json not found: pick the GameSet folder itself (for example Mods/GameSets/Default)');
  }
  const config = parseLooseJson(dec.decode(await src.read('config.json')));
  const modId = String(prop(config, 'ModId') ?? 'default');
  const modName = String(prop(config, 'ModName') ?? modId);
  const version = String(prop(config, 'Version') ?? '');

  const blockFiles = files.filter((f) => f.startsWith('Blocks/') && !f.split('/').some((p) => p.startsWith('_')));

  // Texture name (file name without extension) -> path. Later files win, as in the game.
  const textureByName = new Map<string, string>();
  for (const f of blockFiles) if (/\.(png|jpe?g)$/i.test(f)) textureByName.set(f.slice(f.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''), f);

  const colorCache = new Map<string, RGB | null>();
  const textureColor = async (name: string): Promise<RGB | null> => {
    if (colorCache.has(name)) return colorCache.get(name)!;
    const path = textureByName.get(name);
    let c: RGB | null = null;
    if (path && /\.png$/i.test(path)) {
      try { c = averageColor(await src.read(path)); } catch { c = null; }
    }
    colorCache.set(name, c);
    return c;
  };

  const blocks: SpaceboxBlock[] = [];
  for (const f of blockFiles) {
    if (!f.endsWith('.json')) continue;
    const parts = f.split('/');
    const fileName = parts[parts.length - 1]!;
    const folder = parts[parts.length - 2]!;
    if (NOT_ENTRY.has(fileName.toLowerCase())) continue;
    if (fileName !== `${folder}.json` && fileName.toLowerCase() !== 'block.json') continue;
    let json: unknown;
    try { json = parseLooseJson(dec.decode(await src.read(f))); } catch { continue; }
    const localId = String(prop(json, 'ID') ?? folder);

    const faces: Record<string, string> = {};
    const active = prop(prop(json, 'Textures'), 'Active');
    if (active && typeof active === 'object') {
      for (const [k, v] of Object.entries(active as Record<string, unknown>)) if (typeof v === 'string') faces[k] = v;
    }
    const names = faces.All ? [faces.All] : Object.values(faces);
    const cols: RGB[] = [];
    for (const n of names) { const c = await textureColor(n); if (c) cols.push(c); }
    const color: RGB | null = cols.length
      ? [0, 1, 2].map((k) => Math.round(cols.reduce((s, c) => s + c[k]!, 0) / cols.length)) as RGB
      : null;
    const texPaths: Record<string, string> = {};
    for (const [face, n] of Object.entries(faces)) { const p = textureByName.get(n); if (p) texPaths[face] = p; }

    const sz = prop(json, 'Size');
    const size: [number, number, number] = [
      Number(prop(sz, 'X') ?? 1) || 1, Number(prop(sz, 'Y') ?? 1) || 1, Number(prop(sz, 'Z') ?? 1) || 1,
    ];
    const model = prop(json, 'Model');
    const type = prop(json, 'Type');
    blocks.push({
      id: `${modId}:${localId}`,
      localId,
      name: String(prop(json, 'Name') ?? localId),
      category: parts.slice(1, -2).join('/') || parts[1]!,
      size,
      transparent: prop(json, 'IsTransparent') === true,
      model: typeof model === 'string' ? model : undefined,
      type: typeof type === 'string' ? type : undefined,
      color,
      textures: texPaths,
      file: f,
    });
  }

  blocks.sort((a, b) => a.category.localeCompare(b.category) || a.localId.localeCompare(b.localId));
  return {
    modId, modName, version, blocks,
    byId: new Map(blocks.map((b) => [b.id, b])),
    categories: [...new Set(blocks.map((b) => b.category))],
  };
}
