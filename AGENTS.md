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
  tier banlists off, Tera and Dynamax disabled, and a fixed level of either 50
  or 100. The final fixed level is not yet locked.
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

The compatibility monkeypatch is applied in the parent Python process.
`fp/search/main.py` uses `ProcessPoolExecutor`, and its workers do not reliably
inherit that patch. Full PoC battles therefore used a runtime substitution of
`ThreadPoolExecutor`.

Resolve this in the future battle-runner with either a worker initializer that
applies the compatibility patch or one small, documented internal edit. Do not
accumulate additional ad hoc runtime commands.

### Local authentication

`fp/websocket_client.py` hardcodes the public Pokemon Showdown login endpoints.
A local `--no-security` server accepts an empty-token command:

```text
/trn USERNAME,0,
```

Stock foul-play does not use that path. The PoC handled it with a runtime
monkeypatch. Prefer keeping local auth in the wrapper; editing
`fp/websocket_client.py` creates an upstream merge cost.

### Challenge acceptance

The tested Showdown server emitted challenge state through PM protocol lines;
other current paths can emit `|updatechallenges|` JSON. The PoC acceptor handled
both forms with a runtime monkeypatch. The battle-runner must normalize this in
one place.

### Results and process behavior

`fp/run_battle.py::pokemon_battle()` returns the winner username. It returns
`None` for a tie. `run.py` treats every non-self winner, including `None`, as a
loss. It emits log output but no structured result or distinct battle exit
code.

The wrapper should call `pokemon_battle()` directly and emit a structured value
such as:

```json
{"winner": "name-or-null", "turns": 24, "replay_log": []}
```

The exact result schema is not yet implemented. Also note that
`check_dictionaries_are_unmodified()` calls `exit(1)` if shared move or Pokedex
dictionaries mutate, which can terminate the whole process.

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

This base command is not yet sufficient for a stock local battle: the current
PoC additionally requires runtime patches for the worker pool, local auth, and
challenge acceptance. There is no clean, checked-in full local-battle command
yet. Do not represent the experimental inline Python commands as a supported
interface.

## Current Status

An end-to-end proof of concept works through experimental CLI glue and four
runtime patches:

1. remove the unsupported MCTS `threads` argument;
2. substitute the process worker pool;
3. use empty-token local authentication;
4. accept the local challenge protocol.

Two foul-play bots completed a local Generation 9 random battle. The captured
replay then animated through the standard Showdown replay player in headless
Chromium with all 299 protocol lines, the final winner, no rejected lines, and
no JavaScript errors.

The compatibility shim and replay fixtures are checked in, but orchestration is
not yet a reusable battle-runner.

## Roadmap

1. Build the battle-runner: consolidate the glue and four patches into one
   tested function `(player_team, boss_team) -> {winner, turns, replay_log}` and
   resolve worker initialization there.
2. Build the pure legality matrix for current type by debut generation, the
   more-than-three filter, and legendary weighting.
3. Build draft and team assembly, exporting fixed-level Showdown teams.
4. Build the orchestrator: draft, run ten battles, and tally results, using
   stub boss clients first.
5. Build the draft UI, results display, and replay viewer, using the hosted
   player temporarily.
6. Author boss teams and tune difficulty after playtesting.
