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
- **Data:** `rollmons/bosses`, `rollmons/sets`, `rollmons/pool` (Showdown export text, read at build or fetch time); `@pkmn/dex` for species/move data; `rollmons/data/smogon_sets.json` and `gen9randombattle.json` for set sources.
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
| Referee + driver worker | — | spike only (sim battle proven) |
| Legality matrix / draft | reference | not started |
| Loadout / set selection | reference | not started |
| Pool / campaign | reference | not started |
| Results / damage summary | reference | not started |
| Replay embed | — | reuse from `web_static/app.js` |

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
