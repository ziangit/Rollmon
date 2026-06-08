import json
import random

import pytest

from rollmons.legality_matrix import DEFAULT_RANDBATS_PATH
from rollmons.team_assembly import (
    FIXED_LEVEL,
    NEUTRAL_EVS,
    STATS,
    TeamAssemblyError,
    assemble_team,
    load_set_override,
    load_random_battle_sets,
    representative_random_battle_set,
    select_smogon_set,
    select_random_battle_set,
)
from rollmons.smogon_sets import load_usable_smogon_sets

DRAFTED_TEAM = (
    "charizard",
    "clefable",
    "raichualola",
    "ironvaliant",
    "articunogalar",
    "taurospaldeacombat",
)


class RecordingRng:
    def __init__(self):
        self.weights = None

    def choices(self, population, weights, *, k):
        self.weights = tuple(weights)
        return [population[0]]


def test_randbats_set_selection_uses_observed_counts_as_weights():
    sets = load_random_battle_sets()
    rng = RecordingRng()

    chosen = select_random_battle_set("charizard", sets, rng=rng)

    source = json.loads(DEFAULT_RANDBATS_PATH.read_text(encoding="utf-8"))
    assert rng.weights == tuple(source["charizard"].values())
    assert chosen.observed_count == rng.weights[0]


def test_source_defined_single_move_set_is_preserved():
    sets = load_random_battle_sets()

    assert sets["ditto"][0].moves == ("transform",)


def test_representative_set_is_the_most_frequently_observed_role():
    sets = load_random_battle_sets()

    representative = representative_random_battle_set("charizard", sets)

    assert representative.observed_count == max(
        set_.observed_count for set_ in sets["charizard"]
    )


def test_team_export_is_well_formed_and_fixed_at_level_100():
    export = assemble_team(DRAFTED_TEAM, rng=random.Random(1234))
    members = export.split("\n\n")

    assert len(members) == 6
    for member in members:
        lines = member.splitlines()
        assert " @ " in lines[0]
        assert any(line.startswith("Ability: ") for line in lines)
        assert f"Level: {FIXED_LEVEL}" in lines
        assert len([line for line in lines if line.startswith("- ")]) == 4
        assert not any(line.startswith("Tera Type: ") for line in lines)


def test_smogon_set_selection_is_uniform_and_seedable():
    sets = load_usable_smogon_sets()
    rng = RecordingRng()

    chosen = select_smogon_set("clefable", sets, rng=rng)

    assert len(sets["clefable"]) > 1
    assert rng.weights == (1, 1, 1)
    assert chosen == sets["clefable"][0]
    assert "Tera Type:" not in chosen.export


def test_neutral_spread_is_the_legal_510_ev_cap():
    export = assemble_team(DRAFTED_TEAM, rng=random.Random(8), source="randbats")
    ev_line = export.split("\n\n")[0].splitlines()[3]
    ev_values = [
        int(part.strip().split(" ", 1)[0])
        for part in ev_line.removeprefix("EVs: ").split("/")
    ]

    assert len(ev_values) == len(STATS)
    assert ev_values == [NEUTRAL_EVS] * 6
    assert sum(ev_values) == 510
    assert all(value <= 252 for value in ev_values)


def test_fixed_level_replaces_randbats_scaled_level():
    source = json.loads(DEFAULT_RANDBATS_PATH.read_text(encoding="utf-8"))
    first_charizard_set = next(iter(source["charizard"]))
    assert first_charizard_set.split(",", 1)[0] == "85"

    export = assemble_team(DRAFTED_TEAM, rng=RecordingRng(), source="randbats")

    assert "Level: 85" not in export
    assert export.count("Level: 100") == 6


def test_team_assembly_rejects_wrong_size_and_duplicates():
    with pytest.raises(TeamAssemblyError, match="exactly 6"):
        assemble_team(DRAFTED_TEAM[:5])
    with pytest.raises(TeamAssemblyError, match="Species Clause"):
        assemble_team(("charizard",) * 6)


def test_species_override_replaces_randbats_set(tmp_path):
    override = """Charizard @ Choice Specs
Ability: Blaze
Level: 100
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Flamethrower
- Air Slash
- Dragon Pulse
- Focus Blast
"""
    (tmp_path / "charizard.txt").write_text(override, encoding="utf-8")

    export = assemble_team(
        DRAFTED_TEAM,
        rng=RecordingRng(),
        sets_dir=tmp_path,
        source="randbats",
    )

    assert load_set_override("charizard", sets_dir=tmp_path) == override.strip()
    assert export.split("\n\n")[0] == override.strip()
    assert "Serious Nature" not in export.split("\n\n")[0]
