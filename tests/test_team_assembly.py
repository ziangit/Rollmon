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
    load_random_battle_sets,
    select_random_battle_set,
)

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


def test_team_export_is_well_formed_and_fixed_at_level_100():
    export = assemble_team(DRAFTED_TEAM, rng=random.Random(1234))
    members = export.split("\n\n")

    assert len(members) == 6
    for member in members:
        lines = member.splitlines()
        assert " @ " in lines[0]
        assert lines[1].startswith("Ability: ")
        assert lines[2] == f"Level: {FIXED_LEVEL}"
        assert lines[3].startswith("EVs: ")
        assert lines[4] == "Serious Nature"
        assert len([line for line in lines if line.startswith("- ")]) == 4
        assert not any(line.startswith("IVs: ") for line in lines)
        assert not any(line.startswith("Tera Type: ") for line in lines)


def test_neutral_spread_is_the_legal_510_ev_cap():
    export = assemble_team(DRAFTED_TEAM, rng=random.Random(8))
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

    export = assemble_team(DRAFTED_TEAM, rng=RecordingRng())

    assert "Level: 85" not in export
    assert export.count("Level: 100") == 6


def test_team_assembly_rejects_wrong_size_and_duplicates():
    with pytest.raises(TeamAssemblyError, match="exactly 6"):
        assemble_team(DRAFTED_TEAM[:5])
    with pytest.raises(TeamAssemblyError, match="Species Clause"):
        assemble_team(("charizard",) * 6)
