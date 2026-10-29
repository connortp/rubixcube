// Pure cube model: no DOM, no three.js, so it can be unit tested in Node.
//
// Coordinates are "doubled" integers so every cubie centre is an integer even on
// cubes of any size: on an N×N cube each axis runs over -(N-1), -(N-3), ..., N-1.
// The centre slice of an odd cube sits at 0.
//
// Every sticker knows its cubie position, the direction it faces (normal) and the
// direction the top of its letter points (up). A layer turn rotates all three.

// Faces in the order they appear in the share grid. `right` and `down` describe how
// a face is read (left-to-right rows, top-to-bottom) when you look straight at it
// with the cube held in its starting orientation.
export const FACES = [
  { id: "U", name: "Top",    normal: [0, 1, 0],  right: [1, 0, 0],  down: [0, 0, 1] },
  { id: "F", name: "Front",  normal: [0, 0, 1],  right: [1, 0, 0],  down: [0, -1, 0] },
  { id: "R", name: "Right",  normal: [1, 0, 0],  right: [0, 0, -1], down: [0, -1, 0] },
  { id: "B", name: "Back",   normal: [0, 0, -1], right: [-1, 0, 0], down: [0, -1, 0] },
  { id: "L", name: "Left",   normal: [-1, 0, 0], right: [0, 0, 1],  down: [0, -1, 0] },
  { id: "D", name: "Bottom", normal: [0, -1, 0], right: [1, 0, 0],  down: [0, 0, -1] },
];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a, k) => [a[0] * k + 0, a[1] * k + 0, a[2] * k + 0];
const add = (...vs) => vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

// Rotate an integer vector +90° (right-handed) around the x, y or z axis, `dir`
// quarter turns (dir is +1 or -1).
export function rotateVec(v, axis, dir) {
  let [x, y, z] = v;
  const turns = ((dir % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) {
    if (axis === 0) [y, z] = [-z, y];
    else if (axis === 1) [z, x] = [-x, z];
    else [x, y] = [-y, x];
  }
  return [x + 0, y + 0, z + 0]; // +0 turns -0 into 0
}

// faceLetters[f][row][col] -> a fresh cube with those letters in place.
export function createCube(n, faceLetters) {
  const stickers = [];
  FACES.forEach((face, f) => {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const pos = add(
          scale(face.normal, n - 1),
          scale(face.right, 2 * c - (n - 1)),
          scale(face.down, 2 * r - (n - 1)),
        );
        stickers.push({
          id: stickers.length,
          pos,
          normal: [...face.normal],
          up: scale(face.down, -1),
          letter: faceLetters[f][r][c],
        });
      }
    }
  });
  return { n, stickers };
}

export function cloneCube(cube) {
  return {
    n: cube.n,
    stickers: cube.stickers.map((s) => ({ ...s, pos: [...s.pos], normal: [...s.normal], up: [...s.up] })),
  };
}

// A move turns one layer: every cubie whose coordinate on `axis` equals `layer`
// rotates a quarter turn (`dir` = +1 or -1, right-handed around the positive axis).
export function isMoveAllowed(n, move) {
  const { axis, layer, dir } = move;
  if (![0, 1, 2].includes(axis) || ![1, -1].includes(dir)) return false;
  if (Math.abs(layer) > n - 1 || (layer + n - 1) % 2 !== 0) return false;
  // The very middle slice of an odd cube holds the face centres, which never move.
  return !(n % 2 === 1 && layer === 0);
}

// The single centre sticker of each face on an odd cube. Its letter stays upright
// forever, so it doubles as the "this way up" marker for reading that face.
export const isFixedCentre = (n, s) =>
  n % 2 === 1 && s.pos.filter((v) => v !== 0).length === 1;

export function applyMove(cube, move) {
  const { axis, layer, dir } = move;
  for (const s of cube.stickers) {
    if (s.pos[axis] !== layer) continue;
    if (isFixedCentre(cube.n, s)) continue;
    s.pos = rotateVec(s.pos, axis, dir);
    s.normal = rotateVec(s.normal, axis, dir);
    s.up = rotateVec(s.up, axis, dir);
  }
  return cube;
}

export const inverseMove = (m) => ({ axis: m.axis, layer: m.layer, dir: -m.dir });

export function allowedLayers(n) {
  const layers = [];
  for (let l = -(n - 1); l <= n - 1; l += 2) if (!(n % 2 === 1 && l === 0)) layers.push(l);
  return layers;
}

// grid[f][row][col] = sticker currently sitting at that spot.
export function readFaces(cube) {
  const { n } = cube;
  const grid = FACES.map(() => Array.from({ length: n }, () => Array(n)));
  for (const s of cube.stickers) {
    const f = FACES.findIndex((face) => same(face.normal, s.normal));
    const face = FACES[f];
    const col = (dot(s.pos, face.right) + (n - 1)) / 2;
    const row = (dot(s.pos, face.down) + (n - 1)) / 2;
    grid[f][row][col] = s;
  }
  return grid;
}

export function rowWords(cube) {
  return readFaces(cube).map((rows) => rows.map((row) => row.map((s) => s.letter).join("")));
}

// Compact move notation used for saving progress: axis letter, layer, direction.
export const encodeMove = (m) => "xyz"[m.axis] + m.layer + (m.dir > 0 ? "+" : "-");
export function decodeMove(str) {
  const match = /^([xyz])(-?\d+)([+-])$/.exec(str);
  if (!match) return null;
  return { axis: "xyz".indexOf(match[1]), layer: Number(match[2]), dir: match[3] === "+" ? 1 : -1 };
}
