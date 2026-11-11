// One-off: dumps Nucleation's block facts (kind, shape family, solidity, colour) into data/mc_block_db.json
// so the converter can match colours offline with no WASM or Python. Run: npx tsx scripts/extract-mc-db.ts
import { writeFileSync } from 'node:fs';
import { Blocks } from 'nucleation';

const ids: string[] = JSON.parse(Blocks.idsJson());
const out: Record<string, [string, string | null, number, number, number | null, number | null, number | null]> = {};
for (const id of ids) {
  const f = JSON.parse(Blocks.getJson(id));
  const c = f.color as [number, number, number] | null;
  out[id] = [f.kind, f.base_block ?? null, f.full_cube ? 1 : 0, f.transparent ? 1 : 0, c?.[0] ?? null, c?.[1] ?? null, c?.[2] ?? null];
}
const doc = {
  note: 'Generated from the Nucleation block database. Columns: kind, base_block, full_cube, transparent, r, g, b.',
  count: ids.length,
  blocks: out,
};
writeFileSync('data/mc_block_db.json', JSON.stringify(doc));
console.log('wrote', ids.length, 'blocks');
