// Needs local files; see tests/local-paths.ts. Skipped when the environment variables are not set.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countBlocks } from '../src/core/grid';
import { readSbs, writeSbs } from '../src/core/sbs';
import { loadGameSet } from '../src/core/gameset';
import { loadMinecraft } from '../src/core/minecraft';
import { convert } from '../src/core/convert';
import { ASTEROID_PROFILE, SHIP_PROFILE, cloneProfile } from '../src/core/profiles';
import { dirSource } from '../src/node/fs-source';
import { local } from './local-paths';

const bytes = (p: string) => new Uint8Array(readFileSync(p));

describe.skipIf(!local.structures)('real Spacebox structures', () => {
  for (const file of ['ship.sbs', 'asteroid.sbs']) {
    it(`${file} reads with the stored block count and bounds, and rewrites losslessly`, () => {
      const { meta, grid } = readSbs(bytes(join(local.structures!, file)));
      expect(countBlocks(grid)).toBe(meta.blocks);
      expect(meta.bounds).toEqual([...grid.min, ...grid.min.map((m, i) => m + grid.size[i]!)]);

      const again = readSbs(writeSbs(grid, { id: meta.id, name: meta.name, author: meta.author, gameVersion: meta.gameVersion, gamesets: meta.gamesets }));
      expect(again.meta.blocks).toBe(meta.blocks);
      expect(again.meta.bounds).toEqual(meta.bounds);
      expect(again.grid.size).toEqual(grid.size);
      for (let i = 0; i < grid.data.length; i++) {
        expect(again.grid.palette[again.grid.data[i]!] ?? '').toBe(grid.palette[grid.data[i]!] ?? '');
        if (grid.orient[i] !== again.grid.orient[i]) throw new Error(`orientation differs at cell ${i}`);
      }
      const sorted = (m: Map<number, number>) => [...m.entries()].sort((a, b) => a[0] - b[0]);
      expect(sorted(again.grid.offsets)).toEqual(sorted(grid.offsets));
    });
  }
});

describe.skipIf(!local.gameSet)('Spacebox GameSet', () => {
  it('lists blocks with sizes, categories and colours', async () => {
    const gs = await loadGameSet(dirSource(local.gameSet!));
    expect(gs.modId).toBe('default');
    expect(gs.blocks.length).toBeGreaterThan(60);
    expect(gs.byId.get('default:iron_block_light')?.category).toBe('MetalBlocks');
    expect(gs.byId.get('default:window')?.transparent).toBe(true);
    const thruster = gs.byId.get('default:thruster_ion');
    if (thruster) expect(thruster.size).toEqual([2, 2, 2]);
    const hull = gs.blocks.filter((b) => b.category === 'MetalBlocks');
    expect(hull.length).toBeGreaterThanOrEqual(9);
    expect(hull.every((b) => b.color !== null)).toBe(true);
  });

  const cases: [string, string | undefined, number | null][] = [['millennium_falcon.litematic', local.falcon, 1], ['nx-01 enterprise .schem', local.enterprise, null]];
  for (const [label, file, floor] of cases) {
    it.skipIf(!file)(`converts ${label} using only 1x1x1 hull, window and light blocks`, async () => {
      const gs = await loadGameSet(dirSource(local.gameSet!));
      const src = loadMinecraft(bytes(file!), file!);
      const profile = cloneProfile(SHIP_PROFILE);
      if (floor !== null) profile.crop = { min: [null, floor, null] };
      const { grid, report } = convert(src, gs, profile);

      expect(report.outputBlocks).toBeGreaterThan(500);
      expect(report.outputBlocks).toBe(countBlocks(grid));
      const allowed = new Set(['MetalBlocks', 'Windows', 'Lights']);
      for (const id of Object.keys(report.targets)) {
        const b = gs.byId.get(id);
        expect(b, id).toBeDefined();
        expect(b!.size, id).toEqual([1, 1, 1]);
        expect(allowed.has(b!.category), `${id} is in ${b!.category}`).toBe(true);
      }
      // Decoration must drop out instead of becoming hull.
      for (const s of report.states) if (/grass|vine|carpet|button|torch$/.test(s.key)) expect(s.target, s.key).toBeNull();

      const back = readSbs(writeSbs(grid, { id: 't', name: 't', gamesets: [gs.modId], voidName: `${gs.modId}:void` }));
      expect(countBlocks(back.grid)).toBe(report.outputBlocks);
    });
  }

  it('asteroid profile maps stone to rocks and never to ores', async () => {
    if (!local.falcon) return;
    const gs = await loadGameSet(dirSource(local.gameSet!));
    const { report } = convert(loadMinecraft(bytes(local.falcon), local.falcon), gs, cloneProfile(ASTEROID_PROFILE));
    for (const id of Object.keys(report.targets)) expect(id).not.toMatch(/_ore$/);
  });
});

describe.skipIf(!local.structures || !local.gameSet)('orientation model against the real ship.sbs', () => {
  it('every multi-block cell points back at an anchor with the same block and orientation', async () => {
    const { anchorFromCell, footprint } = await import('../src/core/orientation');
    const { decodeOrient, cellIndex } = await import('../src/core/grid');
    const gs = await loadGameSet(dirSource(local.gameSet!));
    const { grid } = readSbs(bytes(join(local.structures!, 'ship.sbs')));
    const seen = new Set<string>();
    let checked = 0;
    for (const [i, off] of grid.offsets) {
      const [sx, sz] = [grid.size[0], grid.size[2]];
      const cell: [number, number, number] = [grid.min[0] + (i % sx), grid.min[1] + Math.floor(i / (sx * sz)), grid.min[2] + (Math.floor(i / sx) % sz)];
      const o = decodeOrient(grid.orient[i]!)!;
      const anchor = anchorFromCell(cell, off, o.direction, o.rotation);
      const ai = cellIndex(grid, anchor[0] - grid.min[0], anchor[1] - grid.min[1], anchor[2] - grid.min[2]);
      expect(grid.offsets.has(ai), `anchor ${anchor} of cell ${cell} must have no offset`).toBe(false);
      expect(grid.palette[grid.data[ai]!]).toBe(grid.palette[grid.data[i]!]);
      expect(grid.orient[ai]).toBe(grid.orient[i]);
      const size = gs.byId.get(grid.palette[grid.data[i]!]!)!.size;
      const key = anchor.join();
      if (!seen.has(key)) {
        seen.add(key);
        for (const c of footprint(anchor, size, o.direction, o.rotation)) {
          const ci = cellIndex(grid, c.pos[0] - grid.min[0], c.pos[1] - grid.min[1], c.pos[2] - grid.min[2]);
          expect(grid.palette[grid.data[ci]!], `footprint cell ${c.pos}`).toBe(grid.palette[grid.data[ai]!]);
          if (c.offset !== 0) expect(grid.offsets.get(ci)).toBe(c.offset);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(6); // ship.sbs holds 6 multi-blocks (power blocks, doors, windows, cobalt blocks)
  });
});
