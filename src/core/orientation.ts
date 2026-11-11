// Spacebox block orientation (direction 0..5 and rotation 0..3) and multi-block footprints. No DOM or Three.js imports.
//
// What ship.sbs shows (all verified against the game's own file, see tests/local.test.ts):
//  - `direction` is where the block's local +Z axis points in the world: 0 = -Y, 1 = +Y, 2 = -X, 3 = +X, 4 = -Z, 5 = +Z.
//    Thrusters on the rear of the ship use 4 (nozzle toward the back), bottom thrusters use 0, side thrusters 2 and 3.
//  - `rotation` rolls the block around that axis in 90 degree steps.
//  - Every cell of a multi-block carries the block's name and orientation. The anchor cell (local 0,0,0) has no entry in
//    `multiblock_offsets`; every other cell has local = lx | ly << 4 | lz << 8, the cell's position in the block's own frame.
// Directions 0, 3 and 5 and the rotations seen with them are confirmed by data; the other combinations follow the same
// rotation model and are not confirmed by a real file yet.
import type { Vec3 } from './grid';

export const DIR_VECTORS: Vec3[] = [[0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]];
export const DIR_NAMES = ['Down', 'Up', 'Left', 'Right', 'Back', 'Forward'];

/** 3x3 integer matrix stored as three columns: the world images of local X, Y and Z. */
type Mat = [Vec3, Vec3, Vec3];

// Rotation that takes local +Z onto the world axis of each direction.
const TO_DIR: Mat[] = [
  [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
];

// Roll around local Z, clockwise by rotation * 90 degrees.
const ROLL: Mat[] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
  [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],
];

function apply(m: Mat, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
    m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
    m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
  ];
}

/** Matrix that turns block-local coordinates into world offsets for an orientation. */
export function orientationMatrix(direction: number, rotation: number): Mat {
  const r = TO_DIR[((direction % 6) + 6) % 6]!, roll = ROLL[((rotation % 4) + 4) % 4]!;
  return [apply(r, roll[0]), apply(r, roll[1]), apply(r, roll[2])];
}

export function packOffset(l: Vec3): number { return l[0] | (l[1] << 4) | (l[2] << 8); }
export function unpackOffset(v: number): Vec3 { return [v & 15, (v >> 4) & 15, (v >> 8) & 15]; }

export interface FootprintCell { pos: Vec3; local: Vec3; offset: number }

/** Every cell a block of `size` occupies when its anchor is at `anchor`. */
export function footprint(anchor: Vec3, size: Vec3, direction: number, rotation: number): FootprintCell[] {
  const m = orientationMatrix(direction, rotation);
  const out: FootprintCell[] = [];
  for (let lx = 0; lx < size[0]; lx++) for (let ly = 0; ly < size[1]; ly++) for (let lz = 0; lz < size[2]; lz++) {
    const d = apply(m, [lx, ly, lz]);
    out.push({ pos: [anchor[0] + d[0], anchor[1] + d[1], anchor[2] + d[2]], local: [lx, ly, lz], offset: packOffset([lx, ly, lz]) });
  }
  return out;
}

/** Anchor cell of a block found from any of its cells and that cell's stored offset. */
export function anchorFromCell(cell: Vec3, offset: number, direction: number, rotation: number): Vec3 {
  const d = apply(orientationMatrix(direction, rotation), unpackOffset(offset));
  return [cell[0] - d[0], cell[1] - d[1], cell[2] - d[2]];
}

/** World extents (cells per axis) of a block's footprint in an orientation. */
export function worldExtent(size: Vec3, direction: number, rotation: number): Vec3 {
  const d = apply(orientationMatrix(direction, rotation), [size[0] - 1, size[1] - 1, size[2] - 1]);
  return [Math.abs(d[0]) + 1, Math.abs(d[1]) + 1, Math.abs(d[2]) + 1];
}

/** Anchor that makes the footprint fill the box starting at `min`. */
export function anchorForBox(min: Vec3, size: Vec3, direction: number, rotation: number): Vec3 {
  const m = orientationMatrix(direction, rotation);
  const ext = worldExtent(size, direction, rotation);
  const anchor: Vec3 = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    // Which local axis lands on world axis a, and with what sign?
    let sign = 1;
    for (let j = 0; j < 3; j++) if (m[j]![a] !== 0) sign = m[j]![a]!;
    anchor[a] = sign > 0 ? min[a]! : min[a]! + ext[a]! - 1;
  }
  return anchor;
}
