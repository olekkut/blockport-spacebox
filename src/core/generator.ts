// Procedural structures: WorldEdit `//g` style math expressions, implicit surfaces, SDFs and a few fractals.
// Produces a Minecraft-style SourceGrid, so the result goes through the same mapping, viewer and export as any file.
// No DOM or Three.js imports. Expressions are parsed here (no eval), so nothing typed into the box can run code.
import type { Vec3 } from './grid';
import type { SourceGrid, SourceState } from './minecraft';

// ---------- expression parser ----------
const VARS = ['x', 'y', 'z', 'r', 'theta', 'phi', 't', 'pi', 'e'] as const;
type Env = Float64Array; // indexed like VARS

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  min: Math.min, max: Math.max, pow: Math.pow, exp: Math.exp, log: Math.log, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, sign: Math.sign,
  mod: (a, b) => ((a % b) + b) % b,
  fract: (a) => a - Math.floor(a),
  clamp: (a, lo, hi) => Math.min(hi, Math.max(lo, a)),
  length: (...a) => Math.hypot(...a),
};

type Node = (v: Env) => number;
interface Compiled { fn: Node; boolean: boolean }

class Parser {
  private i = 0;
  boolean = false;
  constructor(private s: string) {}

  private ws() { while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++; }
  private eat(tok: string): boolean {
    this.ws();
    if (this.s.startsWith(tok, this.i)) { this.i += tok.length; return true; }
    return false;
  }
  private peek(tok: string): boolean { this.ws(); return this.s.startsWith(tok, this.i); }
  private fail(msg: string): never { throw new Error(`${msg} (at character ${this.i + 1})`); }

  parse(): Node {
    const n = this.or();
    this.ws();
    if (this.i < this.s.length) this.fail(`Unexpected "${this.s[this.i]}"`);
    return n;
  }

  private or(): Node {
    let l = this.and();
    while (this.eat('||')) { this.boolean = true; const a = l, b = this.and(); l = (v) => (a(v) !== 0 || b(v) !== 0 ? 1 : 0); }
    return l;
  }
  private and(): Node {
    let l = this.cmp();
    while (this.eat('&&')) { this.boolean = true; const a = l, b = this.cmp(); l = (v) => (a(v) !== 0 && b(v) !== 0 ? 1 : 0); }
    return l;
  }
  private cmp(): Node {
    const l = this.add();
    for (const op of ['<=', '>=', '==', '!=', '<', '>']) {
      if (this.peek(op)) {
        this.eat(op);
        this.boolean = true;
        const r = this.add();
        switch (op) {
          case '<=': return (v) => (l(v) <= r(v) ? 1 : 0);
          case '>=': return (v) => (l(v) >= r(v) ? 1 : 0);
          case '==': return (v) => (l(v) === r(v) ? 1 : 0);
          case '!=': return (v) => (l(v) !== r(v) ? 1 : 0);
          case '<': return (v) => (l(v) < r(v) ? 1 : 0);
          default: return (v) => (l(v) > r(v) ? 1 : 0);
        }
      }
    }
    return l;
  }
  private add(): Node {
    let l = this.mul();
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if (c !== '+' && c !== '-') return l;
      this.i++;
      const a = l, b = this.mul();
      l = c === '+' ? (v) => a(v) + b(v) : (v) => a(v) - b(v);
    }
  }
  private mul(): Node {
    let l = this.unary();
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if ((c !== '*' && c !== '/' && c !== '%') || this.s[this.i + 1] === '*') return l;
      this.i++;
      const a = l, b = this.unary();
      l = c === '*' ? (v) => a(v) * b(v) : c === '/' ? (v) => a(v) / b(v) : (v) => a(v) % b(v);
    }
  }
  private unary(): Node {
    this.ws();
    if (this.eat('-')) { const a = this.unary(); return (v) => -a(v); }
    if (this.eat('+')) return this.unary();
    if (this.s[this.i] === '!' && this.s[this.i + 1] !== '=') { this.i++; const a = this.unary(); this.boolean = true; return (v) => (a(v) === 0 ? 1 : 0); }
    return this.pow();
  }
  private pow(): Node {
    const base = this.atom();
    if (this.eat('**') || this.eat('^')) { const e = this.unary(); return (v) => Math.pow(base(v), e(v)); }
    return base;
  }
  private atom(): Node {
    this.ws();
    const rest = this.s.slice(this.i);
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(rest);
    if (num) { this.i += num[0].length; const n = Number(num[0]); return () => n; }
    const id = /^[A-Za-z_][A-Za-z_0-9]*/.exec(rest);
    if (id) {
      const name = id[0];
      this.i += name.length;
      if (this.eat('(')) {
        const fn = FUNCS[name];
        if (!fn) this.fail(`Unknown function "${name}"`);
        const args: Node[] = [];
        if (!this.eat(')')) {
          do args.push(this.or()); while (this.eat(','));
          if (!this.eat(')')) this.fail('Missing ")"');
        }
        const n = args.length;
        if (n === 1) { const a = args[0]!; return (v) => fn(a(v)); }
        return (v) => fn(...args.map((a) => a(v)));
      }
      const slot = (VARS as readonly string[]).indexOf(name);
      if (slot < 0) this.fail(`Unknown name "${name}"`);
      return (v) => v[slot]!;
    }
    if (this.eat('(')) {
      const n = this.or();
      if (!this.eat(')')) this.fail('Missing ")"');
      return n;
    }
    return this.fail(this.i >= this.s.length ? 'The expression ends too early' : `Unexpected "${this.s[this.i]}"`);
  }
}

/** Compiles an expression. With a comparison or logic operator it is a condition; otherwise a value where <= 0 is solid. */
export function compileExpression(expr: string): Compiled {
  const p = new Parser(expr);
  const fn = p.parse();
  return { fn, boolean: p.boolean };
}

export interface ParsedCommand { expr: string; block?: string; flags: string[] }

/** Accepts `//g stone x^2+y^2+z^2<1`, `//generate -h iron_block ...` or a plain expression. */
export function parseCommand(input: string): ParsedCommand {
  let s = input.trim();
  const flags: string[] = [];
  const cmd = /^\/{1,2}(g|gen|generate)\b\s*/i.exec(s);
  if (cmd) {
    s = s.slice(cmd[0].length);
    for (;;) {
      const f = /^-([a-z]+)\b\s*/i.exec(s);
      if (!f) break;
      flags.push(...f[1]!.toLowerCase().split(''));
      s = s.slice(f[0].length);
    }
    const b = /^([A-Za-z_][A-Za-z_0-9]*(?::[A-Za-z_0-9/]+)?)\s+(?=\S)/.exec(s);
    if (b && !(b[1]! in FUNCS) && !(VARS as readonly string[]).includes(b[1]!)) {
      s = s.slice(b[0].length);
      return { expr: s.trim(), block: b[1]!.includes(':') ? b[1]! : `minecraft:${b[1]}`, flags };
    }
  }
  return { expr: s.trim(), flags };
}

// ---------- built-in fields ----------
/** A solid test for one point. `t` is the thickness slider. */
type Field = (x: number, y: number, z: number, t: number) => boolean;

function knotField(): Field {
  const P = 7, Q = 3, R = 0.62, A = 0.22, SEG = 420;
  const pts: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const u = (i / SEG) * Math.PI * 2;
    const rr = R + A * Math.cos(Q * u);
    pts.push(rr * Math.cos(P * u), rr * Math.sin(P * u), A * Math.sin(Q * u));
  }
  return (x, y, z, t) => {
    const tube = 0.05 + t * 0.2;
    const ring = Math.hypot(Math.hypot(x, y) - R, z);
    if (ring > A + tube) return false;
    const lim = tube * tube;
    for (let i = 0; i < SEG; i++) {
      const ax = pts[i * 3]!, ay = pts[i * 3 + 1]!, az = pts[i * 3 + 2]!;
      const bx = pts[i * 3 + 3]! - ax, by = pts[i * 3 + 4]! - ay, bz = pts[i * 3 + 5]! - az;
      const px = x - ax, py = y - ay, pz = z - az;
      const h = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz)));
      const dx = px - bx * h, dy = py - by * h, dz = pz - bz * h;
      if (dx * dx + dy * dy + dz * dz < lim) return true;
    }
    return false;
  };
}

/** Menger sponge, 3 levels. `t` sets the width of the cut-out middle part (t = 0.5 is the classic one third). */
const menger: Field = (x, y, z, t) => {
  const w = Math.min(0.8, Math.max(0.08, (t * 2) / 3)), side = (1 - w) / 2;
  let u = (x + 1) / 2, v = (y + 1) / 2, q = (z + 1) / 2;
  if (u < 0 || v < 0 || q < 0 || u > 1 || v > 1 || q > 1) return false;
  u = Math.min(u, 0.999999); v = Math.min(v, 0.999999); q = Math.min(q, 0.999999);
  const part = (c: number) => (c < side ? 0 : c < side + w ? 1 : 2);
  const rescale = (c: number, a: number) => (a === 0 ? c / side : a === 1 ? (c - side) / w : (c - side - w) / side);
  for (let i = 0; i < 3; i++) {
    const a = part(u), b = part(v), c = part(q);
    if ((a === 1 ? 1 : 0) + (b === 1 ? 1 : 0) + (c === 1 ? 1 : 0) >= 2) return false;
    u = rescale(u, a); v = rescale(v, b); q = rescale(q, c);
  }
  return true;
};

/** Mandelbulb. `t` sets the power: 2 + 12 t, so t = 0.5 is the classic power 8 and the slider changes the shape. */
const mandelbulb: Field = (cx, cy, cz, t) => {
  const n = 2 + t * 12;
  let x = cx, y = cy, z = cz;
  for (let i = 0; i < 8; i++) {
    const r = Math.hypot(x, y, z);
    if (r > 2) return false;
    const th = Math.acos(z / (r || 1e-9)) * n, ph = Math.atan2(y, x) * n, rn = Math.pow(r, n);
    x = rn * Math.sin(th) * Math.cos(ph) + cx;
    y = rn * Math.sin(th) * Math.sin(ph) + cy;
    z = rn * Math.cos(th) + cz;
  }
  return true;
};

export interface Preset {
  id: string;
  name: string;
  /** Expression text, or empty when `field` is used. */
  expr: string;
  field?: () => Field;
  /** Half extent of the sampled domain. */
  scale: number;
  t: number;
}

export const PRESETS: Preset[] = [
  { id: 'gyroid', name: 'Gyroid Minimal Surface', expr: 'abs(sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)) < t', scale: 3.14, t: 0.28 },
  { id: 'schwarz-p', name: 'Schwarz P Lattice', expr: 'abs(cos(x) + cos(y) + cos(z)) < t', scale: 6.28, t: 0.35 },
  { id: 'schwarz-d', name: 'Schwarz Diamond Lattice', expr: 'abs(sin(x)*sin(y)*sin(z) + sin(x)*cos(y)*cos(z) + cos(x)*sin(y)*cos(z) + cos(x)*cos(y)*sin(z)) < t', scale: 3.14, t: 0.25 },
  { id: 'torus-worldedit', name: 'Torus / Möbius Variant (WorldEdit)', expr: '(sqrt(x^2+y^2)-cos(z))^2 + sin(z)^2 < t', scale: 2.2, t: 0.5 },
  { id: 'ring', name: 'Orbital Ring Station (Torus)', expr: '(sqrt(x^2+z^2) - 0.68)^2 + y^2 < t^2', scale: 1.1, t: 0.22 },
  { id: 'knot', name: 'Septafoil Alien Knot', expr: '', field: knotField, scale: 1.1, t: 0.35 },
  { id: 'menger', name: 'Menger Sponge Fractal', expr: '', field: () => menger, scale: 1, t: 0.5 },
  { id: 'mandelbulb', name: 'Mandelbulb 3D Fractal', expr: '', field: () => mandelbulb, scale: 1.2, t: 0.5 },
  { id: 'dyson', name: 'Ribbed Geodesic Dyson Shell', expr: 'abs(r - 0.82) < t * 0.35 && (abs(sin(6*theta)) < 0.35 || abs(sin(6*phi)) < 0.35 || abs(r - 0.82) < t * 0.15)', scale: 1.0, t: 0.5 },
];

// ---------- generation ----------
export type LayerMode = 'single' | 'radial' | 'height';

export interface GenOptions {
  /** Expression or full WorldEdit command. Ignored when `preset` has a built-in field. */
  expr: string;
  preset?: string;
  size: Vec3;
  scale: number;
  t: number;
  layers: LayerMode;
  block?: string;
}

export const LAYER_BLOCKS = [
  'minecraft:sea_lantern', 'minecraft:cyan_terracotta', 'minecraft:iron_block', 'minecraft:deepslate_tiles', 'minecraft:blue_stained_glass',
];
const BANDS = 5;

export const MAX_SIDE = 128;

export interface Generated { grid: SourceGrid; blocks: number; label: string }

export function generate(o: GenOptions): Generated {
  const size = o.size.map((n) => Math.max(1, Math.min(MAX_SIDE, Math.round(n)))) as Vec3;
  const [sx, sy, sz] = size;
  const preset = o.preset ? PRESETS.find((p) => p.id === o.preset) : undefined;
  let field: Field;
  let block = o.block;
  let hollow = false;
  if (preset?.field) {
    field = preset.field();
  } else {
    const cmd = parseCommand(preset?.expr ?? o.expr);
    if (!cmd.expr) throw new Error('Enter an expression, for example x^2 + y^2 + z^2 < 0.8');
    block = block ?? cmd.block;
    hollow = cmd.flags.includes('h');
    const c = compileExpression(cmd.expr);
    const v: Env = new Float64Array(VARS.length);
    v[8] = Math.E; v[7] = Math.PI;
    field = (x, y, z, t) => {
      v[0] = x; v[1] = y; v[2] = z;
      const r = Math.hypot(x, y, z);
      v[3] = r; v[4] = Math.atan2(z, x); v[5] = Math.acos(Math.max(-1, Math.min(1, y / (r || 1e-9)))); v[6] = t;
      const out = c.fn(v);
      return c.boolean ? out !== 0 : out <= 0;
    };
  }

  const mid = (n: number, i: number) => (n === 1 ? 0 : (i / (n - 1)) * 2 - 1);
  const filled = new Uint8Array(sx * sy * sz);
  const radius = new Float32Array(sx * sy * sz);
  let minR = Infinity, maxR = 0, minY = sy, maxY = 0, count = 0;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const px = mid(sx, x) * o.scale, py = mid(sy, y) * o.scale, pz = mid(sz, z) * o.scale;
    let ok = false;
    try { ok = field(px, py, pz, o.t); } catch { ok = false; }
    if (!ok) continue;
    const i = ((y * sz) + z) * sx + x;
    filled[i] = 1;
    radius[i] = Math.hypot(px, py, pz);
    if (radius[i]! > maxR) maxR = radius[i]!;
    if (radius[i]! < minR) minR = radius[i]!;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    count++;
  }

  if (hollow) {
    const keep = filled.slice();
    for (let y = 1; y < sy - 1; y++) for (let z = 1; z < sz - 1; z++) for (let x = 1; x < sx - 1; x++) {
      const i = ((y * sz) + z) * sx + x;
      if (filled[i] && filled[i - 1] && filled[i + 1] && filled[i - sx] && filled[i + sx] && filled[i - sx * sz] && filled[i + sx * sz]) { keep[i] = 0; count--; }
    }
    filled.set(keep);
  }
  // Band ranges come from the cells that are really solid (after hollowing), so every layer is used.
  minR = Infinity; maxR = 0; minY = sy; maxY = 0;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const i = ((y * sz) + z) * sx + x;
    if (!filled[i]) continue;
    if (radius[i]! < minR) minR = radius[i]!;
    if (radius[i]! > maxR) maxR = radius[i]!;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (count === 0) throw new Error('Nothing is solid at these settings. Try a larger thickness or domain scale.');

  const single = block ?? 'minecraft:iron_block';
  const names = o.layers === 'single' ? [single] : LAYER_BLOCKS;
  const palette: SourceState[] = [{ id: 'minecraft:air', props: {}, key: 'minecraft:air' }];
  for (const n of names) palette.push({ id: n, props: {}, key: n });
  const data = new Uint16Array(sx * sy * sz);
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const i = ((y * sz) + z) * sx + x;
    if (!filled[i]) continue;
    let band = 0;
    if (o.layers === 'radial') band = Math.min(BANDS - 1, Math.floor(((radius[i]! - minR) / (maxR - minR || 1)) * BANDS));
    else if (o.layers === 'height') band = Math.min(BANDS - 1, Math.floor(((y - minY) / (maxY - minY || 1)) * BANDS));
    data[i] = band + 1;
  }
  return { grid: { size, palette, data }, blocks: count, label: preset?.name ?? 'Expression' };
}
