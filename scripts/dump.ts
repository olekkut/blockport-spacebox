// Debug helper: print an NBT file as an indented tree. Usage: tsx scripts/dump.ts <file> [maxItems]
import { readFileSync } from 'node:fs';
import { readNbt, Tag, type NbtValue } from '../src/core/nbt';

const maxItems = Number(process.argv[3] ?? 2);

function show(v: NbtValue, ind: string, name: string, out: string[]) {
  const tn = Tag[v.type];
  if (v.type === Tag.Compound) {
    out.push(`${ind}${name}: Compound {`);
    for (const [k, x] of v.value) show(x, ind + '  ', k, out);
    out.push(`${ind}}`);
  } else if (v.type === Tag.List) {
    out.push(`${ind}${name}: List<${Tag[v.itemType]}>[${v.value.length}]`);
    v.value.slice(0, maxItems).forEach((x, i) => show(x, ind + '  ', `[${i}]`, out));
  } else if (v.type === Tag.ByteArray || v.type === Tag.IntArray || v.type === Tag.LongArray) {
    const a = Array.from(v.value as ArrayLike<number | bigint>);
    out.push(`${ind}${name}: ${tn}[${a.length}] ${a.slice(0, 24).join(',')}${a.length > 24 ? '...' : ''}`);
  } else {
    out.push(`${ind}${name}: ${tn} ${String((v as { value: unknown }).value)}`);
  }
}

const root = readNbt(new Uint8Array(readFileSync(process.argv[2]!)));
const out: string[] = [];
show(root.value, '', `root("${root.name}")`, out);
console.log(out.join('\n'));
