# rollmons

A single-player Pokémon draft/autobattler. Draft six Pokémon through a slot machine, pick each one's set, then watch an AI-piloted ten-battle boss gauntlet.

**Play it:** https://rollmon.vercel.app — everything runs in your browser; no account needed to play (one is needed only to post a score to the leaderboard).

**v2 goal:** run the whole game in the browser. The battle AI ([poke-engine](https://github.com/pmariglia/poke-engine), Rust) compiles to WebAssembly and [`@pkmn/sim`](https://github.com/pkmn/ps/tree/main/sim) referees in a Web Worker, so there is no battle server and the game hosts as a static site. v1, which ran [foul-play](https://github.com/pmariglia/foul-play) against a local Pokémon Showdown server and shipped as a macOS app, is archived at [ziangit/rollmons](https://github.com/ziangit/rollmons).

## Screenshots

| | |
|:--:|:--:|
| ![Title screen with the Gen by Type slot roller](rollmons/screenshot/home.png)<br>**Title & slot roller** | ![Draft pool legality matrix](rollmons/screenshot/pool.png)<br>**Draft pool** — 18×9 type-by-debut-generation matrix |
| ![AI-piloted battle replay](rollmons/screenshot/battle.png)<br>**Battle theater** | ![Campaign results dashboard](rollmons/screenshot/win_summary.png)<br>**Results** — outcome, MVP, damage breakdown |

## Status
- The whole game runs in the browser: poke-engine (WebAssembly) searches moves, `@pkmn/sim` referees, both in a Web Worker; the draft, loadout, campaign, and results logic is TypeScript under `web/`. Every push to `main` redeploys the site via GitHub Pages.
- The Python layer under `rollmons/` remains the reference implementation and test oracle for the pure game logic (`make test`).
- Battles play live in the replay theater; completed campaign runs can be posted to a leaderboard by signed-in players (name + password, Showdown-style, no email), where the server replays the run with the simulator before accepting the score. The board shows each player's best run.
- Next: the draft pool redesign and difficulty tuning (`docs/ROADMAP.md`, `session-handoff.md`). How the AI works and how strong it is: `docs/BATTLE_AI.md`.

## Quick start

```bash
make test                      # ruff + pytest for the reference layer (Python 3.11)
cd engine && wasm-pack build --release --target web --out-dir pkg   # engine wasm (rustup + wasm-pack)
cd web && npm install && npm run typecheck && npm test && npm run dev   # game at http://127.0.0.1:8975/dist/index.html
```

See `web/README.md` for the scripts (headless-Chrome full-run check, battle sweeps, name checks).

## Leaderboard setup (Vercel)
The API is one Vercel function (`web/api/`) backed by Neon Postgres. It needs two environment variables: `DATABASE_URL` (in the Vercel dashboard open the project, **Storage → Create Database → Neon**, free tier, connect it to the project) and `SESSION_SECRET` (any long random string; it signs the account cookies and keys the sign-up address hashes: `openssl rand -base64 48 | vercel env add SESSION_SECRET production`). Then redeploy. The tables are created and migrated on first use (`deploy/leaderboard.sql` documents them). Without the database the API answers 503 and the game hides the board; without the secret accounts are off and scores cannot be posted. Accounts have no email and no password reset; at most 5 can be created per network per day.

## Contributing data
Boss teams (`rollmons/bosses/*.txt`, `rollmons/pool/<tier>/*.txt`) and per-species set overrides (`rollmons/sets/*.txt`) are plain Showdown export text. Validate with:

```bash
.venv/bin/python -m rollmons.validate_submission boss rollmons/pool/advanced/Cynthia.txt
.venv/bin/python -m rollmons.validate_submission set rollmons/sets/abomasnow.txt
```

See `CONTRIBUTING.md`.

## Credits
- [poke-engine](https://github.com/pmariglia/poke-engine) (MIT) — the battle search engine.
- [Pokémon Showdown](https://github.com/smogon/pokemon-showdown) and [`@pkmn`](https://github.com/pkmn/ps) (MIT) — simulator, data, replay player.
- [foul-play](https://github.com/pmariglia/foul-play) (GPL-3.0) — v1's AI client and the design inspiration; no foul-play code is in this repository.
- Pokémon is © Nintendo / Creatures / GAME FREAK. This is a non-commercial fan project.
