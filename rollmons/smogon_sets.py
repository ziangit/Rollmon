"""Ingest contributor-provided Smogon export sets for Rollmons."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from rollmons.submissions import (
    MOVES_PATH,
    POKEDEX_PATH,
    SubmissionError,
    parse_showdown_export,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SMOGON_SETS_PATH = REPO_ROOT / "rollmons" / "data" / "smogon_sets.json"
EXCLUDED_FORMAT_ALIASES = {
    "1v1",
    "1v 1",
    "2v2",
    "aaa",
    "almost any ability",
    "battle stadium singles",
    "battle spot singles",
    "bss",
    "doubles",
    "godly gift",
    "mix and mega",
    "monotype",
    "vgc",
    "bh",
    "balanced hackmons",
    "pure hackmons",
    "stabmons",
    "cap",
    "inheritance",
    "camomons",
    "partners in crime",
    "draft",
    "free for all",
    "ffa",
    "triples",
}


@dataclass(frozen=True)
class SmogonSet:
    species_id: str
    label: str
    generation: str
    format: str
    name: str
    export: str
    source_url: str
    item: str
    ability: str
    moves: tuple[str, ...]


@dataclass(frozen=True)
class ValidationIssue:
    species_id: str
    label: str
    format: str
    field: str
    value: str
    reason: str


@dataclass(frozen=True)
class SmogonIngestionReport:
    input_species_count: int
    input_set_count: int
    format_excluded_set_count: int
    matched_format_strings: tuple[str, ...]
    usable_species_count: int
    usable_set_count: int
    validation_issues: tuple[ValidationIssue, ...]
    no_json_set_species: tuple[str, ...]
    all_sets_excluded_or_failed_species: tuple[str, ...]


class SmogonSetDataError(ValueError):
    pass


def _load_json(path: str | Path) -> dict:
    with Path(path).open(encoding="utf-8") as source:
        data = json.load(source)
    if not isinstance(data, dict):
        raise SmogonSetDataError(f"expected a JSON object in {path}")
    return data


def normalized_format(format_name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", format_name.lower()).strip()


def is_format_excluded(format_name: str) -> bool:
    normalized = normalized_format(format_name)
    return (
        normalized in EXCLUDED_FORMAT_ALIASES
        or normalized.startswith("bss ")
        or normalized.startswith("vgc")
        or "monotype" in normalized
        or "hackmons" in normalized
        or "doubles" in normalized
    )


def strip_tera_type_lines(export_text: str) -> str:
    """Remove Tera-only metadata so exports are inert in the no-Tera format."""

    return "\n".join(
        line
        for line in export_text.splitlines()
        if not line.strip().lower().startswith("tera type:")
    ).strip()


def _load_entities() -> tuple[Mapping[str, object], Mapping[str, object]]:
    return (
        _load_json(POKEDEX_PATH),
        _load_json(MOVES_PATH),
    )


def _validation_issues(
    *,
    expected_species_id: str,
    label: str,
    format_name: str,
    export_text: str,
    pokedex: Mapping[str, object],
    moves: Mapping[str, object],
) -> tuple[ValidationIssue, ...]:
    try:
        members = parse_showdown_export(
            export_text,
            expected_members=1,
            source=f"{expected_species_id} {label}",
        )
    except SubmissionError as exc:
        return (
            ValidationIssue(
                species_id=expected_species_id,
                label=label,
                format=format_name,
                field="export",
                value=label,
                reason=str(exc),
            ),
        )
    member = members[0]
    issues = []
    parsed_species = member["species"]
    if parsed_species != expected_species_id:
        issues.append(
            ValidationIssue(
                species_id=expected_species_id,
                label=label,
                format=format_name,
                field="species",
                value=parsed_species,
                reason=f"export species does not match JSON key {expected_species_id}",
            )
        )
    if parsed_species not in pokedex:
        issues.append(
            ValidationIssue(
                species_id=expected_species_id,
                label=label,
                format=format_name,
                field="species",
                value=parsed_species,
                reason="species is not implemented in checked-in Gen 9 engine data",
            )
        )
    for move_id in member["moves"]:
        if move_id not in moves:
            issues.append(
                ValidationIssue(
                    species_id=expected_species_id,
                    label=label,
                    format=format_name,
                    field="move",
                    value=move_id,
                    reason="move is not implemented in checked-in Gen 9 engine data",
                )
            )
    return tuple(issues)


def _smogon_set_from_export(
    *,
    species_id: str,
    raw_set: Mapping[str, object],
    export_text: str,
) -> SmogonSet:
    member = parse_showdown_export(
        export_text,
        expected_members=1,
        source=f"{species_id} {raw_set.get('label', '')}",
    )[0]
    return SmogonSet(
        species_id=species_id,
        label=str(raw_set.get("label", "")),
        generation=str(raw_set.get("generation", "")),
        format=str(raw_set.get("format", "")),
        name=str(raw_set.get("name", "")),
        export=export_text,
        source_url=str(raw_set.get("source_url", "")),
        item=member["item"],
        ability=member["ability"],
        moves=tuple(member["moves"]),
    )


def ingest_smogon_sets(
    path: str | Path = DEFAULT_SMOGON_SETS_PATH,
    *,
    comparison_species: set[str] | None = None,
) -> tuple[dict[str, tuple[SmogonSet, ...]], SmogonIngestionReport]:
    """Return usable no-Tera Smogon sets and an auditable ingestion report."""

    data = _load_json(path)
    raw_sets = data.get("sets")
    if not isinstance(raw_sets, dict):
        raise SmogonSetDataError(f"{path} has no top-level sets mapping")
    pokedex, moves = _load_entities()

    usable: dict[str, list[SmogonSet]] = {}
    matched_formats = set()
    format_excluded_count = 0
    validation_issues: list[ValidationIssue] = []
    all_sets_excluded_or_failed = []

    for species_id, entries in raw_sets.items():
        if not isinstance(entries, list):
            raise SmogonSetDataError(f"{species_id} sets must be a list")
        species_usable_sets: list[SmogonSet] = []
        for raw_set in entries:
            if not isinstance(raw_set, dict):
                raise SmogonSetDataError(f"{species_id} set must be an object")
            format_name = str(raw_set.get("format", ""))
            if is_format_excluded(format_name):
                matched_formats.add(format_name)
                format_excluded_count += 1
                continue
            export = strip_tera_type_lines(str(raw_set.get("export", "")))
            issues = _validation_issues(
                expected_species_id=species_id,
                label=str(raw_set.get("label", "")),
                format_name=format_name,
                export_text=export,
                pokedex=pokedex,
                moves=moves,
            )
            if issues:
                validation_issues.extend(issues)
                continue
            species_usable_sets.append(
                _smogon_set_from_export(
                    species_id=species_id,
                    raw_set=raw_set,
                    export_text=export,
                )
            )
        if species_usable_sets:
            usable[species_id] = species_usable_sets
        else:
            all_sets_excluded_or_failed.append(species_id)

    comparison_species = comparison_species or set()
    no_json_set_species = sorted(comparison_species.difference(raw_sets))
    report = SmogonIngestionReport(
        input_species_count=len(raw_sets),
        input_set_count=sum(len(entries) for entries in raw_sets.values()),
        format_excluded_set_count=format_excluded_count,
        matched_format_strings=tuple(sorted(matched_formats)),
        usable_species_count=len(usable),
        usable_set_count=sum(len(entries) for entries in usable.values()),
        validation_issues=tuple(validation_issues),
        no_json_set_species=tuple(no_json_set_species),
        all_sets_excluded_or_failed_species=tuple(sorted(all_sets_excluded_or_failed)),
    )
    return {key: tuple(value) for key, value in usable.items()}, report


def load_usable_smogon_sets(
    path: str | Path = DEFAULT_SMOGON_SETS_PATH,
) -> dict[str, tuple[SmogonSet, ...]]:
    return ingest_smogon_sets(path)[0]
