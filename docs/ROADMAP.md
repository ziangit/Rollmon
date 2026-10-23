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
| 6 | Draft pool coverage audit, Smogon set scrape | done | §6; 649 draftable species since 2026-10-22 (652 on 2026-10-21, was 437) |
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

- **Rarity per species** = its Showdown tier rank: Uber/AG legendary,
  OU/UUBL rare, UU/RUBL/RU/NUBL uncommon, everything else common. Base
  stats decide only for a species with no tier at all (over 600 legendary,
  else common; Slaking and Regigigas never lifted). A species whose
  override file holds a Mega set ranks by the Mega forme's tier when that
  is higher (2026-10-22: Charizard is ZU but Mega Charizard OU, Salamence
  RUBL but Mega Salamence Uber; 30 of the 42 Mega species move up,
  `effectiveTier`). Arceus formes are separate species; the Gourgeist sizes
  are one species (Super; `DROPPED_FORMES`, 2026-10-22). Buckets over the
  649 draftable species: common 349, uncommon 135, rare 86, legendary 79
  (373/133/72/74 before the Mega rule). History (all 2026-10-21): a first
  build also lifted 570+ BST to rare and 500+ to uncommon, which promoted
  165 tier-weak stat balls (Carbink, Shuckle, Regirock) and was dropped so
  Articuno and the Regis are common like their tiers; a 600+ BST lift to
  legendary stayed for the day, but its only effect was to make
  Hoopa-Unbound (680, UUBL), Zamazenta and Kyurem (660, OU) Master Ball,
  and the author wants those three as Ultra Ball, so the tier decides on
  its own. Flutter Mane, Volcarona and Palafin are legendary by tier. The
  30 tier-only legendaries with ordinary stats are shown as four stars plus
  their tier; the author may relabel them later.
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
  Rejected (2026-10-21): a third floor that pulled one Ultra Ball visitor
  into the 90 cells with no OU-level native. It would have put an OU-level
  pick in 85% of offers; the author preferred to keep cells honest and
  raise the odds instead.
- **Slot roll.** Each of the five offer slots rolls a rarity from
  `rarityOdds` = 40 / 30 / 20 / 10 (Poké / Great / Ultra / Master Ball;
  50 / 28 / 12 / 10 for the first hours),
  **falls down** to the next lower rarity the pool still has when the rolled
  one is absent (never up), then draws a species uniformly within that
  rarity, without replacement. Falling down rather than renormalising, and
  the non-legendary floor, are what stop a legendary-heavy cell (dragon/gen4
  has five among six natives) from forcing one into the offer.
- **No thin-cell free reroll** (removed 2026-10-21, author's call): visitors
  make every offer five cards, so the reroll had nothing left to fix and the
  two manual skips cover "not this cell". A thin cell (fewer than
  `thinCellThreshold` = 3 undrafted natives) only shows a note saying the
  rest are visitors; the pool inspector still marks it.
- **No pity counter** (author's choice: simpler to explain; the score
  handicap in §7 already punishes a legendary-heavy team on the board).
- The cell roll stays uniform and the 18×9 grid keeps its identity.

Expected numbers from a 30,000-run simulation of the final rules (player
always takes the best ball offered), after the Mega rule of 2026-10-22: an
Ultra Ball or better in 64% of offers, 3.8 OU-level picks per team, three
or more in 88% of runs, all six in 7% (the ceiling is the grid: 69 cells
have no OU-level native, so an Ultra roll there falls down to Great Ball);
a Master Ball in 22% of offers and 78% of runs, 1.3 per team; the most
legendary-prone cell (fighting/gen8) offers one 44% of the time, and no
cell is above 50%. Before the Mega rule the same simulation gave 52%, 3.2,
72%, 2%, 85 cells, 20%, 75%, 1.2: the 40/30/20/10 slot odds have not been
retuned for the lift. `node scripts/coverage.ts` prints the buckets, the
short cells, and the 19 legendary-heavy cells whose visitors keep the
offer open.

Knobs to playtest (`DEFAULT_DRAFT_CONFIG`): `rarityOdds`, `backfillMin`,
`backfillMinNonLegendary`, `thinCellThreshold`. The Python reference
(`rollmons/draft.py`) still implements the pre-§1 weighting and is no longer
the oracle for the draft; its tests cover the Python code only.

## 2. CPU hint and low-power mode

The battle runs on the player's device (`docs/BATTLE_AI.md`). The battle screen
gets a one-line notice and a "low power" switch that halves both search budgets
(`DEFAULT_BUDGET_MS`); the choice is remembered in `localStorage`. The dev knobs
`?p1ms=&p2ms=` keep working and override the switch.

Phone cost, measured by emulation on 2026-10-22 (headless Chrome, iPhone 13
viewport, Lighthouse-style CPU throttling on the main thread; the worker cannot
be throttled, so the engine bench was run on the main thread): 230.8k MCTS
iterations per 100 ms on the Mac, 53.2k at 4x (mid-range phone), 34.3k at 6x
(low-end). Budgets are wall-clock, so a slower phone plays weaker, not longer:
a four-battle campaign took 37 s with the replay animating at 60 fps on the
throttled thread and only two long tasks. Live site on slow 4G: title usable at
5.5 s, worker ready at 11.6 s (1.5 MB brotli: worker 1.03, data 0.26, wasm
0.21), but play.pokemonshowdown.com sends ~4.7 MB of replay client and sprites
per run. Heap: page 75–105 MB, worker ~25 MB. Still unmeasured: real WebKit.

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
645 species with sets, 649 draftable species; `node scripts/coverage.ts`
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

### Feedback and set contributions (built 2026-10-22)
A **✉ Feedback** button in the tools strip opens a drawer with one text
box; **Contribute a set** in the pool's species panel opens the same drawer
for that species, and the paste must parse as a Showdown export for it
(`parseShowdownExport`, every block's species checked) or it is refused
with the parser's message. `POST /api/feedback` (`web/api/feedback.ts`,
same function, Vercel route `?op=feedback`) stores kind, text, species,
screen, language, seed, user agent, the account name when signed in, and
the hashed address; 10 per network per day, except for the author's accounts
(`web/game/dev-accounts.ts`, shared with the page's developer gate), which
have no cap (2026-10-23). Same-origin only, so a local
build shows "can only be sent from the hosted site". A set contribution
also carries a one-line **summary** of what the set does (required, 200
characters, column `note`; added 2026-10-22 at the author's request, the
column is created on existing tables by an `alter table … if not exists`
in the schema list), so a row reads as summary + export. Reading the rows
(2026-10-23): `GET /api/feedback?limit=200` returns them newest first
(no hashed addresses) for a signed-in developer account or with
`Authorization: Bearer <FEEDBACK_READ_TOKEN>`; the token is a Vercel env
var (production + preview, not flagged sensitive, so `vercel env pull`
recovers it) that the author's tooling / an agent session uses to pull
contributed sets without the Neon console. The Neon console still works:
`select * from feedback order by id desc`. No admin page.

### Score (built; retuned 2026-10-23; numbers are playtest knobs in `web/game/score.ts`)
```
score = round( Σ over won battles of  bandPoints × speedBonus  ×  teamHandicap  × 10 )
bandPoints : Cakewalk 1, Meme 2, Red 3, Middle 5 each, Advanced 8 each, Air 30   (max 75)
speedBonus : 1 + 0.05 × clamp((30 − turns) / 30, 0, 1)        (a token; the bots set the pace)
teamHandicap: mean over the six of costFactor(forme played), rounded to 4 places
costFactor by Showdown tier: Uber/AG 0.8, OU 0.88, UU 0.96, RU 1.04, NU 1.12, PU/ZU 1.2
tiebreak   : fewer total turns, then the earlier post
```
Decided with the author on 2026-10-23, keeping the 2026-10-18 shape: (1)
the speed bonus was 25%, too much for something the player does not
control, so it is a token 5%; (2) the handicap was 0.5–1.5, which let six
ZU at level 5 beat six Ubers at level 8; at 0.8–1.2 a cheap team is worth
about one level (six ZU at level 5 beat six Ubers at level 6, lose to
level 7); (3) the last boss went from 15 to 30 points so that any clear
(worst case six Ubers, 600) beats any run that fell short (best case six
ZU at level 9 at full speed, 567): whoever beats the last boss tops the
board. A species scores by the forme it plays: a chosen Mega set counts
as the Mega forme's tier (closes the "draft ZU Charizard, play Mega X"
hole; proofs carry set choices so the server verifies it). `turns` is
stored per row (`alter table … if not exists`); rows from before carry 0
and the old scale, so the board is wiped when this ships (`delete from
leaderboard` in the Neon console). The earlier idea of a left-standing /
HP tiebreak was never built and is dropped.
A loss ends the run, so only wins count. The tier comes from the Showdown
simulator's own data (`Dex.species.get(id).tier`); species absent from gen9
use the latest generation where they had a tier (Nidoking UU in gen8, Raticate
ZU in gen7). No manual labelling. BST is the fallback for anything untiered.

## 8. UI rework (after §1 and §9)

One pass with the new draft flow and i18n keys known, so it is done once.

**Review (2026-10-21).** Screenshots of every screen at desktop and phone
width and in zh/ja, read independently by two models, agreed on the problems:
Pixelify Sans at weight 700 is unreadable at small sizes (2→8, 3→9, c→o,
confirmed by zoomed crops); the same orange rounded frame sits on every
component so nothing has a hierarchy; four fonts, Press Start 2P used below
8 px; the topbar tools strip overflows a phone viewport horizontally; the
battle screen fixes the replay iframe at 620 px and stacks blank replay
cards; copy is in a developer voice with emoji; the title is a day sky while
every other screen is night. Direction chosen by the author: keep the
pixel theme and use **PokéRogue** as the reference (its starter-select,
battle, and title-menu screens), execute it properly: one square panel
style, a CJK-capable pixel face (DotGothic16 now; Fusion Pixel or Ark Pixel
if zh needs more), whole-pixel sizes, nothing under 12 px, colour as a role
(frame / gold heading / type colour) rather than decoration.

**Done: pool screen (2026-10-21, simplified 2026-10-22, back on the shared
theme 2026-10-22).** The pool page is a PokéRogue starter-select layout
(matrix + cell panel). It was first built as its own square, DotGothic16
`.pr` style meant to spread to the other screens; the author then chose
to keep the existing theme everywhere (no time to redo the title, draft
and battle screens), so the pool now uses the shared tokens, Pixelify
Sans and the rounded red-orange frames, and the §8 rework is layout and
content work within the existing theme, not a restyle (the draft-screen
findings above still apply minus the font and frame points). The 18×9
Type × Gen matrix of v1 is the whole
navigation (author's choice: a first build had Gen/Type/Rarity/Sort filter
rows, a grid of all 652 sprites and a Matrix/Grid switch, which the author
found too much to operate): native count per cell, thin cells dimmed, a
star where a Master Ball native lives, Rarity tabs above it change the
counts. A cell click lists the cell's natives in the left panel as a sprite
strip (best ball first, rarity number in the corner as PokéRogue draws
starter cost; other balls dimmed under a Rarity tab), and a sprite click
shows the species: Showdown `gen5` pixel sprite, dex number, types, rarity
stars + ball name, tier, BST, its cells (the other one is a link), and its
sets: one tab per set the loadout would offer (override sets first, then
the Smogon ones; a click opens it) with real move, item and ability names
(override sets carry ids; `displayName` reads the names off the Smogon
exports and the pokedex) and moves coloured by type. The landing cell is a random full one so the panel
is never empty; on a phone the matrix comes first and a cell click scrolls
to the panel. The title roller now
rolls a real cell of this pool and shows one of its natives (`roller.ts`,
animated sprite with a pixel fallback) instead of v1's fixed decorative
list.
**Draft screen (2026-10-22, for the author to test).** The author wanted
the available sets visible while drafting. Of the two options offered (A:
the open set in every card; B: a candidate strip and one detail panel) the
author chose B. The five candidates are a strip of tiles (sprite, name,
stars + ball, type chips, dashed frame for a visitor); the highlighted one
is detailed below in the pool's species block (dex number, types, rarity,
tier, BST, debut generation) plus the pool's set block (one tab per set,
item · ability, type-coloured moves, Contribute a set), both shared with
the pool panel (`speciesBlock` / `setBlock` in `main.ts`). The Pick button
carries the open set: `GameSession.pick(speciesId, setId?)` remembers it
and, when the draft completes, applies it after the default loadout as
`set:` actions, so the proof replays unchanged and the loadout screen only
has to confirm. The party column and the pips became a six-slot sprite
strip in the page head (current slot pulsing); the round number sits in
the cell header. Phone: three tiles per row, the panel stacks, slots
shrink to 44 px. Pick-to-pick transition (same day, author's request):
the tiles drop away one after another and the panel fades (Web
Animations API), then the next cell's header bounces in, its tiles slide
in one after another and the panel rises; the new slot pops; switching
tiles swaps the panel with a short rise. A first version also flew the
picked sprite into its slot; the author asked for that to go, and its
fade had been left filling forwards on the panel element, which blanked
the sets after the first pick (fixed by cancelling it after it finishes).
All of it is skipped under `prefers-reduced-motion`, and a pick is ignored
while one plays. The "Team assembled" card that followed the sixth pick
was removed later that day (author: the export is pointless before the
sets are chosen, and the next step is the loadout anyway): the sixth
pick's transition lands on the loadout screen, which now holds the Copy
team export button next to Start the gauntlet.
**Boss page is a developer page (2026-10-22, author's call).** Players
never needed the ladder editor: the loadout's button now starts the tiered
campaign directly, the Gauntlet step is gone from the topbar (Draft ·
Loadout · Battle · Results), and the boss page opens only from a "⚙
Gauntlet" button in the tools strip that shows for the author's account
(`DEV_ACCOUNTS` in `main.ts`, matched as a Showdown id) and locally, where
there are no accounts. Direct navigation to it as a player falls back to
the loadout. This is a UI gate, not security: the manual ladder was never
a scoring path (proofs replay the campaign only).
**Next screens, in order:** loadout, battle (the replay frame and live
cards; an end-of-run card with New run / View run summary under the last
replay was added 2026-10-22, since the fixed button is far from where
the player is after watching the last battle), results and the leaderboard drawer, then the topbar strip (phone
overflow). The title page stays as it is.

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
labels (`roller.ts`), and `SessionError` messages from
the game layer. The pixel display font has no CJK glyphs, so headings in zh/ja
fall back to the system font; the UI rework (§8) should pick a CJK pixel face.

## 10. Weather-core modes (parked)

"Start with a Rain core / Sand core / Sun core": the player begins with a fixed
two-Pokémon core (e.g. Pelipper + a Swift Swim user) and drafts the remaining
four. Fun modes, not ranked, or a separate board. Needs: a `GameSession` option
for pre-filled slots, draft rounds reduced to four, core files under
`rollmons/cores/`, and a mode picker on the title screen. Not started.
