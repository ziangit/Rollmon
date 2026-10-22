# web

The browser app: the **game page** (`app/`), the **battle worker** (`battle/`),
the replay embed, the damage summary, and the **pure game layer** (`game/`).
`npm run build` writes the whole static site to `dist/`.

```
npm install
npm run typecheck          # tsc, no emit
npm test                   # node:test suites in battle/, replay/, game/
npm run battle -- pool/advanced/Cynthia.txt bosses/leon.txt 1   # one traced battle in Node
node scripts/sweep.ts 40 10          # many quick battles, reports problems
node scripts/check-names.ts          # every species/move/item/ability in rollmons/ and the usable Smogon sets known to the engine
node scripts/coverage.ts [--list]    # fully evolved species that are not draftable; rarity buckets, short and legendary-heavy cells
node scripts/smogon-scrape.ts [id…]  # fill rollmons/data/smogon_sets.json from Smogon's dex (SV → SS → SM → … fallback, standard tiers only)
npm run build              # dist/: index.html, styles.css, app.js, worker.js, wasm, data/game-data.json (+ dev battle-page.js)
npm run build -- --minify  # same, minified, no sourcemaps (what deploy/vercel-build.sh deploys)
npm run dev                # watch + serve: game at /dist/index.html, worker page at /dev/battle.html (:8975)
node scripts/chrome-app.mjs [seed] [p1ms] [p2ms]   # headless Chrome plays a whole run (draft → campaign → results → replay)
ROLLMONS_URL=https://rollmon.vercel.app node scripts/chrome-app.mjs   # same, against the deployed site (also checks the sign-in button)
node scripts/chrome-battle.mjs 1     # headless Chrome runs the worker dev page end to end
```

Needs `engine/pkg` first: `cd engine && wasm-pack build --release --target web --out-dir pkg`.

## app/
- `index.html`, `styles.css` — v1's screens and styles, unchanged apart from local asset paths.
- `main.ts` — port of v1 `app.js`: router, renderers for draft / loadout / bosses / battle / results / pool; drives the worker through `BattleClient`. Dev knobs: `?seed=N`, `?p1ms=&p2ms=`; `window.__rollmons` exposes the session view for scripts.
- `session.ts` — `GameSession` (one run: draft, loadout, gauntlet/campaign, results), `BossBook` (authored + pasted bosses), `createGameContext`, view builders. Replaces the v1 FastAPI session; tests in `session.test.ts`.
- `sprites.ts` — Showdown sprite URLs (hotlinked, dev-only).
- `roller.js` — the title-screen slot roller, verbatim from v1 (decorative).

## battle/
- `engine-state.ts` — omniscient mapper: `@pkmn/sim` `Battle` → poke-engine state string.
- `driver.ts` — sim request → legal choices; MCTS result → one choice (75 %-of-best visit rule, visit-weighted sample; random legal fallback).
- `runner.ts` — the synchronous battle loop (`runBattle`), format constant, outcome + omniscient protocol log.
- `worker.ts` — Web Worker entry: `{type:'battle', p1, p2, seed, budgetMs}` (teams as export text or parsed sets) → `turn` events → `done`.
- `client.ts` — `BattleClient`: promise wrapper over the worker (one battle at a time, per-turn callback).
- `summary.ts` — damage summary from the protocol log (MVP, per-Pokémon %, gauntlet sentence); port of the Python reference.

## game/
Port of the Python reference (`rollmons/*.py`), tests ported from `tests/test_*.py`. No I/O: every
function takes its data as objects (`GameData`, see `data.ts`), RNG is injected (`rng.ts`, seedable).
- `legality-matrix.ts` — 18×9 type × debut-generation matrix, species metadata, legendary weighting, `selectSpecies`.
- `draft.ts` / `draft-config.ts` — six-round `Draft` state machine (offers, picks, skips, visitors, rarity slots, candidate cap).
- `team-assembly.ts` — randbats/Smogon/override set selection, `selectableSets` (loadout options), `assembleTeam` / `assembleLoadout`.
- `smogon-sets.ts` — Smogon JSON ingestion (format exclusions, Tera stripping, existence validation + report).
- `pool.ts` / `bosses.ts` — tiered pool, seedable 10-battle campaign, boss discovery.
- `showdown-export.ts` / `submissions.ts` — export block parsing and existence-only validation of contributed teams/sets.
- `scripts/game-data.ts` — loads the bundle from the repo for tests, scripts, and the build.

## replay/
- `embed.ts` — hosted Showdown replay player in a srcdoc iframe (boss avatar rewrite, lazy load, sizing), carried over from v1.

## dev/
- `battle.html` + `battle-page.ts` — run a battle in the worker, then show the summary and the replay.

TypeScript runs directly under Node 24 (type stripping); esbuild bundles for the browser.
