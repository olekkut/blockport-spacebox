import { describe, expect, it } from 'vitest';
import { Tag, nbt, readNbt, writeNbt } from '../src/core/nbt';
import { countBlocks, createGrid, cellIndex, paletteIndex, trimGrid } from '../src/core/grid';
import { readSbs, writeSbs } from '../src/core/sbs';
import { parseLooseJson, type GameSet, type SpaceboxBlock } from '../src/core/gameset';
import { convert, hollowOut } from '../src/core/convert';
import { parseStateKey, type SourceGrid } from '../src/core/minecraft';
import { SHIP_PROFILE, cloneProfile, parseProfile, serializeProfile } from '../src/core/profiles';
import { Resolver, globToRegExp } from '../src/core/mapper';
import { labDistance, rgbToLab } from '../src/core/color';

function block(localId: string, category: string, color: [number, number, number], extra: Partial<SpaceboxBlock> = {}): SpaceboxBlock {
  return { id: `default:${localId}`, localId, name: localId, category, size: [1, 1, 1], transparent: false, color, textures: {}, file: '', ...extra };
}
function fakeGameSet(): GameSet {
  const blocks = [
    block('metal_dark', 'MetalBlocks', [60, 60, 66]),
    block('metal_light', 'MetalBlocks', [190, 190, 196]),
    block('window', 'Windows', [200, 230, 255], { transparent: true }),
    block('lamp', 'Lights', [255, 255, 255], { model: 'torch' }),
    block('big_thruster', 'Ships/Thrusters', [90, 90, 90], { size: [2, 2, 2] }),
    block('granite', 'Resources', [150, 120, 110]),
    block('iron_ore', 'Resources', [150, 120, 110]),
  ];
  return { modId: 'default', modName: 'Default', version: '0.1.5.1', blocks, byId: new Map(blocks.map((b) => [b.id, b])), categories: [...new Set(blocks.map((b) => b.category))] };
}
function source(entries: Record<string, string>, size: [number, number, number]): SourceGrid {
  const palette = [parseStateKey('minecraft:air')];
  const data = new Uint16Array(size[0] * size[1] * size[2]);
  for (const [pos, key] of Object.entries(entries)) {
    const [x, y, z] = pos.split(',').map(Number) as [number, number, number];
    let i = palette.findIndex((p) => p.key === key);
    if (i < 0) { i = palette.length; palette.push(parseStateKey(key)); }
    data[((y * size[2]) + z) * size[0] + x] = i;
  }
  return { size, palette, data };
}

describe('nbt', () => {
  it('round-trips every tag type, gzip and big-endian', () => {
    const root = nbt.compound({
      b: nbt.byte(-5), s: nbt.short(-300), i: nbt.int(123456), l: nbt.long(-(2n ** 40n)), f: nbt.float(1.5), str: nbt.string('héllo'),
      ba: nbt.byteArray(Int8Array.from([1, -2, 3])), ia: nbt.intArray(Int32Array.from([1, -2, 3])),
      list: nbt.list(Tag.String, [nbt.string('a'), nbt.string('b')]), empty: nbt.list(Tag.Compound, []),
      c: nbt.compound({ inner: nbt.int(7) }),
    });
    const back = readNbt(writeNbt({ name: 'x', value: root }));
    expect(back.name).toBe('x');
    expect(back.value.value.get('l')).toEqual({ type: Tag.Long, value: -(2n ** 40n) });
    expect(back.value.value.get('str')).toEqual({ type: Tag.String, value: 'héllo' });
    expect(Array.from((back.value.value.get('ba') as { value: Int8Array }).value)).toEqual([1, -2, 3]);
    expect((back.value.value.get('list') as { value: unknown[] }).value).toHaveLength(2);
  });
  it('rejects truncated data', () => {
    const bytes = writeNbt({ name: '', value: nbt.compound({ a: nbt.intArray(new Int32Array(100)) }) }, { gzip: false });
    expect(() => readNbt(bytes.slice(0, 20))).toThrow();
  });
});

describe('.sbs writer and reader', () => {
  it('keeps blocks, orientation, multi-block offsets and negative coordinates', () => {
    const g = createGrid([-40, -3, 30], [50, 5, 40]);
    const a = paletteIndex(g, 'default:metal_dark'), b = paletteIndex(g, 'default:window');
    const spots: [number, number, number][] = [[0, 0, 0], [49, 4, 39], [10, 2, 33], [41, 1, 2]];
    spots.forEach((p, n) => { g.data[cellIndex(g, ...p)] = n % 2 ? a : b; });
    g.orient[cellIndex(g, 10, 2, 33)] = 1 + 3 * 4 + 2;
    g.offsets.set(cellIndex(g, 41, 1, 2), 273);
    const back = readSbs(writeSbs(g, { id: 't', name: 'T' }));
    expect(countBlocks(back.grid)).toBe(4);
    expect(back.meta.blocks).toBe(4);
    expect(back.meta.bounds).toEqual([...back.grid.min, ...back.grid.min.map((m, i) => m + back.grid.size[i]!)]);
    const at = (x: number, y: number, z: number) => back.grid.palette[back.grid.data[cellIndex(back.grid, x - back.grid.min[0], y - back.grid.min[1], z - back.grid.min[2])]!];
    expect(at(-40, -3, 30)).toBe('default:window');
    expect(at(-30, -1, 63)).toBe('default:window');
    expect(back.grid.orient[cellIndex(back.grid, -30 - back.grid.min[0], -1 - back.grid.min[1], 63 - back.grid.min[2])]).toBe(15);
    expect([...back.grid.offsets.values()]).toEqual([273]);
  });
  it('treats void at any palette index as air', () => {
    const g = createGrid([0, 0, 0], [2, 1, 1]);
    g.data[0] = paletteIndex(g, 'default:metal_dark');
    expect(countBlocks(readSbs(writeSbs(g)).grid)).toBe(1);
  });
  it('rejects non-structure data', () => {
    expect(() => readSbs(writeNbt({ name: '', value: nbt.compound({ format: nbt.int(2) }) }))).toThrow();
  });
});

describe('GameSet JSON', () => {
  it('accepts comments and trailing commas like the game does', () => {
    expect(parseLooseJson('{ // c\n "ID": "a/b", /* x */ "n": [1,2,], }')).toEqual({ ID: 'a/b', n: [1, 2] });
  });
});

describe('demo block list', () => {
  it('has the categories the built-in profiles use and converts without a GameSet folder', async () => {
    const { fallbackGameSet } = await import('../src/core/fallback');
    const gs = fallbackGameSet();
    for (const cat of ['MetalBlocks', 'Windows', 'Lights', 'Resources']) expect(gs.categories).toContain(cat);
    expect(gs.blocks.filter((b) => b.category === 'MetalBlocks')).toHaveLength(9);
    expect(gs.blocks.every((b) => b.color !== null && b.localId !== '')).toBe(true);
    expect(gs.byId.get('default:thruster_ion')?.size).toEqual([2, 2, 2]);
    expect(gs.byId.get('default:cobalt_power_block')?.size).toEqual([1, 2, 1]);
    // only 1x1x1 blocks may be picked automatically
    expect(gs.blocks.filter((b) => ['MetalBlocks', 'Windows', 'Lights', 'Resources'].includes(b.category)).every((b) => b.size.join() === '1,1,1')).toBe(true);
    const src = source({ '0,0,0': 'minecraft:stone', '1,0,0': 'minecraft:glass', '2,0,0': 'minecraft:short_grass' }, [3, 1, 1]);
    const { report } = convert(src, gs, cloneProfile(SHIP_PROFILE));
    expect(report.outputBlocks).toBe(2);
    expect(Object.keys(report.targets).every((id) => gs.byId.has(id))).toBe(true);
  });
});

describe('colour', () => {
  it('keeps greys close and a grey far from blue', () => {
    const g1 = rgbToLab([120, 120, 120]), g2 = rgbToLab([130, 130, 130]), blue = rgbToLab([30, 60, 200]);
    expect(labDistance(g1, g2)).toBeLessThan(5);
    expect(labDistance(g1, blue)).toBeGreaterThan(30);
  });
});

describe('mapping', () => {
  const gs = fakeGameSet();
  const profile = cloneProfile(SHIP_PROFILE);
  const res = (key: string, p = profile) => new Resolver(gs, p).resolve(parseStateKey(key));

  it('maps full cubes into the allowed category only', () => {
    const r = res('minecraft:stone');
    expect(['default:metal_dark', 'default:metal_light']).toContain(r.target);
  });
  it('sends glass to Windows and never auto-picks resources', () => {
    expect(res('minecraft:glass').target).toBe('default:window');
    for (const id of ['minecraft:stone', 'minecraft:dirt', 'minecraft:cyan_terracotta']) expect(res(id).target).not.toMatch(/granite|ore/);
  });
  it('drops non-cube decoration instead of turning it into hull', () => {
    for (const id of ['minecraft:short_grass', 'minecraft:oak_button[face=wall,facing=north,powered=false]', 'minecraft:gray_carpet', 'minecraft:torch', 'minecraft:water']) {
      expect(res(id).target, id).toBeNull();
    }
  });
  it('never picks multi-block or model blocks automatically', () => {
    const pool = new Resolver(gs, profile);
    expect(pool.candidates('solid').every((b) => b.size.join() === '1,1,1')).toBe(true);
  });
  it('applies slab rules by half', () => {
    const top = 'minecraft:stone_slab[type=top,waterlogged=false]', bottom = 'minecraft:stone_slab[type=bottom,waterlogged=false]', dbl = 'minecraft:stone_slab[type=double,waterlogged=false]';
    const p = cloneProfile(profile);
    p.shapes.slab = 'top-full';
    expect(res(top, p).target).not.toBeNull();
    expect(res(bottom, p).target).toBeNull();
    expect(res(dbl, p).target).not.toBeNull();
    p.shapes.slab = 'drop';
    expect(res(top, p).target).toBeNull();
    expect(res(dbl, p).target).not.toBeNull();
  });
  it('keeps only the lower half of a door when asked', () => {
    const p = cloneProfile(profile);
    p.shapes.door = 'lower-full';
    expect(res('minecraft:iron_door[half=lower,facing=north,hinge=left,open=false,powered=false]', p).target).not.toBeNull();
    expect(res('minecraft:iron_door[half=upper,facing=north,hinge=left,open=false,powered=false]', p).target).toBeNull();
  });
  it('explicit rules beat shape rules and support state matching', () => {
    const p = cloneProfile(profile);
    p.rules = [{ match: 'minecraft:*_stairs[half=top]', target: 'air' }, { match: 'minecraft:stone*', target: 'default:metal_light' }];
    expect(res('minecraft:stone_stairs[facing=north,half=top,shape=straight,waterlogged=false]', p).target).toBeNull();
    expect(res('minecraft:stone_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]', p).target).toBe('default:metal_light');
    expect(res('minecraft:stone', p).target).toBe('default:metal_light');
  });
  it('a rule with state filters beats a broader rule even when listed after it', () => {
    const p = cloneProfile(profile);
    p.rules = [
      { match: 'minecraft:stone_slab', target: 'default:metal_dark' },
      { match: 'minecraft:stone_slab[type=top]', target: 'default:metal_light' },
    ];
    expect(res('minecraft:stone_slab[type=top,waterlogged=false]', p).target).toBe('default:metal_light');
    expect(res('minecraft:stone_slab[type=bottom,waterlogged=false]', p).target).toBe('default:metal_dark');
  });
  it('reports an unknown rule target instead of writing it', () => {
    const p = cloneProfile(profile);
    p.rules = [{ match: 'minecraft:stone', target: 'default:does_not_exist' }];
    expect(res('minecraft:stone', p).target).toBeNull();
  });
  it('globs match whole ids', () => {
    expect(globToRegExp('minecraft:*_planks').test('minecraft:oak_planks')).toBe(true);
    expect(globToRegExp('minecraft:*_planks').test('minecraft:oak_planks_extra')).toBe(false);
  });
  it('profiles survive a JSON round trip and fill missing fields', () => {
    const p = cloneProfile(profile);
    p.rules.push({ match: 'minecraft:dirt', target: 'air' });
    expect(parseProfile(serializeProfile(p))).toEqual(p);
    expect(parseProfile('{"name":"x"}').shapes.slab).toBe('full');
  });
});

describe('convert', () => {
  const gs = fakeGameSet();
  it('crops, drops decor, and reports what happened', () => {
    const src = source({ '0,0,0': 'minecraft:grass_block', '1,1,0': 'minecraft:stone', '2,1,0': 'minecraft:short_grass', '0,1,1': 'minecraft:glass' }, [3, 2, 2]);
    const p = cloneProfile(SHIP_PROFILE);
    p.crop = { min: [null, 1, null] };
    const { grid, report } = convert(src, gs, p);
    expect(report.inputBlocks).toBe(4);
    expect(report.croppedBlocks).toBe(3);
    expect(report.outputBlocks).toBe(2);
    expect(countBlocks(grid)).toBe(2);
    expect(report.states.find((s) => s.key === 'minecraft:short_grass')?.target).toBeNull();
  });
  it('hollowing keeps a shell of the requested thickness and ignores glass', () => {
    const g = createGrid([0, 0, 0], [7, 7, 7]);
    const solid = paletteIndex(g, 'default:metal_dark');
    g.data.fill(solid);
    const total = 7 * 7 * 7;
    const g1 = trimGrid(g);
    expect(hollowOut(g1, gs, 1)).toBe(5 * 5 * 5);
    expect(countBlocks(g1)).toBe(total - 125);
    const g2 = createGrid([0, 0, 0], [7, 7, 7]);
    g2.data.fill(paletteIndex(g2, 'default:metal_dark'));
    expect(hollowOut(g2, gs, 2)).toBe(3 * 3 * 3);
    const glass = createGrid([0, 0, 0], [5, 5, 5]);
    glass.data.fill(paletteIndex(glass, 'default:window'));
    expect(hollowOut(glass, gs, 1)).toBe(0);
  });
  it('mirrors Z only when asked', () => {
    const src = source({ '0,0,0': 'minecraft:stone', '0,0,2': 'minecraft:glass' }, [1, 1, 3]);
    const at = (flip: boolean) => {
      const p = cloneProfile(SHIP_PROFILE); p.flipZ = flip;
      const { grid } = convert(src, gs, p);
      return grid.palette[grid.data[cellIndex(grid, 0, 0, 0)]!];
    };
    expect(at(false)).not.toBe(at(true));
  });
});

describe('orientation and multi-block footprints', () => {
  it('footprint and anchor are inverse for every orientation', async () => {
    const { footprint, anchorFromCell, anchorForBox, worldExtent } = await import('../src/core/orientation');
    for (let dir = 0; dir < 6; dir++) for (let rot = 0; rot < 4; rot++) {
      const size: [number, number, number] = [2, 3, 1];
      const anchor: [number, number, number] = [5, -2, 7];
      const cells = footprint(anchor, size, dir, rot);
      expect(new Set(cells.map((c) => c.pos.join())).size).toBe(6);
      for (const c of cells) expect(anchorFromCell(c.pos, c.offset, dir, rot)).toEqual(anchor);
      const ext = worldExtent(size, dir, rot);
      const min = [0, 1, 2].map((a) => Math.min(...cells.map((c) => c.pos[a]!))) as [number, number, number];
      expect(ext).toEqual([0, 1, 2].map((a) => Math.max(...cells.map((c) => c.pos[a]!)) - min[a]! + 1));
      expect(anchorForBox(min, size, dir, rot)).toEqual(anchor);
    }
  });
  it('matches the multi-block layout seen in ship.sbs (nuclear block, dir 0 rot 2)', async () => {
    const { footprint } = await import('../src/core/orientation');
    const cells = footprint([1, 3, -8], [2, 2, 2], 0, 2);
    const at = (p: [number, number, number]) => cells.find((c) => c.pos.join() === p.join())?.offset;
    expect(at([0, 2, -9])).toBe(273);
    expect(at([1, 2, -9])).toBe(272);
    expect(at([0, 2, -8])).toBe(257);
    expect(at([1, 2, -8])).toBe(256);
  });
});

describe('manual edits', () => {
  const sizes: Record<string, [number, number, number]> = { 'default:big': [2, 2, 2] };
  const sizeOf = (id: string): [number, number, number] => sizes[id] ?? [1, 1, 1];
  const base = () => {
    const g = createGrid([0, 0, 0], [3, 3, 3]);
    g.data[cellIndex(g, 1, 1, 1)] = paletteIndex(g, 'default:metal_dark');
    return g;
  };
  it('places a single block outside the grid and erases it again', async () => {
    const { applyEdits } = await import('../src/core/edits');
    const g = applyEdits(base(), [{ type: 'place', pos: [5, 1, 1], blockId: 'default:lamp', direction: 4, rotation: 0 }], sizeOf);
    expect(countBlocks(g)).toBe(2);
    expect(g.size[0]).toBe(5);
    expect(countBlocks(applyEdits(g, [{ type: 'erase', pos: [5, 1, 1] }], sizeOf))).toBe(1);
  });
  it('places a multi-block with offsets and erases all of it from any cell', async () => {
    const { applyEdits } = await import('../src/core/edits');
    const { readSbs, writeSbs } = await import('../src/core/sbs');
    const placed = applyEdits(base(), [{ type: 'place', pos: [3, 0, 0], blockId: 'default:big', direction: 5, rotation: 0 }], sizeOf);
    expect(countBlocks(placed)).toBe(9);
    expect(placed.offsets.size).toBe(7);
    // survives writing and reading
    expect(countBlocks(readSbs(writeSbs(placed)).grid)).toBe(9);
    const lastCell: [number, number, number] = [4, 1, 1];
    expect(countBlocks(applyEdits(placed, [{ type: 'erase', pos: lastCell }], sizeOf))).toBe(1);
  });
  it('replaces existing blocks without leaving half a multi-block behind', async () => {
    const { applyEdits } = await import('../src/core/edits');
    const a = applyEdits(base(), [
      { type: 'place', pos: [3, 0, 0], blockId: 'default:big', direction: 5, rotation: 0 },
      { type: 'place', pos: [4, 0, 0], blockId: 'default:lamp', direction: -1, rotation: 0 },
    ], sizeOf);
    expect(countBlocks(a)).toBe(2);
    expect(a.offsets.size).toBe(0);
  });
});

describe('history', () => {
  it('undoes, redoes, and ignores unchanged snapshots', async () => {
    const { History } = await import('../src/core/history');
    const h = new History();
    h.record('a'); h.record('b'); expect(h.record('b')).toBe(false); h.record('c');
    expect(h.undo()).toBe('b'); expect(h.undo()).toBe('a'); expect(h.undo()).toBeNull();
    expect(h.redo()).toBe('b');
    h.record('d'); // drops 'c'
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe('b');
  });
});

describe('chunk count', () => {
  it('counts the 32-cell chunks that contain blocks', async () => {
    const { chunkCount } = await import('../src/core/sbs');
    const g = createGrid([-1, 0, 0], [40, 1, 1]);
    g.data[cellIndex(g, 0, 0, 0)] = paletteIndex(g, 'default:metal_dark');
    g.data[cellIndex(g, 20, 0, 0)] = paletteIndex(g, 'default:metal_dark');
    g.data[cellIndex(g, 39, 0, 0)] = paletteIndex(g, 'default:metal_dark');
    expect(chunkCount(g)).toBe(3); // world x = -1 (chunk -1), 19 (chunk 0), 38 (chunk 1)
  });
});

describe('generator', () => {
  it('parses WorldEdit //g commands', async () => {
    const { parseCommand } = await import('../src/core/generator');
    expect(parseCommand('//g stone x^2+y^2<1')).toEqual({ expr: 'x^2+y^2<1', block: 'minecraft:stone', flags: [] });
    expect(parseCommand('//generate -h iron_block x^2+y^2+z^2 < 0.8')).toEqual({ expr: 'x^2+y^2+z^2 < 0.8', block: 'minecraft:iron_block', flags: ['h'] });
    expect(parseCommand('sin(x) < 0')).toEqual({ expr: 'sin(x) < 0', flags: [] });
  });

  it('evaluates expressions, with ^ as power and boolean or implicit forms', async () => {
    const { compileExpression } = await import('../src/core/generator');
    const env = new Float64Array([2, 0, 0, 2, 0, 0, 0.5, Math.PI, Math.E]);
    expect(compileExpression('x^2').fn(env)).toBe(4);
    expect(compileExpression('-x^2').fn(env)).toBe(-4);
    const c = compileExpression('x^2 < 5 && abs(sin(0)) <= t');
    expect(c.boolean).toBe(true);
    expect(c.fn(env)).toBe(1);
    expect(compileExpression('length(3,4) - 5').boolean).toBe(false);
    expect(() => compileExpression('foo(x)')).toThrow(/Unknown function/);
    expect(() => compileExpression('x +')).toThrow();
    expect(() => compileExpression('process')).toThrow(/Unknown name/);
  });

  it('fills a sphere and bands it into layers', async () => {
    const { generate } = await import('../src/core/generator');
    const g = generate({ expr: 'x^2+y^2+z^2 < 0.64', size: [21, 21, 21], scale: 1, t: 0.5, layers: 'single' });
    expect(g.blocks).toBeGreaterThan(2000);
    expect(g.blocks).toBeLessThan(4200); // sphere radius 0.8 of the half extent, about 2144 cells
    const radial = generate({ expr: 'x^2+y^2+z^2 < 0.64', size: [21, 21, 21], scale: 1, t: 0.5, layers: 'radial' });
    expect(new Set(radial.grid.data).size).toBeGreaterThanOrEqual(5);
  });

  it('runs every preset', async () => {
    const { generate, PRESETS } = await import('../src/core/generator');
    for (const p of PRESETS) {
      const g = generate({ expr: '', preset: p.id, size: [24, 24, 24], scale: p.scale, t: p.t, layers: 'single' });
      expect(g.blocks, p.name).toBeGreaterThan(20);
    }
  });

  it('hollow flag keeps a shell', async () => {
    const { generate } = await import('../src/core/generator');
    const solid = generate({ expr: '//g stone x^2+y^2+z^2 < 0.8', size: [24, 24, 24], scale: 1, t: 0.5, layers: 'single' });
    const shell = generate({ expr: '//g -h stone x^2+y^2+z^2 < 0.8', size: [24, 24, 24], scale: 1, t: 0.5, layers: 'single' });
    expect(shell.blocks).toBeLessThan(solid.blocks);
  });
});

describe('crop anchoring', () => {
  it('keeps the model in place when the crop changes', async () => {
    const { generate } = await import('../src/core/generator');
    const { fallbackGameSet } = await import('../src/core/fallback');
    const src = generate({ expr: 'x^2+y^2+z^2 < 0.64', size: [15, 15, 15], scale: 1, t: 0.5, layers: 'single' }).grid;
    const gs = fallbackGameSet();
    const a = convert(src, gs, cloneProfile(SHIP_PROFILE));
    const p = cloneProfile(SHIP_PROFILE);
    p.crop = { min: [null, 4, null], max: [] };
    const b = convert(src, gs, p);
    // the top layer sits at the same world height in both
    expect(b.grid.min[1] + b.grid.size[1]).toBe(a.grid.min[1] + a.grid.size[1]);
    expect(b.grid.min[0]).toBe(a.grid.min[0]);
  });
});

describe('opening .sbs as a source', () => {
  it('keeps Spacebox ids and orientation through convert', async () => {
    const { fallbackGameSet } = await import('../src/core/fallback');
    const { encodeOrient } = await import('../src/core/grid');
    const gs = fallbackGameSet();
    const id = gs.blocks.find((b) => b.category === 'MetalBlocks')!.id;
    const g = createGrid([0, 0, 0], [2, 1, 1]);
    g.palette.push(id);
    g.data[0] = 1; g.data[1] = 1; g.orient[1] = encodeOrient(3, 1);
    const { grid, meta } = readSbs(writeSbs(g, { voidName: 'default:void' }));
    expect(meta.blocks).toBe(2);
    const src = { size: [...grid.size] as [number, number, number], palette: [{ id: 'minecraft:air', props: {}, key: 'minecraft:air' }, { id, props: {}, key: id }], data: grid.data.slice(), orient: grid.orient.slice(), offsets: new Map(grid.offsets) };
    const out = convert(src, gs, cloneProfile(SHIP_PROFILE));
    expect(countBlocks(out.grid)).toBe(2);
    expect(out.grid.palette[out.grid.data[0]!]).toBe(id);
    expect(out.grid.orient.filter((o) => o !== 0).length).toBe(1);
  });
});

describe('generator banding and t', () => {
  it('uses all five layers for hollow shapes', async () => {
    const { generate, PRESETS } = await import('../src/core/generator');
    for (const id of ['ring', 'knot']) {
      const p = PRESETS.find((x) => x.id === id)!;
      for (const layers of ['radial', 'height'] as const) {
        const g = generate({ expr: '', preset: id, size: [40, 40, 40], scale: p.scale, t: p.t, layers });
        const counts = new Array(6).fill(0);
        for (const v of g.grid.data) counts[v]++;
        for (let b = 1; b <= 5; b++) expect(counts[b], `${id} ${layers} band ${b}`).toBeGreaterThan(10);
      }
    }
  });
  it('t changes the fractals', async () => {
    const { generate } = await import('../src/core/generator');
    for (const id of ['menger', 'mandelbulb']) {
      const n = (t: number) => generate({ expr: '', preset: id, size: [32, 32, 32], scale: id === 'menger' ? 1 : 1.2, t, layers: 'single' }).blocks;
      expect(n(0.3)).not.toBe(n(0.7));
    }
  });
});
