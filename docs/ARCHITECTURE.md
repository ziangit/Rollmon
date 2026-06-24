# rollmons — architecture (living doc)

> Update this whenever a non-obvious decision or constraint is discovered.
> `AGENTS.md` is the authoritative, more detailed reference — this is the fast map.

## Stack
- **Python game layer** under `rollmons/` (pure; no `fp/` imports). FastAPI transport in `rollmons/web_app.py`; static SPA in `rollmons/web_static/`.
- **Vendored foul-play** (`fp/`) — the AI client; Python over a websocket, backed by the Rust **poke-engine** (`poke-engine==0.0.46`, built gen9 no-Tera).
- **Pokémon Showdown** — self-hosted Node server, the referee and source of battle truth (run with `--no-security`, `logchallenges = true`).
- `battle_runner.py` is the single boundary between our code and foul-play/poke-engine.
- Data: `data/pokedex.json` (types, base stats, dex numbers, formes, requiredItem), `rollmons/data/smogon_sets.json` (default source), `rollmons/data/gen9randombattle.json` (508-atom alternate/fallback).

## Module map
- `rollmons/legality_matrix.py` — builds the type×gen draft matrix and weighted selection. Atoms = configured-source species **∪ species with a checked-in set override**. `_validate_no_battle_only_mechanics` rejects mega/gmax *forme* atoms (overrides use base species, so they're fine).
- `rollmons/draft.py` — six-round draft state machine; uniform cell choice, weighted candidate sampling only when a cell has > `candidate_cap` (5).
- `rollmons/team_assembly.py` — `selectable_sets()` enumerates a species' choices (override blocks + Smogon or randbats fallback); `assemble_loadout()` builds the team from chosen set IDs. Override exports normalized via `_normalize_override_export` (strip Tera, force `Level: 100`). `assemble_team()` is the legacy random path (sandbox/CLI).
- `rollmons/smogon_sets.py` — ingests Smogon JSON, excludes OM/doubles/VGC/etc. formats, strips `Tera Type:` lines.
- `rollmons/boss_loader.py` / `rollmons/submissions.py` — boss/set discovery + existence-only validation (`python -m rollmons.validate_submission`). Reads **only `rollmons/bosses/`**. `rollmons/bosses_2/` is a staged batch of future bosses (Eevee, LC, Cyrus, Maxie, Archie, Giovanni) that is **not loaded** until moved/wired in.
- `rollmons/pool_loader.py` — pure. Discovers tiered teams from `rollmons/pool/<tier>/*.txt` and `build_campaign()` selects a seedable **10-battle** run (one random team per tier; `level_6to9` contributes 4, sampled without replacement; ascending). Structure in `CAMPAIGN_STRUCTURE`.
- `rollmons/web_app.py` — pure matrix/draft/loadout routes; live `battle_runner` import only on the battle endpoints. Loadout: `POST /api/drafts/{id}/loadout`. Campaign: `POST /api/drafts/{id}/campaign/start` builds a campaign, stores the picked exports on the session (`campaign_teams`), and runs them through the **same** gauntlet seam via campaign-aware `resolve_boss_team`/`resolve_boss_name` (no new battle plumbing).
- **Frontend** (`rollmons/web_static/`) — a Scarlet/Violet screen-based SPA: title → draft → loadout → gauntlet → battle → results, + Pokédex/pool. Ported from the `rollmons/open_design/index.html` reference into `index.html`/`styles.css`/`app.js`. The Gauntlet screen offers "Start campaign" (tiered) and a manual ladder; Results is a dashboard built from `gauntlet.damage` (climb pips, per-Pokémon contribution bars, MVP spotlight). The Showdown replay embed (`replayDoc` + iframe) is intentionally untouched. Bump the `?v=` cache string on edits.
- **Dev server port: 8973** (`make live`; `index.html` is *not* cache-busted, so hard-refresh after asset edits). Showdown runs on `:8000`.

## Known constraints & gotchas
- **poke-engine pin is load-bearing.** Keep `==0.0.46`; build `--features poke-engine/gen9 --no-default-features`. Tera must be compiled out (foul-play doesn't pass Showdown's `canTerastallize`, so a Tera engine can return illegal `-tera`). `run_poke_engine_compat.py` / `battle_runner.py` patch out the missing `threads` MCTS kwarg, including in spawned MCTS workers.
- **Two nested process layers:** `run_battle()` spawns one foul-play client per role; each move search spawns a transient MCTS `ProcessPoolExecutor`. Keep that process pool (don't swap to threads). On macOS, scripts that call `run_battle` must guard under `if __name__ == "__main__":` (spawn re-imports `__main__`).
- **Local auth & protocol normalization** live in `battle_runner.py`: empty-token `/trn` login for `--no-security`; both `|updatechallenges|` JSON and PM challenge forms; buffering request-only frames that arrive before the public battle update. Keep these in the wrapper, not in `fp/`.
- **Battle-runner is flaky standalone:** intermittent timeouts / Showdown inactivity losses. The web-UI boss rush is the reliable path. Some teams (e.g. Smeargle / odd movesets) can crash the gen9-no-Tera search → player never moves.
- **Mega in player teams:** the custom format runs with `+Past`, enabling Mega Stones. foul-play reads `canMegaEvo` and issues `move X mega`; it skips gen-9 Legends-ZA megas. Drafted base species + a Mega-Stone set ⇒ it mega-evolves in battle. Only **one** Mega evolves per team per battle.
- **Replay rendering:** the hosted Showdown player (play.pokemonshowdown.com, dev-only) must initialize against a visible, laid-out container or it renders blank.
- **[KNOWN BUG — open] Redesigned Battle theater replay.** In the new SPA (`renderTheater`/`renderRun`), the first battle's replay can render blank-grey and the "Waiting for the first battle…" placeholder is not cleared when the first result arrives. `renderRun` only clears `#theater` when `results.length===0`, so real cards get appended onto the stale placeholder. To fix next session.
- **A hung battle can wedge the web app.** Boss-rush battles run through the single uvicorn worker; a stuck/flaky battle can kill that worker (leaving a zombie) and make `:8080` unresponsive. Recover by restarting `make live`. Harden by running battles in a supervised subprocess with a hard timeout.
- **Sprites/item icons hotlinked**; text/types/sets stay functional when images fail. Bump `?v=` in `index.html` after editing SPA assets.

## Key decisions
- "Legendary" is `BST > 600` (competitive-power, not lore), excluding Slaking/Regigigas (ability-suppressed). Legendary draft weight stays strictly positive to avoid soft-locking thin legendary-heavy cells.
- Set overrides **add** options (not replace the source); a `rollmons/sets/<species>.txt` file can hold multiple export blocks. Override presence also makes the base species draftable.
- Draft uses current/modern typing + generation of debut (gen number is cosmetic; one battle generation for all battles). Custom format: Species Clause on, tiers off, Tera/Dynamax/Z-Moves off, level 100.
- Player set selection is **engine-driven and user-chosen** (loadout), defaulting to non-Mega; it is not random and not computed in JS.
