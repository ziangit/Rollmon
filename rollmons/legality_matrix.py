"""Build the rollmons type-by-debut-generation draft legality matrix.

Draftable atoms come from the configured set source. Smogon contributor sets
are the default primary source; randbats remains available as a fallback and
alternate source.
Current types and base stats come from the checked-in Showdown-derived
Pokedex. Forme debut overrides were verified against Pokemon Showdown's
``Dex.species.get(id).gen``.
"""

from __future__ import annotations

import json
import os
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Protocol, Sequence

Cell = tuple[str, int]

TYPES = (
    "bug",
    "dark",
    "dragon",
    "electric",
    "fairy",
    "fighting",
    "fire",
    "flying",
    "ghost",
    "grass",
    "ground",
    "ice",
    "normal",
    "poison",
    "psychic",
    "rock",
    "steel",
    "water",
)
GENERATIONS = tuple(range(1, 10))
DEFAULT_LEGENDARY_WEIGHT = 0.25
LEGENDARY_BST_THRESHOLD = 600
LEGENDARY_BST_EXCLUSIONS = {
    "slaking",  # Truant suppresses the stat-ball; raw BST overstates competitive power.
    "regigigas",  # Slow Start suppresses the stat-ball; raw BST overstates competitive power.
}
MIN_CELL_SIZE = 1

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RANDBATS_PATH = REPO_ROOT / "rollmons" / "data" / "gen9randombattle.json"
DEFAULT_POKEDEX_PATH = REPO_ROOT / "data" / "pokedex.json"
DEFAULT_SET_SOURCE = "smogon"
SET_SOURCE_ENV_VAR = "ROLLMONS_SET_SOURCE"

# These are the randbats formes whose Showdown debut generation differs from
# the generation implied by their National Dex number. Values were extracted
# from Pokemon Showdown Dex.species.get(id).gen at commit a9caa4c.
FORME_DEBUT_GENERATION_OVERRIDES = {
    "arcaninehisui": 8,
    "arceusfairy": 6,
    "articunogalar": 8,
    "avalugghisui": 8,
    "braviaryhisui": 8,
    "decidueyehisui": 8,
    "dialgaorigin": 8,
    "dugtrioalola": 7,
    "electrodehisui": 8,
    "exeggutoralola": 7,
    "golemalola": 7,
    "goodrahisui": 8,
    "greninjabond": 7,
    "lilliganthisui": 8,
    "moltresgalar": 8,
    "mukalola": 7,
    "ninetalesalola": 7,
    "palkiaorigin": 8,
    "persianalola": 7,
    "qwilfishhisui": 8,
    "raichualola": 7,
    "samurotthisui": 8,
    "sandslashalola": 7,
    "slowbrogalar": 8,
    "slowkinggalar": 8,
    "taurospaldeaaqua": 9,
    "taurospaldeablaze": 9,
    "taurospaldeacombat": 9,
    "typhlosionhisui": 8,
    "ursalunabloodmoon": 9,
    "weezinggalar": 8,
    "zapdosgalar": 8,
    "zoroarkhisui": 8,
}


class RandomSource(Protocol):
    def choices(
        self,
        population: Sequence[str],
        weights: Sequence[float],
        *,
        k: int,
    ) -> list[str]: ...


class LegalityDataError(ValueError):
    """Raised when the checked-in source data cannot be reconciled."""


@dataclass(frozen=True)
class SpeciesMetadata:
    species_id: str
    name: str
    types: tuple[str, ...]
    debut_generation: int
    base_stat_total: int
    legendary: bool


@dataclass(frozen=True)
class LegalityData:
    atoms: tuple[str, ...]
    species: Mapping[str, SpeciesMetadata]
    matrix: Mapping[Cell, tuple[str, ...]]


def _load_json(path: str | Path) -> dict:
    with Path(path).open(encoding="utf-8") as source:
        data = json.load(source)
    if not isinstance(data, dict):
        raise LegalityDataError(f"expected a JSON object in {path}")
    return data


def configured_set_source() -> str:
    return os.environ.get(SET_SOURCE_ENV_VAR, DEFAULT_SET_SOURCE).strip().lower()


def _atoms_for_source(
    *,
    source: str,
    randbats_path: str | Path,
    smogon_path: str | Path | None,
) -> tuple[str, ...]:
    if source == "randbats":
        return tuple(sorted(_load_json(randbats_path)))
    if source == "smogon":
        from rollmons.smogon_sets import DEFAULT_SMOGON_SETS_PATH, load_usable_smogon_sets

        return tuple(
            sorted(load_usable_smogon_sets(smogon_path or DEFAULT_SMOGON_SETS_PATH))
        )
    raise LegalityDataError(
        f"unsupported set source {source!r}; expected 'smogon' or 'randbats'"
    )


def _generation_from_national_dex_number(number: int) -> int:
    if number <= 0:
        raise LegalityDataError(f"invalid National Dex number: {number}")
    upper_bounds = (151, 251, 386, 493, 649, 721, 809, 905)
    for generation, upper_bound in enumerate(upper_bounds, start=1):
        if number <= upper_bound:
            return generation
    return 9


def _debut_generation(species_id: str, entry: Mapping[str, object]) -> int:
    if species_id in FORME_DEBUT_GENERATION_OVERRIDES:
        return FORME_DEBUT_GENERATION_OVERRIDES[species_id]
    number = entry.get("num")
    if not isinstance(number, int):
        raise LegalityDataError(f"{species_id} has no integer National Dex number")
    return _generation_from_national_dex_number(number)


def _base_stat_total(species_id: str, entry: Mapping[str, object]) -> int:
    base_stats = entry.get("baseStats")
    if not isinstance(base_stats, dict) or len(base_stats) != 6:
        raise LegalityDataError(f"{species_id} has incomplete base stat data")
    if not all(isinstance(value, int) for value in base_stats.values()):
        raise LegalityDataError(f"{species_id} has non-integer base stat data")
    return sum(base_stats.values())


def _validate_no_battle_only_mechanics(
    species_id: str, entry: Mapping[str, object]
) -> None:
    forme = str(entry.get("forme", "")).lower()
    if forme.startswith("mega") or forme.startswith("gmax"):
        raise LegalityDataError(
            f"battle-only Mega or Gigantamax forme leaked into randbats: {species_id}"
        )


def build_matrix(
    species: Mapping[str, SpeciesMetadata],
    *,
    min_cell_size: int = MIN_CELL_SIZE,
) -> dict[Cell, tuple[str, ...]]:
    """Build draftable cells, excluding every cell below ``min_cell_size``."""

    if min_cell_size < 1:
        raise ValueError("min_cell_size must be positive")
    candidates = build_all_cells(species)
    return {
        cell: eligible
        for cell, eligible in candidates.items()
        if len(eligible) >= min_cell_size
    }


def build_all_cells(
    species: Mapping[str, SpeciesMetadata],
) -> dict[Cell, tuple[str, ...]]:
    """Build all 18x9 cells, including cells excluded from slot-machine rolls."""

    candidates: dict[Cell, list[str]] = {
        (pokemon_type, generation): []
        for pokemon_type in TYPES
        for generation in GENERATIONS
    }
    for species_id, metadata in species.items():
        for pokemon_type in metadata.types:
            cell = (pokemon_type, metadata.debut_generation)
            if cell not in candidates:
                raise LegalityDataError(
                    f"{species_id} has unsupported type/generation cell {cell}"
                )
            candidates[cell].append(species_id)

    return {cell: tuple(sorted(eligible)) for cell, eligible in candidates.items()}


def cells_for_species(metadata: SpeciesMetadata) -> tuple[Cell, ...]:
    """Return every unfiltered type-generation cell occupied by one atom."""

    return tuple(
        (pokemon_type, metadata.debut_generation) for pokemon_type in metadata.types
    )


def build_legality_data(
    *,
    randbats_path: str | Path = DEFAULT_RANDBATS_PATH,
    smogon_path: str | Path | None = None,
    pokedex_path: str | Path = DEFAULT_POKEDEX_PATH,
    source: str | None = None,
) -> LegalityData:
    """Load source data and return atoms, metadata, and the filtered matrix."""

    selected_source = (source or configured_set_source()).lower()
    pokedex = _load_json(pokedex_path)
    atoms = _atoms_for_source(
        source=selected_source,
        randbats_path=randbats_path,
        smogon_path=smogon_path,
    )
    species = {}

    for species_id in atoms:
        entry = pokedex.get(species_id)
        if not isinstance(entry, dict):
            raise LegalityDataError(
                f"{selected_source} atom {species_id} is missing from the Pokedex"
            )
        _validate_no_battle_only_mechanics(species_id, entry)
        raw_types = entry.get("types")
        if not isinstance(raw_types, list) or not raw_types:
            raise LegalityDataError(f"{species_id} has no current type data")
        types = tuple(str(pokemon_type).lower() for pokemon_type in raw_types)
        base_stat_total = _base_stat_total(species_id, entry)
        species[species_id] = SpeciesMetadata(
            species_id=species_id,
            name=str(entry.get("name", species_id)),
            types=types,
            debut_generation=_debut_generation(species_id, entry),
            base_stat_total=base_stat_total,
            # "Legendary" is deliberately a competitive-power category, not
            # Pokedex lore: exactly-600 mythicals and pseudo-legendaries are
            # normal atoms. Slaking and Regigigas are explicit ability-based
            # exceptions because their raw BST overstates competitive power.
            legendary=(
                base_stat_total > LEGENDARY_BST_THRESHOLD
                and species_id not in LEGENDARY_BST_EXCLUSIONS
            ),
        )

    return LegalityData(
        atoms=atoms,
        species=species,
        matrix=build_matrix(species),
    )


def selection_probabilities(
    cell: Cell,
    matrix: Mapping[Cell, Sequence[str]],
    species: Mapping[str, SpeciesMetadata],
    *,
    legendary_weight: float = DEFAULT_LEGENDARY_WEIGHT,
) -> dict[str, float]:
    """Return the selector's normalized probability for every eligible atom."""

    if legendary_weight <= 0:
        raise ValueError("legendary_weight must be greater than zero")
    eligible = tuple(matrix.get(cell, ()))
    if not eligible:
        raise KeyError(f"cell is not eligible: {cell}")
    try:
        weights = [
            legendary_weight if species[species_id].legendary else 1.0
            for species_id in eligible
        ]
    except KeyError as exc:
        raise LegalityDataError(
            f"cell {cell} references unknown species {exc.args[0]}"
        ) from exc
    total_weight = sum(weights)
    return {
        species_id: weight / total_weight
        for species_id, weight in zip(eligible, weights, strict=True)
    }


def select_species(
    cell: Cell,
    matrix: Mapping[Cell, Sequence[str]],
    species: Mapping[str, SpeciesMetadata],
    *,
    rng: RandomSource | None = None,
    legendary_weight: float = DEFAULT_LEGENDARY_WEIGHT,
) -> str:
    """Select one eligible atom, down-weighting but never banning legendaries."""

    probabilities = selection_probabilities(
        cell,
        matrix,
        species,
        legendary_weight=legendary_weight,
    )
    random_source = rng or random
    return random_source.choices(
        tuple(probabilities),
        tuple(probabilities.values()),
        k=1,
    )[0]
