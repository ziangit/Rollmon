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
- Include every nonempty `(type, generation)` cell. Cells with 1-2 undrafted
  candidates are thin and grant an optional reroll separate from the manual skip.
- Legendary Pokemon are down-weighted, not banned.
- A species or forme is a draftable atom if it has at least one usable set in
  the configured set source, OR a checked-in set override under
  `rollmons/sets/`. `rollmons/data/smogon_sets.json` is the default primary
  source; the checked-in `gen9randombattle` snapshot remains available as a
  switchable alternate and set-level fallback. Its type is its current type and
  its generation is its debut generation. Override-only atoms (e.g. a base
  species that exists in the pool solely because it has a Mega-Stone set) use
  the base species' type and debut generation, like any other atom.
- Battles use Generation 9 mechanics with no Terastallization, Dynamax, or
  Z-Moves. Mega Evolution is allowed for both authored boss teams and player
  teams through the custom game format: a drafted base species carrying a
  Mega-Stone set mega-evolves in battle. Only one Pokemon per team can
  mega-evolve per battle (standard rule).
- Battles use a self-hosted, permissive custom format with Species Clause on,
  tier banlists off, Tera and Dynamax disabled, and a fixed level of 100.
- The one-battle integration format is based on `gen9customgame` and adds
  `Species Clause`, `+Past`, `Dynamax Clause`, `Z-Move Clause`, `CFZ Clause`,
  `Terastal Clause`, `!! Max Move Count = 4`, and `Adjust Level = 100`. The
  double bang is required to replace Custom Game's existing 24-move value.
  `+Past` enables old coded species, moves, formes, and Mega Stones for authored
  teams. Gigantamax is rejected by Dynamax Clause, Z-Moves remain blocked, and
  Terastallization remains blocked. Do not add tier banlists or general
  `Obtainable`/learnset validation.
- Player movesets are assembled from the configured set source at level 100.
  Smogon exports are already level 100; their `Tera Type:` lines are stripped
  so the set is inert in the no-Tera format. foul-play does not derive fixed
  custom teams automatically from source data.

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

- `rollmons/data/smogon_sets.json`: the contributor-provided Smogon set
  snapshot. This is the default primary pool and set source.
- `rollmons/data/gen9randombattle.json`: the checked-in 508-atom Generation 9
  random-battle set snapshot. This remains available with
  `ROLLMONS_SET_SOURCE=randbats` and as the fallback when a drafted species has
  no usable Smogon set.
- `rollmons/sets/`: checked-in override files. `build_legality_data` unions the
  configured source's atoms with every species that has an override file (those
  in the Pokedex), so override-only species (e.g. Mega-Stone base species absent
  from the source pool) become draftable atoms. The battle-only Mega/Gmax
  *forme* guard still rejects forme atoms; overrides use base species, so they
  pass.
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
back to a tag-based definition. Every nonempty cell is valid; cells with 1-2
undrafted candidates expose a free optional reroll for that offer. Draft
balance knobs live in `rollmons/draft_config.py` and may be overridden by
environment variables for playtesting. Starting playtest values are candidate
cap 5, legendary weight 0.10, Arceus-forme weight 0.05, manual skips 2, and
thin-cell threshold `<3`. These are explicitly subject to playtest and are not
final balance constants.
Legendary selection weight must remain strictly positive so thin
legendary-heavy cells cannot soft-lock.

`rollmons/draft.py` implements the six-round headless draft state machine. Each
offer contains a valid cell, up to the configured cap of undrafted candidates
sampled with the configured legendary and Arceus-specific weights, and one
weighted suggested pick. The suggestion is a soft nudge only: the chooser may
select any offered candidate, so legendary Pokemon remain fully draftable. The
offer also exposes the selector's normalized probability for each offered candidate;
consumers must display this engine value rather than recomputing weights.
Species identity is deduplicated globally across both types, the slot-machine
guard excludes cells with no undrafted candidates, and the default draft has
two bounded manual cell skips. Thin-cell rerolls do not consume that skip and
do not bank as extra skip currency.

`rollmons/smogon_sets.py` ingests the Smogon JSON. It first excludes set rows
whose format is Godly Gift, 1v1/1V1, Battle Stadium Singles/BSS, Monotype,
Almost Any Ability/AAA, Mix and Mega, Doubles, or VGC using case-insensitive
alias matching. It strips `Tera Type:` lines, parses the remaining standard
Showdown export text, and applies only the existing
species/move existence pre-flight. Failed sets are reported for manual review
and do not count as usable; they are not silently fixed. Run
`python3 -m rollmons.report_smogon_ingestion` to reproduce exclusion counts,
validation issues, setless species, and pool/matrix deltas.

`rollmons/team_assembly.py` enumerates the **selectable sets** for each drafted
species via `selectable_sets()`: the species' checked-in override sets PLUS the
active source's sets (Smogon when present, otherwise the randbats fallback,
where observed counts remain the selection weights). After the six-round draft
the player chooses one set per species on the loadout screen; `assemble_loadout()`
builds the team from those chosen set IDs. The legacy `assemble_team()` random
path (one set per species, seedable RNG, override-first) remains for the
sandbox/CLI. Do not use the contributor JSON's generation or format priority for
runtime set selection. `ROLLMONS_SET_SOURCE=randbats` switches the source.

Contributor overrides live under `rollmons/sets/` as one file per normalized
species-ID filename, each holding **one or more** standard Showdown export
blocks (blank-line separated); every block becomes a separately selectable set
for that species (e.g. Mega X and Mega Y, or a Mega plus a non-Mega build). A
species with an override file is draftable even when the configured source has
no set for it, so override files are how Mega-capable base species enter the
player pool. `load_set_overrides()` validates each block's species. A block may
carry an optional **label** as its Showdown nickname (`Label (Species) @ Item`);
`selectable_sets()` reads that nickname to name the loadout option (falling back
to `Custom N`/`Mega …`). Override exports are normalized by
`_normalize_override_export()` — it strips the label nickname (keeping any
`(M)`/`(F)` gender marker) and the inert `Tera Type:` line, and guarantees an
explicit `Level: 100` — so authors may omit the level line, and the label never
leaks into the draft card, loadout pokepaste, or the Pokemon's battle nickname.
Both the loadout path and the legacy `assemble_team()` normalize override blocks
before use. The post-draft loadout defaults to a non-Mega set so Mega is an
opt-in choice. There is a gated set editor (`ROLLMONS_ENABLE_SET_EDITOR`, route
`/sets-editor`) for editing these files without touching the export format. Overrides never create custom player teams; all player teams
still originate from a six-round pool draft, set-by-set.

The randbats fallback path intentionally uses `Serious` nature, 85 EVs in each
of the six stats (the legal 510 total cap), and omitted IV lines so Showdown
defaults to 31. This exactly matches foul-play's own randbats parser. Smogon
sets preserve their authored EVs, IVs, nature, item, ability, and moves after
Tera-line stripping. Separately authored boss teams may use optimized spreads.

Authored bosses live as Showdown export text under `rollmons/bosses/`.
`rollmons/boss_loader.py` discovers stable boss IDs from those files and returns the
export string expected by `battle_runner.run_battle()`. `ash.txt` is the first
thematic, intentionally suboptimal boss team; all six members explicitly set
level 100. The boss display name derives from the file stem. The loader reads
only `rollmons/bosses/`; `rollmons/bosses_2/` holds staged future boss teams
(Eevee, LC, Cyrus, Maxie, Archie, Giovanni) that are not loaded until promoted.

`rollmons/pool_loader.py` powers the tiered campaign (pure; no `fp/`). Teams live
under `rollmons/pool/<tier>/*.txt` (tiers `level_1`..`level_5`, `level_6to9`,
`level_10`). `build_campaign()` selects a seedable **ten-battle** run — one
random team per tier, with `level_6to9` contributing four distinct teams
(sampled without replacement), ascending in difficulty (`CAMPAIGN_STRUCTURE`).
`POST /api/drafts/{id}/campaign/start` stores the picked exports on the session
and runs them through the existing gauntlet seam, so the campaign reuses
`run_battle()`, replays, and the damage summary unchanged. The pool `.txt` files
need a `.gitignore` whitelist line like the other data dirs.

`rollmons/submissions.py` wraps the existing foul-play Showdown export parser
for both six-member boss files and single-member set overrides. Its existence
pre-flight reads checked-in species and move JSON directly and applies no
tier, learnset, or obtainability legality. Contributors run
`python3 -m rollmons.validate_submission {boss,set} PATH`; this pure command
does not require Showdown, Rust, poke-engine, or a running battle stack.

`rollmons/web_app.py` is a thin FastAPI transport over the game-layer modules.
It keeps local single-user draft sessions in memory and exposes the complete
18x9 pool inspector plus start/state/pick/skip draft endpoints. When a draft
completes it builds a default loadout (one set per drafted species, preferring a
non-Mega set) and exposes the per-species selectable sets; `POST
/api/drafts/{id}/loadout` records the player's chosen set and re-assembles the
team. The loadout locks once a battle or boss rush starts. The static SPA under
`rollmons/web_static/` (`index.html`/`styles.css`/`app.js`) is a Scarlet/Violet
screen-based flow — title → draft → loadout → gauntlet → battle → results, plus
a Pokedex/pool screen — ported from the `rollmons/open_design/index.html`
reference. It renders engine state only (BST, suggestion probability, selectable
sets and the chosen set, assembly level); the post-draft loadout screen
(`#screen-loadout` / `#loadout-list`) is where the player picks each Pokemon's
set, and the Showdown replay embed (`replayDoc` + iframe) is left unchanged. It
does not implement matrix filtering, dedupe, cell guards, weighted suggestions,
probability calculation, set selection logic, or team assembly in JavaScript.

The module does not import `battle_runner` or poke-engine while serving pure
matrix/draft routes. The live runner/config imports occur only when the battle
endpoint is invoked. `make harness` bootstraps `.venv/pure` from
`requirements-pure.txt`, so a fresh clone can run the inspector and draft
without Rust, poke-engine, Node, or Showdown.

After a six-round draft completes, the harness exposes one live integration
action. It loads the Ash boss, performs an existence-only species/move check
against foul-play's checked-in Gen 9 data, calls `battle_runner.run_battle()`,
and returns winner, turns, battle ID, and replay protocol. The browser embeds
`"\n".join(replay_log)` in the hosted Showdown replay player. This path requires
the self-hosted server, `logchallenges = true`, a readable
`ROLLMONS_SHOWDOWN_LOG_DIR`, and the gen9-no-Tera engine. Matrix inspection and
drafting remain usable without any live battle stack.

Live battles request the clean Showdown usernames `Player` (configurable with
`ROLLMONS_PLAYER_NAME`) and the boss file's display name, so both structured
results and replay protocol use friendly names. If a stale sequential
connection still owns a name, the runner retries with a short internal suffix
and normalizes that fallback back to the display name in returned replay text.

`python3 -m rollmons.sandbox --boss PATH --runs N` is the live boss-testing
path. It discovers the selected boss through the boss loader, creates a fresh
six-round pool draft for every run, uses normal team assembly and the shared
existence pre-flight, then calls `battle_runner.run_battle()`. It reports a
boss win/loss/tie tally and writes each hosted-player replay page to a
temporary, untracked directory. `N=1` and the default `N=10` are both
supported. This sandbox requires the live stack; the matrix inspector and
draft harness remain pure.

`make stack RUNS=N BOSS=id` is the containerized sandbox path. Compose builds a
pinned `pokemon-showdown@0.11.10` service with challenge logging and a shared
log volume, plus a Rollmons image. The Rollmons Dockerfile compiles
`poke-engine==0.0.46` with
`--features poke-engine/gen9 --no-default-features` in a
`rust:1.89-slim-bookworm` stage and copies only the wheel into a Python 3.11
slim runtime. The final image contains neither Rust nor Cargo. Replay HTML is
bind-mounted to ignored `.sandbox-replays/`; no sprites or audio are included.
The Make target tears down containers and the network after the sandbox exits.

Run the development harness with:

```bash
make harness
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

**Operational landmine (cost a long debugging session):** `requirements.txt`
pins poke-engine with `--features poke-engine/terastallization` (**Tera ON**),
so `make install` / a plain `pip install -r` produces a Tera-ENABLED engine.
You must apply `make poke_engine GEN=gen9` afterward to get the no-Tera build,
and **re-running `make install` silently reverts it**. Symptom of a Tera engine:
battles "hang" / "player never moves" — the AI keeps choosing `... terastallize`
and Showdown rejects every move (`|error|... can't Terastallize`). The desktop
build (`packaging/build_macos.sh`) force-rebuilds the no-Tera engine on every
build for this reason (skip with `ROLLMONS_SKIP_ENGINE_REBUILD=1`).

The Docker equivalent is:

```bash
make docker
```

Rust and Cargo are required for a local engine build. The Dockerfile is fixed
to gen9-no-tera and keeps Rust only in its build stage.

### Worker processes

There are two nested process layers. `run_battle()` spawns one disposable
foul-play client process per role (player and boss). Inside each client, every
move search creates a transient `ProcessPoolExecutor` of MCTS workers; the pool
is created and torn down per decision, not persisted for the battle.

`battle_runner.py` preserves that inner process-pool concurrency and installs a
worker initializer that reapplies the `poke-engine==0.0.46` compatibility patch
only in those MCTS workers. Do not replace foul-play's process pool with
threads **in the normal (unfrozen) path**.

**Exception — the PyInstaller desktop app:** there, each foul-play client is
itself a spawned (`multiprocessing` "spawn") frozen-binary worker, and spawning
the inner `ProcessPoolExecutor` from it nests multiprocessing and deadlocks
(0% CPU, no moves). So `battle_runner._install_worker_executor` swaps the search
pool to a `ThreadPoolExecutor` **only when `sys.frozen`** — poke-engine is Rust
and releases the GIL, so threads parallelize the search without more processes.
The entry point also calls `multiprocessing.freeze_support()` (else spawned
workers re-launch the whole app). Both are desktop-only; `make live` is
unchanged.

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
make docker
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

The pure legality matrix is implemented in `rollmons/legality_matrix.py`.
With the current Smogon primary source plus the checked-in Mega-Stone override
files, 437 atoms (424 source + 13 override-only) produce 155 nonempty
type-generation cells (118 normal and 37 thin), with seven empty cells
excluded. (Without override files the source pool is 424 atoms / 155 cells /
113 normal / 42 thin; the randbats alternate is 508 atoms / 158 cells.) The
six-round draft and level-100 team assembly are implemented in
`rollmons/draft.py` and `rollmons/team_assembly.py`. Player-pool Mega Evolution
is built: 36 Mega-Stone sets ship under `rollmons/sets/`, making those base
species draftable and Mega-capable; the post-draft loadout lets the player pick
one set per Pokemon (Mega opt-in), and foul-play mega-evolves the chosen set in
battle (verified live). The first authored boss and one real post-draft battle
path are built, including structured results, a per-Pokemon damage summary, and
a hosted replay embed. Contributor boss/set validation and the N-battle
pool-draft sandbox are built. The browser can run the discovered boss list as a
sequential post-draft boss rush: it validates every selected boss up front, runs
one battle at a time through `battle_runner.run_battle()`, renders each replay
immediately, then starts the next battle. Fixed ten-battle campaign tuning and
additional authored boss teams remain ongoing work. The battle runner is
intermittently flaky in standalone runs (timeouts / Showdown inactivity losses);
the web-UI boss rush is the reliable path.

## Roadmap

1. Tune the sequential browser boss rush into the intended fixed ten-battle
   campaign ordering and aggregate results. Do not duplicate the existing
   battle-runner seam.
2. Extend the boss-rush results UI for campaign-level summaries. The hosted
   replay viewer is still temporary.
3. Author boss teams and tune difficulty after playtesting.
