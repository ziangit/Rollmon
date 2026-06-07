import pytest

from rollmons.boss_loader import load_boss_team
from rollmons.submissions import (
    SubmissionError,
    parse_showdown_export,
    validate_submission,
)


def test_standard_team_and_single_set_use_existing_export_parser(tmp_path):
    boss = load_boss_team("ash")
    set_text = boss.split("\n\n", 1)[0]
    boss_path = tmp_path / "boss.txt"
    set_path = tmp_path / "pikachu.txt"
    boss_path.write_text(boss, encoding="utf-8")
    set_path.write_text(set_text, encoding="utf-8")

    assert validate_submission(boss_path, "boss") == (6, 24)
    assert validate_submission(set_path, "set") == (1, 4)
    assert parse_showdown_export(set_text, expected_members=1)[0]["species"] == (
        "pikachu"
    )


def test_malformed_submission_has_clear_error(tmp_path):
    path = tmp_path / "broken.txt"
    path.write_text("Pikachu @ Light Ball\nAbility: Static\n", encoding="utf-8")

    with pytest.raises(SubmissionError, match="member 1 has no moves"):
        validate_submission(path, "set")
