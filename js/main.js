import { applyMove, inverseMove, readFaces, encodeMove, decodeMove, FACES } from "./cube.js";
import {
  DIFFICULTIES, generatePuzzle, buildScrambled, scoreCube, shareText, rankFor, formatTime, dateKey, puzzleNumber,
  revealMoves,
} from "./puzzle.js";
import { CubeView } from "./render.js";

const $ = (id) => document.getElementById(id);
const STORE = "cubeword:v1";

// ---- storage (wrapped: private mode / blocked storage must not break the game) --
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`${STORE}:${key}`);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`${STORE}:${key}`, JSON.stringify(value));
    } catch {}
  },
};

let today = dateKey();
let game = null; // { puzzle, cube, moves, startedAt, finishedAt, done, result }
let busy = false;
let revealing = false; // playing the give-up animation
let lastWords = new Set();

const view = new CubeView($("stage"), {
  onTwist: (move) => twist(move),
  onBlocked: () => toast("📌 Centre slices are fixed. Spin the cube instead"),
});

// ---- game lifecycle ----------------------------------------------------------

function load(diffKey) {
  store.set("difficulty", diffKey);
  const puzzle = generatePuzzle(today, diffKey);
  const cube = buildScrambled(puzzle.n, puzzle.solution, puzzle.scramble);
  const saved = store.get(`${today}:${diffKey}`, null);
  const moves = [];
  for (const m of saved?.moves ?? []) {
    const move = decodeMove(m);
    if (!move) continue;
    applyMove(cube, move);
    moves.push(move);
  }
  // Gave up earlier today: show the finished cube straight away.
  if (saved?.gaveUp) for (const m of revealMoves(puzzle, moves)) applyMove(cube, m);
  game = {
    diffKey,
    puzzle,
    cube,
    moves,
    startedAt: saved?.startedAt ?? null,
    finishedAt: saved?.finishedAt ?? null,
    done: saved?.done ?? false,
    final: saved?.gaveUp ?? null, // the score frozen at the moment they gave up
  };
  view.setCube(cube);
  view.setLocked(game.done);
  lastWords = null;
  refresh();
  renderTabs();
  $("puzzle-label").textContent = `#${puzzleNumber(today)} · ${new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
}

function save() {
  store.set(`${today}:${game.diffKey}`, {
    moves: game.moves.map(encodeMove),
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
    done: game.done,
    gaveUp: game.final,
  });
}

async function twist(move, { record = true } = {}) {
  if (busy || game.done) return;
  busy = true;
  await view.animateMove(game.cube, move);
  applyMove(game.cube, move);
  if (record) game.moves.push(move);
  if (!game.startedAt) game.startedAt = Date.now();
  save();
  refresh();
  busy = false;
  if (game.result.score === game.puzzle.max) finish();
}

async function undo() {
  if (busy || game.done || !game.moves.length) return;
  const last = game.moves.pop();
  await twist(inverseMove(last), { record: false });
}

// Freeze the score, then play the cube back to solved, fast, so every missed word
// lights up on the way.
async function giveUp() {
  if (busy || game.done) return;
  busy = true;
  const { score, targets, status } = game.result;
  game.final = { score, targets, status };
  game.done = true;
  game.finishedAt = Date.now();
  if (!game.startedAt) game.startedAt = game.finishedAt;
  save();
  recordStats(false);
  view.setLocked(true);
  renderTabs();
  refresh();
  view.resetView();
  const moves = revealMoves(game.puzzle, game.moves);
  const ms = Math.max(45, Math.min(140, 3500 / moves.length));
  revealing = true;
  await wait(400);
  for (const m of moves) {
    await view.animateMove(game.cube, m, ms);
    applyMove(game.cube, m);
    // Hold for a beat whenever original words come back so you can read them.
    if (refresh().some((x) => x.st === "target")) await wait(Math.min(220, ms * 2));
  }
  revealing = false;
  busy = false;
  refresh();
  toast(`🏳️ All ${game.puzzle.max} words. You had ${score}`, 2400);
  setTimeout(showResults, 1600);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function finish() {
  if (game.done) return;
  const perfect = game.result.score === game.puzzle.max;
  game.done = true;
  game.finishedAt = Date.now();
  if (!game.startedAt) game.startedAt = game.finishedAt;
  save();
  recordStats(perfect);
  view.setLocked(true);
  refresh();
  renderTabs();
  if (perfect) toast("🏆 Every row is a word!");
  setTimeout(showResults, perfect ? 900 : 150);
}

function recordStats(perfect) {
  const key = `stats:${game.diffKey}`;
  const s = store.get(key, { played: 0, streak: 0, maxStreak: 0, perfect: 0, lastKey: null });
  if (s.lastKey === today) return;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  s.streak = s.lastKey === dateKey(y) ? s.streak + 1 : 1;
  s.maxStreak = Math.max(s.maxStreak, s.streak);
  s.played += 1;
  if (perfect) s.perfect += 1;
  s.lastKey = today;
  store.set(key, s);
}

const elapsed = () => (game.startedAt ? (game.finishedAt ?? Date.now()) - game.startedAt : 0);

// ---- rendering ---------------------------------------------------------------

function refresh() {
  const { cube, puzzle } = game;
  const result = scoreCube(cube, puzzle.solution);
  // After giving up the cube is shown solved, but the score stays what they had.
  game.result = game.final ? { ...game.final, rows: result.rows } : result;

  const grid = readFaces(cube);
  const statusById = new Map();
  result.status.forEach((rows, f) => rows.forEach((st, r) => grid[f][r].forEach((s) => statusById.set(s.id, st))));
  view.update(cube, statusById);

  const scoreEl = $("score");
  const prev = scoreEl.textContent;
  scoreEl.textContent = `${game.result.score}/${puzzle.max}`;
  if (lastWords && prev !== scoreEl.textContent) bump(scoreEl.parentElement);
  $("moves").textContent = game.moves.length;
  $("par").textContent = `moves · par ${puzzle.par}`;
  $("timer").textContent = formatTime(elapsed());
  $("undo-btn").disabled = game.done || !game.moves.length;
  const doneBtn = $("done-btn");
  doneBtn.textContent = game.done ? "📤 Share" : "Lock in";
  $("giveup-btn").hidden = game.done;

  // Per-face table, labelled by each face's fixed centre letter: "A 2/5".
  const mid = (puzzle.n - 1) / 2;
  $("faces").innerHTML = FACES.map((face, f) => {
    const found = game.result.status[f].filter((st) => st !== "none").length;
    const cls = found === puzzle.n ? "full" : found ? "some" : "";
    return `<div class="face-cell ${cls}" title="${face.name} face: ${found} of ${puzzle.n} rows are words">
      <span class="face-letter">${grid[f][mid][mid].letter}</span><span class="face-count">${found}/${puzzle.n}</span>
      <span class="face-bar"><i style="width:${(100 * found) / puzzle.n}%"></i></span></div>`;
  }).join("");

  // Word chips; announce new ones.
  const found = [];
  result.status.forEach((rows, f) => rows.forEach((st, r) => st !== "none" && found.push({ w: result.rows[f][r], st, key: `${f}:${r}:${result.rows[f][r]}` })));
  const keys = new Set(found.map((x) => x.key));
  const fresh = lastWords ? found.filter((x) => !lastWords.has(x.key)) : [];
  const wordsEl = $("words");
  wordsEl.innerHTML = "";
  if (!found.length) wordsEl.innerHTML = `<span class="empty">No words yet. Twist away!</span>`;
  // Newest first, then restored originals, then other words.
  const order = [...fresh, ...found.filter((x) => !fresh.includes(x)).sort((a, b) => (a.st === b.st ? 0 : a.st === "target" ? -1 : 1))];
  for (const x of order) {
    const chip = document.createElement("span");
    chip.className = `chip ${x.st}${fresh.includes(x) ? " new" : ""}`;
    chip.textContent = x.w;
    wordsEl.appendChild(chip);
  }
  if (fresh.length && (!game.done || revealing)) toast(fresh.map((x) => `${x.st === "target" ? "🟩" : "🟨"} ${x.w}`).join("  ") + `  +${fresh.length}`);
  lastWords = keys;
  return fresh;
}

function bump(el) {
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

function renderTabs() {
  const tabs = $("tabs");
  tabs.innerHTML = "";
  for (const d of Object.values(DIFFICULTIES)) {
    const b = document.createElement("button");
    b.className = "tab";
    b.role = "tab";
    b.setAttribute("aria-selected", String(d.key === game.diffKey));
    const done = store.get(`${today}:${d.key}`, null)?.done;
    b.innerHTML = `${d.label} <small>${d.n}×${d.n}</small>${done ? '<span class="done">✓</span>' : ""}`;
    b.onclick = () => d.key !== game.diffKey && !busy && load(d.key);
    tabs.appendChild(b);
  }
}

let toastTimer;
function toast(text, ms = 1800) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

// ---- results & sharing -------------------------------------------------------

function currentShareText() {
  return shareText({
    puzzle: game.puzzle,
    result: game.result,
    moves: game.moves.length,
    timeMs: elapsed(),
    url: location.origin + location.pathname,
    gaveUp: !!game.final,
  });
}

function showResults() {
  const { puzzle, result } = game;
  $("result-rank").textContent = game.final ? "🏳️ Gave up" : game.done ? rankFor(result.score, puzzle.max) : "In progress…";
  $("result-score").innerHTML = `${result.score}<small>/${puzzle.max}</small>`;
  $("result-meta").textContent = `${puzzle.difficulty.label} ${puzzle.n}×${puzzle.n} · ${game.moves.length} moves (par ${puzzle.par}) · ${formatTime(elapsed())}`;
  const text = currentShareText();
  $("result-grid").textContent = text.split("\n").filter((l) => /^[🟩🟨⬛]/u.test(l)).join("\n");

  const share = $("share-btn");
  share.textContent = game.done ? "📤 Share score" : "🔒 Lock in to share";

  const s = store.get(`stats:${game.diffKey}`, { played: 0, streak: 0, maxStreak: 0, perfect: 0 });
  $("result-stats").innerHTML = [
    ["Played", s.played],
    ["Streak", s.streak],
    ["Best", s.maxStreak],
    ["Perfect", s.perfect],
  ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join("");

  const answers = $("answers");
  answers.hidden = !game.done;
  answers.open = !!game.final;
  $("answers-list").innerHTML = puzzle.solution
    .map((words, f) => `<div class="face"><b>${FACES[f].name}</b>${words.join(" · ")}</div>`)
    .join("");
  updateCountdown();
  openDialog($("result-dialog"));
}

function updateCountdown() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  $("next-puzzle").textContent = `New cubes in ${formatTime(next - now)}`;
}

async function shareScore() {
  if (!game.done) {
    $("result-dialog").close();
    confirmFinish();
    return;
  }
  const text = currentShareText();
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e?.name === "AbortError") return;
    }
  }
  if (await copy(text)) toast("📋 Copied! Paste it in the group chat");
  else toast("Couldn't copy. Long-press the squares to copy", 2600);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    ta.remove();
    return ok;
  }
}

function confirmFinish() {
  const { result, puzzle } = game;
  ask(
    "Lock in your score?",
    `You've got ${result.score} of ${puzzle.max} words. Once you lock in, today's ${puzzle.difficulty.label} cube is done and you can share your score.`,
    "Lock it in",
    finish,
  );
}

function confirmGiveUp() {
  const { result, puzzle } = game;
  ask(
    "Give up?",
    `Your score stays at ${result.score} of ${puzzle.max}, then the cube twists itself back so you can see every word you missed.`,
    "🏳️ Show me",
    giveUp,
  );
}

function ask(title, text, okLabel, onOk) {
  $("confirm-title").textContent = title;
  $("confirm-text").textContent = text;
  $("confirm-ok").textContent = okLabel;
  const dlg = $("confirm-dialog");
  dlg.returnValue = "";
  dlg.onclose = () => dlg.returnValue === "ok" && onOk();
  openDialog(dlg);
}

function openDialog(dlg) {
  if (!dlg.open) dlg.showModal();
}

// ---- wiring ------------------------------------------------------------------

$("undo-btn").onclick = undo;
$("view-btn").onclick = () => view.resetView();
$("giveup-btn").onclick = () => !busy && !game.done && confirmGiveUp();
$("done-btn").onclick = () => (game.done ? showResults() : confirmFinish());
$("stats-btn").onclick = showResults;
$("help-btn").onclick = () => openDialog($("help-dialog"));
$("share-btn").onclick = shareScore;
for (const dlg of document.querySelectorAll("dialog")) {
  // Tap outside the sheet to close.
  dlg.addEventListener("click", (e) => e.target === dlg && dlg.close());
}

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "z") {
    e.preventDefault();
    undo();
  }
});

setInterval(() => {
  if (dateKey() !== today) {
    // Midnight rolled over while the page was open: load the new day.
    today = dateKey();
    load(game.diffKey);
    return;
  }
  if (game?.startedAt && !game.done) $("timer").textContent = formatTime(elapsed());
  if ($("result-dialog").open) updateCountdown();
}, 1000);

const initial = new URLSearchParams(location.search).get("level") ?? store.get("difficulty", "easy");
load(DIFFICULTIES[initial] ? initial : "easy");
if (!store.get("seenHelp", false)) {
  store.set("seenHelp", true);
  openDialog($("help-dialog"));
}
