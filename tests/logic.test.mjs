import test from "node:test";
import assert from "node:assert/strict";
import { createCube, applyMove, inverseMove, rowWords, readFaces, isMoveAllowed, allowedLayers, encodeMove, decodeMove, FACES } from "../js/cube.js";
import { generatePuzzle, buildScrambled, scoreCube, solutionMoves, shareText, DIFFICULTIES, puzzleNumber, dateKey } from "../js/puzzle.js";

const letters = (n) => FACES.map((_, f) => Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => String.fromCharCode(65 + ((f * 7 + r * n + c) % 26)))));

test("four quarter turns of any layer return the cube to start", () => {
  for (const n of [3, 5, 7]) {
    const start = rowWords(createCube(n, letters(n)));
    for (const layer of allowedLayers(n)) for (const axis of [0, 1, 2]) {
      const cube = createCube(n, letters(n));
      for (let i = 0; i < 4; i++) applyMove(cube, { axis, layer, dir: 1 });
      assert.deepEqual(rowWords(cube), start);
    }
  }
});

test("a move followed by its inverse is a no-op, and each move changes the cube", () => {
  const n = 5;
  const start = rowWords(createCube(n, letters(n)));
  for (const layer of allowedLayers(n)) for (const axis of [0, 1, 2]) {
    const cube = createCube(n, letters(n));
    applyMove(cube, { axis, layer, dir: -1 });
    assert.notDeepEqual(rowWords(cube), start);
    applyMove(cube, inverseMove({ axis, layer, dir: -1 }));
    assert.deepEqual(rowWords(cube), start);
  }
});

test("face centres never move and every slot stays filled", () => {
  const n = 3;
  const cube = createCube(n, letters(n));
  const centres = rowWords(cube).map((f) => f[1][1]);
  for (let i = 0; i < 200; i++) {
    const layers = allowedLayers(n);
    applyMove(cube, { axis: i % 3, layer: layers[(i * 7) % layers.length], dir: i % 2 ? 1 : -1 });
  }
  assert.deepEqual(rowWords(cube).map((f) => f[1][1]), centres);
  readFaces(cube).forEach((f) => f.forEach((row) => row.forEach((s) => assert.ok(s))));
});

test("middle slices are not allowed on odd cubes", () => {
  assert.equal(isMoveAllowed(3, { axis: 0, layer: 0, dir: 1 }), false);
  assert.equal(isMoveAllowed(5, { axis: 1, layer: 0, dir: -1 }), false);
  assert.equal(isMoveAllowed(5, { axis: 1, layer: 2, dir: -1 }), true);
  assert.equal(isMoveAllowed(3, { axis: 2, layer: 2, dir: 1 }), true);
  assert.equal(isMoveAllowed(3, { axis: 2, layer: 1, dir: 1 }), false);
});

test("front face clockwise turn moves the top row's bottom edge onto the right face", () => {
  // Turning the front layer clockwise (as seen from the front) is -90° around +z.
  const n = 3;
  const cube = createCube(n, letters(n));
  const before = rowWords(cube);
  applyMove(cube, { axis: 2, layer: 2, dir: -1 });
  const after = rowWords(cube);
  // Top face bottom row (U row 2) goes to the right face's left column, top to bottom.
  const rightLeftCol = after[2].map((row) => row[0]).join("");
  assert.equal(rightLeftCol, before[0][2]);
});

test("move encoding round-trips", () => {
  for (const m of [{ axis: 0, layer: -2, dir: 1 }, { axis: 2, layer: 6, dir: -1 }]) assert.deepEqual(decodeMove(encodeMove(m)), m);
});

test("daily puzzles are deterministic, scrambled, and solvable", () => {
  for (const key of Object.keys(DIFFICULTIES)) {
    const a = generatePuzzle("2026-10-29", key);
    const b = generatePuzzle("2026-10-29", key);
    const c = generatePuzzle("2026-10-30", key);
    assert.deepEqual(a.solution, b.solution);
    assert.deepEqual(a.scramble, b.scramble);
    assert.notDeepEqual(a.solution, c.solution);
    assert.equal(a.max, 6 * a.n);
    const cube = buildScrambled(a.n, a.solution, a.scramble);
    assert.ok(scoreCube(cube, a.solution).score < a.max, "scrambled cube should not be solved");
    for (const m of solutionMoves(a)) applyMove(cube, m);
    const solved = scoreCube(cube, a.solution);
    assert.equal(solved.score, a.max);
    assert.equal(solved.targets, a.max);
  }
});

test("share text has the score, moves and a row per cube row", () => {
  const p = generatePuzzle("2026-10-29", "easy");
  const cube = buildScrambled(p.n, p.solution, []);
  const text = shareText({ puzzle: p, result: scoreCube(cube, p.solution), moves: 4, timeMs: 83000, url: "https://x.test" });
  assert.match(text, /CUBEWORD #1 · Easy 3×3/);
  assert.match(text, /⭐ 18\/18 words · 🏆 Cube Master/);
  assert.match(text, /🔄 4 moves \(par 4\) ⛳ · ⏱️ 1:23/);
  assert.equal(text.split("\n").filter((l) => l.startsWith("🟩")).length, 3);
});

test("puzzle numbers count from launch day", () => {
  assert.equal(puzzleNumber("2026-10-29"), 1);
  assert.equal(puzzleNumber("2026-11-28"), 31);
  assert.equal(puzzleNumber("2027-10-29"), 366);
  assert.equal(dateKey(new Date(2026, 0, 5)), "2026-01-05");
});

test("centre letters stay upright when their face turns", () => {
  const cube = createCube(3, letters(3));
  const centre = cube.stickers.find((s) => s.pos[2] === 2 && s.pos[0] === 0 && s.pos[1] === 0);
  applyMove(cube, { axis: 2, layer: 2, dir: 1 });
  assert.deepEqual(centre.up, [0, 1, 0]);
  const corner = cube.stickers.find((s) => s.normal[2] === 1 && s.pos[0] === 2 && s.pos[1] === 2);
  assert.notDeepEqual(corner.up, [0, 1, 0]);
});
