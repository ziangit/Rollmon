"""Pure parsing and existence validation for contributed Showdown exports."""

from __future__ import annotations

import json
from pathlib import Path

from teams.team_converter import export_to_dict

REPO_ROOT = Path(__file__).resolve().parents[1]
POKEDEX_PATH = REPO_ROOT / "data" / "pokedex.json"
MOVES_PATH = REPO_ROOT / "data" / "moves.json"


class SubmissionError(ValueError):
    pass


class BattleEntityNotFoundError(SubmissionError):
    pass


def parse_showdown_export(
    export_text: str,
    *,
    expected_members: int | None = None,
    source: str = "submission",
) -> list[dict]:
    text = export_text.strip()
    if not text:
        raise SubmissionError(f"{source} is empty")
    try:
        members = export_to_dict(text)
    except (IndexError, KeyError, ValueError) as exc:
        raise SubmissionError(f"{source} is malformed Showdown export text") from exc
    if expected_members is not None and len(members) != expected_members:
        raise SubmissionError(
            f"{source} must contain exactly {expected_members} Pokemon; "
            f"found {len(members)}"
        )
    for index, member in enumerate(members, start=1):
        if not member["species"]:
            raise SubmissionError(f"{source} member {index} has no species")
        if not member["moves"]:
            raise SubmissionError(f"{source} member {index} has no moves")
        if len(member["moves"]) > 4:
            raise SubmissionError(f"{source} member {index} has more than four moves")
    return members


def verify_team_entities_exist(**teams: str) -> None:
    """Reject only species and moves absent from checked-in Gen 9 engine data."""

    pokedex = json.loads(POKEDEX_PATH.read_text(encoding="utf-8"))
    moves = json.loads(MOVES_PATH.read_text(encoding="utf-8"))
    missing = []
    for team_name, team_export in teams.items():
        members = parse_showdown_export(team_export, source=team_name)
        for member in members:
            species_id = member["species"]
            if species_id not in pokedex:
                missing.append(f"{team_name}: species '{species_id or '(blank)'}'")
            for move_id in member["moves"]:
                if move_id not in moves:
                    missing.append(f"{team_name}: move '{move_id or '(blank)'}'")
    if missing:
        raise BattleEntityNotFoundError(
            "not implemented in the Gen 9 engine: " + ", ".join(missing)
        )


def validate_submission(path: str | Path, kind: str) -> tuple[int, int]:
    submission_path = Path(path)
    try:
        export_text = submission_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise SubmissionError(f"could not read submission: {submission_path}") from exc
    expected_members = 6 if kind == "boss" else 1
    members = parse_showdown_export(
        export_text,
        expected_members=expected_members,
        source=str(submission_path),
    )
    verify_team_entities_exist(submission=export_text)
    return len(members), sum(len(member["moves"]) for member in members)
