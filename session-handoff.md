# Session handoff

**Current phase:** milestone 1 done (2026-10-17): `engine/` builds poke-engine to wasm (gen9, Tera compiled out) and benchmarks at ~80 % of native in a Chrome Web Worker (table in `docs/ARCHITECTURE.md`). Reference Python layer green (`make test`). Referee spike proven.
**Next concrete step:** milestone 2 — the omniscient state mapper (`@pkmn/sim` battle object → poke-engine serialized state string; the format is documented in the doc-comment on `State::deserialize` in upstream `src/state.rs`: `side1/side2/weather/terrain/trickroom/teampreview`, each side's six Pokémon `=`-separated with `,`-separated fields; v1's `battler_to_poke_engine_side` logic is the behavioural reference but must be rewritten fresh) and then one full AI-vs-AI battle in a page: `@pkmn/sim` BattleStream + `engine/pkg` MCTS in a Web Worker, choice sampling within 75 % of best, `move X mega` handling. Start as `spikes/sim-engine-battle/` and promote to `web/battle/` once a battle finishes.

## Why v2 exists
v1 could not be hosted for many players: every battle ran foul-play + poke-engine on the server (measured ~19–23 s of bot CPU per battle, two thirds of it foul-play spawning a process per decision; ~5–7 s real search). Moving the battle into the player's browser makes server cost zero. Enablers verified on 2026-10-17:
- poke-engine upstream added wasm support (issue #19 closed 2026-10-10; `web-time` on the wasm32 target; only deps are dashmap/clap/rand). Single-thread MCTS is the wasm path.
- `@pkmn/sim` (browser build of Showdown's simulator) runs the rollmons custom format in-process: Cynthia vs Leon finished in 28 ms, 25 turns, with Mega Evolution firing. Spike checked in at `spikes/sim-battle/` (`npm install && npm start`): a RandomPlayerAI pair on `BattleStreams.BattleStream` with `gen9customgame@@@Species Clause,+Past,Dynamax Clause,Terastal Clause,!! Max Move Count = 4,Adjust Level = 100`.
- **`@pkmn/sim` 0.10.11 lacks the `Z-Move Clause` and `CFZ Clause` rules** that v1's format string included. Both are irrelevant in gen9 (no Z-moves in the gen9 sim), so v2's format drops them. `PERMISSIVE_GEN9_FORMAT` in `battle_runner.py` still lists them for parity with v1 tests; align when the TS format constant is written.

## Decisions (v2)
- **Phase 2 straight away:** port the Python draft/loadout logic to TypeScript so the whole game is a static site. Python stays as the reference and test oracle until each module is ported.
- **Perfect-information AI.** v1's foul-play inferred the opponent's hidden set from Smogon usage (4k lines). In v2 both teams are fully known (boss files + chosen loadout), so the engine state is built straight from the sim's omniscient battle object. Symmetric for both sides.
- **Keep the v1 history**, drop the fork. Licensing: no GPL (foul-play) code remains; poke-engine and Showdown/@pkmn are MIT. This repo is MIT.
- License: MIT (chosen 2026-10-17).
- Draft weights, caps, and AI think time remain playtest knobs (`docs/DIFFICULTY.md`).

## Milestones
1. **Engine:** `engine/` crate wrapping poke-engine with wasm-bindgen; exports state-from-string, MCTS (time-boxed), damage calc. Benchmark. **Done:** pinned upstream master at `f7b147f` (0.0.48 + wasm `web-time` patch + in-engine Mega modelling); the no-Tera build is unit-tested to never emit `-tera`.
2. **Referee + driver:** `web/battle/` worker: `@pkmn/sim` BattleStream, state mapper (mirror of v1 `battler_to_poke_engine_side` logic, written fresh), move selection from MCTS results (keep v1's "sample among choices within 75% of the best" rule), Mega handling (`move X mega`; one Mega per team per battle). Validate win rates vs the archived Python stack on a few pool matchups.
3. **Replay:** feed the worker's protocol log to the existing replay embed (`replayDoc` in `app.js`, opponent avatar rewrite). Unchanged otherwise.
4. **Port the pure layer:** legality matrix, draft state machine, loadout/set selection, pool/campaign builder, set-override normalization. Use the Python tests as the spec; `@pkmn/dex` replaces `data/pokedex.json`/`moves.json`.
5. **Static hosting** (GitHub Pages or similar). Then playtest; deepen Middle band; per-band AI think time.

## Done so far (most recent first)
- **Milestone 1: engine wasm build + benchmark (2026-10-17).** rustup installed (Homebrew keg-only formula; `~/.cargo/bin` symlink shims keep `showdown-rs` building). `engine/` crate: wasm-bindgen wrapper exporting `root_options` / `mcts` / `evaluate_state` / `damage_rolls` / `engine_version`, poke-engine pinned to git rev `f7b147f` (first wasm-capable revision; 0.0.48 on crates.io panics on `Instant::now()` under wasm), `gen9` only, unit test asserts no `-tera` choice is ever offered. Bench: 100 ms budget → native 276k iterations, Chrome worker 220k, Node 202k; 25 ms → 57k vs 52k. `spikes/engine-bench/` drives headless Chrome via puppeteer-core. Bundle: 653 KB wasm, 203 KB gzipped.
- **Handoff from the v1 session (2026-10-17):** v1 repo README/handoff carry a "superseded" banner pointing here; v1 is to be archived on GitHub (`gh repo archive ziangit/rollmons -R ziangit/rollmons`). The referee spike is checked in under `spikes/sim-battle/`.
- **Repo bootstrap (2026-10-17):** filtered history; `AGENTS.md` → `docs/v1-foul-play-integration.md`; removed `rollmons/sandbox.py` (needed the v1 runner); `battle_runner.py` reduced to the types the web app and tests use (`run_battle` raises); clean-room `rollmons/showdown_export.py` replaces foul-play's `teams.team_converter`; `data/pokedex.json` + `moves.json` carried over (Showdown-derived, MIT); Makefile with `install`/`test`/`harness`.

## Open questions / known issues
- Mobile Safari wasm performance unmeasured; may need a lower search budget on weak devices.
- Engine wasm is 203 KB gzipped (measured). `@pkmn/sim` gen9-only bundle size unmeasured (package is 46 MB unpacked across all gens; expect a few MB gzipped after tree-shaking).
- `rollmons/bosses_2/` is staged but not loaded (same as v1).
- Set editor (`set_editor.html`) was gated behind `ROLLMONS_ENABLE_SET_EDITOR` in v1; decide whether it survives the port.
