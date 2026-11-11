// Built-in mapping profiles. Users save and load their own as JSON (same shape as MappingProfile).
import type { MappingProfile } from './mapper';

/** Ships and stations: hull plating from MetalBlocks, glass from Windows, emitters from Lights. Never rocks, ores or bombs. */
export const SHIP_PROFILE: MappingProfile = {
  name: 'Spaceship / station',
  description: 'Structural blocks only: no rocks, ores, machines or explosives are picked automatically.',
  pools: {
    solid: { categories: ['MetalBlocks'], exclude: [] },
    glass: { categories: ['Windows'], exclude: [] },
    light: { categories: ['Lights'], exclude: [] },
  },
  shapes: { slab: 'full', stair: 'full', wall: 'full', fence: 'drop', pane: 'window', door: 'drop', decor: 'drop' },
  rules: [],
  hollow: { enabled: false, thickness: 1 },
  flipZ: false,
};

/** Asteroids and terrain: stone and dirt become the rocks and ice of Resources (ores stay out unless mapped by hand). */
export const ASTEROID_PROFILE: MappingProfile = {
  name: 'Asteroid / terrain',
  description: 'Stone, dirt and sand become rocks and ice from Resources.',
  pools: {
    solid: { categories: ['Resources'], exclude: ['*_ore'] },
    glass: { categories: ['Windows'], exclude: [] },
    light: { categories: ['Lights'], exclude: [] },
  },
  shapes: { slab: 'full', stair: 'full', wall: 'full', fence: 'drop', pane: 'window', door: 'drop', decor: 'drop' },
  rules: [],
  hollow: { enabled: true, thickness: 2 },
  flipZ: false,
};

export const BUILTIN_PROFILES: Record<string, MappingProfile> = { ship: SHIP_PROFILE, asteroid: ASTEROID_PROFILE };

export function cloneProfile(p: MappingProfile): MappingProfile { return JSON.parse(JSON.stringify(p)) as MappingProfile; }

export function serializeProfile(p: MappingProfile): string { return JSON.stringify(p, null, 2); }

/** Parses and validates a profile saved as JSON; missing fields fall back to the ship profile. */
export function parseProfile(text: string): MappingProfile {
  const raw = JSON.parse(text) as Partial<MappingProfile>;
  const base = cloneProfile(SHIP_PROFILE);
  return {
    ...base, ...raw,
    pools: { ...base.pools, ...raw.pools },
    shapes: { ...base.shapes, ...raw.shapes },
    rules: Array.isArray(raw.rules) ? raw.rules.filter((r) => typeof r?.match === 'string' && typeof r?.target === 'string') : [],
    hollow: { ...base.hollow, ...raw.hollow },
  };
}
