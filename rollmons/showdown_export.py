"""Clean-room parser for Pokémon Showdown export text (the Pokepaste format).

Written for rollmons v2 so the pure layer has no dependency on foul-play.
IDs follow Showdown's convention: lowercase, alphanumerics only.
"""

from __future__ import annotations

import re

_STAT_KEYS = {
    "hp": "hp",
    "atk": "attack",
    "def": "defense",
    "spa": "special-attack",
    "spd": "special-defense",
    "spe": "speed",
}
_DEFAULT_EVS = dict.fromkeys(_STAT_KEYS.values(), 0)
_DEFAULT_IVS = dict.fromkeys(_STAT_KEYS.values(), 31)
_GENDER_SUFFIX = re.compile(r"\s*\((M|F)\)\s*$")


def to_id(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum())


def _parse_stat_line(payload: str, defaults: dict[str, int]) -> dict[str, int]:
    stats = dict(defaults)
    for part in payload.split("/"):
        part = part.strip()
        if not part:
            continue
        amount, _, stat = part.partition(" ")
        key = _STAT_KEYS.get(stat.strip().lower())
        if key is None or not amount.strip().isdigit():
            raise ValueError(f"bad stat entry: {part!r}")
        stats[key] = int(amount)
    return stats


def _parse_header(line: str) -> dict:
    """``Nickname (Species) (G) @ Item`` with every part but the name optional."""

    head, at, item = line.partition("@")
    head = head.strip()
    gender = ""
    match = _GENDER_SUFFIX.search(head)
    if match:
        gender = match.group(1)
        head = head[: match.start()].rstrip()
    nickname = ""
    species = head
    if head.endswith(")") and "(" in head:
        nickname, _, inner = head.rpartition("(")
        nickname = nickname.strip()
        species = inner[:-1].strip()
    if not species:
        raise ValueError(f"export block has no species: {line!r}")
    return {
        "species": to_id(species),
        "name": nickname or species,
        "gender": gender,
        "item": to_id(item) if at else "",
    }


def single_pokemon_export_to_dict(block: str) -> dict:
    lines = [line.strip() for line in block.strip().splitlines() if line.strip()]
    if not lines:
        raise ValueError("empty export block")
    pkmn = _parse_header(lines[0])
    pkmn.update(
        {
            "ability": "",
            "level": 100,
            "nature": "",
            "shiny": False,
            "tera_type": "",
            "evs": dict(_DEFAULT_EVS),
            "ivs": dict(_DEFAULT_IVS),
            "moves": [],
        }
    )
    for line in lines[1:]:
        if line.startswith("-"):
            pkmn["moves"].append(to_id(line[1:]))
        elif line.startswith("Ability:"):
            pkmn["ability"] = to_id(line.removeprefix("Ability:"))
        elif line.startswith("Level:"):
            pkmn["level"] = int(line.removeprefix("Level:").strip())
        elif line.startswith("EVs:"):
            pkmn["evs"] = _parse_stat_line(line.removeprefix("EVs:"), _DEFAULT_EVS)
        elif line.startswith("IVs:"):
            pkmn["ivs"] = _parse_stat_line(line.removeprefix("IVs:"), _DEFAULT_IVS)
        elif line.startswith("Tera Type:"):
            pkmn["tera_type"] = to_id(line.removeprefix("Tera Type:"))
        elif line.startswith("Shiny:"):
            pkmn["shiny"] = line.removeprefix("Shiny:").strip().lower() == "yes"
        elif line.endswith("Nature"):
            pkmn["nature"] = to_id(line.removesuffix("Nature"))
        # Unknown lines (Happiness, Gigantamax, comments) are ignored.
    return pkmn


def export_to_dict(export_text: str) -> list[dict]:
    """Parse a full export (blocks separated by blank lines) into member dicts."""

    blocks = re.split(r"\n\s*\n", export_text.strip())
    return [single_pokemon_export_to_dict(block) for block in blocks if block.strip()]
