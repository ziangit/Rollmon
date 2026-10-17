# rollmons — product

## What it is
A single-player Pokémon roguelite/autobattler. The player drafts six Pokémon through a slot machine, builds each one's set, then runs a fixed gauntlet of AI-piloted battles against pre-authored boss teams. Both sides are AI-piloted — the player does not choose moves during battle. rollmons owns the draft, team assembly, bosses, loadout, results, and frontend; it treats poke-engine (search) and the Showdown simulator (referee) as the battle engine, both running in the player's browser.

## How a run works
1. **Draft** — six rounds. Each round locks a random `(current type, generation of debut)` cell; the player picks one of the offered candidates (legendaries down-weighted, not banned; thin 1–2-candidate cells grant a free reroll; two manual skips).
2. **Loadout** — for each drafted Pokémon, choose one set from its options (override/custom sets + Smogon sets, randbats as fallback). Mega is an opt-in set choice.
3. **Boss rush** — battle the gauntlet one battle at a time; replays animate and a campaign damage summary (MVP, per-Pokémon contribution) is shown.

## Features
- Engine-backed 18×9 type-by-debut-generation legality matrix and pool inspector.
- Six-round weighted draft with dedupe, thin-cell rerolls, and manual skips.
- Per-Pokémon multi-set loadout selection (post-draft), with Mega Evolution as an opt-in set.
- Contributor data: boss teams (`rollmons/bosses/*.txt`) and per-species set overrides (`rollmons/sets/*.txt`, one or more export blocks each) in standard Showdown export format, validated existence-only without the live stack.
- Battles run in the browser (poke-engine via WebAssembly + `@pkmn/sim`), so the game hosts as a static site.
- Hosted-replay embedding for finished battles (dev-only dependency).

## Non-goals (explicitly out of scope for now)
- Reimplementing the battle engine, or letting the player choose moves mid-battle.
- Player-authored full custom teams — every team still comes from a six-round draft.
- Terastallization, Dynamax, Z-Moves (engine is gen9 with Tera compiled out; Mega is allowed via the custom format).
- Tier/learnset/obtainability legality validation beyond species + move existence.
- Self-hosting Showdown client assets / sprites / audio (hotlinked for dev; distribution decision deferred).
- Final balance constants — draft weights, caps, and difficulty are playtest knobs, not settled.
