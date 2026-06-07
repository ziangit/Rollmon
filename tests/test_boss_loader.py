import pytest

from rollmons import boss_loader
from rollmons.boss_loader import (
    BossTeamError,
    boss_display_name,
    list_boss_ids,
    load_boss_team,
)
from rollmons.submissions import parse_showdown_export


def test_ash_team_is_a_six_member_level_100_export():
    team = load_boss_team("ash")

    assert len(team.split("\n\n")) == 6
    assert team.count("Level: 100") == 6
    assert "Pikachu @ Light Ball" in team
    assert "- Volt Tackle" in team
    assert "Blastoise" in team
    assert "- Hydro Cannon" in team
    assert boss_display_name("ash") == "Ash"
    assert "ash" in list_boss_ids()


def test_unknown_boss_is_rejected():
    with pytest.raises(BossTeamError, match="unknown boss"):
        load_boss_team("missing")


def test_contributed_boss_file_is_discovered_and_usable(tmp_path, monkeypatch):
    submitted = tmp_path / "misty.txt"
    submitted.write_text(load_boss_team("ash"), encoding="utf-8")
    monkeypatch.setattr(boss_loader, "BOSSES_DIR", tmp_path)

    team = load_boss_team("misty")

    assert len(parse_showdown_export(team, expected_members=6)) == 6
    assert list_boss_ids() == ("misty",)
