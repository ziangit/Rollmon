# rollmons

A single-player Pokémon draft/autobattler built on a vendored [foul-play](https://github.com/pmariglia/foul-play) AI + [poke-engine](https://github.com/pmariglia/poke-engine), with a self-hosted Pokémon Showdown server as the battle referee. The player drafts six Pokémon through a slot machine, chooses a set per Pokémon, then runs an AI-piloted boss gauntlet.

@docs/PRODUCT.md
@session-handoff.md

## Conventions
- Pure game logic lives under `rollmons/` and **must not import `fp/`**. The pure draft/matrix/loadout routes run without Rust, poke-engine, Node, or Showdown.
- All foul-play / poke-engine usage goes through the single `battle_runner.py` boundary. Prefer wrappers and monkeypatches over editing vendored `fp/` internals.
- Match surrounding code style. Run `make test` (ruff + pytest) before considering work done; keep the suite green.
- Static SPA (`rollmons/web_static/`) renders engine state only — no matrix/draft/assembly logic in JS. Bump the `?v=` cache string in `index.html` when editing `app.js`/`styles.css`.
- Do only the requested scope; flag scope growth instead of silently building adjacent features.

## Hard constraints (never violate)
- Keep `poke-engine==0.0.46` pinned and build **gen9 with `--no-default-features`** (Tera compiled out — a Tera-enabled engine can return illegal `-tera` choices).
- Push project work only to the `origin` remote. The `upstream` foul-play remote is fetch-only — never push to it.
- Never commit credentials, logs, caches, Node deps, audit clones, or vendored sprite/audio assets. Sprites/item icons are **hotlinked** from play.pokemonshowdown.com for dev only — do not vendor.
- Don't upgrade a dependency just to make an error go away without checking the installed artifact's API.

## Where to look
- Deep technical reference, integration landmines, locked decisions: `AGENTS.md`
- Architecture summary & hard-won gotchas: `docs/ARCHITECTURE.md` (read on demand)
