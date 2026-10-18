# web

The browser app. Today: the **battle worker**, the replay embed, the damage
summary (milestones 2–3), and the **pure game layer** (milestone 4: legality
matrix, draft, loadout, pool/campaign, bosses). The game UI comes with milestone 5.

```
npm install
npm run typecheck          # tsc, no emit
npm test                   # node:test suites in battle/, replay/, game/
npm run battle -- pool/advanced/Cynthia.txt bosses/leon.txt 1   # one traced battle in Node
node scripts/sweep.ts 40 10          # many quick battles, reports problems
node scripts/check-names.ts          # every species/move/item/ability in rollmons/ known to the engine
npm run build              # dist/worker.js + dist/battle-page.js + wasm copy + dist/data/game-data.json
npm run dev                # same, watching, serves dev/battle.html on :8975
node scripts/chrome-battle.mjs 1     # headless Chrome runs the worker page end to end
```

Needs `engine/pkg` first: `cd engine && wasm-pack build --release --target web --out-dir pkg`.

## battle/
- `engine-state.ts` — omniscient mapper: `@pkmn/sim` `Battle` → poke-engine state string.
- `driver.ts` — sim request → legal choices; MCTS result → one choice (75 %-of-best visit rule, visit-weighted sample; random legal fallback).
- `runner.ts` — the synchronous battle loop (`runBattle`), format constant, outcome + omniscient protocol log.
- `worker.ts` — Web Worker entry: `{type:'battle', p1, p2, seed, budgetMs}` → `turn` events → `done`.
- `summary.ts` — damage summary from the protocol log (MVP, per-Pokémon %, gauntlet sentence); port of the Python reference.

## game/
Port of the Python reference (`rollmons/*.py`), tests ported from `tests/test_*.py`. No I/O: every
function takes its data as objects (`GameData`, see `data.ts`), RNG is injected (`rng.ts`, seedable).
- `legality-matrix.ts` — 18×9 type × debut-generation matrix, species metadata, legendary weighting, `selectSpecies`.
- `draft.ts` / `draft-config.ts` — six-round `Draft` state machine (offers, picks, skips, thin-cell rerolls, candidate cap).
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
