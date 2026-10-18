# rollmons v2 — architecture (living doc)

> Update this whenever a non-obvious decision or constraint is discovered.
> `docs/v1-foul-play-integration.md` holds the v1 notes; the landmines listed
> under "Carried over" below are the ones that still apply.

## Target stack (static site, no battle server)
- **`web/`** (TypeScript, bundled): the SPA (title → draft → loadout → gauntlet → battle → results, + Pokédex/pool) and a **battle Web Worker**.
- **Battle worker** = referee + engine + driver, all in-process:
  - *Referee:* `@pkmn/sim` `BattleStream` running the rollmons custom format
    `gen9customgame@@@Species Clause,+Past,Dynamax Clause,Terastal Clause,!! Max Move Count = 4,Adjust Level = 100`
    (`+Past` enables Mega Stones; Z-Move/CFZ clauses are not in `@pkmn/sim` and are moot in gen9).
  - *Engine:* poke-engine compiled to wasm (`engine/`, wasm-bindgen), features `gen9` only, Tera compiled out. Exposed calls: state from string, time-boxed MCTS, damage calc. Single-thread search.
  - *Driver:* builds the poke-engine state **directly from the sim's omniscient battle object** for the side to move (perfect information, both sides), runs MCTS for the side's budget (boss 25 ms / player 100 ms by default; per-band later), picks a choice (sample among choices within 75% of the best, as v1 did), issues `move X [mega]` / `switch N`.
  - *Output:* the standard Showdown protocol log → the existing replay embed (hosted player, hotlinked sprites) and the damage summary.
- **Data:** `rollmons/bosses`, `rollmons/sets`, `rollmons/pool` (Showdown export text), `data/pokedex.json` + `moves.json` (species/move data), `rollmons/data/smogon_sets.json` and `gen9randombattle.json` (set sources). The build inlines all of it into `dist/data/game-data.json` (1.5 MB, ~200 KB gzipped), which the page fetches once.
- **Hosting:** static (GitHub Pages or equivalent). Sprites and the replay player stay hotlinked from play.pokemonshowdown.com for dev; distribution decision deferred.

## Reference implementation (Python, `rollmons/`)
Kept as the behavioral spec until each module is ported. `make test` runs ruff + 71 tests, no Rust/Node needed.
- `legality_matrix.py` — 18×9 type-by-debut-generation matrix; atoms = configured source ∪ species with a set override; rejects mega/gmax *forme* atoms.
- `draft.py` / `draft_config.py` — six-round draft state machine; weighted sampling only when a cell exceeds `candidate_cap` (5); thin-cell rerolls; two skips.
- `team_assembly.py` — `selectable_sets()` (override blocks + Smogon or randbats fallback), `assemble_loadout()`, `_normalize_override_export` (strip nickname label and Tera, force `Level: 100`).
- `smogon_sets.py` — Smogon JSON ingestion, format exclusions, Tera stripping.
- `pool_loader.py` — `CAMPAIGN_STRUCTURE` = `1 + 1 + 1 + 3 + 3 + 1`; seedable 10-battle campaign.
- `boss_loader.py` / `submissions.py` / `showdown_export.py` — boss/set discovery, clean-room export parsing, existence-only validation (`python -m rollmons.validate_submission`).
- `web_app.py` — FastAPI routes for the above plus the results/damage summary built from a replay log. Battle endpoints call `battle_runner.run_battle`, which raises in v2.
- `web_static/` — the v1 SPA (`index.html`/`styles.css`/`app.js`); its screens, replay embed (`replayDoc`, boss avatar rewrite), and results dashboard are the port's starting point.

## Port status
| Module | Python | TypeScript |
|---|---|---|
| Engine wasm build | — | **done** (`engine/`, pinned poke-engine git rev, gen9 no-Tera; ~200 KB gzipped) |
| Referee + driver worker | — | **done** (`web/battle/`: mapper, driver, runner, worker; 60-battle sweep clean) |
| Legality matrix / draft | reference | **done** (`web/game/legality-matrix.ts`, `draft.ts`, `draft-config.ts`; reference tests ported) |
| Loadout / set selection | reference | **done** (`web/game/team-assembly.ts`, `smogon-sets.ts`; reference tests ported) |
| Pool / campaign | reference | **done** (`web/game/pool.ts`, `bosses.ts`, `submissions.ts`, `showdown-export.ts`) |
| Results / damage summary | reference | **done** (`web/battle/summary.ts`, reference tests ported) |
| Replay embed | — | **done** (`web/replay/embed.ts`, ported from `web_static/app.js`; hosted player, dev-only) |

## Engine benchmark (2026-10-17, M1-class Mac, single thread)
MCTS iterations completed per budget, mean over the ten states in `engine/bench/states.txt`
(`cargo run --release --bin bench` vs `spikes/engine-bench/`):

| budget | native | wasm in Node 24 | wasm in Chrome 155 Web Worker |
|---|---|---|---|
| 100 ms | 276k | 202k | 220k |
| 25 ms | 57k | — | 52k |

wasm runs at ~75–80 % of native, so the v1 think-time knobs (boss 25 ms /
player 100 ms) carry over unchanged on desktop. Per-state counts vary 10×
(states with few legal options converge faster); compare means only.
Gotchas: the crates.io release lacks wasm support (pin the git rev);
`rand 0.9`/`getrandom 0.3` need the `wasm_js` backend (feature + `--cfg` in
`engine/.cargo/config.toml`); warm the module up once before timing (V8
tier-up costs the first ~100 ms).

## Battle worker (2026-10-17, `web/battle/`)
- **Mapper** (`engine-state.ts`): sim `Battle` → poke-engine state string, both sides omniscient. The side's six Pokémon are emitted in the sim's *current* `side.pokemon` order (the sim moves the active to the front on every switch), so engine indices map 1:1 to `move N` / `switch N`. Names are Showdown ids upper-cased, which is poke-engine's spelling for species, moves, items, abilities.
- **Engine ↔ sim legality gaps the driver covers** (each found by `scripts/sweep.ts`): the request's move list is not in slot order while locked into a move (Outrage, charge turn, Recharge, Struggle) — map by id via `side.pokemon[active].moves`; Recharge/Struggle are the engine's `none`; a fainted active must *not* be flagged `force_switch` (the engine infers it from hp and only then handles a double KO) nor `force_trapped` (the sim's `trapped` is stale outside move requests); a Mega Stone the sim no longer honours (teammate already Mega'd) is mapped to no item.
- **Choice rule**: among engine choices the sim allows, keep those with ≥ 75 % of the top visit count, sample proportionally to visits; random legal choice if nothing matches (counted as a *fallback* and reported as a problem).
- **Engine outputs are structured** (`{kind, index, mega}`), never parsed from move names.
- **Known inaccuracies**: Team Preview keeps file order (no lead search); seven items in the data are unknown to the engine and searched as "no item" (Terrain Extender, Heat/Damp Rock, Scope Lens, Quick Claw, Eject Pack, Eject Button — `node scripts/check-names.ts`); engine durations for Encore/Taunt/Yawn/locked moves are approximated from the sim's remaining turns; the engine's Mega legality is per Pokémon, not per team.
- **Cost**: ~3.5–4.5 s per battle at 100 ms (p1) / 25 ms (p2) per decision; the `@pkmn/sim` + engine worker bundle is 9.7 MB unminified, **1.04 MB minified+gzipped** (plus 203 KB wasm) — all generations' data are included, tree-shaking gen9 is future work.

## Replay + summary (2026-10-17)
- The worker's `Outcome.log` is the **omniscient** channel of the sim's log (`extractChannelMessages(..., [-1])`): exact HP for both sides, no `|split|`/`|request|` lines. The hosted replay player renders it as-is; the damage summary measures percent of each target's max HP, so absolute (`141/297`) and percent (`48/100`) conditions give the same numbers.
- `web/replay/embed.ts` keeps v1's behaviour verbatim: boss `|player|` line rewritten with a trainer avatar, srcdoc iframe, lazy load on intersection, re-measure after load (the measure uses `max(body, documentElement).scrollHeight`, so it only ever grows past the 620 px fallback — as in v1).
- `node scripts/chrome-battle.mjs` now also waits for the replay player to paint inside the iframe and prints the summary sentence.

## Pure game layer (2026-10-17, `web/game/`)
Module-by-module port of the Python reference, using its tests as the spec (`web/game/*.test.ts`, 53 tests; the same data-count oracles: 424 usable Smogon species, 720/650/70 Smogon sets in/usable/excluded, 508 randbats atoms, campaign of 10).
- **Data in, no I/O.** Every function takes plain objects (`GameData` in `game/data.ts`: pokedex, moves, randbats, Smogon JSON, overrides, pool, bosses). Node fills it from the repo (`scripts/game-data.ts`); the browser gets the JSON the build emits. Checked-in `data/pokedex.json` / `moves.json` stay the species/move source rather than `@pkmn/dex`, so the forme debut-generation overrides and base-stat totals match the reference exactly.
- **RNG is injected** (`game/rng.ts`: `choice` / `weightedChoice` / `sample` interfaces, `seededRng(seed)` on mulberry32, shared with the battle runner). The draft, campaign, and set selection are reproducible under a seed; the Python `random.Random` streams are not reproduced, only the behaviour.
- **Ids** use Showdown's `[a-z0-9]` rule (`toId`), matching `@pkmn/sim`. The reference's `to_id` keeps non-ASCII letters instead; the two differ only for Flabébé (pokedex key `flabebe`, which neither produces) and no checked-in data contains accented names.
- **Deliberate deviation:** an override block without a nickname (e.g. `Charizard @ Charizardite X`) is labelled "Mega X" / "Custom N". The reference compared the nickname against the lowercase pokedex name and so labelled it "Charizard".
- **Dropped:** the `ROLLMONS_DRAFT_*` environment overrides (the config object is the knob) and the `_sets_dir` path parameters (overrides are a `{speciesId: text}` map).

## Carried over from v1 (still true)
- **Tera must be compiled out of the engine.** A Tera-enabled engine returns `-tera` choices the referee rejects.
- **Mega:** `+Past` makes Mega Stones legal; the driver must issue `move X mega` when `canMegaEvo` is set; only one Mega per team per battle. The engine (0.0.48+) models Mega evolution; 0.0.46 relied on the client to swap formes. Skip Legends-ZA megas.
- **Replay rendering:** the hosted player must initialize against a visible, laid-out container or renders blank; build replays lazily (IntersectionObserver) and size the iframe to content.
- **Weak teams can crash the search** (v1 saw it with a no-attack Smeargle). Guard the worker: catch engine errors, fall back to a random legal choice, and log.
- Sprites/item icons hotlinked; text stays functional when images fail.

## Key decisions
- "Legendary" = `BST > 600` (excluding Slaking/Regigigas); legendary weight stays strictly positive.
- Set overrides **add** options; override presence makes the base species draftable; labels live in the nickname slot of the file and show only in the loadout picker.
- Draft uses modern typing + generation of debut; one battle generation (gen9) for all battles.
- Perfect-information AI for both sides (v2); battles run on the player's CPU in a worker.
