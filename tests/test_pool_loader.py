import random

import pytest

from rollmons.pool_loader import (
    CAMPAIGN_STRUCTURE,
    PoolError,
    build_campaign,
    load_pool_team,
    tier_teams,
)
from rollmons.submissions import verify_team_entities_exist


def _write_pool(root, layout):
    for tier, teams in layout.items():
        tier_dir = root / tier
        tier_dir.mkdir(parents=True)
        for name in teams:
            # minimal single-mon export per file is enough for selection tests
            (tier_dir / f"{name}.txt").write_text(
                f"{name} placeholder\n", encoding="utf-8"
            )


def test_campaign_structure_sums_to_ten_battles():
    assert sum(count for _, count in CAMPAIGN_STRUCTURE) == 10


def test_tier_teams_lists_sorted_stems(tmp_path):
    _write_pool(tmp_path, {"level_1": ["LC3", "LC", "LC2"]})
    assert tier_teams("level_1", pool_dir=tmp_path) == ("LC", "LC2", "LC3")
    assert tier_teams("missing", pool_dir=tmp_path) == ()


def test_build_campaign_is_ten_ordered_battles_in_tier_order(tmp_path):
    _write_pool(
        tmp_path,
        {
            "level_1": ["a"],
            "level_2": ["b"],
            "level_3": ["c"],
            "middle": ["d", "e", "f"],
            "advanced": ["g", "h", "i"],
            "level_10": ["j"],
        },
    )
    campaign = build_campaign(rng=random.Random(1), pool_dir=tmp_path)

    assert [b.order for b in campaign] == list(range(1, 11))
    assert [b.tier for b in campaign] == [
        "level_1",
        "level_2",
        "level_3",
        "middle",
        "middle",
        "middle",
        "advanced",
        "advanced",
        "advanced",
        "level_10",
    ]
    # Each band contributes three distinct teams (sampled without replacement).
    assert sorted(b.team_id for b in campaign if b.tier == "middle") == ["d", "e", "f"]
    assert sorted(b.team_id for b in campaign if b.tier == "advanced") == ["g", "h", "i"]
    assert campaign[0].export.startswith("a")


def test_build_campaign_is_deterministic_under_a_seed(tmp_path):
    _write_pool(
        tmp_path,
        {
            "level_1": ["a1", "a2", "a3"],
            "level_2": ["b"],
            "level_3": ["c"],
            "middle": ["d", "e", "f"],
            "advanced": ["g", "h", "i", "j", "k"],
            "level_10": ["l"],
        },
    )
    first = build_campaign(rng=random.Random(7), pool_dir=tmp_path)
    second = build_campaign(rng=random.Random(7), pool_dir=tmp_path)
    assert [b.team_id for b in first] == [b.team_id for b in second]
    # a five-team band drawn three times still yields three distinct teams
    assert len({b.team_id for b in first if b.tier == "advanced"}) == 3


def test_build_campaign_errors_when_a_tier_is_too_thin(tmp_path):
    _write_pool(
        tmp_path,
        {
            "level_1": ["a"],
            "level_2": ["b"],
            "level_3": ["c"],
            "middle": ["d", "e", "f"],
            "advanced": ["g", "h"],  # needs 3, only 2
            "level_10": ["j"],
        },
    )
    with pytest.raises(PoolError):
        build_campaign(rng=random.Random(0), pool_dir=tmp_path)


def test_checked_in_pool_builds_a_valid_campaign():
    # The real rollmons/pool teams must satisfy the structure and be loadable
    # six-member exports whose species + moves exist in the engine.
    campaign = build_campaign(rng=random.Random(2026))
    assert len(campaign) == 10
    for battle in campaign:
        verify_team_entities_exist(team=battle.export)
        assert battle.export == load_pool_team(battle.tier, battle.team_id)
