// Daily puzzle generation, scoring and the share string. Pure JS, testable in Node.
import { FACES, createCube, applyMove, allowedLayers, rowWords, inverseMove } from "./cube.js";
import { ANSWERS, VALID } from "./words.js";

export const GAME_NAME = "CUBEWORD";
export const LAUNCH_DATE = "2026-10-29"; // puzzle #1

export const DIFFICULTIES = {
  easy:   { key: "easy",   label: "Easy",   n: 3, scramble: 4,  emoji: "🟢" },
  medium: { key: "medium", label: "Medium", n: 5, scramble: 6,  emoji: "🟡" },
  hard:   { key: "hard",   label: "Hard",   n: 7, scramble: 9,  emoji: "🔴" },
};

const answerLists = Object.fromEntries(Object.entries(ANSWERS).map(([n, s]) => [n, s.split(" ")]));
const validSets = Object.fromEntries(Object.entries(VALID).map(([n, s]) => [n, new Set(s.split(" "))]));

export const isWord = (w) => validSets[w.length]?.has(w) ?? false;

// ---- dates ---------------------------------------------------------------

export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function puzzleNumber(key) {
  const toDays = (k) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  };
  return toDays(key) - toDays(LAUNCH_DATE) + 1;
}

// ---- seeded randomness ---------------------------------------------------

function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function makeRng(seedText) {
  let a = hashString(seedText);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- puzzle --------------------------------------------------------------

// Everyone gets the same puzzle for a given date and difficulty: the solved cube has
// a real N-letter word on every row of every face, then it's scrambled with `scramble`
// random layer turns. Max score = 6 faces × N rows.
export function generatePuzzle(key, difficultyKey) {
  const diff = DIFFICULTIES[difficultyKey];
  const { n } = diff;
  const rng = makeRng(`${GAME_NAME}:${key}:${difficultyKey}`);
  const pool = answerLists[n];

  const picked = new Set();
  while (picked.size < 6 * n) picked.add(pool[Math.floor(rng() * pool.length)]);
  const words = [...picked];
  const solution = FACES.map((_, f) => words.slice(f * n, f * n + n));

  const layers = allowedLayers(n);
  let scramble, cube;
  // Re-roll in the (very unlikely) case the scramble leaves too much intact.
  for (let attempt = 0; attempt < 50; attempt++) {
    scramble = [];
    let prev = null;
    while (scramble.length < diff.scramble) {
      const m = {
        axis: Math.floor(rng() * 3),
        layer: layers[Math.floor(rng() * layers.length)],
        dir: rng() < 0.5 ? 1 : -1,
      };
      // Never turn the same layer twice in a row (it would undo or merge the turn).
      if (prev && prev.axis === m.axis && prev.layer === m.layer) continue;
      scramble.push(m);
      prev = m;
    }
    cube = buildScrambled(n, solution, scramble);
    if (scoreCube(cube, solution).targets <= 6 * n * 0.5) break;
  }

  return {
    key,
    number: puzzleNumber(key),
    difficulty: diff,
    n,
    solution,
    scramble,
    par: scramble.length,
    max: 6 * n,
  };
}

export function buildScrambled(n, solution, scramble) {
  const cube = createCube(n, solution.map((rows) => rows.map((w) => w.split(""))));
  for (const m of scramble) applyMove(cube, m);
  return cube;
}

// The shortest known way back is the scramble undone in reverse.
export const solutionMoves = (puzzle) => [...puzzle.scramble].reverse().map(inverseMove);

// Moves that take the cube from where the player is back to the solved cube: undo the
// player's twists, then undo the scramble, cancelling any twist that is immediately
// undone (e.g. a player's last scramble-undo followed by redoing it).
export function revealMoves(puzzle, playerMoves) {
  const seq = [...playerMoves].reverse().map(inverseMove).concat(solutionMoves(puzzle));
  const out = [];
  for (const m of seq) {
    const top = out[out.length - 1];
    if (top && top.axis === m.axis && top.layer === m.layer && top.dir === -m.dir) out.pop();
    else out.push(m);
  }
  return out;
}

// Each row of each face, read left to right, scores one point if it spells a word.
// status: "target" = the row is back to the day's original word,
//         "word"   = some other real word (still counts!),
//         "none"   = not a word.
export function scoreCube(cube, solution) {
  const rows = rowWords(cube);
  let score = 0;
  let targets = 0;
  const status = rows.map((faceRows, f) =>
    faceRows.map((w, r) => {
      if (w === solution[f][r]) {
        score++;
        targets++;
        return "target";
      }
      if (isWord(w)) {
        score++;
        return "word";
      }
      return "none";
    }),
  );
  return { score, targets, status, rows };
}

// ---- sharing -------------------------------------------------------------

export function rankFor(score, max) {
  const pct = score / max;
  if (pct >= 1) return "🏆 Cube Master";
  if (pct >= 0.8) return "🔥 Word Twister";
  if (pct >= 0.6) return "🧠 Big Brain";
  if (pct >= 0.4) return "🧩 Getting Twisty";
  return "😵‍💫 Dizzy";
}

export function formatTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const SQUARE = { target: "🟩", word: "🟨", none: "⬛" };

export function shareText({ puzzle, result, moves, timeMs, url, gaveUp = false }) {
  const { n, max, par, difficulty } = puzzle;
  const lines = [];
  lines.push(`${GAME_NAME} #${puzzle.number} · ${difficulty.label} ${n}×${n} 🧊`);
  lines.push(`⭐ ${result.score}/${max} words · ${gaveUp ? "🏳️ Gave up" : rankFor(result.score, max)}`);
  let movesLine = `🔄 ${moves} move${moves === 1 ? "" : "s"} (par ${par})`;
  if (!gaveUp && result.score === max && moves <= par) movesLine += " ⛳";
  lines.push(`${movesLine} · ⏱️ ${formatTime(timeMs)}`);
  lines.push("");
  // One column per face, one line per row: a mini picture of the cube.
  for (let r = 0; r < n; r++) lines.push(result.status.map((face) => SQUARE[face[r]]).join(""));
  if (url) lines.push(url);
  return lines.join("\n");
}
