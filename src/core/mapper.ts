// Mapping rules: decides, for every Minecraft block state, which Spacebox block (or air) it becomes.
// Priority: explicit rules > shape rules (slabs, stairs, doors, ...) > colour match inside a category pool.
import { labDistance, rgbToLab, type Lab } from './color';
import type { GameSet, SpaceboxBlock } from './gameset';
import { mcFacts } from './mcdb';
import type { SourceState } from './minecraft';

export type ShapeAction = 'full' | 'drop';
export type SlabAction = 'full' | 'top-full' | 'bottom-full' | 'drop';
export type PaneAction = 'window' | 'full' | 'drop';
export type DoorAction = 'drop' | 'lower-full';

/** Spacebox categories the colour matcher may pick from, minus ids matching an exclude glob. */
export interface Pool { categories: string[]; exclude: string[] }

export interface MappingRule {
  /** Glob on the block id ("minecraft:*_planks") or on the id with states ("minecraft:*_stairs[half=top]"). */
  match: string;
  /** A full Spacebox id such as "default:iron_block_medium", or "air". */
  target: string;
}

export interface MappingProfile {
  name: string;
  description?: string;
  pools: { solid: Pool; glass: Pool; light: Pool };
  shapes: {
    slab: SlabAction; stair: ShapeAction; wall: ShapeAction; fence: ShapeAction;
    pane: PaneAction; door: DoorAction; decor: ShapeAction;
  };
  rules: MappingRule[];
  /** Crop box in source coordinates, inclusive. Missing sides mean "no limit". */
  crop?: { min?: (number | null | undefined)[]; max?: (number | null | undefined)[] };
  hollow: { enabled: boolean; thickness: number };
  /** Mirror the Z axis. Off by default; turn on if the converted ship looks mirrored in the game. */
  flipZ: boolean;
}

export interface Resolution { target: string | null; reason: string }

const EMISSIVE = /(sea_lantern|glowstone|shroomlight|froglight|redstone_lamp|jack_o_lantern|magma_block|end_rod)/;

export function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`);
}

interface CompiledMatch { idRe: RegExp; props: [string, string][] }

/** "minecraft:*_stairs[half=top]" = id glob plus the listed states, which may be a subset of the block's states. */
export function compileMatch(match: string): CompiledMatch {
  const i = match.indexOf('[');
  const props: [string, string][] = [];
  if (i >= 0) {
    for (const kv of match.slice(i + 1, match.endsWith(']') ? -1 : undefined).split(',')) {
      const [k, v] = kv.split('=');
      if (k) props.push([k.trim(), (v ?? '').trim()]);
    }
  }
  return { idRe: globToRegExp(i < 0 ? match : match.slice(0, i)), props };
}

export function matchesState(state: SourceState, m: CompiledMatch): boolean {
  return m.idRe.test(state.id) && m.props.every(([k, v]) => state.props[k] === v);
}

export function matchRule(state: SourceState, rule: MappingRule): boolean {
  return matchesState(state, compileMatch(rule.match));
}

export class Resolver {
  private lab = new Map<string, Lab>();
  private cache = new Map<string, Resolution>();
  private compiled: { m: CompiledMatch; target: string }[];

  constructor(private gameSet: GameSet, private profile: MappingProfile) {
    // Rules with more state filters win over broader ones; among equals, the earlier rule wins.
    this.compiled = profile.rules.map((r) => ({ m: compileMatch(r.match), target: r.target }))
      .sort((a, b) => b.m.props.length - a.m.props.length);
    for (const b of gameSet.blocks) if (b.color) this.lab.set(b.id, rgbToLab(b.color));
  }

  resolve(state: SourceState): Resolution {
    let r = this.cache.get(state.key);
    if (!r) { r = this.compute(state); this.cache.set(state.key, r); }
    return r;
  }

  private compute(state: SourceState): Resolution {
    if (/^minecraft:(cave_|void_)?air$/.test(state.id)) return { target: null, reason: 'air' };

    for (const rule of this.compiled) {
      if (matchesState(state, rule.m)) {
        if (rule.target === 'air') return { target: null, reason: 'rule: air' };
        if (!this.gameSet.byId.has(rule.target)) return { target: null, reason: `rule target not in GameSet: ${rule.target}` };
        return { target: rule.target, reason: 'rule' };
      }
    }

    // Opened .sbs files carry Spacebox ids already: keep them unless a rule above remapped them.
    if (this.gameSet.byId.has(state.id)) return { target: state.id, reason: 'already a Spacebox block' };

    const facts = mcFacts(state.id);
    if (!facts) return { target: null, reason: 'unknown block' };
    const { shapes } = this.profile;
    const kind = facts.kind.replace('minecraft:', '');
    const p = state.props;
    const cube = (why: string): Resolution => this.matchColor(state, facts.color, why);

    if (kind === 'slab') {
      if (p.type === 'double') return cube('double slab');
      const top = p.type === 'top';
      const act = shapes.slab;
      if (act === 'drop') return { target: null, reason: 'slab: drop' };
      if (act === 'full' || (act === 'top-full' && top) || (act === 'bottom-full' && !top)) return cube(`slab: ${act}`);
      return { target: null, reason: `slab: ${top ? 'top' : 'bottom'} dropped` };
    }
    if (kind === 'stair') return shapes.stair === 'full' ? cube('stair: full') : { target: null, reason: 'stair: drop' };
    if (kind === 'wall') return shapes.wall === 'full' ? cube('wall: full') : { target: null, reason: 'wall: drop' };
    if (kind === 'fence' || kind === 'fence_gate' || kind === 'iron_bars') {
      return shapes.fence === 'full' ? cube('fence: full') : { target: null, reason: 'fence/bars: drop' };
    }
    if (kind.includes('glass_pane') || kind === 'glass_pane') {
      if (shapes.pane === 'drop') return { target: null, reason: 'pane: drop' };
      return this.matchColor(state, facts.color, 'pane', 'glass');
    }
    if (kind === 'door') {
      if (shapes.door === 'drop' || p.half === 'upper') return { target: null, reason: p.half === 'upper' ? 'door: upper half' : 'door: drop' };
      return cube('door: lower half');
    }
    if (kind === 'trapdoor') return { target: null, reason: 'trapdoor: drop' };

    if (!facts.fullCube) return shapes.decor === 'full' ? cube('decor: full') : { target: null, reason: 'not a full cube: drop' };
    if (kind.includes('glass') || state.id.includes('glass')) return this.matchColor(state, facts.color, 'glass', 'glass');
    if (EMISSIVE.test(state.id)) return this.matchColor(state, facts.color, 'light', 'light');
    return cube('colour match');
  }

  private matchColor(state: SourceState, color: [number, number, number] | null, why: string, pool: 'solid' | 'glass' | 'light' = 'solid'): Resolution {
    const base = mcFacts(state.id)?.baseBlock;
    const col = color ?? (base ? mcFacts(base)?.color ?? null : null);
    if (!col) return { target: null, reason: 'no colour data' };
    const best = this.nearest(rgbToLab(col), pool);
    return best ? { target: best.id, reason: `${why} -> ${pool} pool` } : { target: null, reason: `empty ${pool} pool` };
  }

  candidates(pool: 'solid' | 'glass' | 'light'): SpaceboxBlock[] {
    const { categories, exclude } = this.profile.pools[pool];
    const ex = exclude.map(globToRegExp);
    return this.gameSet.blocks.filter((b) =>
      b.size[0] === 1 && b.size[1] === 1 && b.size[2] === 1 &&
      categories.includes(b.category) && b.color !== null && !ex.some((re) => re.test(b.localId)));
  }

  private nearest(lab: Lab, pool: 'solid' | 'glass' | 'light'): SpaceboxBlock | undefined {
    let best: SpaceboxBlock | undefined, bd = Infinity;
    for (const b of this.candidates(pool)) {
      const d = labDistance(lab, this.lab.get(b.id)!);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
}
