import { readFileSync } from 'node:fs';
import { readSbs, writeSbs } from '../src/core/sbs';
import { countBlocks } from '../src/core/grid';

for (const f of process.argv.slice(2)) {
  const { meta, grid } = readSbs(new Uint8Array(readFileSync(f)));
  const max = grid.min.map((m, i) => m + grid.size[i]! - 1);
  console.log(f.split(/[\\/]/).pop());
  console.log('  file bounds ', meta.bounds.join(','), ' blocks field', meta.blocks);
  console.log('  cells  min  ', grid.min.join(','), ' max', max.join(','), ' counted', countBlocks(grid));
  console.log('  palette', grid.palette.length, grid.palette.slice(0, 40).join(' '));
  console.log('  offsets', grid.offsets.size, ' orient', grid.orient.reduce((n, v) => n + (v ? 1 : 0), 0));
  const again = readSbs(writeSbs(grid, { id: meta.id, name: meta.name }));
  console.log('  roundtrip blocks', countBlocks(again.grid), 'bounds', again.meta.bounds.join(','));
}
