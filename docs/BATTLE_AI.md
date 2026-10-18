# Battle AI: how it runs in the browser, and how strong it is

Written 2026-10-18 to answer two questions: how a CPU-heavy battle engine that could
not be hosted became a static website, and what that did to the AI's strength
compared with v1's foul-play. Companion to `docs/ARCHITECTURE.md` (design) and
`docs/DIFFICULTY.md` (tuning knobs).

## 1. Why v1 could not be hosted, and what moved where

### v1 (archived at github.com/ziangit/rollmons)
Every battle ran on the server, three processes deep:

- **foul-play** (Python): a Showdown bot. For each decision it spawned a
  **poke-engine** process (Rust) to search, and talked to
- a local **Pokémon Showdown server** (Node) over a websocket, which refereed.

Measured cost: **19–23 s of server CPU per battle**, two thirds of it foul-play's
process spawning and protocol handling, the rest real search. That cost scaled
with the number of players, so the game could not be put online for many people.
The macOS app ran this same stack on the player's Mac, which is why it ran hot:
three processes, one of them a Node server, alive for the whole run.

### v2 (this repo)
No server does any battle work. The site is static files. The battle runs in the
player's browser:

| Piece | v1 | v2 |
|---|---|---|
| Move search | poke-engine, native binary, one process per decision | poke-engine compiled to **WebAssembly** (`engine/`), loaded once |
| Referee | Pokémon Showdown server over websocket | `@pkmn/sim`, Showdown's simulator as a JS library, in-process |
| Bot plumbing | foul-play (Python) | `web/battle/` (TypeScript), written fresh |
| Where it runs | server (or the Mac app's background processes) | a **Web Worker** in the browser tab |

The worker (`web/battle/worker.ts`) loads the wasm, runs the whole battle loop
synchronously (`runner.ts`), and streams one event per decision to the page. The
UI thread never searches, so the page stays responsive during a battle.

### What it costs the player's machine
The search is **time-boxed**, not effort-boxed. For each decision the engine runs
Monte Carlo tree search until a wall-clock budget expires and returns whatever it
found (`DEFAULT_BUDGET_MS` in `web/battle/runner.ts`):

| | Player's AI | Boss AI |
|---|---|---|
| Budget per decision | 100 ms | 25 ms |
| Iterations in that budget (Chrome 155, M1-class Mac) | ~220k | ~52k |
| Per battle (~25 turns, both sides) | ≈ 4 s of one core, in bursts | |
| Full 10-battle campaign | ≈ 40 s of one core | |

Single thread, one core, for a few seconds per battle. wasm runs at roughly
75–80 % of native speed (benchmark in `docs/ARCHITECTURE.md`).

Consequences of the time budget:
- A slower machine does not get hotter or take longer: it completes fewer
  iterations in the same 100 ms, so the AI plays a little weaker.
- The page also fetches ~2 MB once (worker bundle, wasm, data), then nothing.

Playtest note (2026-10-18): on the author's Mac the browser version was fine; no
noticeable heat, unlike the v1 Mac app.

### What the player is told
Nothing, today. The battle screen shows "Now battling X — turn N" while the worker
searches. There is no notice that the AI is computing on the player's device and
no low-power setting. Both are cheap to add: a one-line hint on the battle screen,
and a budget toggle (the budgets are already overridable with `?p1ms=&p2ms=` for
development). Mobile Safari performance is unmeasured; a lower default budget
there may be needed.

## 2. How strong the AI is, and the foul-play question

### v2 does not use foul-play
foul-play is GPL-3.0 and none of its code is in this repository (hard constraint
in `CLAUDE.md`). This was recorded as a v2 decision in the handoff written at the
end of the v1 session, together with the perfect-information decision below, and
carried into this repo's docs. The reasons were about the deployment target, not
foul-play's quality:

- foul-play is a Python program that spawns processes and needs a Showdown server
  over a websocket. None of that exists in a browser. Using it means running a
  server again, which is exactly what made v1 unhostable.
- Most of what foul-play adds on top of poke-engine is unnecessary when both sets
  are known (see below).
- Vendoring GPL code would have forced this MIT repo to GPL. (Running foul-play on
  a server of your own would *not* be a license problem; only shipping its code is.)

### What foul-play is made of, and what v2 replaced each part with
foul-play is four layers. Only one of them knows how to play Pokémon.

| Layer | foul-play | v2 |
|---|---|---|
| 1. Battle state | reconstructed from the Showdown protocol stream | read directly from the simulator's omniscient `Battle` object (same worker) |
| 2. Opponent inference | samples likely opponent sets from usage statistics; searches several candidate states | **dropped**: both sets are known in rollmons, so the true state is searched |
| 3. Search and evaluation | **poke-engine** (separate process) | **poke-engine** (same program, wasm, newer pinned revision `f7b147f` with in-engine Mega modelling) |
| 4. Move selection | combine results across candidate states, send a move | filter the engine's suggestions to what the sim says is legal; keep those within 75 % of the best visit count; sample one by visits (`web/battle/driver.ts`, `CANDIDATE_VISIT_RATIO`) |

All damage formulas, mechanics, tree search, and position evaluation live in
layer 3, and that is the same engine in both. v2 wrote the plumbing (layers 1,
2, 4) fresh in TypeScript. The state mapper (`web/battle/engine-state.ts`)
writes both sides into poke-engine's state-string format (29 `=`-separated side
fields, 29 `,`-separated fields per Pokémon). The 75 %-of-best sampling rule was
kept from v1 so battles are not deterministic.

### Same, better, worse

| Aspect | v1 with foul-play | v2 | Effect |
|---|---|---|---|
| Search and evaluation | poke-engine | poke-engine, newer revision | same |
| Knowledge of the opponent's set | guessed | exact (perfect information, both sides) | better, and more clairvoyant |
| Budget per decision | 100 ms player / 25 ms boss, native | same budgets, ~80 % native speed | slightly fewer iterations |
| Candidate states per decision | several guesses share the budget | one true state gets all of it | better |
| State fidelity | foul-play's protocol tracking (years of use) | fresh mapper from the sim object | depends on mapper correctness |
| Engine limits | no Tera (compiled out); some items unknown | same: 7 items in the data are unknown to the engine and searched as no item | same |

"Better information" means layers 2 and the candidate-state row: foul-play spends
part of its budget on sets the opponent might have; v2 spends all of it on the
real position. For the same engine and budget that should give equal or better
decisions. The flip side is style: both AIs know the opposing sets, so they switch
into the exact counter for moves they "should not" know. This is deliberate and
symmetric (`docs/ARCHITECTURE.md`, key decisions).

The boss gets a quarter of the player's budget, so the player's team is favoured
on purpose. Those two numbers are the main difficulty knob.

### What is not proven
- **No measurement.** The win-rate comparison against the archived v1 stack
  (milestone 2) was never run, because foul-play is not in this repo. A self-play
  sweep at different budgets (`node scripts/sweep.ts`) is the available tool.
- **Mapper fidelity.** If `engine-state.ts` mis-transcribes a volatile status, a
  boost, or a weather counter, the engine searches a slightly wrong position and
  plays worse without any error. The 60-battle sweep checked move legality, not
  field-by-field fidelity.
- **foul-play heuristics.** foul-play may carry small selection heuristics on top
  of the raw search that were not audited against v2's driver.
- **No competitive rating** is quoted here; none was measured.

### If foul-play were ever wanted back
It would be a server-side battle service (foul-play + Showdown server + poke-engine
on a VPS; the page submits a battle and fetches the log), roughly $5–20/month for a
hobby audience, ~20 s of CPU per battle, scaling linearly with players. The clean
shape is a hybrid: keep the browser engine as the default and add an optional
server mode. That is a milestone-sized project starting from the archived v1 runner.
