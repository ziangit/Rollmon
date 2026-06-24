# rollmons — campaign difficulty design

How the fixed ten-battle campaign is tuned. The campaign is assembled by
`rollmons/pool_loader.py` (`build_campaign` over `CAMPAIGN_STRUCTURE`) from the
checked-in team exports under `rollmons/pool/<tier>/*.txt`. This doc is the
contract for what each tier *means*; the code only enforces the battle count.

## Philosophy

A run should feel like a climb with a clear identity at every rung — tutorial,
joke teams, a homage cameo, the villains, the ladder, the wall — not a flat
stat-ramp. The player drafts six and then only *watches*; both sides are
AI-piloted. So difficulty is something we **author into the opposing teams and
the AI**, never something the player dials mid-battle.

## The two difficulty axes

Difficulty is `team strength × AI think time`. Tune both per band — a strong
team played dumbly is beatable; a fair team played sharply punishes mistakes.

1. **Team strength** — movesets, items, EV investment, synergy, coverage. This
   is the primary lever today and is fully under our control via the export
   files. Guidance per band is below.
2. **AI think time** — `search_time_ms` (boss) governs how deeply poke-engine
   searches per decision. Higher = stronger play. **Current state:** this is a
   single *global* value (default boss `25`, player `100`; overridable via
   `ROLLMONS_SEARCH_TIME_MS` / `ROLLMONS_PLAYER_SEARCH_TIME_MS`). Per-band think
   time is a **planned** knob — see "Open knobs" — so for now the band
   difficulty gap lives entirely in team strength.

> Keep the gen9 engine built `--no-default-features` (Tera compiled out). Tuning
> never changes that; a Tera-enabled engine can return illegal choices.

## The ten-battle ladder

`CAMPAIGN_STRUCTURE` = `1 + 1 + 1 + 3 + 3 + 1 = 10`. Pool bands are sampled
**without replacement**, so a run varies while still climbing band to band.

| # | Tier dir | Band | Selection | Draws | Identity |
|---|----------|------|-----------|-------|----------|
| 1 | `level_1` | Cakewalk | pool | 1 | tutorial — you win unless you troll your draft |
| 2 | `level_2` | Meme | pool | 1 | joke/themed teams with real-but-capped bite |
| 3 | `level_3` | Red | **fixed** | 1 | homage cameo (Red's HGSS six, nerfed) |
| 4–6 | `middle` | **Middle** | pool | 3 | the villains — competent, deliberately sub-optimal |
| 7–9 | `advanced` | **Advanced** | pool | 3 | the ladder — champions + real competitive teams |
| 10 | `level_10` | Air | **fixed** | 1 | the wall — already strong, the run's true test |

## Band specs

Each band lists its **intent**, a **target outcome** (rough feel, a playtest
knob not a settled constant), **team-strength guidance**, and the **current
roster**. Pool bands must hold at least their draw count; the targets below give
headroom for variety.

### 1 · `level_1` — Cakewalk (pool, draws 1)
- **Intent:** teach the loop; reassure. A reasonable draft wins comfortably.
- **Target outcome:** ~95%+ win for any non-self-sabotaging team.
- **Team guidance:** Little-Cup-tier / under-evolved / shallow coverage. No
  hazards stacks, no setup sweepers, minimal items.
- **Pool size target:** 3–5 (currently **3**: LC, LC2, LC3).

### 2 · `level_2` — Meme (pool, draws 1)
- **Intent:** flavor break — single-type / gimmick teams (cat, dog, eevee;
  deer/etc. later) that bite a little but are intentionally capped.
- **Target outcome:** ~80–90% win; an off draft can stumble.
- **Team guidance:** themed and coherent, mid-tier strength, *no* top-meta cores.
- **⚠ Stability:** meme teams are where the engine flakes. A no-attack
  hazard-setter (Smeargle) could crash the gen9-no-Tera search, and a
  single-move mon (e.g. Furfrou with only Last Resort) will Struggle/idle.
  **Playtest meme teams in a live battle**, not just existence-validation.
- **Pool size target:** 3–5 (currently **3**: Cat, Dog, Eevee).

### 3 · `level_3` — Red (fixed, draws 1)
- **Intent:** a recognizable homage spike. This is **Red's HGSS team**
  (Pikachu / Lapras / Snorlax / Venusaur / Charizard / Blastoise), not the
  anime Ash roster — named `Red.txt`; the replay shows the `red` trainer sprite.
- **Target outcome:** ~70–80% win — a noticeable bump over meme, still fair.
- **Nerf approach:** mostly item-less, several recharge STABs (Frenzy Plant,
  Blast Burn, Hydro Cannon, Giga Impact) that cost a turn. Keep it iconic but
  beatable here.
- **Note:** in the games Red is the *hardest* fight; using him as an early
  cameo is a deliberate inversion. If you ever want canonical brutality, that
  belongs at `level_10`, not here.

### 4–6 · `middle` — Middle / the villains (pool, draws 3)
- **Intent:** "real bosses, beatable." Villain-team leaders with competent but
  deliberately sub-optimal teams — worse than a real ladder team and played
  without the deepest lines.
- **Target outcome:** the band as a whole is a coin-flip-to-favorable climb;
  individual losses are acceptable.
- **Team guidance:** sensible cores, real items, full EVs, *some* but not
  perfect coverage/synergy. Avoid hyper-optimized meta stacks (those are
  Advanced). When per-band think time lands, Middle gets the lower setting.
- **Pool size target:** 6+ for variety (currently **5**: Alder, Archie, Cyrus,
  Giovanni, Maxie).

### 7–9 · `advanced` — Advanced / the ladder (pool, draws 3)
- **Intent:** the real test — champions and genuinely competitive teams that
  punish bad drafts and loose play.
- **Target outcome:** the difficulty wall before the finale; losses here are
  expected without a strong, synergistic six.
- **Team guidance:** top-tier cores, optimal items/EVs/spreads, hazard control,
  win conditions. Lift from Smogon sample teams / competitive cores. When
  per-band think time lands, Advanced gets the higher setting.
- **Pool size target:** 6+ (currently **9**: Bug, Cynthia, Drizzle, Drought,
  Geeta, Leon, N, Psychic, Sand — champions Cynthia/Geeta/Leon + N + weather
  and competitive cores).

### 10 · `level_10` — Air (fixed, draws 1)
- **Intent:** the finale wall. `Air.txt` is already strong enough to be the
  run's true test; it is the one guaranteed hard fight every run ends on.
- **Target outcome:** ~30–50% win even with a good team — the payoff fight.
- **Note:** the natural home for a future "superboss" escalation (e.g. a
  brutal Red) if the campaign grows a post-game.

## Authoring & validating teams

- One file per team: `rollmons/pool/<tier>/<TeamName>.txt`, a standard Showdown
  six-member export. The file stem is the boss name shown in-game and drives the
  replay trainer sprite (canonical names like `Cynthia`/`N`/`Giovanni` map to
  their sprite; others get a stable themed avatar).
- `.gitignore` ignores `*.txt` broadly; pool files are whitelisted via
  `!rollmons/pool/**/*.txt`, so new band dirs are tracked automatically.
- **Validate (existence-only, no live stack):**
  ```
  python -c "from pathlib import Path; \
    from rollmons.submissions import verify_team_entities_exist; \
    from rollmons.team_assembly import parse_showdown_export; \
    e=Path('rollmons/pool/<tier>/<Name>.txt').read_text().strip(); \
    parse_showdown_export(e, expected_members=6, source='<Name>'); \
    verify_team_entities_exist(boss=e); print('ok')"
  ```
  `make test` also asserts the whole checked-in pool builds a valid 10-battle
  campaign (`test_checked_in_pool_builds_a_valid_campaign`). Validation is
  **species + item + move existence only** — not tier/learnset legality and not
  battle stability. Strength and stability are playtest judgments.

## Open knobs / TODO

- **Per-band AI think time.** Thread a per-tier `search_time_ms` through
  `build_campaign` → the gauntlet seam so Middle plays shallower than Advanced.
  Today it's one global value; this is the cleanest next difficulty lever.
- **Per-band difficulty tuning.** Once think time is per-band, playtest the
  target outcomes above and adjust team strength to hit them.
- **Deepen pools.** Middle wants 6+; Advanced has room to grow. More teams =
  less repetition across runs.
- **StS-style choice.** Consider letting the player pick which Middle/Advanced
  opponent (or an elite variant) they face, instead of pure random draw.
