"""Load authored boss teams stored as Showdown export text."""

from __future__ import annotations

from pathlib import Path

BOSSES_DIR = Path(__file__).resolve().parent / "bosses"
class BossTeamError(ValueError):
    pass


def boss_team_path(boss_id: str) -> Path:
    normalized_id = boss_id.removesuffix(".txt")
    if Path(normalized_id).name != normalized_id:
        raise BossTeamError(f"invalid boss ID: {boss_id}")
    path = BOSSES_DIR / f"{normalized_id}.txt"
    if not path.is_file():
        raise BossTeamError(f"unknown boss: {boss_id}")
    return path


def load_boss_team(boss_id: str) -> str:
    path = boss_team_path(boss_id)
    try:
        team_export = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise BossTeamError(f"could not load boss team: {boss_id}") from exc
    if not team_export:
        raise BossTeamError(f"boss team is empty: {boss_id}")
    return team_export


def boss_display_name(boss_id: str) -> str:
    path = boss_team_path(boss_id)
    return path.stem.replace("-", " ").replace("_", " ").title()


def list_boss_ids() -> tuple[str, ...]:
    return tuple(path.stem for path in sorted(BOSSES_DIR.glob("*.txt")))
