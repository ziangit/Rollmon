# Contributing

## Data contributions

Boss teams and Pokémon set overrides use standard Pokémon Showdown export text,
the format shared through [Pokepaste](https://pokepast.es/). Store the export
content in this repository; do not submit a Pokepaste URL.

- Boss (manual ladder): `rollmons/bosses/<boss-name>.txt`, exactly six Pokémon.
- Campaign pool team: `rollmons/pool/<tier>/<name>.txt`, exactly six Pokémon.
  Tiers and their intent are in `docs/DIFFICULTY.md`.
- Set override: `rollmons/sets/<showdown-species-id>.txt`, one or more export
  blocks. A label in the nickname slot (`Label (Species) @ Item`) shows only in
  the loadout picker. Overrides add choices next to the Smogon/randbats sets.

Install and validate (Python 3.11 only; no Rust, Node, or Showdown needed):

```bash
make install
.venv/bin/python -m rollmons.validate_submission boss rollmons/pool/advanced/Cynthia.txt
.venv/bin/python -m rollmons.validate_submission set rollmons/sets/abomasnow.txt
```

Validation checks export structure and whether species/moves exist in the
checked-in Generation 9 data. The `set` kind validates one block per file;
multi-block override files are validated block by block by the web app. It does
not enforce tiers, learnsets, or obtainability. Playtest new teams in a real battle once the browser battle
worker lands; weak or gimmick teams are where the search engine flakes.

## Code contributions

```bash
make test
```

The Python package under `rollmons/` is the reference implementation and its
tests are the spec for the TypeScript port. Do not add foul-play (GPL) code to
this repository. Push only to `origin`.
