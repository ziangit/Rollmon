"""Validate one contributed boss team or Pokemon set without the live stack."""

from __future__ import annotations

import argparse

from rollmons.submissions import SubmissionError, validate_submission


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=("boss", "set"))
    parser.add_argument("path")
    args = parser.parse_args()
    try:
        members, moves = validate_submission(args.path, args.kind)
    except SubmissionError as exc:
        raise SystemExit(f"INVALID: {exc}") from exc
    print(
        f"OK: {args.kind} submission has {members} Pokemon and "
        f"{moves} implemented moves"
    )


if __name__ == "__main__":
    main()
