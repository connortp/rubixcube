# CUBEWORD

A daily word puzzle on a twisty letter cube. Every sticker on the cube has a letter.
In the solved cube every row on every face spells a word, then it gets scrambled.
Twist the layers like a real Rubik's cube to get the words back, then share your score
with the group chat.

Same cubes for everyone each day (seeded by the date), new ones at local midnight.

| Level  | Cube | Words          | Max score | Par (scramble twists) |
| ------ | ---- | -------------- | --------- | --------------------- |
| Easy   | 3×3  | 3-letter words | 18        | 4                     |
| Medium | 5×5  | 5-letter words | 30        | 6                     |
| Hard   | 7×7  | 7-letter words | 42        | 9                     |

## How it plays

- **Drag a letter** to twist that row or column layer. **Drag empty space** (or use two
  fingers on a phone) to spin the whole cube around to see the other sides.
- The **centre letter of each face is fixed**: it never moves and always stays upright, so
  it shows which way is "up" for reading that face. The middle slices can't turn (turning
  them would move the centres).
- Every other letter turns with its sticker, so a sideways letter is a hint it's out of place.
  The small bar under each letter shows its bottom.

## Scoring

- Each face has N rows, read left to right from the centre letter's point of view.
  Every row that spells a word is **1 point**, so the max is 6 × N.
  - 🟩 green: the row is back to the day's original word.
  - 🟨 yellow: a different real word. Still a point!
- A table above the cube shows each face's progress, labelled by its centre letter,
  e.g. `A 2/5` means 2 of that face's 5 rows are words.
- Moves are counted against **par**, the number of random twists used to scramble.
  Undo takes a twist back without counting it.
- Getting every row is an automatic finish. Otherwise tap **Lock in** whenever you're
  happy with your score. One go per level per day.
- Stuck? **Give up** freezes your score, then the cube rapidly twists itself back from
  wherever you left it to the solved cube, lighting up every word you missed on the way.
  The share text says 🏳️ Gave up.

## Sharing

After you lock in, **Share** opens the iPhone share sheet (Messages etc.) or copies to the
clipboard on a computer:

```
CUBEWORD #1 · Easy 3×3 🧊
⭐ 16/18 words · 🔥 Word Twister
🔄 7 moves (par 4) · ⏱️ 2:14

🟩🟩🟩🟨🟩🟩
🟩⬛🟩🟩🟩🟩
🟩🟩🟨🟩⬛🟩
https://connortp.github.io/rubixcube/
```

Each column of squares is a face (Top, Front, Right, Back, Left, Bottom) and each line is a row.
Perfect score in par or fewer moves earns a ⛳.

## Running it

It's a static site with no build step (three.js is vendored in `vendor/`).

```sh
npm start        # serves on http://localhost:8000 (python3 http.server)
npm test         # unit tests for the cube logic, daily puzzle and share text
```

Add `?level=easy|medium|hard` to the URL to jump straight to a level.

### Deploying to GitHub Pages

Settings → Pages → Build and deployment → Source: **Deploy from a branch**, branch `main`,
folder `/ (root)`. The game will be at `https://connortp.github.io/rubixcube/`.

## Code map

- `js/cube.js`: the cube model (sticker positions, layer turns). Pure JS.
- `js/puzzle.js`: daily seed, puzzle generation, scoring, share text. Pure JS.
- `js/render.js`: three.js rendering plus mouse/touch input.
- `js/main.js`: UI, saved progress (localStorage), stats and sharing.
- `js/words.js`: generated word lists. Rebuild with `scripts/build_words.py`
  (dictionary from the `word-list` npm package, filtered by `wordfreq` frequency so
  obscure words don't count and the hidden words are common ones).
