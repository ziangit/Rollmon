"""Assemble drafted randbats atoms into fixed-level Showdown exports."""

from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Protocol, Sequence

from rollmons.draft import TEAM_SIZE
from rollmons.legality_matrix import (
    DEFAULT_POKEDEX_PATH,
    DEFAULT_RANDBATS_PATH,
)
from rollmons.submissions import SubmissionError, parse_showdown_export

FIXED_LEVEL = 100
NEUTRAL_NATURE = "Serious"
NEUTRAL_EVS = 85
DEFAULT_IVS = 31
STATS = ("HP", "Atk", "Def", "SpA", "SpD", "Spe")
SETS_DIR = Path(__file__).resolve().parent / "sets"


class TeamRandomSource(Protocol):
    def choices(
        self,
        population: Sequence[str],
        weights: Sequence[int],
        *,
        k: int,
    ) -> list[str]: ...


class TeamAssemblyError(ValueError):
    pass


@dataclass(frozen=True)
class RandomBattleSet:
    source_level: int
    item: str
    ability: str
    moves: tuple[str, ...]
    tera_type: str
    observed_count: int


def _load_json(path: str | Path) -> dict:
    with Path(path).open(encoding="utf-8") as source:
        data = json.load(source)
    if not isinstance(data, dict):
        raise TeamAssemblyError(f"expected a JSON object in {path}")
    return data


def parse_random_battle_set(encoded: str, observed_count: int) -> RandomBattleSet:
    fields = encoded.split(",")
    if len(fields) < 5:
        raise TeamAssemblyError(
            f"expected level, item, ability, moves, and tera type: {encoded}"
        )
    level, item, ability = fields[:3]
    moves = fields[3:-1]
    tera_type = fields[-1]
    if not 1 <= len(moves) <= 4:
        raise TeamAssemblyError(f"expected one to four moves: {encoded}")
    if observed_count <= 0:
        raise TeamAssemblyError("randbats observed count must be positive")
    return RandomBattleSet(
        source_level=int(level),
        item=item,
        ability=ability,
        moves=tuple(moves),
        tera_type=tera_type,
        observed_count=observed_count,
    )


def load_random_battle_sets(
    path: str | Path = DEFAULT_RANDBATS_PATH,
) -> dict[str, tuple[RandomBattleSet, ...]]:
    raw_data = _load_json(path)
    return {
        species_id: tuple(
            parse_random_battle_set(encoded, count)
            for encoded, count in encoded_sets.items()
        )
        for species_id, encoded_sets in raw_data.items()
    }


def select_random_battle_set(
    species_id: str,
    sets: Mapping[str, Sequence[RandomBattleSet]],
    *,
    rng: TeamRandomSource | None = None,
) -> RandomBattleSet:
    available = tuple(sets.get(species_id, ()))
    if not available:
        raise TeamAssemblyError(f"no randbats sets for {species_id}")
    random_source = rng or random
    return random_source.choices(
        available,
        [set_.observed_count for set_ in available],
        k=1,
    )[0]


def representative_random_battle_set(
    species_id: str,
    sets: Mapping[str, Sequence[RandomBattleSet]],
) -> RandomBattleSet:
    """Return the most frequently observed randbats set for inspection."""

    available = tuple(sets.get(species_id, ()))
    if not available:
        raise TeamAssemblyError(f"no randbats sets for {species_id}")
    return max(available, key=lambda set_: set_.observed_count)


def _display_name(value: str) -> str:
    return value.replace("-", " ").title().replace(" ", "-")


def _export_member(name: str, set_: RandomBattleSet) -> str:
    # This legal 510-EV neutral spread is deliberate. It exactly matches
    # foul-play's randbats parser, keeping player-team stats aligned with the
    # sets the AI was validated piloting; it is not an optimized spread.
    evs = " / ".join(f"{NEUTRAL_EVS} {stat}" for stat in STATS)
    lines = [
        f"{name} @ {_display_name(set_.item)}",
        f"Ability: {_display_name(set_.ability)}",
        f"Level: {FIXED_LEVEL}",
        f"EVs: {evs}",
        f"{NEUTRAL_NATURE} Nature",
        *[f"- {_display_name(move)}" for move in set_.moves],
    ]
    return "\n".join(lines)


def load_set_override(
    species_id: str,
    *,
    sets_dir: str | Path = SETS_DIR,
) -> str | None:
    path = Path(sets_dir) / f"{species_id}.txt"
    if not path.is_file():
        return None
    try:
        export_text = path.read_text(encoding="utf-8").strip()
        members = parse_showdown_export(
            export_text,
            expected_members=1,
            source=str(path),
        )
    except (OSError, SubmissionError) as exc:
        raise TeamAssemblyError(f"invalid set override for {species_id}: {exc}") from exc
    if members[0]["species"] != species_id:
        raise TeamAssemblyError(
            f"set override {path} contains {members[0]['species']}, "
            f"expected {species_id}"
        )
    return export_text


def assemble_team(
    drafted_species: Sequence[str],
    *,
    rng: TeamRandomSource | None = None,
    randbats_path: str | Path = DEFAULT_RANDBATS_PATH,
    pokedex_path: str | Path = DEFAULT_POKEDEX_PATH,
    sets_dir: str | Path = SETS_DIR,
) -> str:
    """Return a six-member, fixed-level Showdown export string."""

    if len(drafted_species) != TEAM_SIZE:
        raise TeamAssemblyError(f"team must contain exactly {TEAM_SIZE} species")
    if len(set(drafted_species)) != TEAM_SIZE:
        raise TeamAssemblyError("team violates Species Clause")

    sets = load_random_battle_sets(randbats_path)
    pokedex = _load_json(pokedex_path)
    members = []
    for species_id in drafted_species:
        override = load_set_override(species_id, sets_dir=sets_dir)
        if override is not None:
            members.append(override)
            continue
        entry = pokedex.get(species_id)
        if not isinstance(entry, dict):
            raise TeamAssemblyError(f"unknown species: {species_id}")
        chosen_set = select_random_battle_set(species_id, sets, rng=rng)
        members.append(_export_member(str(entry.get("name", species_id)), chosen_set))
    return "\n\n".join(members)
