import json
import random

import pytest

from rollmons.legality_matrix import (
    DEFAULT_POKEDEX_PATH,
    DEFAULT_RANDBATS_PATH,
    FORME_DEBUT_GENERATION_OVERRIDES,
    MIN_CELL_SIZE,
    SpeciesMetadata,
    build_legality_data,
    build_matrix,
    cells_for_species,
    select_species,
)


@pytest.fixture(scope="module")
def legality_data():
    return build_legality_data()


def metadata(species_id, types, generation, *, legendary=False):
    return SpeciesMetadata(
        species_id=species_id,
        name=species_id,
        types=types,
        debut_generation=generation,
        legendary=legendary,
    )


def test_atom_count_matches_gen9_randbats_source(legality_data):
    source = json.loads(DEFAULT_RANDBATS_PATH.read_text(encoding="utf-8"))
    assert len(source) == 508
    assert len(legality_data.atoms) == len(source)
    assert set(legality_data.atoms) == set(source)


def test_cells_with_three_or_fewer_species_are_excluded():
    species = {
        f"small{index}": metadata(f"small{index}", ("fire",), 1) for index in range(3)
    }
    species.update(
        {
            f"valid{index}": metadata(f"valid{index}", ("water",), 1)
            for index in range(MIN_CELL_SIZE)
        }
    )

    matrix = build_matrix(species)

    assert ("fire", 1) not in matrix
    assert len(matrix[("water", 1)]) == MIN_CELL_SIZE


def test_modern_type_and_debut_generation_placements(legality_data):
    clefable = legality_data.species["clefable"]
    assert clefable.types == ("fairy",)
    assert clefable.debut_generation == 1
    assert cells_for_species(clefable) == (("fairy", 1),)
    assert ("fairy", 1) not in legality_data.matrix

    charizard = legality_data.species["charizard"]
    assert charizard.types == ("fire", "flying")
    assert charizard.debut_generation == 1
    assert cells_for_species(charizard) == (("fire", 1), ("flying", 1))
    assert "charizard" in legality_data.matrix[("fire", 1)]
    assert "charizard" in legality_data.matrix[("flying", 1)]

    raichu_alola = legality_data.species["raichualola"]
    assert raichu_alola.types == ("electric", "psychic")
    assert raichu_alola.debut_generation == 7
    assert FORME_DEBUT_GENERATION_OVERRIDES["raichualola"] == 7
    assert cells_for_species(raichu_alola) == (("electric", 7), ("psychic", 7))
    assert "raichualola" in legality_data.matrix[("electric", 7)]
    assert "raichualola" in legality_data.matrix[("psychic", 7)]


def test_legendary_tags_are_inherited_by_formes(legality_data):
    assert legality_data.species["articuno"].legendary
    assert legality_data.species["articunogalar"].legendary
    assert legality_data.species["arceusfairy"].legendary
    assert "Sub-Legendary" in legality_data.species["articunogalar"].legendary_tags
    assert "Mythical" in legality_data.species["arceusfairy"].legendary_tags


def test_legendary_selection_is_down_weighted_deterministically():
    cell = ("psychic", 1)
    species = {
        "normal": metadata("normal", ("psychic",), 1),
        "legend": metadata("legend", ("psychic",), 1, legendary=True),
    }
    matrix = {cell: ("normal", "legend")}
    rng = random.Random(24601)

    picks = [
        select_species(cell, matrix, species, rng=rng, legendary_weight=0.25)
        for _ in range(2_000)
    ]

    assert picks.count("legend") < picks.count("normal")
    assert picks.count("legend") > 0


def test_three_of_four_legendary_cell_never_soft_locks():
    cell = ("dragon", 9)
    species = {
        "ordinary": metadata("ordinary", ("dragon",), 9),
        **{
            f"legend{index}": metadata(f"legend{index}", ("dragon",), 9, legendary=True)
            for index in range(3)
        },
    }
    matrix = {cell: tuple(species)}
    rng = random.Random(7)

    picks = [
        select_species(cell, matrix, species, rng=rng, legendary_weight=0.01)
        for _ in range(1_000)
    ]

    assert set(picks).issubset(species)
    assert any(pick.startswith("legend") for pick in picks)


def test_every_included_real_cell_can_return_a_pick(legality_data):
    rng = random.Random(99)
    for cell, eligible in legality_data.matrix.items():
        assert len(eligible) >= MIN_CELL_SIZE
        assert (
            select_species(
                cell,
                legality_data.matrix,
                legality_data.species,
                rng=rng,
            )
            in eligible
        )


def test_megas_gigantamax_and_z_battle_formes_do_not_leak(legality_data):
    excluded = {
        "charizardmegax",
        "charizardmegay",
        "charizardgmax",
        "pikachugmax",
        "necrozmaultra",
    }
    assert excluded.isdisjoint(legality_data.atoms)

    pokedex = json.loads(DEFAULT_POKEDEX_PATH.read_text(encoding="utf-8"))
    for species_id in legality_data.atoms:
        forme = str(pokedex[species_id].get("forme", "")).lower()
        assert not forme.startswith(("mega", "gmax"))
