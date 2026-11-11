// Prints fallback block definitions (id, name, rough colour, size) for the non-core categories of a GameSet.
// Usage: npx tsx scripts/dump-defs.ts "<Spacebox>/Mods/GameSets/Default"
import { loadGameSet } from '../src/core/gameset';
import { dirSource } from '../src/node/fs-source';

const gs = await loadGameSet(dirSource(process.argv[2]!));
const skip = new Set(['MetalBlocks', 'Windows', 'Lights', 'Resources']);
const round = (n: number) => Math.round(n / 5) * 5;
const by = new Map<string, string[]>();
for (const b of gs.blocks) {
  if (skip.has(b.category)) continue;
  const extra: string[] = [];
  if (b.size.join() !== '1,1,1') extra.push(`size: [${b.size.join(', ')}]`);
  if (b.type) extra.push(`type: '${b.type}'`);
  if (b.model) extra.push(`model: '${b.model}'`);
  if (b.transparent) extra.push('transparent: true');
  const c = (b.color ?? [128, 128, 128]).map(round).join(', ');
  const line = `    ['${b.localId}', '${b.name.replace(/'/g, "\\'")}', [${c}]${extra.length ? `, { ${extra.join(', ')} }` : ''}],`;
  if (!by.has(b.category)) by.set(b.category, []);
  by.get(b.category)!.push(line);
}
for (const [cat, lines] of by) console.log(`  ['${cat}', [\n${lines.join('\n')}\n  ]],`);
