"""Report Smogon set ingestion decisions and pool/matrix deltas."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from rollmons.legality_matrix import (
    DEFAULT_RANDBATS_PATH,
    build_all_cells,
    build_legality_data,
)
from rollmons.smogon_sets import DEFAULT_SMOGON_SETS_PATH, ingest_smogon_sets


def _cell_summary(data) -> dict[str, int]:
    all_cells = build_all_cells(data.species)
    return {
        "included": len(data.matrix),
        "normal": sum(len(species) > 2 for species in all_cells.values()),
        "thin": sum(0 < len(species) <= 2 for species in all_cells.values()),
        "excluded": sum(not species for species in all_cells.values()),
    }


def _print_list(title: str, values: list[str] | tuple[str, ...]) -> None:
    print(f"{title} ({len(values)}):")
    if not values:
        print("  none")
        return
    for value in values:
        print(f"  {value}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", default=str(DEFAULT_SMOGON_SETS_PATH))
    args = parser.parse_args()

    randbats_source = json.loads(DEFAULT_RANDBATS_PATH.read_text(encoding="utf-8"))
    smogon_sets, report = ingest_smogon_sets(
        Path(args.path),
        comparison_species=set(randbats_source),
    )
    randbats_data = build_legality_data(source="randbats")
    smogon_data = build_legality_data(source="smogon", smogon_path=args.path)
    randbats_atoms = set(randbats_data.atoms)
    smogon_atoms = set(smogon_data.atoms)
    randbats_summary = _cell_summary(randbats_data)
    smogon_summary = _cell_summary(smogon_data)

    print("Smogon ingestion")
    print(f"  input species: {report.input_species_count}")
    print(f"  input sets: {report.input_set_count}")
    print(f"  usable species: {report.usable_species_count}")
    print(f"  usable sets: {report.usable_set_count}")
    print(f"  format-excluded sets: {report.format_excluded_set_count}")
    _print_list("matched excluded format strings", report.matched_format_strings)

    print("validation issues flagged for review:")
    if not report.validation_issues:
        print("  none")
    for issue in report.validation_issues:
        print(
            "  "
            f"{issue.species_id} [{issue.format}] {issue.label}: "
            f"{issue.field} '{issue.value}' - {issue.reason}"
        )

    _print_list("no set at all from JSON", report.no_json_set_species)
    _print_list(
        "had sets but all were excluded or failed",
        report.all_sets_excluded_or_failed_species,
    )

    gained = sorted(smogon_atoms - randbats_atoms)
    lost = sorted(randbats_atoms - smogon_atoms)
    print("pool delta")
    print(f"  randbats total: {len(randbats_atoms)}")
    print(f"  smogon total: {len(smogon_atoms)}")
    print(f"  gained: {len(gained)}")
    print(f"  lost: {len(lost)}")
    _print_list("species gained", gained)
    _print_list("species lost", lost)

    print("matrix delta")
    for key in ("included", "normal", "thin", "excluded"):
        print(
            f"  {key}: randbats={randbats_summary[key]} "
            f"smogon={smogon_summary[key]} "
            f"delta={smogon_summary[key] - randbats_summary[key]:+d}"
        )

    # Keep a direct reference to the loaded sets so accidental report-only
    # regressions cannot hide a mismatch between report counts and usable data.
    assert report.usable_species_count == len(smogon_sets)


if __name__ == "__main__":
    main()
