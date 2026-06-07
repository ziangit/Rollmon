import pytest

from rollmons.boss_loader import BossTeamError, boss_display_name, load_boss_team


def test_ash_team_is_a_six_member_level_100_export():
    team = load_boss_team("ash")

    assert len(team.split("\n\n")) == 6
    assert team.count("Level: 100") == 6
    assert "Pikachu @ Light Ball" in team
    assert "- Volt Tackle" in team
    assert "Blastoise" in team
    assert "- Hydro Cannon" in team
    assert boss_display_name("ash") == "Ash"


def test_unknown_boss_is_rejected():
    with pytest.raises(BossTeamError, match="unknown boss"):
        load_boss_team("missing")
