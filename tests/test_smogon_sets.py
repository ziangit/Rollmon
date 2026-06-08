from rollmons.smogon_sets import (
    ingest_smogon_sets,
    is_format_excluded,
    strip_tera_type_lines,
)


def test_format_exclusion_matches_requested_aliases():
    assert is_format_excluded("Godly Gift")
    assert is_format_excluded("1V1")
    assert is_format_excluded("Battle Stadium Singles")
    assert is_format_excluded("BSS Series 2")
    assert is_format_excluded("National Dex Monotype")
    assert not is_format_excluded("OU")


def test_tera_type_lines_are_stripped_from_smogon_exports():
    export = """Abomasnow @ Eject Pack
Ability: Snow Warning
Level: 100
Tera Type: Ghost
- Blizzard
"""

    assert strip_tera_type_lines(export) == """Abomasnow @ Eject Pack
Ability: Snow Warning
Level: 100
- Blizzard"""


def test_checked_in_smogon_ingestion_counts_and_validation_report():
    sets, report = ingest_smogon_sets()

    assert len(sets) == 435
    assert report.usable_set_count == 661
    assert report.format_excluded_set_count == 62
    assert report.matched_format_strings == (
        "1v1",
        "BSS Series 2",
        "Battle Stadium Singles",
        "Godly Gift",
        "Monotype",
        "National Dex Monotype",
    )
    assert report.validation_issues == ()
    assert report.all_sets_excluded_or_failed_species[:3] == (
        "annihilape",
        "arceusghost",
        "archaludon",
    )
    assert all("Tera Type:" not in set_.export for entries in sets.values() for set_ in entries)
