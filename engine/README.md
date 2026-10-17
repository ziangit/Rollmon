# engine

`rollmons-engine`: a wasm-bindgen wrapper around
[poke-engine](https://github.com/pmariglia/poke-engine) (MIT), built with
`gen9` only and **Terastallization compiled out** (a Tera-enabled engine emits
`-tera` choices the referee rejects; `cargo test` asserts none appear).

Upstream is pinned by git rev in `Cargo.toml`: the crates.io 0.0.48 release
predates the `web-time` patch and panics on `Instant::now()` under wasm32.

## Build
```
rustup target add wasm32-unknown-unknown      # once
brew install wasm-pack                          # once
wasm-pack build --release --target web --out-dir pkg
```
Output in `pkg/` (gitignored): `rollmons_engine.js` + `rollmons_engine_bg.wasm`
(~650 KB raw, ~200 KB gzipped). `cargo test --release` runs the native unit
tests; `cargo run --release --bin bench -- 100` prints native MCTS throughput
(compare with `spikes/engine-bench/`).

## Exports (all strings in, JSON strings out)
| fn | purpose |
|---|---|
| `engine_version()` | pinned upstream rev + feature set |
| `root_options(state)` | `{"s1":[choice…],"s2":[…]}` legal root choices |
| `mcts(state, max_time_ms, max_iterations)` | `{"iterations","s1":[{choice,score,visits}…],"s2":[…]}`; `max_iterations > 0` overrides the time budget |
| `evaluate_state(state)` | static eval from side one's view |
| `damage_rolls(state, s1_move, s2_move, s1_moves_first)` | `{"s1":[16 rolls]|null,"s2":…}` |

`state` is poke-engine's serialized state format (`State::deserialize`); the
battle driver builds it from the `@pkmn/sim` battle object. Choice strings
are poke-engine's own (`PSYSHOCK`, `PSYSHOCK-mega`, `switch GARCHOMP`).

Notes:
- `rand 0.9` → `getrandom 0.3` needs the `wasm_js` backend: feature in
  `Cargo.toml` plus the `--cfg` in `.cargo/config.toml`.
- The search is single-threaded (`mcts`); `mcts_threaded` compiles but would
  fail at runtime on wasm (no `std::thread`), so it is not exported.
