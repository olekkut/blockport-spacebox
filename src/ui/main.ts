// Browser app: load a Spacebox GameSet folder and a Minecraft structure, preview the converted result in 3D,
// remap blocks by clicking, place or erase blocks by hand, then export an .sbs file. All files stay in the browser.
import { convert, type ConversionResult } from '../core/convert';
import { applyEdits, type ManualEdit } from '../core/edits';
import { fallbackGameSet } from '../core/fallback';
import { loadGameSet, type FileSource, type GameSet, type SpaceboxBlock } from '../core/gameset';
import { cellIndex, countBlocks, decodeOrient, type Vec3, type VoxelGrid } from '../core/grid';
import { PRESETS, generate, type LayerMode } from '../core/generator';
import { History } from '../core/history';
import type { MappingProfile } from '../core/mapper';
import { mcFacts } from '../core/mcdb';
import { loadMinecraft, parseStateKey, type SourceGrid, type SourceState } from '../core/minecraft';
import { DIR_NAMES, anchorForBox, anchorFromCell, footprint, worldExtent } from '../core/orientation';
import { BUILTIN_PROFILES, cloneProfile, parseProfile, serializeProfile } from '../core/profiles';
import { chunkCount, readSbs, writeSbs } from '../core/sbs';
import { Viewer, type BlockLook, type Hit, type Tool } from '../viewer/viewer';
import { fileListSource } from './browser-source';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const num = (n: number) => n.toLocaleString('en-US');

interface Row { key: string; ids: string[]; count: number; targets: Set<string | null>; ruled: boolean }

const S = {
  /** Starts as a stand-in block list (coloured cubes) until the user picks their Spacebox GameSet folder. */
  gameSet: fallbackGameSet() as GameSet,
  demo: true,
  texUrls: new Map<string, string>(),
  source: null as SourceGrid | null,
  profile: cloneProfile(BUILTIN_PROFILES.ship!),
  edits: [] as ManualEdit[],
  result: null as ConversionResult | null,
  /** The converted grid with manual edits applied. This is what is shown and exported. */
  final: null as VoxelGrid | null,
  /** `key` is the row key (block id or material family); `ids` are the Minecraft block ids it covers. */
  selection: null as { key: string; ids: string[]; props: Record<string, string> } | null,
  groupMode: 'id' as 'id' | 'family',
  filter: '',
  isolate: false,
  showMulti: false,
  descTouched: false,
  tool: 'remap' as Tool,
  placeId: null as string | null,
  placeDir: 5,
  placeRot: 0,
  lastHit: null as Hit | null,
};

const viewer = new Viewer($('view'));
const status = (msg: string) => { $('status').textContent = msg; $('error').textContent = ''; };
const fail = (msg: string) => { $('error').textContent = msg; };
const sizeOf = (id: string): Vec3 => S.gameSet.byId.get(id)?.size ?? [1, 1, 1];
const isMulti = (b: SpaceboxBlock) => b.size[0] * b.size[1] * b.size[2] > 1;

// ---------- history (rules, shape, crop, hollow and manual edits) ----------
let history = new History();
let recTimer = 0;
const snapshot = () => JSON.stringify({ profile: S.profile, edits: S.edits });
function updateUndo() {
  ($('btn-undo') as HTMLButtonElement).disabled = !history.canUndo;
  ($('btn-redo') as HTMLButtonElement).disabled = !history.canRedo;
}
function recordSoon() {
  clearTimeout(recTimer);
  recTimer = window.setTimeout(() => { history.record(snapshot()); updateUndo(); }, 350);
}
function restore(s: string) {
  const o = JSON.parse(s) as { profile: MappingProfile; edits: ManualEdit[] };
  S.profile = o.profile;
  S.edits = o.edits;
  syncControls();
  renderCropValues();
  run(false);
}
function undo() {
  clearTimeout(recTimer);
  history.record(snapshot());
  const s = history.undo();
  if (s) restore(s);
  updateUndo();
}
function redo() {
  clearTimeout(recTimer);
  const s = history.redo();
  if (s) restore(s);
  updateUndo();
}

// ---------- loading ----------
const decoder = new TextDecoder();
function updateGameSetBadge() {
  const b = $('gs-badge');
  b.textContent = S.demo ? 'Demo Cubes' : 'Loaded';
  b.className = `badge ${S.demo ? 'warn' : 'ok'}`;
  $('demo').style.display = S.demo ? 'block' : 'none';
}

async function setGameSet(src: FileSource) {
  try {
    status('Reading GameSet');
    const gs = await loadGameSet(src);
    for (const url of S.texUrls.values()) URL.revokeObjectURL(url);
    S.texUrls.clear();
    for (const b of gs.blocks) {
      for (const path of Object.values(b.textures)) {
        if (S.texUrls.has(path) || !/\.png$/i.test(path)) continue;
        try { S.texUrls.set(path, URL.createObjectURL(new Blob([(await src.read(path)) as BlobPart], { type: 'image/png' }))); } catch { /* no texture */ }
      }
    }
    S.gameSet = gs;
    S.demo = false;
    updateGameSetBadge();
    status(`GameSet "${gs.modName}" ${gs.version} loaded: ${gs.blocks.length} blocks in ${gs.categories.length} categories`);
    renderPicker();
    run(true);
  } catch (e) { fail(e instanceof Error ? e.message : String(e)); }
}

/** An opened .sbs file as a source: its Spacebox ids pass through the mapper unchanged unless a rule remaps them. */
function sbsToSource(bytes: Uint8Array) {
  const { grid, meta } = readSbs(bytes);
  const palette: SourceState[] = grid.palette.map((n) => ({ id: n, props: {}, key: n }));
  palette[0] = { id: 'minecraft:air', props: {}, key: 'minecraft:air' };
  const src: SourceGrid = { size: [...grid.size], palette, data: grid.data.slice(), orient: grid.orient.slice(), offsets: new Map(grid.offsets) };
  return { src, meta };
}

interface SourceMeta { name?: string; author?: string; description?: string }

function useSource(src: SourceGrid, name: string, meta: SourceMeta = {}) {
  S.source = src;
  S.selection = null;
  S.edits = [];
  S.profile.crop = undefined;
  S.profile.rules = []; // overrides from the previous structure must not leak into this one
  const base = name.replace(/\.[^.]+$/, '');
  ($('meta-name') as HTMLInputElement).value = meta.name || base.replace(/[_-]+/g, ' ');
  if (meta.author) ($('meta-author') as HTMLInputElement).value = meta.author;
  if (meta.description) ($('meta-desc') as HTMLInputElement).value = meta.description;
  else if (!S.descTouched) ($('meta-desc') as HTMLInputElement).value = `Converted from ${name} with Blockport`;
  renderCrop();
  history = new History();
  run(true);
  clearTimeout(recTimer);
  history.record(snapshot());
  updateUndo();
  status(`${name} loaded`);
}

async function setModel(bytes: Uint8Array, name: string) {
  try {
    status(`Reading ${name}`);
    await new Promise((r) => setTimeout(r, 20));
    if (/\.sbs$/i.test(name)) {
      const { src, meta } = sbsToSource(bytes);
      useSource(src, name, { name: meta.name, author: meta.author, description: meta.description });
    } else useSource(loadMinecraft(bytes, name), name);
  } catch (e) { fail(e instanceof Error ? e.message : String(e)); }
}

// ---------- conversion and rendering ----------
function texOf(b: SpaceboxBlock, face: string): string | undefined {
  const p = b.textures[face];
  return p ? S.texUrls.get(p) : undefined;
}

function iconUrl(b: SpaceboxBlock): string | undefined {
  return texOf(b, 'All') ?? texOf(b, 'Forward') ?? texOf(b, 'Side') ?? [...Object.keys(b.textures)].map((f) => texOf(b, f)).find(Boolean);
}

function looks(): Map<string, BlockLook> {
  const m = new Map<string, BlockLook>();
  for (const b of S.gameSet.blocks) {
    m.set(b.id, {
      color: b.color, transparent: b.transparent, size: b.size,
      faces: { all: texOf(b, 'All') ?? texOf(b, 'Side') ?? texOf(b, 'Walls') ?? iconUrl(b), up: texOf(b, 'Up'), down: texOf(b, 'Down'), forward: texOf(b, 'Forward') },
    });
  }
  return m;
}

/** Does this Minecraft state belong to the current selection (block ids plus optional state filters)? */
function inSelection(state: { id: string; props: Record<string, string> }): boolean {
  const sel = S.selection;
  return !!sel && sel.ids.includes(state.id) && Object.entries(sel.props).every(([k, v]) => state.props[k] === v);
}

/** Palette index of the Minecraft block that produced the cell at a world position, or 0 if it was edited or is outside. */
function sourceIndexAt(world: Vec3): number {
  const r = S.result, f = S.final;
  if (!r || !f) return 0;
  const g = r.grid;
  const x = world[0] - g.min[0], y = world[1] - g.min[1], z = world[2] - g.min[2];
  if (x < 0 || y < 0 || z < 0 || x >= g.size[0] || y >= g.size[1] || z >= g.size[2]) return 0;
  const fx = world[0] - f.min[0], fy = world[1] - f.min[1], fz = world[2] - f.min[2];
  const fi = cellIndex(f, fx, fy, fz);
  if (g.palette[g.data[cellIndex(g, x, y, z)]!] !== f.palette[f.data[fi]!]) return 0; // replaced by an edit
  return r.sourceAt(x, y, z);
}

function worldOf(g: VoxelGrid, ci: number): Vec3 {
  const [sx, , sz] = g.size;
  return [g.min[0] + (ci % sx), g.min[1] + Math.floor(ci / (sx * sz)), g.min[2] + (Math.floor(ci / sx) % sz)];
}

function selectedCells(): Set<number> {
  const out = new Set<number>();
  const f = S.final;
  if (!f || !S.source || !S.selection) return out;
  const match = S.source.palette.map((st) => inSelection(st));
  for (let ci = 0; ci < f.data.length; ci++) {
    if (f.data[ci] !== 0 && match[sourceIndexAt(worldOf(f, ci))]) out.add(ci);
  }
  return out;
}

function draw(refit: boolean) {
  if (!S.final) return;
  const cells = S.selection && S.tool === 'remap' ? selectedCells() : null;
  viewer.setGrid(S.final, looks(), { visible: S.isolate && cells ? cells : null, refit });
  viewer.setHighlight(S.isolate ? null : cells);
}

function cropActive(): boolean {
  const c = S.profile.crop;
  return !!c && [...(c.min ?? []), ...(c.max ?? [])].some((v) => v !== null && v !== undefined);
}

function renderStats() {
  const r = S.result?.report, f = S.final;
  if (!r || !f) { $('stats').innerHTML = ''; return; }
  const pill = (label: string, value: string, cls = '') => `<span class="pill ${cls}"><b>${label}</b><span>${value}</span></span>`;
  $('stats').innerHTML = [
    pill('Input', num(r.inputBlocks)),
    pill('Output Blocks', num(countBlocks(f))),
    pill('Dropped', num(r.dropped), r.dropped > 0 ? 'bad' : ''),
    pill('Dimensions', f.size.join('×')),
    pill('Chunks', num(chunkCount(f))),
  ].join('');
}

function run(refit: boolean) {
  if (!S.source) {
    $('empty').style.display = 'flex';
    return;
  }
  $('empty').style.display = 'none';
  try {
    S.result = convert(S.source, S.gameSet, S.profile);
    S.final = applyEdits(S.result.grid, S.edits, sizeOf);
  } catch (e) { fail(e instanceof Error ? e.message : String(e)); return; }
  draw(refit);
  viewer.setCropBox(cropActive() ? S.result.window : null);
  ($('btn-export') as HTMLButtonElement).disabled = countBlocks(S.final) === 0;
  ($('btn-save-profile') as HTMLButtonElement).disabled = false;
  renderStats();
  renderRows();
  renderPickerState();
  recordSoon();
}

// ---------- left panel ----------
function family(id: string): string {
  const base = mcFacts(id)?.baseBlock;
  return base ?? id.replace(/_(stairs|slab|wall|fence_gate|fence|button|pressure_plate|trapdoor|door|wall_sign|sign|carpet|pane)$/, '');
}

function buildRows(): Row[] {
  if (!S.result) return [];
  const map = new Map<string, Row>();
  for (const s of S.result.report.states) {
    const id = parseStateKey(s.key).id;
    const key = S.groupMode === 'family' ? family(id) : id;
    let r = map.get(key);
    if (!r) { r = { key, ids: [], count: 0, targets: new Set(), ruled: false }; map.set(key, r); }
    if (!r.ids.includes(id)) r.ids.push(id);
    r.count += s.count;
    r.targets.add(s.target);
    if (S.profile.rules.some((x) => x.match === id || x.match.startsWith(`${id}[`))) r.ruled = true;
  }
  const q = S.filter.trim().toLowerCase();
  return [...map.values()].filter((r) => !q || r.key.toLowerCase().includes(q)).sort((a, b) => b.count - a.count);
}

function mcSwatch(id: string): string {
  const c = mcFacts(id)?.color;
  return c ? `rgb(${c[0]},${c[1]},${c[2]})` : '#555';
}

function targetCell(r: Row): string {
  const cls = r.ruled ? ' rule' : '';
  if (r.targets.size > 1) return `<div class="tg${cls}">mixed</div>`;
  const t = [...r.targets][0] ?? null;
  if (t === null) return `<div class="tg air${cls}">air</div>`;
  const b = S.gameSet.byId.get(t);
  const icon = b ? iconUrl(b) : undefined;
  return `<div class="tg${cls}" title="${esc(t)}">${icon ? `<img src="${icon}">` : ''}${esc(t.replace(/^[^:]*:/, ''))}</div>`;
}

function renderRows() {
  $('rows').innerHTML = buildRows().map((r) => {
    const on = S.selection?.key === r.key;
    return `<div class="row${on ? ' sel' : ''}" data-key="${esc(r.key)}"><span class="sw" style="background:${mcSwatch(r.ids[0]!)}"></span>` +
      `<span class="nm" title="${esc(r.ids.join(', '))}">${esc(r.key.replace(/^[a-z0-9_]+:/, ''))}</span><span class="ct">${num(r.count)}</span>${targetCell(r)}</div>`;
  }).join('');
}

function select(key: string | null) {
  if (key === null) S.selection = null;
  else {
    const row = buildRows().find((r) => r.key === key);
    S.selection = { key, ids: row?.ids ?? [key], props: {} };
  }
  draw(false);
  renderRows();
  renderPickerState();
  document.querySelector('#rows .row.sel')?.scrollIntoView({ block: 'nearest' });
}

$('rows').addEventListener('click', (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
  if (row) { setTool('remap'); select(row.dataset.key!); }
});
$('filter').addEventListener('input', (e) => { S.filter = (e.target as HTMLInputElement).value; renderRows(); });
for (const [id, mode] of [['tab-id', 'id'], ['tab-family', 'family']] as const) {
  $(id).addEventListener('click', () => {
    S.groupMode = mode;
    $('tab-id').classList.toggle('on', mode === 'id');
    $('tab-family').classList.toggle('on', mode === 'family');
    S.selection = null;
    run(false);
  });
}

// ---------- tools and viewport ----------
function setTool(t: Tool) {
  S.tool = t;
  viewer.tool = t;
  viewer.setGhost(null);
  S.lastHit = null;
  document.querySelectorAll<HTMLElement>('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  $('view').className = `tool-${t}`;
  if (t !== 'remap') viewer.setHighlight(null); else draw(false);
  renderPicker();
  renderPickerState();
}
$('tools').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-tool]');
  if (b) setTool(b.dataset.tool as Tool);
});
$('cams').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-view]');
  if (!b) return;
  if (b.dataset.view === 'fit') viewer.fit(); else viewer.snap(b.dataset.view as 'front' | 'top' | 'side' | 'iso');
});
$('cam-rotate').addEventListener('click', (e) => {
  const on = !(e.currentTarget as HTMLElement).classList.contains('on');
  (e.currentTarget as HTMLElement).classList.toggle('on', on);
  viewer.setAutoRotate(on);
});

function needsOrientation(b: SpaceboxBlock): boolean {
  return isMulti(b) || b.type !== undefined || b.model !== undefined;
}

interface Placement { min: Vec3; size: Vec3; anchor: Vec3; direction: number; rotation: number; valid: boolean; block: SpaceboxBlock }

function placementFor(hit: Hit): Placement | null {
  const b = S.placeId ? S.gameSet.byId.get(S.placeId) : undefined;
  if (!b) return null;
  const ext = worldExtent(b.size, S.placeDir, S.placeRot);
  const target: Vec3 = [hit.cell[0] + hit.normal[0], hit.cell[1] + hit.normal[1], hit.cell[2] + hit.normal[2]];
  const min: Vec3 = [0, 1, 2].map((a) => (hit.normal[a]! < 0 ? target[a]! - ext[a]! + 1 : target[a]!)) as Vec3;
  const anchor = anchorForBox(min, b.size, S.placeDir, S.placeRot);
  let valid = true;
  for (const c of footprint(anchor, b.size, S.placeDir, S.placeRot)) {
    if (viewer.indexOfCell(c.pos) >= 0 && S.final!.data[viewer.indexOfCell(c.pos)] !== 0) { valid = false; break; }
  }
  return { min, size: ext, anchor, direction: S.placeDir, rotation: S.placeRot, valid, block: b };
}

function showGhost() {
  const p = S.tool === 'place' && S.lastHit ? placementFor(S.lastHit) : null;
  viewer.setGhost(p ? { min: p.min, size: p.size, direction: p.direction, valid: p.valid } : null);
}

function addEdit(e: ManualEdit) {
  S.edits = [...S.edits, e];
  run(false);
  showGhost(); // the spot is now taken, so the preview turns red
}

viewer.onHover = (hit) => {
  S.lastHit = hit;
  if (S.tool === 'place') showGhost();
  else if (S.tool === 'erase') {
    const cells = hit ? blockCellsAt(hit.cell) : [];
    viewer.setHighlight(cells.length ? cells : null, 0xe0686b);
  }
};

/** Grid indexes of every cell of the block at a world cell (all of a multi-block's cells, or just the one). */
function blockCellsAt(cell: Vec3): number[] {
  const f = S.final;
  const ci = viewer.indexOfCell(cell);
  if (!f || ci < 0 || f.data[ci] === 0) return [];
  const size = sizeOf(f.palette[f.data[ci]!]!);
  if (size[0] * size[1] * size[2] <= 1) return [ci];
  const o = decodeOrient(f.orient[ci]!) ?? { direction: 5, rotation: 0 };
  const anchor = anchorFromCell(cell, f.offsets.get(ci) ?? 0, o.direction, o.rotation);
  const out = footprint(anchor, size, o.direction, o.rotation).map((c) => viewer.indexOfCell(c.pos)).filter((i) => i >= 0);
  return out.length ? out : [ci];
}

viewer.onPick = (hit) => {
  if (S.tool === 'remap') {
    if (!hit || !S.final) return select(null);
    const id = S.source?.palette[sourceIndexAt(hit.cell)]?.id;
    if (!id) return select(null);
    return select(S.groupMode === 'family' ? family(id) : id);
  }
  if (!hit) return;
  if (S.tool === 'erase') {
    viewer.setHighlight(null);
    addEdit({ type: 'erase', pos: hit.cell });
    return;
  }
  const p = placementFor(hit);
  if (!p) return status('Choose a Spacebox block on the right first');
  if (!p.valid) return status('That space is occupied. Erase the blocks in the way first');
  addEdit({ type: 'place', pos: p.anchor, blockId: p.block.id, direction: needsOrientation(p.block) ? p.direction : -1, rotation: p.rotation });
};

// ---------- right panel: block picker and remapping ----------
function iconHtml(b: SpaceboxBlock): string {
  const url = iconUrl(b);
  return url ? `<img src="${url}" alt="">` : `<div class="dot" style="background:${b.color ? `rgb(${b.color})` : '#555'}"></div>`;
}

function renderPicker() {
  const cats = new Map<string, SpaceboxBlock[]>();
  const showMulti = S.showMulti || S.tool === 'place';
  for (const b of S.gameSet.blocks) {
    if (isMulti(b) && !showMulti) continue;
    let l = cats.get(b.category);
    if (!l) { l = []; cats.set(b.category, l); }
    l.push(b);
  }
  $('picker').innerHTML = [...cats].map(([cat, list]) =>
    `<div class="cat">${esc(cat)}</div><div class="grid">${list.map((b) =>
      `<button data-id="${esc(b.id)}" title="${esc(b.name)} (${esc(b.id)})">${iconHtml(b)}${isMulti(b) ? `<span class="sz-badge">${b.size.join('×')}</span>` : ''}</button>`).join('')}</div>`).join('');
  renderPickerState();
}

function currentTargets(): Set<string | null> {
  const out = new Set<string | null>();
  if (!S.selection || !S.result) return out;
  for (const s of S.result.report.states) if (inSelection(parseStateKey(s.key))) out.add(s.target);
  return out;
}

/** Buttons for every state property that varies in the selected blocks (half, type, facing, ...). */
function renderStates() {
  const el = $('states');
  const sel = S.selection;
  if (!sel || !S.result || S.tool !== 'remap') { el.innerHTML = ''; return; }
  const props = new Map<string, Map<string, number>>();
  for (const s of S.result.report.states) {
    const st = parseStateKey(s.key);
    if (!sel.ids.includes(st.id)) continue;
    for (const [k, v] of Object.entries(st.props)) {
      let m = props.get(k);
      if (!m) { m = new Map(); props.set(k, m); }
      m.set(v, (m.get(v) ?? 0) + s.count);
    }
  }
  const varying = [...props].filter(([k, m]) => m.size > 1 || k in sel.props);
  el.innerHTML = varying.length
    ? `<div class="cat">Only these states (optional)</div>` + varying.map(([k, m]) =>
      `<div class="facet"><span>${esc(k)}</span>${[...m].sort((a, b) => b[1] - a[1]).map(([v, n]) =>
        `<button data-prop="${esc(k)}" data-val="${esc(v)}" class="${sel.props[k] === v ? 'on' : ''}" title="${num(n)} blocks">${esc(v)}</button>`).join('')}</div>`).join('')
    : '';
}

$('states').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-prop]');
  if (!b || !S.selection) return;
  const k = b.dataset.prop!, v = b.dataset.val!;
  if (S.selection.props[k] === v) delete S.selection.props[k]; else S.selection.props[k] = v;
  draw(false);
  renderPickerState();
});

function selectionLabel(): string {
  const sel = S.selection!;
  const filter = Object.entries(sel.props).map(([k, v]) => `${k}=${v}`).join(', ');
  return sel.key.replace(/^[a-z0-9_]+:/, '') + (filter ? ` [${filter}]` : '');
}

const ROLLS = [0, 90, 180, 270];
function renderPlaceCtl() {
  const el = $('place-ctl');
  if (S.tool === 'remap') { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'block';
  let h = '';
  if (S.tool === 'place') {
    h += `<div class="row2"><span>Direction</span><div class="seg">${DIR_NAMES.map((n, i) => `<button data-dir="${i}" class="${S.placeDir === i ? 'on' : ''}">${n}</button>`).join('')}</div></div>`;
    h += `<div class="row2"><span>Roll</span><div class="seg">${ROLLS.map((d, i) => `<button data-roll="${i}" class="${S.placeRot === i ? 'on' : ''}">${d}&deg;</button>`).join('')}</div></div>`;
  }
  if (S.edits.length) h += `<button id="btn-clear-edits">Clear manual edits (${S.edits.length})</button>`;
  el.innerHTML = h;
}

$('place-ctl').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  if (b.dataset.dir !== undefined) S.placeDir = Number(b.dataset.dir);
  else if (b.dataset.roll !== undefined) S.placeRot = Number(b.dataset.roll);
  else if (b.id === 'btn-clear-edits') { S.edits = []; run(false); showGhost(); return; }
  renderPickerState();
  showGhost();
});

function renderPickerState() {
  const remap = S.tool === 'remap', place = S.tool === 'place';
  renderPlaceCtl();
  const has = !!S.selection;
  const n = S.selection ? S.selection.ids.length : 0;
  if (remap) {
    $('pick-title').textContent = has ? `Remap: ${selectionLabel()}` : 'Remap';
    $('pick-sub').textContent = has ? `${n} block type${n === 1 ? '' : 's'} selected. Click a Spacebox block to use it instead.` : 'Select a block on the left or click it in the 3D view.';
  } else if (place) {
    const b = S.placeId ? S.gameSet.byId.get(S.placeId) : undefined;
    $('pick-title').textContent = b ? `Place: ${b.name}` : 'Place';
    $('pick-sub').textContent = b
      ? `Facing ${DIR_NAMES[S.placeDir]}, roll ${S.placeRot * 90} degrees. Press R to turn the block, Shift+R to roll it, then click a face in the 3D view.`
      : 'Choose a Spacebox block below, then click a face in the 3D view to attach it.';
  } else {
    $('pick-title').textContent = 'Erase';
    $('pick-sub').textContent = 'Click a block in the 3D view to remove it. A multi-block is removed whole.';
  }
  $('remap-chips').style.display = remap ? 'flex' : 'none';
  const nRules = S.profile.rules.length;
  const reset = $('btn-reset-rules');
  reset.style.display = remap && nRules > 0 ? '' : 'none';
  reset.textContent = `Reset all remaps (${nRules})`;
  $('picker').style.display = S.tool === 'erase' ? 'none' : 'block';
  ($('btn-auto') as HTMLButtonElement).disabled = !has;
  ($('btn-air') as HTMLButtonElement).disabled = !has;
  renderStates();
  const cur = place ? new Set<string | null>([S.placeId]) : currentTargets();
  document.querySelectorAll<HTMLElement>('#picker button').forEach((b) => b.classList.toggle('cur', cur.size === 1 && cur.has(b.dataset.id!)));
}

function applyTarget(target: string | null) {
  if (!S.selection) return;
  const { ids, props } = S.selection;
  const filter = Object.keys(props).sort().map((k) => `${k}=${props[k]}`).join(',');
  const matches = ids.map((id) => (filter ? `${id}[${filter}]` : id));
  const set = new Set(matches);
  S.profile.rules = S.profile.rules.filter((r) => !set.has(r.match));
  if (target !== null) for (const match of matches) S.profile.rules.unshift({ match, target });
  run(false);
}

function chooseBlockToPlace(id: string) {
  S.placeId = id;
  const b = S.gameSet.byId.get(id);
  S.placeDir = b?.type === 'thruster' ? 4 : 5;
  S.placeRot = 0;
  renderPickerState();
  showGhost();
}

$('picker').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-id]');
  if (!b) return;
  const id = b.dataset.id!;
  if (S.tool === 'place') return chooseBlockToPlace(id);
  const blk = S.gameSet.byId.get(id);
  if (blk && isMulti(blk)) {
    // A multi-block cannot replace single cells: that would write pieces without their offsets.
    setTool('place');
    chooseBlockToPlace(id);
    status(`${blk.name} is a ${blk.size.join('x')} block, so it is placed instead of remapped. Click a face in the 3D view.`);
    return;
  }
  applyTarget(id);
});
$('btn-reset-rules').addEventListener('click', () => { S.profile.rules = []; run(false); });
$('btn-auto').addEventListener('click', () => applyTarget(null));
$('btn-air').addEventListener('click', () => applyTarget('air'));
$('chk-isolate').addEventListener('change', (e) => { S.isolate = (e.target as HTMLInputElement).checked; draw(false); });
$('chk-multi').addEventListener('change', (e) => { S.showMulti = (e.target as HTMLInputElement).checked; renderPicker(); });

// ---------- settings ----------
const SHAPES: [keyof MappingProfile['shapes'], string, [string, string][]][] = [
  ['slab', 'Slabs', [['full', 'All as full blocks'], ['top-full', 'Top slabs only'], ['bottom-full', 'Bottom slabs only'], ['drop', 'Drop all']]],
  ['stair', 'Stairs', [['full', 'Full block'], ['drop', 'Drop']]],
  ['wall', 'Walls', [['full', 'Full block'], ['drop', 'Drop']]],
  ['fence', 'Fences and bars', [['drop', 'Drop'], ['full', 'Full block']]],
  ['pane', 'Glass panes', [['window', 'Window block'], ['full', 'Full block'], ['drop', 'Drop']]],
  ['door', 'Doors', [['drop', 'Drop'], ['lower-full', 'Lower half as block']]],
  ['decor', 'Other decor', [['drop', 'Drop'], ['full', 'Full block']]],
];

function renderShapes() {
  $('shapes').innerHTML = SHAPES.map(([key, label, opts]) =>
    `<label class="f">${label}<select data-shape="${key}">${opts.map(([v, t]) => `<option value="${v}"${S.profile.shapes[key] === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`).join('');
}
$('shapes').addEventListener('change', (e) => {
  const sel = e.target as HTMLSelectElement;
  (S.profile.shapes as Record<string, string>)[sel.dataset.shape!] = sel.value;
  run(false);
});

$('sel-profile').addEventListener('change', (e) => {
  const next = cloneProfile(BUILTIN_PROFILES[(e.target as HTMLSelectElement).value]!);
  next.rules = S.profile.rules;
  next.crop = S.profile.crop;
  next.flipZ = S.profile.flipZ;
  S.profile = next;
  syncControls();
  run(false);
});

// Cross-section: a slider and a number box per bound, kept in sync.
const AXES = ['X', 'Y', 'Z'];
const maxOf = (i: number) => Math.max(0, (S.source?.size[i] ?? 1) - 1);

function renderCrop() {
  const row = (a: string, i: number) =>
    `<span>${a}</span>` +
    `<input type="range" data-crop="min" data-axis="${i}" min="0" max="${maxOf(i)}" value="0" aria-label="${a} min" />` +
    `<input type="number" data-crop="min" data-axis="${i}" min="0" max="${maxOf(i)}" value="0" aria-label="${a} min value" />` +
    `<input type="range" data-crop="max" data-axis="${i}" min="0" max="${maxOf(i)}" value="${maxOf(i)}" aria-label="${a} max" />` +
    `<input type="number" data-crop="max" data-axis="${i}" min="0" max="${maxOf(i)}" value="${maxOf(i)}" aria-label="${a} max value" />`;
  $('crop').innerHTML = `<span></span><span class="hd">Min</span><span></span><span class="hd">Max</span><span></span>` + AXES.map(row).join('');
}

function cropInputs(side: 'min' | 'max', i: number) {
  return [...document.querySelectorAll<HTMLInputElement>(`[data-crop="${side}"][data-axis="${i}"]`)];
}

function renderCropValues() {
  for (let i = 0; i < 3; i++) {
    const lo = S.profile.crop?.min?.[i] ?? 0, hi = S.profile.crop?.max?.[i] ?? maxOf(i);
    for (const el of cropInputs('min', i)) el.value = String(lo);
    for (const el of cropInputs('max', i)) el.value = String(hi);
  }
}

$('crop').addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  const i = Number(t.dataset.axis), side = t.dataset.crop as 'min' | 'max';
  let v = Math.min(maxOf(i), Math.max(0, Number(t.value) || 0));
  const other = Number(cropInputs(side === 'min' ? 'max' : 'min', i)[0]!.value);
  if (side === 'min' && v > other) v = other;
  if (side === 'max' && v < other) v = other;
  for (const el of cropInputs(side, i)) el.value = String(v);
  const read = (s: 'min' | 'max') => AXES.map((_, a) => {
    const val = Number(cropInputs(s, a)[0]!.value);
    return val === (s === 'min' ? 0 : maxOf(a)) ? null : val;
  });
  const min = read('min'), max = read('max');
  S.profile.crop = [...min, ...max].some((x) => x !== null) ? { min, max } : undefined;
  run(false);
});
$('btn-crop-reset').addEventListener('click', () => { S.profile.crop = undefined; renderCropValues(); run(false); });
$('chk-hollow').addEventListener('change', (e) => { S.profile.hollow.enabled = (e.target as HTMLInputElement).checked; run(false); });
$('num-hollow').addEventListener('input', (e) => { S.profile.hollow.thickness = Math.min(3, Math.max(1, Number((e.target as HTMLInputElement).value) || 1)); run(false); });
$('chk-flip').addEventListener('change', (e) => { S.profile.flipZ = (e.target as HTMLInputElement).checked; run(true); });

function syncControls() {
  ($('chk-hollow') as HTMLInputElement).checked = S.profile.hollow.enabled;
  ($('num-hollow') as HTMLInputElement).value = String(S.profile.hollow.thickness);
  ($('chk-flip') as HTMLInputElement).checked = S.profile.flipZ;
  renderShapes();
}

// ---------- file buttons, drag and drop ----------
$('btn-gameset').addEventListener('click', () => $('in-gameset').click());
$('in-gameset').addEventListener('change', (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (files?.length) void setGameSet(fileListSource(files));
});
$('btn-model').addEventListener('click', () => $('in-model').click());
async function openModel(f: File) { await setModel(new Uint8Array(await f.arrayBuffer()), f.name); }
$('in-model').addEventListener('change', (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void openModel(f); });

const view = $('view');
view.addEventListener('dragover', (e) => { e.preventDefault(); view.classList.add('over'); });
view.addEventListener('dragleave', () => view.classList.remove('over'));
view.addEventListener('drop', (e) => {
  e.preventDefault();
  view.classList.remove('over');
  const f = e.dataTransfer?.files[0];
  if (f) void openModel(f);
});

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$('btn-save-profile').addEventListener('click', () => download(new Blob([serializeProfile(S.profile)], { type: 'application/json' }), 'blockport-profile.json'));
$('btn-load-profile').addEventListener('click', () => $('in-profile').click());
$('in-profile').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try { S.profile = parseProfile(decoder.decode(new Uint8Array(await f.arrayBuffer()))); syncControls(); renderCropValues(); run(false); }
  catch (err) { fail(`Not a valid profile: ${err instanceof Error ? err.message : String(err)}`); }
});

$('meta-desc').addEventListener('input', () => { S.descTouched = true; });
{
  let author = 'Blockport';
  try { author = localStorage.getItem('blockport-author') || author; } catch { /* storage unavailable */ }
  ($('meta-author') as HTMLInputElement).value = author;
}
$('meta-author').addEventListener('input', (e) => { try { localStorage.setItem('blockport-author', (e.target as HTMLInputElement).value); } catch { /* ignore */ } });

// ---------- export ----------
async function thumbnail(): Promise<{ bytes: Uint8Array; url: string }> {
  const url = viewer.captureClean((src) => {
    const w = 320, h = Math.max(1, Math.round((src.height / src.width) * w));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(src, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.85);
  });
  return { bytes: Uint8Array.from(atob(url.split(',')[1]!), (ch) => ch.charCodeAt(0)), url };
}

let toastTimer = 0;
// Resolves after a paint, or after 60 ms when the tab is in the background and the browser pauses animation frames.
const nextFrame = () => new Promise<void>((resolve) => {
  let done = false;
  const go = () => { if (!done) { done = true; resolve(); } };
  requestAnimationFrame(() => setTimeout(go, 0));
  setTimeout(go, 60);
});
let lastBytes: { bytes: Uint8Array; name: string } | null = null;

function openToast(): void {
  clearTimeout(toastTimer);
  $('toast').classList.add('show', 'busy');
  $('toast').classList.remove('canload');
  $('toast-title').className = '';
  $('toast-title').textContent = 'Exporting...';
}

async function progress(pct: number, text: string) {
  ($('toast-bar') as HTMLElement).style.width = `${pct}%`;
  $('toast-step').textContent = `${pct}% - ${text}`;
  await nextFrame(); // let the browser paint before the next heavy step
}

interface ToastDone { file: string; sizeKb: number; blocks: number; chunks: number; thumb: string }
function finishToast(d: ToastDone) {
  $('toast').classList.remove('busy');
  $('toast').classList.add('canload');
  $('toast-title').textContent = 'Export complete';
  $('toast-title').className = '';
  $('toast-note').textContent = `Downloaded ${d.file} (${num(d.sizeKb)} KB). Move it from your browser downloads into Spacebox/Structures/ (or click "Open folder" in Spacebox's in-game Structures menu).`;
  ($('toast-img') as HTMLImageElement).src = d.thumb;
  $('toast-file').textContent = d.file;
  $('toast-info').textContent = `${num(d.blocks)} blocks in ${num(d.chunks)} chunk${d.chunks === 1 ? '' : 's'}`;
  toastTimer = window.setTimeout(() => $('toast').classList.remove('show'), 30000);
}
$('toast-x').addEventListener('click', () => $('toast').classList.remove('show'));
$('toast-dl').addEventListener('click', () => {
  if (lastBytes) download(new Blob([lastBytes.bytes as BlobPart], { type: 'application/octet-stream' }), lastBytes.name);
});

const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

// A standard browser download always works and shows up in the browser's downloads list. (The file picker API is
// blocked by Chrome for folders such as Downloads, where many people keep the game.)
$('btn-export').addEventListener('click', async () => {
  const f = S.final;
  if (!f) return;
  const name = ($('meta-name') as HTMLInputElement).value.trim() || 'Structure';
  const file = (name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Structure') + '.sbs';

  openToast();
  try {
    await progress(20, 'Rendering clean 3D thumbnail...');
    const thumb = await thumbnail();
    await progress(60, 'Packing chunks & compressing .sbs...');
    const bytes = writeSbs(f, {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'structure',
      name,
      author: ($('meta-author') as HTMLInputElement).value,
      description: ($('meta-desc') as HTMLInputElement).value,
      gameVersion: S.gameSet.version,
      gamesets: [S.gameSet.modId],
      voidName: `${S.gameSet.modId}:void`,
      picture: thumb.bytes,
    });
    lastBytes = { bytes, name: file };
    await progress(90, 'Starting browser download...');
    download(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), file);
    await progress(100, 'Export complete!');
    finishToast({ file, sizeKb: Math.max(1, Math.round(bytes.length / 1024)), blocks: countBlocks(f), chunks: chunkCount(f), thumb: thumb.url });
    status(`Exported ${file}`);
  } catch (e) {
    $('toast').classList.remove('show', 'busy');
    fail(`Export failed: ${describe(e)}`);
  }
});

// ---------- keyboard ----------
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox' && (t as HTMLInputElement).type !== 'range') return;
  if (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
  if ($('gen-modal').classList.contains('show')) { if (e.key === 'Escape') closeGen(); return; }
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (e.key.toLowerCase() === 'r' && !ctrl && S.tool === 'place') {
    e.preventDefault();
    if (e.shiftKey) S.placeRot = (S.placeRot + 1) % 4; else S.placeDir = (S.placeDir + 1) % 6;
    renderPickerState();
    showGhost();
  }
  if (e.key === 'Escape') setTool('remap');
});
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);

// ---------- demo ship ----------
async function loadDemo() {
  try {
    status('Loading the demo ship');
    const res = await fetch(`${import.meta.env.BASE_URL}demo/millennium_falcon_mk1.sbs`);
    if (!res.ok) throw new Error(`Demo file not found (${res.status})`);
    await setModel(new Uint8Array(await res.arrayBuffer()), 'millennium_falcon_mk1.sbs');
  } catch (e) { fail(e instanceof Error ? e.message : String(e)); }
}
$('btn-demo').addEventListener('click', () => void loadDemo());
if (new URLSearchParams(location.search).has('demo')) void loadDemo();

// ---------- generator ----------
const genEl = {
  preset: $('gen-preset') as HTMLSelectElement, expr: $('gen-expr') as HTMLTextAreaElement, size: $('gen-size') as HTMLSelectElement,
  scale: $('gen-scale') as HTMLInputElement, t: $('gen-t') as HTMLInputElement, layers: $('gen-layers') as HTMLSelectElement,
};
function closeGen() { $('gen-modal').classList.remove('show'); }
function applyPreset() {
  const p = PRESETS.find((x) => x.id === genEl.preset.value);
  genEl.expr.readOnly = !!p?.field;
  if (p) {
    genEl.expr.value = p.field ? `(built-in ${p.name.toLowerCase()} shape)` : p.expr;
    genEl.scale.value = String(p.scale);
    genEl.t.value = String(p.t);
  } else if (genEl.expr.readOnly || genEl.expr.value.startsWith('(built-in')) genEl.expr.value = '';
  $('gen-t-val').textContent = genEl.t.value;
}
genEl.preset.innerHTML = PRESETS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('') + '<option value="">Custom expression</option>';
applyPreset();
genEl.preset.addEventListener('change', applyPreset);
genEl.expr.addEventListener('input', () => {
  const p = PRESETS.find((x) => x.id === genEl.preset.value);
  if (p) genEl.preset.value = '';
});
genEl.t.addEventListener('input', () => { $('gen-t-val').textContent = genEl.t.value; });
genEl.size.addEventListener('change', () => { $('gen-custom').style.display = genEl.size.value === 'custom' ? 'block' : 'none'; });
$('btn-generate').addEventListener('click', () => { $('gen-err').textContent = ''; $('gen-modal').classList.add('show'); });
$('gen-cancel').addEventListener('click', closeGen);
$('gen-modal').addEventListener('mousedown', (e) => { if (e.target === $('gen-modal')) closeGen(); });
$('gen-go').addEventListener('click', async () => {
  const btn = $('gen-go') as HTMLButtonElement;
  const n = genEl.size.value === 'custom'
    ? (['gen-x', 'gen-y', 'gen-z'].map((id) => Number(($(id) as HTMLInputElement).value) || 1) as Vec3)
    : ([1, 2, 3].map(() => Number(genEl.size.value)) as Vec3);
  btn.disabled = true;
  btn.textContent = 'Generating...';
  $('gen-err').textContent = '';
  await nextFrame();
  try {
    const preset = PRESETS.find((x) => x.id === genEl.preset.value);
    const g = generate({ expr: genEl.expr.value, preset: preset?.id, size: n, scale: Number(genEl.scale.value) || 1, t: Number(genEl.t.value), layers: genEl.layers.value as LayerMode });
    S.profile.flipZ = false;
    ($('chk-flip') as HTMLInputElement).checked = false;
    const label = g.label === 'Expression' ? 'Generated structure' : g.label;
    useSource(g.grid, `${label}.generated`, { name: label, description: `Generated with Blockport: ${label}` });
    closeGen();
    status(`Generated ${num(g.blocks)} blocks (${g.grid.size.join('x')} grid)`);
  } catch (e) {
    $('gen-err').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
});

syncControls();
renderCrop();
renderPicker();
updateGameSetBadge();
updateUndo();

// ---------- dev server shortcut: /?dev loads files named by BLOCKPORT_DEV_* (see vite.config.ts) ----------
if (import.meta.env.DEV && new URLSearchParams(location.search).has('dev')) {
  void (async () => {
    const info = await (await fetch('/__dev/info')).json() as { gameset: boolean; model: string | null };
    if (info.gameset && new URLSearchParams(location.search).get('dev') !== 'model') {
      const files = await (await fetch('/__dev/list')).json() as string[];
      await setGameSet({
        list: () => files,
        read: async (p) => new Uint8Array(await (await fetch(`/__dev/file?p=${encodeURIComponent(p)}`)).arrayBuffer()),
      });
    }
    if (info.model) await setModel(new Uint8Array(await (await fetch('/__dev/model')).arrayBuffer()), info.model);
  })();
}
