# Project Context

## Project

This repository is being evaluated as the battle-AI dependency for a
single-player Pokemon roguelite.

The player drafts six Pokemon through a slot machine. Each draft round locks a
random `(current type, generation of debut)` cell, and the player takes the
strongest available Pokemon eligible for that cell. The drafted team then plays
a fixed ten-battle gauntlet against pre-authored boss teams. Both sides are
AI-piloted; the player does not choose moves during battle.

Treat the upstream foul-play code in this repository as a vendored dependency.
Our game-specific code should eventually live outside its internals.

## Locked Decisions

- Draft labels use current/modern typing and generation of debut. The generation
  number is cosmetic metadata only; all battles use one battle generation.
- Show only `(type, generation)` cells with more than three eligible Pokemon.
- Legendary Pokemon are down-weighted, not banned.
- A species or forme is a draftable atom if it has a `gen9randombattle` set.
  Its type is its current type and its generation is its debut generation.
- Battles use Generation 9 mechanics with no Terastallization, Dynamax, Mega
  Evolution, or Z-Moves.
- Battles use a self-hosted, permissive custom format with Species Clause on,
  tier banlists off, Tera and Dynamax disabled, and a fixed level of 100.
- The one-battle integration format is based on `gen9customgame` and adds
  `Species Clause`, `+Past`, `-Mega`, explicit Primal and battle-only Past forme
  bans, every Mega Stone and Primal Orb ban, `Dynamax Clause`,
  `Z-Move Clause`, `CFZ Clause`, `Terastal Clause`,
  `!! Max Move Count = 4`, and `Adjust Level = 100`. The double bang is required
  to replace Custom Game's existing 24-move value. `+Past` enables old coded
  species and moves but does not permit old mechanics: Mega and Primal
  transformations are blocked by both forme and item bans, direct battle-only
  Past formes are banned, Gigantamax is rejected by Dynamax Clause, and
  Z-Moves remain blocked. Do not add tier banlists or general
  `Obtainable`/learnset validation.
- Movesets are borrowed from Generation 9 random-battle data and re-statted at
  the fixed level as an authoring step. foul-play does not derive fixed custom
  teams automatically from random-battle data.

## Architecture

- A self-hosted Pokemon Showdown server is the referee and source of battle
  truth. It runs under Node and was validated with `--no-security`.
- foul-play is the AI client. It is Python code backed by the Rust
  `poke-engine` package and connects to Showdown over a websocket.
- foul-play pilots the drafted player team.
- The boss is a second client. Initially, use a second foul-play instance with a
  low search time; author and tune real boss teams later.
- Our code owns orchestration, drafting, team assembly, results, and frontend.
- Do not reimplement the battle engine.
- Do not depend on `play.pokemonshowdown.com` at product runtime. During
  development only, the hosted replay player is an accepted temporary
  dependency.

The intended boundary is one battle-runner module. It should be the only place
our code imports or calls foul-play.

## Game Layer

Pure game logic lives under `rollmons/` and must not import `fp/`.

`rollmons/legality_matrix.py` builds the draft legality matrix and weighted
selection primitive. Its data sources are:

- `rollmons/data/gen9randombattle.json`: the checked-in 508-atom Generation 9
  random-battle set snapshot. Presence in this file defines draftability.
- `data/pokedex.json`: Showdown-derived current types, six base stats, National
  Dex numbers, formes, and base-species links. BST is the sum of the six
  `baseStats` values in this file.
- `FORME_DEBUT_GENERATION_OVERRIDES`: 33 forme debut generations verified
  against Pokemon Showdown `Dex.species.get(id).gen` at Showdown commit
  `a9caa4c`. All other atoms derive generation from National Dex boundaries.

The project intentionally defines legendary as `BST > 600`, regardless of
Pokedex lore tags, except for `LEGENDARY_BST_EXCLUSIONS`: Slaking (`Truant`)
and Regigigas (`Slow Start`). Their ability-suppressed stat-balls make raw BST
overstate competitive power. Exactly-600 pseudo-legendaries and mythicals such
as Mew, Jirachi, and Victini are normal atoms by design. Do not change this
back to a tag-based definition. Valid cells contain at least four atoms.
Legendary selection weight must remain strictly positive so thin
legendary-heavy cells cannot soft-lock.

`rollmons/draft.py` implements the six-round headless draft state machine. Each
offer contains a valid cell, its complete undrafted candidate list, and one
legendary-weighted suggested pick. The suggestion is a soft nudge only: the
chooser may select any offered candidate, so legendary Pokemon remain fully
draftable. The offer also exposes the selector's normalized probability for
each candidate; consumers must display this engine value rather than
recomputing weights. Species identity is deduplicated globally across both
types, and the default draft has one bounded cell skip.

`rollmons/team_assembly.py` selects each drafted atom's randbats set weighted by
its observed count and emits a six-member Showdown export at level 100. It
preserves the recorded item, ability, and moves. Nearly all source records have
four moves; Ditto deliberately preserves its source-defined single
`Transform`.

Player-team stats intentionally use `Serious` nature, 85 EVs in each of the six
stats (the legal 510 total cap), and omitted IV lines so Showdown defaults to
31. This exactly matches foul-play's own randbats parser, keeping assembled
player teams stat-identical to what the AI was validated piloting. The spread
is neutral and source-consistent, not optimized or a placeholder. Separately
authored boss teams may use optimized spreads.

Authored bosses live as Showdown export text under `rollmons/bosses/`.
`rollmons/boss_loader.py` maps stable boss IDs to those files and returns the
export string expected by `battle_runner.run_battle()`. `ash.txt` is the first
thematic, intentionally suboptimal boss team; all six members explicitly set
level 100.

`rollmons/web_app.py` is a thin FastAPI transport over the game-layer modules.
It keeps local single-user draft sessions in memory and exposes the complete
18x9 pool inspector plus start/state/pick/skip draft endpoints. The static SPA
under `rollmons/web_static/` renders that engine state, including BST,
engine-calculated suggestion probability, the most-observed representative
randbats set and role count, and the fixed player assembly spread. Draft cards
use a light PokePaste/Showdown-teambuilder layout with the real level 100,
Serious, flat-85 EV, and implicit-31 IV assembly data. It does not implement
matrix filtering, dedupe, cell guards, weighted suggestions, probability
calculation, or team assembly in JavaScript.

After a six-round draft completes, the harness exposes one live integration
action. It loads the Ash boss, performs an existence-only species/move check
against foul-play's checked-in Gen 9 data, calls `battle_runner.run_battle()`,
and returns winner, turns, battle ID, and replay protocol. The browser embeds
`"\n".join(replay_log)` in the hosted Showdown replay player. This path requires
the self-hosted server, `logchallenges = true`, a readable
`ROLLMONS_SHOWDOWN_LOG_DIR`, and the gen9-no-Tera engine. Matrix inspection and
drafting remain usable without any live battle stack.

Run the development harness with:

```bash
make dev
```

Run the complete local draft-to-battle stack with:

```bash
make live SHOWDOWN_DIR=/path/to/pokemon-showdown
```

`scripts/run_live_harness.py` validates the external checkout, enables
`logchallenges`, creates its log root, starts Showdown and Uvicorn, opens the
browser, and owns cleanup for both process groups. It may auto-detect a single
nearby Showdown installation and runs `npm install` there if local Node
dependencies are absent. It does not build or upgrade poke-engine.

Open `http://127.0.0.1:8080`. For development only, the harness hotlinks
Pokemon sprites and the item-icon sheet from `play.pokemonshowdown.com`, using
the same `home-centered` sprite IDs and item `spritenum` coordinates as the
Showdown client. Showdown's code is open source, but the community- and
Nintendo-derived image assets do not have established redistribution terms.
Hotlink for display; do not download, vendor, or commit these assets. This
keeps the licensing and self-hosting decision deferred, like the hosted replay
player. Text, type chips, sets, probabilities, and controls remain functional
when images fail.

## Integration Landmines

### poke-engine compatibility

`requirements.txt` pins `poke-engine==0.0.46`. Keep that exact pin until a
tagged, compatible release is deliberately adopted.

The current foul-play search calls:

```python
monte_carlo_tree_search(state, duration_ms, threads=...)
```

The `threads` keyword does not exist in `poke-engine==0.0.46`.
`run_poke_engine_compat.py` patches the imported function so extra keyword
arguments are discarded:

```python
poke_engine.monte_carlo_tree_search(state, duration_ms)
```

Do not install `poke-engine` from its main branch while it still identifies
itself as `0.0.46`. That produces an unreproducible dependency. When a tagged
release supports threaded MCTS, pin that release and restore the `threads`
argument.

### Engine generation and Tera

Build plain Generation 9, not the default Terastallization feature:

```bash
make poke_engine GEN=gen9
```

The Makefile expands this to:

```text
--features poke-engine/gen9 --no-default-features
```

Tera must be compiled out. A server ban is not sufficient because foul-play
does not pass Showdown's `canTerastallize` state to poke-engine; a Tera-enabled
engine can therefore return an illegal `-tera` choice.

The Docker equivalent is:

```bash
make docker GEN=gen9
```

Rust and Cargo are required for a local engine build. The Docker build keeps
Rust in its build stage.

### Worker processes

There are two nested process layers. `run_battle()` spawns one disposable
foul-play client process per role (player and boss). Inside each client, every
move search creates a transient `ProcessPoolExecutor` of MCTS workers; the pool
is created and torn down per decision, not persisted for the battle.

`battle_runner.py` preserves that inner process-pool concurrency and installs a
worker initializer that reapplies the `poke-engine==0.0.46` compatibility patch
only in those MCTS workers. Do not replace foul-play's process pool with
threads.

### Local authentication

`fp/websocket_client.py` hardcodes the public Pokemon Showdown login endpoints.
A local `--no-security` server accepts an empty-token command:

```text
/trn USERNAME,0,
```

Stock foul-play does not use that path. `battle_runner.py` owns the empty-token
login and verifies the resulting `|updateuser|` response. Keep local auth in
the wrapper; editing `fp/websocket_client.py` creates an upstream merge cost.

### Challenge acceptance

The tested Showdown server emitted challenge state through PM protocol lines;
other current paths can emit `|updatechallenges|` JSON. `battle_runner.py`
normalizes both forms in one place.

Some current Showdown websocket paths also emit each private `|request|` frame
before the corresponding public battle update frame. Stock foul-play assumes
the public update is seen first (or in the same frame), otherwise it can discard
the team-preview request or search before applying a switch. The runner buffers
request-only battle frames until the next public update and then replays the
request. Keep this protocol normalization in the wrapper.

### Results and process behavior

`fp/run_battle.py::pokemon_battle()` returns the winner username. It returns
`None` for a tie. `run.py` treats every non-self winner, including `None`, as a
loss. It emits log output but no structured result or distinct battle exit
code.

The wrapper calls `pokemon_battle()` directly and emits:

```json
{"winner": "player-or-boss-or-tie", "turns": 24, "battle_id": "...", "replay_log": []}
```

The outer player and boss client processes are disposable, isolating engine
failures and `SystemExit`; they are distinct from the transient inner MCTS
workers described above. The runner does not call `run_foul_play()` or
`check_dictionaries_are_unmodified()`.

Challenge battle logs require `logchallenges = true` on the Showdown server.
`BattleRunnerConfig.showdown_log_dir` must be the readable/shared battle-log
root. A missing JSON log after `replay_timeout` is a recoverable
`BattleReplayTimeoutError`.

### Reproducibility

Keep the `poke-engine==0.0.46` pin and Rust feature flags locked in build
scripts. Pinned versions are load-bearing; never upgrade a dependency merely to
make an error disappear without checking the installed artifact's API.

## Replays

`replays/gen9randombattle-12.log.json` is a known-good server battle-log
fixture. Its `log` array contains standard Showdown protocol and has no
`|split|` markers, so it is already spectator/export form.

Normalization is:

```python
protocol = "\n".join(data["log"])
```

Place that protocol in:

```html
<script type="text/plain" class="battle-log-data">
```

`replay-embed.js` consumes this protocol directly; the animation log is not a
separate format. `replays/gen9randombattle-12.html` is the corresponding
known-good generated fixture.

During development, the fixture loads the hosted player from
`play.pokemonshowdown.com`. Full self-hosting is deferred until the product
decision between local-only and hosted distribution is made. Self-hosting
requires:

- Pokemon Showdown client JavaScript, CSS, and data files
- sprites from `smogon/sprites`
- audio, which is not included in the client repository

The largest clean-distribution risk is sprite and especially audio licensing.
If self-hosting proceeds, limit sprites to the draft pool and omit audio.

## Working Conventions

- Touch foul-play internals as little as possible.
- Put custom behavior in our driver code behind one battle-runner boundary.
- Push project work only to the `origin` remote
  (`https://github.com/ziangit/rollmons.git`). The `upstream` foul-play remote is
  fetch-only and must never receive project commits.
- Prefer wrappers and monkeypatches to internal edits.
- Document any unavoidable foul-play edit as an explicit maintenance cost.
- Verify integrations by running them: an MCTS decision must return, a battle
  must complete, and a replay must animate in a headless browser.
- Do only the requested scope. Flag scope growth instead of silently building
  adjacent features.
- Never commit credentials, logs, caches, temporary audit clones, Node
  dependencies, or vendored sprite/audio bundles.

## Known-Good Commands

Build the pinned non-Tera Generation 9 engine:

```bash
make poke_engine GEN=gen9
```

Build the same configuration in Docker:

```bash
make docker GEN=gen9
```

Run the compatibility entry point with the normal foul-play CLI:

```bash
python3 run_poke_engine_compat.py --help
```

The local Showdown PoC used this command from a separate Pokemon Showdown
checkout:

```bash
node pokemon-showdown start --no-security 8000
```

That server checkout and command are not provided by this repository.

Enable challenge battle logs in that server's `config/config.js`:

```js
exports.logchallenges = true;
```

Call the checked-in fixed-team seam programmatically:

```python
run_battle(player_team, boss_team, config) -> BattleResult
```

Both teams are Showdown export strings. `config.seed` controls foul-play's
Python-side sampling only; it does not seed Showdown's battle RNG.

Run the live validation against the external server:

```bash
python3 scripts/validate_battle_runner.py --runs 20
```

The base foul-play client invocation against that server is:

```bash
python3 run_poke_engine_compat.py \
  --websocket-uri ws://localhost:8000/showdown/websocket \
  --ps-username BOT_NAME \
  --bot-mode challenge_user \
  --user-to-challenge OTHER_BOT_NAME \
  --pokemon-format gen9randombattle \
  --run-count 1 \
  --search-time-ms 25 \
  --search-parallelism 1
```

The base foul-play CLI command remains useful for diagnosis, but product code
must use `battle_runner.py` so lifecycle and result handling stay isolated.

## Current Status

`battle_runner.py` implements the one-battle fixed-team seam. It owns the MCTS
compatibility patch, spawned-worker initialization, local no-security login,
both challenge notification forms, typed lifecycle failures, normalized
results, and server battle-log retrieval.

Live validation completed 20 consecutive fixed-team Generation 9 challenge
battles. All structured winners matched both clients and the replay's final
`|win|`; 80 spawned MCTS workers reported the compatibility initializer; child
process and established connection counts were unchanged before and after.

The earlier 299-line random-battle replay fixture still animates through the
standard Showdown replay player with no rejected lines or JavaScript errors.

The pure legality matrix is implemented in `rollmons/legality_matrix.py`: 508
randbats atoms produce 101 valid type-generation cells after the more-than-three
filter. The six-round draft and level-100 team assembly are implemented in
`rollmons/draft.py` and `rollmons/team_assembly.py`. The first authored boss and
one real post-draft battle path are built, including structured results and a
hosted replay embed. Ten-battle orchestration, gauntlet results, and additional
boss authoring remain unbuilt.

## Roadmap

1. Stabilize and containerize the existing battle-runner configuration without
   expanding its one-battle API.
2. Expand the proven one-battle draft integration into the ten-battle
   orchestrator and tally results. Do not duplicate the existing seam.
3. Extend the one-battle results UI for gauntlet progress and aggregate results.
   The hosted single-battle replay viewer is built temporarily.
4. Author boss teams and tune difficulty after playtesting.
