"""Load authored boss teams stored as Showdown export text."""

from __future__ import annotations

from pathlib import Path

BOSSES_DIR = Path(__file__).resolve().parent / "bosses"
BOSS_TEAM_PATHS = {
    "ash": BOSSES_DIR / "ash.txt",
}


class BossTeamError(ValueError):
    pass


def load_boss_team(boss_id: str) -> str:
    path = BOSS_TEAM_PATHS.get(boss_id)
    if path is None:
        raise BossTeamError(f"unknown boss: {boss_id}")
    try:
        team_export = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise BossTeamError(f"could not load boss team: {boss_id}") from exc
    if not team_export:
        raise BossTeamError(f"boss team is empty: {boss_id}")
    return team_export
