// Debug helper: how .sbs encodes directions, rotations and multi-block offsets.
// Usage: tsx scripts/inspect-multiblock.ts <ship.sbs> <GameSets/Default folder>
import { readFileSync } from 'node:fs';
import { loadGameSet } from '../src/core/gameset';
import { readSbs } from '../src/core/sbs';
import { dirSource } from '../src/node/fs-source';
import { decodeOrient } from '../src/core/grid';

const gs = await loadGameSet(dirSource(process.argv[3]!));
const { grid } = readSbs(new Uint8Array(readFileSync(process.argv[2]!)));
const [sx, sy, sz] = grid.size;
const rows: string[] = [];
for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
  const i = (y * sz + z) * sx + x;
  if (!grid.data[i]) continue;
  const name = grid.palette[grid.data[i]!]!;
  const b = gs.byId.get(name);
  const off = grid.offsets.get(i);
  const o = decodeOrient(grid.orient[i]!);
  const big = b && b.size.join() !== '1,1,1';
  if (off === undefined && !big && !o) continue;
  rows.push(`${String(grid.min[0] + x).padStart(3)},${String(grid.min[1] + y).padStart(3)},${String(grid.min[2] + z).padStart(3)}  ${name.padEnd(36)} size=${b?.size.join('x') ?? '?'} off=${off ?? '-'}${off !== undefined ? ` (x${off & 15} y${(off >> 4) & 15} z${(off >> 8) & 15})` : ''} dir=${o?.direction ?? '-'} rot=${o?.rotation ?? '-'}`);
}
console.log(rows.join('\n'));
