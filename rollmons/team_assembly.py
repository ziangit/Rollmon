"""Assemble drafted randbats atoms into fixed-level Showdown exports."""

from __future__ import annotations

import json
import random
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Protocol, Sequence

from rollmons.draft import TEAM_SIZE
from rollmons.legality_matrix import (
    DEFAULT_POKEDEX_PATH,
    DEFAULT_RANDBATS_PATH,
    configured_set_source,
)
from rollmons.smogon_sets import (
    DEFAULT_SMOGON_SETS_PATH,
    SmogonSet,
    load_usable_smogon_sets,
)
from rollmons.submissions import SubmissionError, parse_showdown_export

FIXED_LEVEL = 100
NEUTRAL_NATURE = "Serious"
NEUTRAL_EVS = 85
DEFAULT_IVS = 31
STATS = ("HP", "Atk", "Def", "SpA", "SpD", "Spe")
SETS_DIR = Path(__file__).resolve().parent / "sets"


class TeamRandomSource(Protocol):
    def choices(
        self,
        population: Sequence[str],
        weights: Sequence[int],
        *,
        k: int,
    ) -> list[str]: ...


class TeamAssemblyError(ValueError):
    pass


@dataclass(frozen=True)
class RandomBattleSet:
    source_level: int
    item: str
    ability: str
    moves: tuple[str, ...]
    tera_type: str
    observed_count: int


def _load_json(path: str | Path) -> dict:
    with Path(path).open(encoding="utf-8") as source:
        data = json.load(source)
    if not isinstance(data, dict):
        raise TeamAssemblyError(f"expected a JSON object in {path}")
    return data


def parse_random_battle_set(encoded: str, observed_count: int) -> RandomBattleSet:
    fields = encoded.split(",")
    if len(fields) < 5:
        raise TeamAssemblyError(
            f"expected level, item, ability, moves, and tera type: {encoded}"
        )
    level, item, ability = fields[:3]
    moves = fields[3:-1]
    tera_type = fields[-1]
    if not 1 <= len(moves) <= 4:
        raise TeamAssemblyError(f"expected one to four moves: {encoded}")
    if observed_count <= 0:
        raise TeamAssemblyError("randbats observed count must be positive")
    return RandomBattleSet(
        source_level=int(level),
        item=item,
        ability=ability,
        moves=tuple(moves),
        tera_type=tera_type,
        observed_count=observed_count,
    )


def load_random_battle_sets(
    path: str | Path = DEFAULT_RANDBATS_PATH,
) -> dict[str, tuple[RandomBattleSet, ...]]:
    raw_data = _load_json(path)
    return {
        species_id: tuple(
            parse_random_battle_set(encoded, count)
            for encoded, count in encoded_sets.items()
        )
        for species_id, encoded_sets in raw_data.items()
    }


def select_random_battle_set(
    species_id: str,
    sets: Mapping[str, Sequence[RandomBattleSet]],
    *,
    rng: TeamRandomSource | None = None,
) -> RandomBattleSet:
    available = tuple(sets.get(species_id, ()))
    if not available:
        raise TeamAssemblyError(f"no randbats sets for {species_id}")
    random_source = rng or random
    return random_source.choices(
        available,
        [set_.observed_count for set_ in available],
        k=1,
    )[0]


def representative_random_battle_set(
    species_id: str,
    sets: Mapping[str, Sequence[RandomBattleSet]],
) -> RandomBattleSet:
    """Return the most frequently observed randbats set for inspection."""

    available = tuple(sets.get(species_id, ()))
    if not available:
        raise TeamAssemblyError(f"no randbats sets for {species_id}")
    return max(available, key=lambda set_: set_.observed_count)


def select_smogon_set(
    species_id: str,
    sets: Mapping[str, Sequence[SmogonSet]],
    *,
    rng: TeamRandomSource | None = None,
) -> SmogonSet:
    available = tuple(sets.get(species_id, ()))
    if not available:
        raise TeamAssemblyError(f"no Smogon sets for {species_id}")
    random_source = rng or random
    return random_source.choices(
        available,
        [1 for _ in available],
        k=1,
    )[0]


def representative_smogon_set(
    species_id: str,
    sets: Mapping[str, Sequence[SmogonSet]],
) -> SmogonSet:
    available = tuple(sets.get(species_id, ()))
    if not available:
        raise TeamAssemblyError(f"no Smogon sets for {species_id}")
    return available[0]


def _display_name(value: str) -> str:
    return value.replace("-", " ").title().replace(" ", "-")


def _export_member(name: str, set_: RandomBattleSet) -> str:
    # This legal 510-EV neutral spread is deliberate. It exactly matches
    # foul-play's randbats parser, keeping player-team stats aligned with the
    # sets the AI was validated piloting; it is not an optimized spread.
    evs = " / ".join(f"{NEUTRAL_EVS} {stat}" for stat in STATS)
    lines = [
        f"{name} @ {_display_name(set_.item)}",
        f"Ability: {_display_name(set_.ability)}",
        f"Level: {FIXED_LEVEL}",
        f"EVs: {evs}",
        f"{NEUTRAL_NATURE} Nature",
        *[f"- {_display_name(move)}" for move in set_.moves],
    ]
    return "\n".join(lines)


def load_set_overrides(
    species_id: str,
    *,
    sets_dir: str | Path = SETS_DIR,
) -> tuple[str, ...]:
    """Return every checked-in override set for a species.

    A ``rollmons/sets/<species-id>.txt`` file may hold one or more standard
    Showdown export blocks (blank-line separated). Each block becomes a
    separately selectable set, so a species can offer several custom sets (for
    example multiple Mega builds, or a Mega plus a non-Mega option).
    """

    path = Path(sets_dir) / f"{species_id}.txt"
    if not path.is_file():
        return ()
    try:
        text = path.read_text(encoding="utf-8").strip()
        blocks = [block.strip() for block in re.split(r"\n\s*\n", text) if block.strip()]
        for block in blocks:
            member = parse_showdown_export(
                block, expected_members=1, source=str(path)
            )[0]
            if member["species"] != species_id:
                raise TeamAssemblyError(
                    f"set override {path} contains {member['species']}, "
                    f"expected {species_id}"
                )
    except (OSError, SubmissionError) as exc:
        raise TeamAssemblyError(f"invalid set override for {species_id}: {exc}") from exc
    return tuple(blocks)


def load_set_override(
    species_id: str,
    *,
    sets_dir: str | Path = SETS_DIR,
) -> str | None:
    """Return the first override set for a species, if any (back-compat shim)."""

    overrides = load_set_overrides(species_id, sets_dir=sets_dir)
    return overrides[0] if overrides else None


def assemble_team(
    drafted_species: Sequence[str],
    *,
    rng: TeamRandomSource | None = None,
    randbats_path: str | Path = DEFAULT_RANDBATS_PATH,
    smogon_path: str | Path = DEFAULT_SMOGON_SETS_PATH,
    pokedex_path: str | Path = DEFAULT_POKEDEX_PATH,
    sets_dir: str | Path = SETS_DIR,
    source: str | None = None,
) -> str:
    """Return a six-member, fixed-level Showdown export string."""

    if len(drafted_species) != TEAM_SIZE:
        raise TeamAssemblyError(f"team must contain exactly {TEAM_SIZE} species")
    if len(set(drafted_species)) != TEAM_SIZE:
        raise TeamAssemblyError("team violates Species Clause")

    selected_source = (source or configured_set_source()).lower()
    randbats_sets = load_random_battle_sets(randbats_path)
    smogon_sets = (
        load_usable_smogon_sets(smogon_path)
        if selected_source == "smogon"
        else {}
    )
    if selected_source not in {"smogon", "randbats"}:
        raise TeamAssemblyError(
            f"unsupported set source {selected_source!r}; "
            "expected 'smogon' or 'randbats'"
        )
    pokedex = _load_json(pokedex_path)
    members = []
    for species_id in drafted_species:
        override = load_set_override(species_id, sets_dir=sets_dir)
        if override is not None:
            members.append(override)
            continue
        if selected_source == "smogon" and species_id in smogon_sets:
            members.append(select_smogon_set(species_id, smogon_sets, rng=rng).export)
            continue
        entry = pokedex.get(species_id)
        if not isinstance(entry, dict):
            raise TeamAssemblyError(f"unknown species: {species_id}")
        chosen_set = select_random_battle_set(species_id, randbats_sets, rng=rng)
        members.append(_export_member(str(entry.get("name", species_id)), chosen_set))
    return "\n\n".join(members)


@dataclass(frozen=True)
class SelectableSet:
    """One set a player can choose for a drafted species on the loadout screen."""

    set_id: str
    source: str  # "override" | "smogon" | "randbats"
    label: str
    item: str
    ability: str
    moves: tuple[str, ...]
    export: str
    is_mega: bool
    mega_forme: str | None


def _normalize_item(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _normalize_override_export(export: str) -> str:
    """Strip the inert Tera line and guarantee an explicit ``Level: 100`` line.

    Override authors may omit the level line; the no-Tera custom format adjusts
    every Pokemon to level 100 anyway, but we normalize here so checked-in sets
    match the project's explicit level-100 convention regardless.
    """

    lines = [
        line
        for line in export.splitlines()
        if not line.strip().lower().startswith("tera type:")
    ]
    if not any(line.strip().lower().startswith("level:") for line in lines):
        # Insert after the species/item line so the export stays conventional.
        lines.insert(1, f"Level: {FIXED_LEVEL}")
    return "\n".join(lines).strip()


def _mega_forme_for_item(
    species_id: str, item: str, pokedex: Mapping[str, object]
) -> str | None:
    item_key = _normalize_item(item)
    if not item_key:
        return None
    for suffix in ("mega", "megax", "megay"):
        forme = f"{species_id}{suffix}"
        entry = pokedex.get(forme)
        if isinstance(entry, dict) and _normalize_item(
            str(entry.get("requiredItem", ""))
        ) == item_key:
            return forme
    return None


def _override_label(mega_forme: str | None, index: int) -> str:
    if mega_forme is None:
        return f"Custom {index + 1}"
    if mega_forme.endswith("megax"):
        return "Mega X"
    if mega_forme.endswith("megay"):
        return "Mega Y"
    return "Mega"


def selectable_sets(
    species_id: str,
    *,
    smogon_sets: Mapping[str, Sequence[SmogonSet]],
    randbats_sets: Mapping[str, Sequence[RandomBattleSet]],
    pokedex: Mapping[str, object],
    set_source: str = "smogon",
    sets_dir: str | Path = SETS_DIR,
) -> list[SelectableSet]:
    """Return every set a player may choose for one drafted species.

    Selectable sets are the checked-in override sets PLUS the active source's
    sets (Smogon when the species has them, otherwise the randbats fallback),
    matching how :func:`assemble_team` draws sets.
    """

    options: list[SelectableSet] = []
    for index, block in enumerate(load_set_overrides(species_id, sets_dir=sets_dir)):
        member = parse_showdown_export(
            block, expected_members=1, source=species_id
        )[0]
        item = member.get("item", "")
        mega_forme = _mega_forme_for_item(species_id, item, pokedex)
        options.append(
            SelectableSet(
                set_id=f"override:{index}",
                source="override",
                label=_override_label(mega_forme, index),
                item=item,
                ability=member.get("ability", ""),
                moves=tuple(member.get("moves", ())),
                export=_normalize_override_export(block),
                is_mega=mega_forme is not None,
                mega_forme=mega_forme,
            )
        )

    species_smogon = smogon_sets.get(species_id) if set_source == "smogon" else None
    if species_smogon:
        for index, smogon_set in enumerate(species_smogon):
            mega_forme = _mega_forme_for_item(species_id, smogon_set.item, pokedex)
            options.append(
                SelectableSet(
                    set_id=f"smogon:{index}",
                    source="smogon",
                    label=smogon_set.label,
                    item=smogon_set.item,
                    ability=smogon_set.ability,
                    moves=tuple(smogon_set.moves),
                    export=smogon_set.export,
                    is_mega=mega_forme is not None,
                    mega_forme=mega_forme,
                )
            )
    else:
        entry = pokedex.get(species_id)
        name = str(entry.get("name", species_id)) if isinstance(entry, dict) else species_id
        for index, randbats_set in enumerate(randbats_sets.get(species_id, ())):
            mega_forme = _mega_forme_for_item(species_id, randbats_set.item, pokedex)
            options.append(
                SelectableSet(
                    set_id=f"randbats:{index}",
                    source="randbats",
                    label=f"Random set {index + 1}",
                    item=randbats_set.item,
                    ability=randbats_set.ability,
                    moves=tuple(randbats_set.moves),
                    export=_export_member(name, randbats_set),
                    is_mega=mega_forme is not None,
                    mega_forme=mega_forme,
                )
            )
    return options


def assemble_loadout(
    loadout: Mapping[str, str],
    *,
    randbats_path: str | Path = DEFAULT_RANDBATS_PATH,
    smogon_path: str | Path = DEFAULT_SMOGON_SETS_PATH,
    pokedex_path: str | Path = DEFAULT_POKEDEX_PATH,
    sets_dir: str | Path = SETS_DIR,
    source: str | None = None,
) -> str:
    """Assemble a team from an ordered species->set_id loadout selection.

    A missing or unknown set_id falls back to the species' first selectable set.
    """

    if len(loadout) != TEAM_SIZE:
        raise TeamAssemblyError(f"team must contain exactly {TEAM_SIZE} species")
    if len(set(loadout)) != TEAM_SIZE:
        raise TeamAssemblyError("team violates Species Clause")

    selected_source = (source or configured_set_source()).lower()
    if selected_source not in {"smogon", "randbats"}:
        raise TeamAssemblyError(
            f"unsupported set source {selected_source!r}; expected 'smogon' or 'randbats'"
        )
    randbats_sets = load_random_battle_sets(randbats_path)
    smogon_sets = (
        load_usable_smogon_sets(smogon_path) if selected_source == "smogon" else {}
    )
    pokedex = _load_json(pokedex_path)

    members = []
    for species_id, set_id in loadout.items():
        options = selectable_sets(
            species_id,
            smogon_sets=smogon_sets,
            randbats_sets=randbats_sets,
            pokedex=pokedex,
            set_source=selected_source,
            sets_dir=sets_dir,
        )
        if not options:
            raise TeamAssemblyError(f"no selectable sets for {species_id}")
        chosen = next((option for option in options if option.set_id == set_id), options[0])
        members.append(chosen.export)
    return "\n\n".join(members)
