// CLI: npx tsx scripts/convert.ts <input> <output.sbs> --gameset <GameSets/Default folder> [options]
//   --profile ship|asteroid|<profile.json>   (default: ship)
//   --crop-min x,y,z  --crop-max x,y,z       source coordinates, inclusive (e.g. --crop-min ,1,  to drop the floor)
//   --hollow [thickness]   --no-hollow   --flip-z   --name "Ship name"   --author "Name"   --description "Text" (empty string allowed)   --report
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { convert } from '../src/core/convert';
import { loadGameSet } from '../src/core/gameset';
import { loadMinecraft } from '../src/core/minecraft';
import { BUILTIN_PROFILES, cloneProfile, parseProfile } from '../src/core/profiles';
import { PLACEHOLDER_PICTURE_BASE64 } from '../src/core/placeholder-picture';
import { writeSbs } from '../src/core/sbs';
import { dirSource } from '../src/node/fs-source';

const args = process.argv.slice(2);
const positional: string[] = [];
const opt = new Map<string, string | true>();
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a.startsWith('--')) {
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('--') && !['--report', '--flip-z', '--no-hollow'].includes(a)) { opt.set(a, next); i++; }
    else opt.set(a, true);
  } else positional.push(a);
}
const [input, output] = positional;
const gamesetDir = opt.get('--gameset');
if (!input || !output || typeof gamesetDir !== 'string') {
  console.error('usage: convert <input> <output.sbs> --gameset <Mods/GameSets/Default> [--profile ship|asteroid|file.json] [--crop-min x,y,z] [--crop-max x,y,z] [--hollow [n]] [--flip-z] [--report]');
  process.exit(2);
}

const triple = (v: string | true | undefined) =>
  typeof v === 'string' ? v.split(',').map((s) => (s.trim() === '' ? undefined : Number(s))) as (number | undefined)[] : undefined;

const profName = typeof opt.get('--profile') === 'string' ? (opt.get('--profile') as string) : 'ship';
const profile = BUILTIN_PROFILES[profName] ? cloneProfile(BUILTIN_PROFILES[profName]!) : parseProfile(readFileSync(profName, 'utf8'));
const cmin = triple(opt.get('--crop-min')), cmax = triple(opt.get('--crop-max'));
if (cmin || cmax) profile.crop = { min: cmin as never, max: cmax as never };
if (opt.has('--hollow')) { profile.hollow.enabled = true; const t = opt.get('--hollow'); if (typeof t === 'string') profile.hollow.thickness = Number(t); }
if (opt.has('--no-hollow')) profile.hollow.enabled = false;
if (opt.has('--flip-z')) profile.flipZ = true;

const gameSet = await loadGameSet(dirSource(gamesetDir));
const src = loadMinecraft(new Uint8Array(readFileSync(input)), input);
const { grid, report } = convert(src, gameSet, profile);

const name = typeof opt.get('--name') === 'string' ? (opt.get('--name') as string) : basename(output).replace(/\.sbs$/i, '');
const picture = Uint8Array.from(Buffer.from(PLACEHOLDER_PICTURE_BASE64, 'base64'));
const bytes = writeSbs(grid, {
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name,
  author: typeof opt.get('--author') === 'string' ? (opt.get('--author') as string) : 'Blockport',
  description: typeof opt.get('--description') === 'string'
    ? (opt.get('--description') as string)
    : `Converted from ${basename(input)} with Blockport (profile: ${profile.name})`,
  gameVersion: gameSet.version, gamesets: [gameSet.modId], voidName: `${gameSet.modId}:void`, picture,
});
writeFileSync(output, bytes);

console.log(`${basename(input)}: ${report.inputBlocks} blocks, ${report.croppedBlocks} after crop -> ${report.outputBlocks} written ` +
  `(${report.dropped} dropped, ${report.hollowed} hollowed), size ${grid.size.join('x')}, ${bytes.length} bytes`);
console.log('targets:', Object.entries(report.targets).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.split(':')[1]}=${v}`).join(' '));
if (opt.has('--report')) for (const s of report.states.slice(0, 60)) console.log(`  ${String(s.count).padStart(6)}  ${s.key}  ->  ${s.target ?? 'AIR'}  (${s.reason})`);
