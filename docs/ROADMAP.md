# Roadmap after milestone 5

Written 2026-10-18 from the author's plan and a code/data audit. The author's tick-off view of the same items is the "Rollmons progress tracker" Claude Doc (link in `session-handoff.md`); keep both in step. Priorities,
findings, and the designs for the items that are decided. Items marked
**discuss** are not to be built until the author has chosen.

| # | Item | Priority | Status |
|---|---|---|---|
| 1 | Pool and draft redesign (rarity, legendaries, thin cells) | P0 | built 2026-10-21, playtesting; design and knobs in §1 |
| 2 | CPU hint on the battle screen, low-power toggle | P0 | done |
| 3 | Opponent band playability review | P1 | after §1 |
| 4 | Watch the battle live | P1 | done |
| 5 | Favicon | P1 | done |
| 6 | Draft pool coverage audit, Smogon set scrape | done | §6; 652 draftable species since 2026-10-21 (was 437) |
| 7 | Leaderboard | P1 | done (Neon connected 2026-10-18, accounts 2026-10-19); follow-ups in §7 |
| 8 | UI rework | P2 | after §1 and §9 |
| 9 | i18n (zh / en / ja) | P2 | easy part done (UI strings, species names); CJK font and reel labels open, §9 |
| 10 | Weather-core game modes | P3 | parked, §10 |

## 1. Pool and draft redesign (decided 2026-10-21, built the same day)

The author and the assistant discussed the two complaints (a legendary was
guaranteed in some cells; thin cells hurt even with a free reroll) and chose
the design below. The pre-decision write-up with the alternatives (cell
weighting, eras instead of generations, a scheduled legendary round, level
handicaps à la random battles) is in the chat history of 2026-10-21; the
simulation scripts are not in the repo.

### What was wrong

Three separate causes, only one of which the set scrape (§6) could touch:

- The cell roll was uniform over the 159 cells, so a one-species cell
  (Togekiss in fairy/gen4) came up as often as a 15-species one: 45% of runs
  met a thin cell.
- The legendary down-weight (0.10) only decided which five of a bigger cell
  were shown. In the 67 cells with five or fewer species everything was
  shown, so the weight was a no-op in 42% of rounds and eight cells put a
  legendary in the offer every time.
- The grid itself has structural holes: Fairy was added in gen 6, gens 1
  and 2 have one Dragon line each, gen 6 has one Bug line. No data fixes
  those 15 thin cells.

### The design (`web/game/draft.ts`, `draft-config.ts`, `legality-matrix.ts`)

- **Rarity per species** = its Showdown tier rank, lifted to legendary when
  its base stat total is over 600. Tier: Uber/AG legendary, OU/UUBL rare,
  UU/RUBL/RU/NUBL uncommon, everything else common. Slaking and Regigigas
  rank by tier only (Truant / Slow Start). Arceus formes are separate
  species. Buckets over the 652 draftable species: common 373, uncommon
  133, rare 69, legendary 77. The single stat rule is there so that a player
  who knows only one scale is not surprised: Hoopa-Unbound (680, UUBL),
  Zamazenta and Kyurem (660, OU) read as legendary by stats; Flutter Mane,
  Volcarona and Palafin by tier. A first build also lifted 570+ BST to rare
  and 500+ to uncommon; that promoted 165 tier-weak stat balls (Carbink,
  Shuckle, Regirock) and was dropped on 2026-10-21, so Articuno and the
  Regis are common like their tiers. The 30 tier-only legendaries with
  ordinary stats are shown as four stars plus their tier; the author may
  relabel them later.
- **Names on the page.** The four ranks are shown as Poké Ball / Great Ball
  / Ultra Ball / Master Ball with one to four stars and the Showdown tier
  (chosen 2026-10-21 over common/uncommon/rare/legendary, whose "legendary"
  collides with the lore sense, and over N/R/SR/SSR). The code keeps the
  internal names `common`, `uncommon`, `rare`, `legendary`.
- **Visitors.** A rolled cell keeps all its natives and is filled from the
  nearest generations of the same type (distance 1, then 2, …) until it has
  at least `backfillMin` = 6 candidates and `backfillMinNonLegendary` = 5
  non-legendary ones. Visitors are tagged in the offer ("Visitor · Gen 3").
  67 of 159 cells need visitors; about a third of offers show one or two.
- **Slot roll.** Each of the five offer slots rolls a rarity from
  `rarityOdds` = 50 / 28 / 12 / 10 (common / uncommon / rare / legendary),
  **falls down** to the next lower rarity the pool still has when the rolled
  one is absent (never up), then draws a species uniformly within that
  rarity, without replacement. Falling down rather than renormalising, and
  the non-legendary floor, are what stop a legendary-heavy cell (dragon/gen4
  has five among six natives) from forcing one into the offer.
- **Thin reroll stays**, judged on natives (fewer than 3), so the player can
  still take Dragonite from the gen 1 Dragon cell or spin again for free.
- **No pity counter** (author's choice: simpler to explain; the score
  handicap in §7 already punishes a legendary-heavy team on the board).
- The cell roll stays uniform and the 18×9 grid keeps its identity.

Expected numbers from a 30,000-run simulation of the final rules (player
takes every legendary offered): a legendary in the offer in 21% of rounds,
in at least one round of 76% of runs, 1.3 legendaries per team; the most
legendary-prone cell offers one 43% of the time, and no cell is above 50%.
`node scripts/coverage.ts` prints the buckets, the short cells, and the 15
legendary-heavy cells whose visitors keep the offer open.

Knobs to playtest (`DEFAULT_DRAFT_CONFIG`): `rarityOdds`, `backfillMin`,
`backfillMinNonLegendary`, `thinCellThreshold`. The Python reference
(`rollmons/draft.py`) still implements the pre-§1 weighting and is no longer
the oracle for the draft; its tests cover the Python code only.

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

Playtest feedback (2026-10-18), done: battles are watched one at a time (the
next one starts only after the previous replay has reached its end), the
rail hides the names of campaign bosses not yet reached and shows a result
only once that battle has been watched, the summary unlocks (in-page button
plus a fixed top-right button) only after the final battle has been watched
instead of auto-navigating, and the battle music is muted in the player.

## 5. Favicon

Original pixel art, not a Pokémon sprite (asset rule and trademark). A 16×16
grid drawn as inline SVG `<rect>`s in `index.html`: a Poké-Ball-shaped
slot-reel window. No asset file.

## 6. Draft pool coverage (done; sets scraped 2026-10-21)

A species is draftable when it has a usable Smogon set or a checked-in
override (`rollmons/sets/`). The first Smogon dump (472 species) had been
scraped from the SV pages only, so 214 fully evolved species were missing:
165 absent from Scarlet/Violet with nothing scraped at all (Togekiss,
Nidoking, the Tapus, the Ultra Beasts, …), 36 whose only scraped sets were
side formats the ingester rightly drops (1v1, Godly Gift, BSS: Volcarona,
Roaring Moon, Flutter Mane, Mewtwo, …), and 13 never scraped.

`web/scripts/smogon-scrape.ts` fills the gaps from Smogon's dex: for each
species it walks SV, SS, SM, XY, BW, DP, RS and keeps up to four sets from the
first generation that has a standard singles tier (OU, Ubers, UU, RU, NU, PU,
ZU, AG and their National Dex versions), never a side format. Z-Crystal sets
are skipped and Hidden Power is dropped (the gen 9 data has no typed Hidden
Power and the battle driver cannot map a plain one). `node scripts/
check-names.ts` now also runs the usable Smogon sets past the engine. Result:
645 species with sets, 652 draftable species; `node scripts/coverage.ts`
lists what is left:

- 12 Scarlet/Violet species with no analysis in any generation (Wyrdeer,
  Tauros-Paldea-Combat, Oinkologne, Dachsbun, Rabsca, Meowstic, Klawf,
  Wugtrio, Squawkabilly, Spidops, Raticate-Alola, Pikachu-Alola) plus Unown,
  whose only set is Hidden Power. `rollmons/data/gen9randombattle.json` has
  sets for most of them; a randbats fallback for species without a Smogon
  set would cover them.
- Five older entries still carry a plain Hidden Power (Luvdisc, Meowstic-F,
  Minun, Plusle, Zebstrika); that move is a fallback decision in battle.
- Which groups belong in the pool is still a §1 decision; §1's numbers are
  the post-scrape ones.

## 7. Leaderboard

### Architecture (built 2026-10-18; `docs/ARCHITECTURE.md` has the code map)
- **Storage: Neon Postgres** behind one Vercel function (`web/api/`). No Redis:
  the scale is tiny and the hard problem is trust, not read throughput; a
  table with an index on `score` serves top-N and keeps the run proof. Same
  origin only (the GitHub Pages mirror was dropped on 2026-10-19 because the
  session cookie cannot cross origins).
- **Setup:** `DATABASE_URL` from the Neon integration and `SESSION_SECRET`
  (README, "Leaderboard setup"). Without the first the API answers 503 and
  the page hides the board; without the second accounts are off.
- **Trust.** Battles run on the player's machine, so a score is just a number
  unless the server can check it. The client submits, per battle, the sim seed
  and the full choice sequence of both sides (`runner.ts` already seeds the
  sim deterministically). The server replays each battle with `@pkmn/sim`
  only, no search (~30 ms per battle), confirms the winner and turn count, and
  recomputes the score itself. Forged scores are rejected. **Not built yet:**
  a daily seed to blunt seed-fishing (restart until a good draft appears); the
  handicap is the only counterweight today. Also open: throttling failed
  logins (brute force), and a name filter beyond the reserved list.
- **Identity (built 2026-10-19).** Showdown-style accounts: a name (1–18
  characters; identity is the lowercased letters-and-digits form, so "Red"
  and "R.e.d" are the same account, and CJK names work) and a password
  (8–128 characters, scrypt-hashed), no email and therefore no reset. The
  session is a signed HttpOnly cookie (30 days). Anyone can play and read
  the board; posting needs a session, and the name on the board is the
  account's. At most 5 accounts per network per rolling day (keyed hash of
  the address). The board lists each player's best run; every run is kept.
- **Placement (2026-10-19).** The board, the language select, and the account
  chip sit in a tools strip: a fixed top-right corner on the title screen,
  the right end of the topbar elsewhere. The board opens as a drawer, so the
  title screen keeps only the logo and the Start panel.

### Score (built; numbers are playtest knobs in `web/game/score.ts`)
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

Easy part, done (2026-10-18): `web/app/i18n.ts` holds the UI strings for
zh-CN and ja keyed by the English text (`t(key, vars)`), static markup is
tagged `data-i18n` and retranslated by `applyStatic`, and a language select
sits in the topbar and on the title panel. The choice is remembered in
`localStorage` (`rollmons-lang`), the default follows `navigator.language`,
and `?lang=zh|ja|en` overrides it for checks. Species names come from
`data/species-names.json` (PokeAPI's `pokemon_species_names.csv`, generated by
`web/scripts/species-names.ts`, keyed by National Dex number; formes keep an
English suffix, e.g. 雷丘-Alola). A test asserts both tables cover the same
keys with the same placeholders.

Not translated, by design or for later: the replay player and battle protocol
(English only upstream), set exports (PokéPaste is an interchange format),
move/item/ability names, boss names (author's data), the slot roller's reel
labels (`roller.js`, carried over from v1), and `SessionError` messages from
the game layer. The pixel display font has no CJK glyphs, so headings in zh/ja
fall back to the system font; the UI rework (§8) should pick a CJK pixel face.

## 10. Weather-core modes (parked)

"Start with a Rain core / Sand core / Sun core": the player begins with a fixed
two-Pokémon core (e.g. Pelipper + a Swift Swim user) and drafts the remaining
four. Fun modes, not ranked, or a separate board. Needs: a `GameSession` option
for pre-filled slots, draft rounds reduced to four, core files under
`rollmons/cores/`, and a mode picker on the title screen. Not started.
