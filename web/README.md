# web

The browser app. Today: the **battle worker**, the replay embed, and the damage
summary (milestones 2–3). Draft/loadout UI comes with milestone 4.

```
npm install
npm run typecheck          # tsc, no emit
npm test                   # node:test suites in battle/
npm run battle -- pool/advanced/Cynthia.txt bosses/leon.txt 1   # one traced battle in Node
node scripts/sweep.ts 40 10          # many quick battles, reports problems
node scripts/check-names.ts          # every species/move/item/ability in rollmons/ known to the engine
npm run build              # dist/worker.js + dist/sim-teams.js + wasm copy
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

## replay/
- `embed.ts` — hosted Showdown replay player in a srcdoc iframe (boss avatar rewrite, lazy load, sizing), carried over from v1.

## dev/
- `battle.html` + `battle-page.ts` — run a battle in the worker, then show the summary and the replay.

TypeScript runs directly under Node 24 (type stripping); esbuild bundles for the browser.
