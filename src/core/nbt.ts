// Minimal NBT reader/writer (big-endian, optional little-endian for Bedrock).
// No DOM or Three.js imports: this module runs in Node and in the browser.
import { gunzipSync, gzipSync } from 'fflate';

export enum Tag {
  End = 0, Byte = 1, Short = 2, Int = 3, Long = 4, Float = 5, Double = 6,
  ByteArray = 7, String = 8, List = 9, Compound = 10, IntArray = 11, LongArray = 12,
}

export type NbtValue =
  | { type: Tag.Byte | Tag.Short | Tag.Int | Tag.Float | Tag.Double; value: number }
  | { type: Tag.Long; value: bigint }
  | { type: Tag.String; value: string }
  | { type: Tag.ByteArray; value: Int8Array }
  | { type: Tag.IntArray; value: Int32Array }
  | { type: Tag.LongArray; value: BigInt64Array }
  | { type: Tag.List; itemType: Tag; value: NbtValue[] }
  | { type: Tag.Compound; value: Map<string, NbtValue> };

export type NbtCompound = Extract<NbtValue, { type: Tag.Compound }>;
export type NbtList = Extract<NbtValue, { type: Tag.List }>;

export interface NbtRoot { name: string; value: NbtCompound }

const td = new TextDecoder('utf-8');
const te = new TextEncoder();

class Reader {
  private view: DataView;
  pos = 0;
  constructor(private bytes: Uint8Array, private little: boolean) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  private need(n: number) {
    if (n < 0 || this.pos + n > this.bytes.length) throw new Error('Unexpected end of NBT data');
  }
  u8() { this.need(1); return this.view.getUint8(this.pos++); }
  i8() { this.need(1); return this.view.getInt8(this.pos++); }
  i16() { this.need(2); const v = this.view.getInt16(this.pos, this.little); this.pos += 2; return v; }
  u16() { this.need(2); const v = this.view.getUint16(this.pos, this.little); this.pos += 2; return v; }
  i32() { this.need(4); const v = this.view.getInt32(this.pos, this.little); this.pos += 4; return v; }
  i64() { this.need(8); const v = this.view.getBigInt64(this.pos, this.little); this.pos += 8; return v; }
  f32() { this.need(4); const v = this.view.getFloat32(this.pos, this.little); this.pos += 4; return v; }
  f64() { this.need(8); const v = this.view.getFloat64(this.pos, this.little); this.pos += 8; return v; }
  str() {
    const len = this.u16();
    this.need(len);
    const s = td.decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
  payload(type: Tag, depth: number): NbtValue {
    if (depth > 512) throw new Error('NBT nesting too deep');
    switch (type) {
      case Tag.Byte: return { type, value: this.i8() };
      case Tag.Short: return { type, value: this.i16() };
      case Tag.Int: return { type, value: this.i32() };
      case Tag.Long: return { type, value: this.i64() };
      case Tag.Float: return { type, value: this.f32() };
      case Tag.Double: return { type, value: this.f64() };
      case Tag.String: return { type, value: this.str() };
      case Tag.ByteArray: {
        const n = this.i32();
        this.need(n);
        const a = new Int8Array(n);
        a.set(new Int8Array(this.bytes.buffer, this.bytes.byteOffset + this.pos, n));
        this.pos += n;
        return { type, value: a };
      }
      case Tag.IntArray: {
        const n = this.i32();
        this.need(n * 4);
        const a = new Int32Array(n);
        for (let i = 0; i < n; i++) a[i] = this.i32();
        return { type, value: a };
      }
      case Tag.LongArray: {
        const n = this.i32();
        this.need(n * 8);
        const a = new BigInt64Array(n);
        for (let i = 0; i < n; i++) a[i] = this.i64();
        return { type, value: a };
      }
      case Tag.List: {
        const itemType = this.u8() as Tag;
        const n = this.i32();
        if (n > 0 && itemType === Tag.End) throw new Error('NBT list of End tags');
        const value: NbtValue[] = [];
        for (let i = 0; i < n; i++) value.push(this.payload(itemType, depth + 1));
        return { type, itemType, value };
      }
      case Tag.Compound: {
        const value = new Map<string, NbtValue>();
        for (;;) {
          const t = this.u8() as Tag;
          if (t === Tag.End) break;
          const name = this.str();
          value.set(name, this.payload(t, depth + 1));
        }
        return { type, value };
      }
      default: throw new Error(`Unknown NBT tag type ${type}`);
    }
  }
}

/** Reads a root compound. Detects GZIP automatically. Bedrock .mcstructure uses little-endian. */
export function readNbt(data: Uint8Array, opts: { littleEndian?: boolean } = {}): NbtRoot {
  let bytes = data;
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  const r = new Reader(bytes, opts.littleEndian ?? false);
  const t = r.u8();
  if (t !== Tag.Compound) throw new Error(`Expected root compound, got tag ${t}`);
  const name = r.str();
  return { name, value: r.payload(Tag.Compound, 0) as NbtCompound };
}

class Writer {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  private len = 0;
  private grow(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }
  u8(v: number) { this.grow(1); this.view.setUint8(this.len++, v); }
  i16(v: number) { this.grow(2); this.view.setInt16(this.len, v); this.len += 2; }
  u16(v: number) { this.grow(2); this.view.setUint16(this.len, v); this.len += 2; }
  i32(v: number) { this.grow(4); this.view.setInt32(this.len, v); this.len += 4; }
  i64(v: bigint) { this.grow(8); this.view.setBigInt64(this.len, v); this.len += 8; }
  f32(v: number) { this.grow(4); this.view.setFloat32(this.len, v); this.len += 4; }
  f64(v: number) { this.grow(8); this.view.setFloat64(this.len, v); this.len += 8; }
  str(s: string) {
    const b = te.encode(s);
    this.u16(b.length);
    this.grow(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  raw(b: Uint8Array) { this.grow(b.length); this.buf.set(b, this.len); this.len += b.length; }
  payload(v: NbtValue) {
    switch (v.type) {
      case Tag.Byte: this.u8(v.value & 0xff); break;
      case Tag.Short: this.i16(v.value); break;
      case Tag.Int: this.i32(v.value); break;
      case Tag.Long: this.i64(v.value); break;
      case Tag.Float: this.f32(v.value); break;
      case Tag.Double: this.f64(v.value); break;
      case Tag.String: this.str(v.value); break;
      case Tag.ByteArray:
        this.i32(v.value.length);
        this.raw(new Uint8Array(v.value.buffer, v.value.byteOffset, v.value.byteLength));
        break;
      case Tag.IntArray: this.i32(v.value.length); for (const x of v.value) this.i32(x); break;
      case Tag.LongArray: this.i32(v.value.length); for (const x of v.value) this.i64(x); break;
      case Tag.List:
        this.u8(v.itemType);
        this.i32(v.value.length);
        for (const x of v.value) this.payload(x);
        break;
      case Tag.Compound:
        for (const [k, x] of v.value) { this.u8(x.type); this.str(k); this.payload(x); }
        this.u8(Tag.End);
        break;
    }
  }
  bytes() { return this.buf.slice(0, this.len); }
}

/** Writes big-endian NBT, GZIP-compressed by default (the .sbs convention). */
export function writeNbt(root: NbtRoot, opts: { gzip?: boolean } = {}): Uint8Array {
  const w = new Writer();
  w.u8(Tag.Compound);
  w.str(root.name);
  w.payload(root.value);
  const raw = w.bytes();
  return opts.gzip === false ? raw : gzipSync(raw, { level: 6 });
}

// ---- Construction and access helpers ----
export const nbt = {
  byte: (value: number): NbtValue => ({ type: Tag.Byte, value }),
  short: (value: number): NbtValue => ({ type: Tag.Short, value }),
  int: (value: number): NbtValue => ({ type: Tag.Int, value }),
  long: (value: bigint): NbtValue => ({ type: Tag.Long, value }),
  float: (value: number): NbtValue => ({ type: Tag.Float, value }),
  string: (value: string): NbtValue => ({ type: Tag.String, value }),
  byteArray: (value: Int8Array): NbtValue => ({ type: Tag.ByteArray, value }),
  intArray: (value: Int32Array): NbtValue => ({ type: Tag.IntArray, value }),
  list: (itemType: Tag, value: NbtValue[]): NbtList => ({ type: Tag.List, itemType, value }),
  compound: (entries: Record<string, NbtValue> | Map<string, NbtValue> = {}): NbtCompound =>
    ({ type: Tag.Compound, value: entries instanceof Map ? entries : new Map(Object.entries(entries)) }),
};

export function num(v: NbtValue | undefined): number | undefined {
  if (!v) return undefined;
  switch (v.type) {
    case Tag.Byte: case Tag.Short: case Tag.Int: case Tag.Float: case Tag.Double: return v.value;
    case Tag.Long: return Number(v.value);
    default: return undefined;
  }
}
export function str(v: NbtValue | undefined): string | undefined { return v?.type === Tag.String ? v.value : undefined; }
export function comp(v: NbtValue | undefined): NbtCompound | undefined { return v?.type === Tag.Compound ? v : undefined; }
export function list(v: NbtValue | undefined): NbtList | undefined { return v?.type === Tag.List ? v : undefined; }
export function get(c: NbtCompound | undefined, key: string): NbtValue | undefined { return c?.value.get(key); }
