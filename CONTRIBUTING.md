# Contributing

## Data contributions

Boss teams and Pokemon set overrides use standard Pokemon Showdown export text,
the same format commonly shared through [Pokepaste](https://pokepast.es/).
Store the export content in this repository; do not submit a Pokepaste URL.

- Boss: `rollmons/bosses/<boss-name>.txt`, exactly six Pokemon.
- Set override: `rollmons/sets/<showdown-species-id>.txt`, exactly one Pokemon.

A set override replaces the randbats set only when that species appears in a
pool draft. It does not create a custom player team.

Install the lightweight data/harness dependencies:

```bash
make install-pure
```

Validate a boss:

```bash
python3 -m rollmons.validate_submission boss rollmons/bosses/ash.txt
```

Expected output:

```text
OK: boss submission has 6 Pokemon and 24 implemented moves
```

Validate a set after adding it:

```bash
python3 -m rollmons.validate_submission set rollmons/sets/charizard.txt
```

Validation checks export structure and whether species/moves exist in the
checked-in Generation 9 data. It does not enforce tiers, learnsets, or
obtainability. No Showdown server, Rust toolchain, or live battle stack is
required.

## Code contributions

Bootstrap the full development environment and run all tests:

```bash
make install
make test
```

Keep game logic under `rollmons/` independent from `fp/`. The single live
battle boundary remains `battle_runner.py`.

Run a real containerized boss sandbox without installing Node or Rust locally:

```bash
make stack RUNS=1 BOSS=ash
```

Generated replay pages are ignored under `.sandbox-replays/`.
