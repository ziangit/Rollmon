# Roadmap after milestone 5

Written 2026-10-18 from the author's plan and a code/data audit. Priorities,
findings, and the designs for the items that are decided. Items marked
**discuss** are not to be built until the author has chosen.

| # | Item | Priority | Status |
|---|---|---|---|
| 1 | Pool and draft redesign (rarity, legendaries, thin cells) | P0 | **discuss**, see §1 |
| 2 | CPU hint on the battle screen, low-power toggle | P0 | building |
| 3 | Opponent band playability review | P1 | after §1 |
| 4 | Watch the battle live | P1 | building |
| 5 | Favicon | P1 | building |
| 6 | Draft pool coverage audit | done | §6, `web/scripts/coverage.ts` |
| 7 | Leaderboard | P1 design, P2 build | design in §7 |
| 8 | UI rework | P2 | after §1 and §9 |
| 9 | i18n (zh / en / ja) | P2 | UI strings and species names first, §9 |
| 10 | Weather-core game modes | P3 | parked, §10 |

## 1. Pool and draft redesign (discuss)

Facts from the current data (`web/scripts/coverage.ts`):

| Fact | Count |
|---|---|
| Draftable species (atoms) | 437 |
| Cells in the 18×9 matrix | 155 |
| Cells with ≤5 species | 107 |
| Legendary species (BST > 600, `LEGENDARY_BST_EXCLUSIONS` aside) | 45 |
| Cells where a legendary is guaranteed in the offer | 17 |

How the legendary weight actually works: `legendaryWeight` (0.10) is used in
`offerCandidates` only when a cell has more than `candidateCap` (5) species, to
pick which five are shown. In a cell with five or fewer species everything is
shown, and the player picks freely. So the weight never applies in 107 of 155
cells, and in 17 cells (Ho-Oh, Groudon, Zacian-Crowned, Calyrex-Ice,
Necrozma-Dusk-Mane, Lunala, Kyurem, Hoopa-Unbound, five Arceus formes, …) a
legendary is on offer every time. The weight also drives the "suggested" pick
and the displayed probabilities, which is cosmetic.

Options on the table:
- **Rarity tiers** per species (common / uncommon / rare / legendary) with
  per-tier odds applied before the cell is chosen, gacha-style, instead of a
  single BST flag applied after.
- **Always offer five.** Backfill thin cells from adjacent generations or the
  second type so weighting always bites and thin-cell rerolls become rare.
- **Hard cap**, e.g. at most one legendary per run, shown as a rule.
- **Score handicap** (§7): legendaries stay draftable but a six-legendary team
  cannot top the leaderboard.

Recommendation to open the discussion: rarity tiers + always-five offers +
score handicap, no hard cap. Not built.

## 2. CPU hint and low-power mode

The battle runs on the player's device (`docs/BATTLE_AI.md`). The battle screen
gets a one-line notice and a "low power" switch that halves both search budgets
(`DEFAULT_BUDGET_MS`); the choice is remembered in `localStorage`. The dev knobs
`?p1ms=&p2ms=` keep working and override the switch.

## 3. Opponent bands (after §1)

Rosters: level_1 3 teams, level_2 3, Red fixed, middle 6 (draws 3), advanced 9
(draws 3), Air fixed. `docs/DIFFICULTY.md` states target win rates per band;
nothing has measured them. Plan: a harness that drafts N seeded teams with the
default loadout and plays each band, printing a win-rate table per band, then
author teams against the numbers. Depends on §1 because the draft decides what
teams the bands face.

## 4. Live battle view

The worker already posts one event per decision. The hosted replay player
accepts protocol lines incrementally (`battle.add(line)` + `battle.play()`), so:
the worker sends the sim's new log lines after each turn, the page forwards
them into the replay iframe, and the player animates as they arrive. Search
(≈4 s of compute per battle) is far ahead of the animation, so the viewer never
waits on the engine. The theater card for the current battle is created when
the battle starts rather than when it ends. Risk: one more dependency on the
hosted client's internal API, already listed in the handoff.

## 5. Favicon

Original pixel art, not a Pokémon sprite (asset rule and trademark). A 16×16
grid drawn as inline SVG `<rect>`s in `index.html`: a Poké-Ball-shaped
slot-reel window. No asset file.

## 6. Draft pool coverage (done)

Of ~692 fully evolved, non-battle-only species in `data/pokedex.json`, 260 are
not draftable (`node scripts/coverage.ts` in `web/`):

- **155 weak species (BST ≤ 500) with no usable Smogon set**: Raticate, Arbok,
  Butterfree, Ledian, … Fine to omit, or to add as cheap picks once §7 rewards
  them (randbats has sets for most).
- **86 mid species (501–600)** absent from Scarlet/Violet, so no gen9 Smogon
  set: Nidoking, Alakazam, Machamp, Starmie, Crobat, Baxcalibur(!),
  Archaludon(!). The format allows them (`+Past`); adding them needs sets from
  earlier gens or randbats.
- **19 box legendaries (> 600)**: Mewtwo, Lugia, Rayquaza, Dialga, Palkia,
  Giratina, Reshiram, Zekrom, Xerneas, Yveltal, Solgaleo, Zacian, … absent while
  Arceus formes and Calyrex-Ice are present. The legendary set is arbitrary.

Which groups to add is a §1 decision.

## 7. Leaderboard

### Architecture (decided)
- **Storage: Postgres** (Neon or Supabase free tier) behind a Vercel serverless
  function at `api/`. No Redis: the scale is tiny and the hard problem is trust,
  not read throughput; a table with an index on `score` serves top-N and keeps
  the run proof. The GitHub Pages mirror calls the same API cross-origin.
- **Trust.** Battles run on the player's machine, so a score is just a number
  unless the server can check it. The client submits, per battle, the sim seed
  and the full choice sequence of both sides (`runner.ts` already seeds the
  sim deterministically). The server replays each battle with `@pkmn/sim`
  only, no search (~30 ms per battle), confirms the winner and turn count, and
  recomputes the score itself. Forged scores are rejected. Seed-fishing (reroll
  the draft until a good team appears) is mitigated by a **daily seed**:
  the board ranks runs played on the day's seed; free-seed runs are shown
  separately or not at all.
- **Identity.** A chosen display name plus a random client token; no accounts.

### Score (decided, numbers are playtest knobs)
```
score = Σ over won battles of  bandPoints × speedBonus  ×  teamHandicap
bandPoints : Cakewalk 1, Meme 2, Red 3, Middle 5 each, Advanced 8 each, Air 15   (max 60)
speedBonus : 1 + 0.25 × clamp((30 − turns) / 30, 0, 1)        (light; turns are the AI's doing)
teamHandicap: mean over the six of costFactor(species)
costFactor by Showdown tier: Uber/AG 0.5, OU 0.8, UU 1.0, RU 1.15, NU 1.3, PU/ZU 1.5
tiebreak   : Pokémon left standing in the last battle, then total HP remaining
```
A loss ends the run, so only wins count. The tier comes from the Showdown
simulator's own data (`Dex.species.get(id).tier`); species absent from gen9
use the latest generation where they had a tier (Nidoking UU in gen8, Raticate
ZU in gen7). No manual labelling. BST is the fallback for anything untiered.

## 8. UI rework (after §1 and §9)

One pass with the new draft flow and i18n keys known, so it is done once.

## 9. i18n

What Showdown offers: the server repo has `translations/zh-cn`, `zh-tw`, `ja`
(and more) but they cover chat commands and help tickets only. The client repo
has only an English template; the battle protocol and replay player are
English. So the replay stays English (the player looks sprites and animations
up by English name).

Easy part, building: our own UI strings (zh-CN, en, ja) with a language
switch remembered in `localStorage`, and species names in the draft and
loadout screens from a checked-in names table. Move/item/ability names and
the replay are out of scope for now.

## 10. Weather-core modes (parked)

"Start with a Rain core / Sand core / Sun core": the player begins with a fixed
two-Pokémon core (e.g. Pelipper + a Swift Swim user) and drafts the remaining
four. Fun modes, not ranked, or a separate board. Needs: a `GameSession` option
for pre-filled slots, draft rounds reduced to four, core files under
`rollmons/cores/`, and a mode picker on the title screen. Not started.
