# rollmons (v2)

A single-player Pokémon draft/autobattler being rebuilt to run **entirely in the browser**: poke-engine (Rust → WebAssembly) searches moves, `@pkmn/sim` referees, and the draft/loadout logic becomes TypeScript, so the game hosts as a static site with no battle server. v1 (vendored foul-play + a local Showdown server + a macOS desktop app) is archived at github.com/ziangit/rollmons.

@docs/PRODUCT.md
@session-handoff.md

## Conventions
- `rollmons/` (Python) is the **reference implementation** of draft, matrix, loadout, pool, and set-override logic. Its tests define behavior. Port from it module by module; keep `make test` green until a module's TypeScript port replaces it.
- Browser code lives under `web/` (TypeScript), the engine build under `engine/`. Game data (`rollmons/bosses`, `rollmons/sets`, `rollmons/pool`) stays in Showdown export format and is read by both implementations.
- The AI battle runs in a Web Worker, never on the UI thread. Both sides use perfect information about sets (a deliberate v2 decision; see `docs/ARCHITECTURE.md`).
- Match surrounding code style. Run `make test` (ruff + pytest) and, when `web/` changed, `cd web && npm run typecheck && npm test` before considering work done. `node scripts/sweep.ts 40 10` (in `web/`) is the battle-level regression check.
- Split work into small, logically separated commits (tooling / refactor / docs), never one catch-all commit.
- Spikes and throwaway experiments go under `spikes/<name>/` with their own `package.json`, so they stay reproducible without polluting `web/`.
- Do only the requested scope; flag scope growth instead of silently building adjacent features.

## Hard constraints (never violate)
- Build poke-engine for wasm with `--features gen9 --no-default-features` (Tera compiled out). A Tera-enabled engine returns illegal `-tera` choices.
- **No foul-play code in this repo** (foul-play is GPL-3.0). The export parser, battle-state mapping, and runner were written fresh. Dependencies are MIT: poke-engine, Pokémon Showdown / `@pkmn/*`.
- Push only to `origin` (github.com/ziangit/Rollmon).
- Never commit `node_modules`, build output, logs, or sprite/audio assets. Sprites and the replay player are hotlinked from play.pokemonshowdown.com (dev only; distribution decision deferred).

## Toolchain
- Rust via **rustup** (not Homebrew `rust`). Installed 2026-10-17 as Homebrew's keg-only `rustup` formula (no `rustup-init`; toolchains live in `~/.rustup`): `/opt/homebrew/opt/rustup/bin` is prepended to PATH in `~/.zshrc`, and `~/.cargo/bin` holds symlinks to those proxies because the sibling project `showdown-rs` puts `~/.cargo/bin` first on PATH (verified it still builds). Targets/components: `wasm32-unknown-unknown`, `llvm-tools-preview`. Homebrew `rust` is still installed but shadowed.
- Engine build: `wasm-pack` (Homebrew) → `cd engine && wasm-pack build --release --target web --out-dir pkg` (needed before anything in `web/` runs). Native checks: `cargo test --release`, `cargo run --release --bin bench`.
- Web: `cd web && npm install && npm run build` writes the static site to `web/dist`; TypeScript runs directly under Node 24 (type stripping, so no enums/namespaces and `.ts` import extensions); `npm run dev` serves the game at `/dist/index.html` and the worker page at `/dev/battle.html`. `node scripts/chrome-app.mjs` plays a whole run in headless Chrome (needs Chrome installed).
- Node 24 for `@pkmn/sim`, the web bundle, and spikes. Python 3.11 only for the reference layer.

## Where to look
- `docs/ARCHITECTURE.md` — v2 target architecture, port status, gotchas carried over from v1
- `docs/BATTLE_AI.md` — how the battle runs in the browser (cost to the player's machine) and how the AI compares with v1's foul-play
- `docs/DIFFICULTY.md` — campaign ladder contract and tuning knobs
- `docs/v1-foul-play-integration.md` — v1 integration notes (historical; the Tera, Mega, and replay-rendering landmines still apply)
