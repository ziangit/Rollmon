"""Local single-user development harness for inspecting and exercising drafts."""

from __future__ import annotations

import json
import logging
import os
import random
import re
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Sequence

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from rollmons.boss_loader import (
    BossTeamError,
    boss_display_name,
    list_boss_ids,
    load_boss_team,
)
from rollmons.draft import Draft, DraftError, DraftOffer
from rollmons.draft_config import DraftConfig, default_draft_config
from rollmons.legality_matrix import (
    DEFAULT_POKEDEX_PATH,
    GENERATIONS,
    TYPES,
    LegalityData,
    SpeciesMetadata,
    build_all_cells,
    build_legality_data,
    configured_set_source,
)
from rollmons.smogon_sets import load_usable_smogon_sets
from rollmons.submissions import (
    BattleEntityNotFoundError,
    SubmissionError,
    parse_showdown_export,
    verify_team_entities_exist,
)
from rollmons.team_assembly import (
    DEFAULT_IVS,
    FIXED_LEVEL,
    NEUTRAL_EVS,
    NEUTRAL_NATURE,
    SETS_DIR,
    STATS,
    load_random_battle_sets,
    _normalize_override_export,
    load_set_override,
    load_set_overrides,
    representative_random_battle_set,
    representative_smogon_set,
    selectable_sets,
)

logger = logging.getLogger(__name__)

# The intermittent "player never moves" engine stall surfaces as one of these;
# they're transient, so a fresh attempt almost always succeeds. Matched by name
# to avoid importing battle_runner (and poke-engine) into the pure layer.
_RETRYABLE_BATTLE_ERRORS = {
    "BattleTimeoutError",
    "BattleReplayTimeoutError",
    "BattleEngineError",
}


def _run_battle_with_retry(run: Callable[[], Any], attempts: int = 3) -> Any:
    """Run a battle, retrying transient engine stalls; re-raise everything else."""
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return run()
        except Exception as exc:  # noqa: BLE001 — re-raised below unless retryable
            if type(exc).__name__ not in _RETRYABLE_BATTLE_ERRORS:
                raise
            last_error = exc
            logger.warning(
                "battle attempt %s/%s failed (%s): %s",
                attempt,
                attempts,
                type(exc).__name__,
                exc,
            )
    raise last_error  # type: ignore[misc]


STATIC_DIR = Path(__file__).resolve().parent / "web_static"
SHOWDOWN_ASSET_ROOT = "https://play.pokemonshowdown.com/sprites"
SHOWDOWN_ITEM_ICON_SIZE = 24

# These spritenums are the items present in the checked-in randbats snapshot.
# They come from Showdown's official /data/items.js. The client renders each
# 24x24 cell from itemicons-sheet.png using this number.
SHOWDOWN_ITEM_SPRITE_NUMBERS = {
    "": 0,
    "adamantcrystal": 741,
    "airballoon": 6,
    "assaultvest": 581,
    "boosterenergy": 745,
    "chestoberry": 65,
    "choiceband": 68,
    "choicescarf": 69,
    "choicespecs": 70,
    "cornerstonemask": 758,
    "custapberry": 86,
    "dracoplate": 105,
    "dreadplate": 110,
    "earthplate": 117,
    "eviolite": 130,
    "expertbelt": 132,
    "fistplate": 143,
    "flameorb": 145,
    "flameplate": 146,
    "focussash": 151,
    "griseouscore": 743,
    "hearthflamemask": 760,
    "heavydutyboots": 715,
    "icicleplate": 220,
    "insectplate": 223,
    "ironplate": 225,
    "leftovers": 242,
    "leppaberry": 244,
    "lifeorb": 249,
    "lightball": 251,
    "lightclay": 252,
    "loadeddice": 751,
    "lumberry": 262,
    "lustrousglobe": 742,
    "lustrousorb": 265,
    "magnet": 273,
    "meadowplate": 282,
    "mindplate": 291,
    "pixieplate": 610,
    "powerherb": 358,
    "rockyhelmet": 417,
    "rustedshield": 699,
    "rustedsword": 698,
    "scopelens": 429,
    "silkscarf": 444,
    "silverpowder": 447,
    "sitrusberry": 448,
    "skyplate": 450,
    "souldew": 459,
    "splashplate": 463,
    "spookyplate": 464,
    "stoneplate": 477,
    "throatspray": 713,
    "toxicorb": 515,
    "toxicplate": 516,
    "weaknesspolicy": 609,
    "wellspringmask": 759,
    "whiteherb": 535,
    "widelens": 537,
    "zapplate": 572,
}


# DEV-ONLY hotlinks: Showdown's code is open source, but its community- and
# Nintendo-derived sprite assets do not have established redistribution terms.
# Display them remotely; do not download, vendor, or commit them.
def _showdown_id(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _showdown_sprite_id(metadata: SpeciesMetadata, pokedex_entry: dict) -> str:
    base_id = _showdown_id(str(pokedex_entry.get("baseSpecies", metadata.name)))
    forme_id = ""
    if base_id != metadata.species_id:
        forme_id = f"-{_showdown_id(str(pokedex_entry.get('forme', '')))}"
    sprite_id = f"{base_id}{forme_id}"
    if sprite_id.endswith("totem"):
        sprite_id = sprite_id[:-5]
    if sprite_id in {"greninja-bond", "rockruff-dusk"}:
        sprite_id = sprite_id.split("-", 1)[0]
    return sprite_id.rstrip("-")


def _item_icon_payload(item_id: str) -> dict | None:
    if not item_id:
        return None
    sprite_number = SHOWDOWN_ITEM_SPRITE_NUMBERS.get(item_id)
    if sprite_number is None:
        return None
    return {
        "url": f"{SHOWDOWN_ASSET_ROOT}/itemicons-sheet.png?v1",
        "left": -(sprite_number % 16) * SHOWDOWN_ITEM_ICON_SIZE,
        "top": -(sprite_number // 16) * SHOWDOWN_ITEM_ICON_SIZE,
        "size": SHOWDOWN_ITEM_ICON_SIZE,
    }


class StartDraftRequest(BaseModel):
    level: int = FIXED_LEVEL
    skip_count: int | None = Field(default=None, ge=0)
    seed: int | None = None


class PickRequest(BaseModel):
    species_id: str


class LoadoutRequest(BaseModel):
    species_id: str
    set_id: str


class BattleRequest(BaseModel):
    boss_id: str = "ash"


class GauntletStartRequest(BaseModel):
    boss_ids: list[str] | None = None
    stop_on_loss: bool = False


class CustomBossRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    export: str = Field(min_length=1)


class SetsRequest(BaseModel):
    # Each entry is one Showdown export block for the species.
    sets: list[str] = Field(default_factory=list)


def _set_editor_enabled() -> bool:
    return os.environ.get("ROLLMONS_ENABLE_SET_EDITOR", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _require_set_editor() -> None:
    # The set editor writes files under rollmons/sets/, so it is an authoring
    # tool: off by default and never exposed in a deployed game.
    if not _set_editor_enabled():
        raise HTTPException(
            status_code=403,
            detail="set editor is disabled; run with ROLLMONS_ENABLE_SET_EDITOR=1",
        )


def _validate_set_blocks(species_id: str, blocks: list[str]) -> list[dict]:
    """Validate each Showdown export block for a species (structure + engine)."""
    results: list[dict] = []
    for index, raw in enumerate(blocks):
        block = raw.strip()
        if not block:
            results.append({"index": index, "ok": False, "error": "empty set"})
            continue
        try:
            members = parse_showdown_export(block, expected_members=1, source=species_id)
            got = members[0]["species"]
            if got != species_id:
                raise SubmissionError(
                    f"this set is for '{got}', but you're editing '{species_id}'"
                )
            verify_team_entities_exist(boss=block)
            results.append({"index": index, "ok": True, "error": None})
        except (SubmissionError, BattleEntityNotFoundError) as exc:
            results.append({"index": index, "ok": False, "error": str(exc)})
    return results


BOSS_ORDER_MIN = 1
BOSS_ORDER_MAX = 10


def _slot_from_protocol_ident(value: str) -> str:
    return value.split(":", 1)[0]


def _name_from_protocol_ident(value: str) -> str:
    return value.split(":", 1)[-1].strip()


def _normalize_species_key(value: str) -> str:
    """Canonical species key shared by roster metadata and replay protocol.

    Replicates ``fp.helpers.normalize_name`` so pure matrix/draft routes never
    import foul-play. Roster names (e.g. ``"iron moth"``) and replay names
    (e.g. ``"Iron Moth"``) must collapse to one key so per-Pokemon damage is
    not double-counted.
    """

    for character in " -.'%*:()":
        value = value.replace(character, "")
    return value.strip().lower().encode("ascii", "ignore").decode("utf-8")


def _species_from_switch_details(value: str) -> str:
    return value.split(",", 1)[0].strip()


def _condition_percent(condition: str) -> float:
    hp_text = condition.split()[0]
    if hp_text == "0":
        return 0.0
    if "/" not in hp_text:
        return 0.0
    current, maximum = hp_text.split("/", 1)
    try:
        return max(0.0, min(100.0, 100 * float(current) / float(maximum)))
    except ValueError:
        return 0.0


def _player_side_from_replay(replay_log: list[str], player_name: str) -> str:
    from fp.helpers import normalize_name

    normalized_player = normalize_name(player_name)
    for line in replay_log:
        parts = line.split("|")
        if len(parts) >= 4 and parts[1] == "player":
            side = parts[2]
            name = parts[3]
            if normalize_name(name) == normalized_player:
                return side
    return "p1"


def _damage_by_player_pokemon(result: Any) -> dict[str, float]:
    replay_log = result.replay_log
    player_side = _player_side_from_replay(replay_log, result.player_name)
    opponent_side = "p2" if player_side == "p1" else "p1"
    active_species_by_slot: dict[str, str] = {}
    hp_by_slot: dict[str, float] = {}
    current_player_attacker: str | None = None
    damage_by_attacker: dict[str, float] = {}

    for line in replay_log:
        parts = line.split("|")
        if len(parts) < 2:
            continue
        event = parts[1]
        if event in {"switch", "drag"} and len(parts) >= 5:
            slot = _slot_from_protocol_ident(parts[2])
            active_species_by_slot[slot] = _species_from_switch_details(parts[3])
            hp_by_slot[slot] = _condition_percent(parts[4])
            current_player_attacker = None
            continue
        if event == "move" and len(parts) >= 4:
            slot = _slot_from_protocol_ident(parts[2])
            side = slot[:2]
            if side == player_side:
                current_player_attacker = active_species_by_slot.get(
                    slot,
                    _name_from_protocol_ident(parts[2]),
                )
            else:
                current_player_attacker = None
            continue
        if event in {"turn", "upkeep", "win", "tie"}:
            current_player_attacker = None
            continue
        if event == "-heal" and len(parts) >= 4:
            slot = _slot_from_protocol_ident(parts[2])
            if slot[:2] == opponent_side:
                hp_by_slot[slot] = _condition_percent(parts[3])
            continue
        if event != "-damage" or len(parts) < 4:
            continue
        slot = _slot_from_protocol_ident(parts[2])
        current_hp = _condition_percent(parts[3])
        previous_hp = hp_by_slot.get(slot, 100.0)
        hp_by_slot[slot] = current_hp
        if slot[:2] != opponent_side or current_player_attacker is None:
            continue
        damage = max(0.0, previous_hp - current_hp)
        if damage <= 0:
            continue
        damage_by_attacker[current_player_attacker] = (
            damage_by_attacker.get(current_player_attacker, 0.0) + damage
        )

    return damage_by_attacker


def _damage_payload_from_totals(
    totals: dict[str, float] | None,
    display_names: dict[str, str] | None = None,
) -> dict:
    totals = totals or {}
    display_names = display_names or {}
    total_damage = sum(totals.values())
    entries = [
        {
            "name": display_names.get(key, key),
            "damage": damage,
            "contribution": (100 * damage / total_damage) if total_damage else 0.0,
        }
        for key, damage in totals.items()
    ]
    entries.sort(key=lambda item: item["damage"], reverse=True)
    mvp = entries[0] if entries and entries[0]["damage"] > 0 else None
    return {
        "total": total_damage,
        "mvp": mvp,
        "by_pokemon": entries,
    }


def _gauntlet_damage_summary(
    totals: dict[str, float] | None,
    display_names: dict[str, str] | None = None,
) -> str | None:
    damage = _damage_payload_from_totals(totals, display_names)
    mvp = damage["mvp"]
    if mvp is None:
        return None
    contributions = ", ".join(
        f"{entry['name']} {entry['damage']:.1f}% ({entry['contribution']:.1f}%)"
        for entry in damage["by_pokemon"]
    )
    return (
        f"Your MVP is {mvp['name']}, dealing {mvp['damage']:.1f}% damage "
        f"to your opponents ({mvp['contribution']:.1f}% contribution). "
        f"Team damage: {contributions}."
    )


def _seed_damage_tracking(
    species_names: Sequence[str],
) -> tuple[dict[str, float], dict[str, str]]:
    """Seed zeroed per-Pokemon damage totals plus a normalized->display map.

    Roster names and replay names are normalized to one key so the same
    Pokemon is never tracked under two keys (e.g. ``"iron moth"`` vs the
    replay's ``"Iron Moth"``).
    """

    totals: dict[str, float] = {}
    display: dict[str, str] = {}
    for name in species_names:
        key = _normalize_species_key(name)
        totals.setdefault(key, 0.0)
        display.setdefault(key, name)
    return totals, display


def _accumulate_player_damage(
    totals: dict[str, float],
    display: dict[str, str],
    result: Any,
) -> None:
    """Fold one battle's replay damage into normalized per-Pokemon totals."""

    for species, damage in _damage_by_player_pokemon(result).items():
        key = _normalize_species_key(species)
        totals[key] = totals.get(key, 0.0) + damage
        # Keep the seeded roster name (matches the team panel/gauntlet list);
        # only fall back to the replay name for an attacker not in the roster.
        display.setdefault(key, species)


@dataclass
class DraftSession:
    draft: Draft
    assembly_rng: random.Random
    team_export: str | None = None
    loadout: dict[str, str] | None = None
    battle_result: Any | None = None
    gauntlet_boss_ids: tuple[str, ...] = ()
    gauntlet_next_index: int = 0
    gauntlet_results: list[Any] | None = None
    gauntlet_stop_on_loss: bool = False
    gauntlet_damage_by_species: dict[str, float] | None = None
    gauntlet_damage_display: dict[str, str] | None = None
    # Campaign mode: maps a gauntlet boss_id (the pool team's stem) to its
    # selected export, so the gauntlet runs tier-drawn pool teams instead of
    # the authored rollmons/bosses/ list. None for a manual boss rush.
    campaign_teams: dict[str, str] | None = None


def _battle_config_from_environment():
    from battle_runner import BattleRunnerConfig

    log_dir = os.environ.get("ROLLMONS_SHOWDOWN_LOG_DIR")
    if not log_dir:
        raise RuntimeError(
            "ROLLMONS_SHOWDOWN_LOG_DIR must point to the Showdown battle-log root"
        )
    return BattleRunnerConfig(
        websocket_url=os.environ.get(
            "ROLLMONS_SHOWDOWN_WEBSOCKET_URL",
            "ws://localhost:8000/showdown/websocket",
        ),
        showdown_log_dir=log_dir,
        search_time_ms=int(os.environ.get("ROLLMONS_SEARCH_TIME_MS", "25")),
        player_search_time_ms=int(
            os.environ.get("ROLLMONS_PLAYER_SEARCH_TIME_MS", "100")
        ),
        search_parallelism=int(os.environ.get("ROLLMONS_SEARCH_PARALLELISM", "1")),
        search_threads=int(os.environ.get("ROLLMONS_SEARCH_THREADS", "1")),
        battle_timeout=float(os.environ.get("ROLLMONS_BATTLE_TIMEOUT", "60")),
    )


def _run_live_battle(*args, **kwargs):
    from battle_runner import run_battle

    return run_battle(*args, **kwargs)


def _gauntlet_payload(
    session: DraftSession,
    *,
    boss_name_lookup: Callable[[str], str] = boss_display_name,
) -> dict:
    boss_ids = session.gauntlet_boss_ids
    next_index = session.gauntlet_next_index
    results = session.gauntlet_results or []
    complete = bool(boss_ids) and next_index >= len(boss_ids)
    summary = None
    if complete and results:
        wins = sum(1 for result in results if result.winner == "player")
        losses = sum(1 for result in results if result.winner == "boss")
        ties = sum(1 for result in results if result.winner == "tie")
        average_turns = sum(result.turns for result in results) / len(results)
        record = f"{wins}-{losses}-{ties}" if ties else f"{wins}-{losses}"
        summary = f"Your record is {record}! Average turn is {average_turns:.1f}."
        damage_summary = _gauntlet_damage_summary(
            session.gauntlet_damage_by_species,
            session.gauntlet_damage_display,
        )
        if damage_summary is not None:
            summary = f"{summary} {damage_summary}"
    return {
        "bosses": [
            {
                "id": boss_id,
                "name": boss_name_lookup(boss_id),
                "complete": index < next_index,
                "current": index == next_index and next_index < len(boss_ids),
            }
            for index, boss_id in enumerate(boss_ids)
        ],
        "next_index": next_index,
        "complete": complete,
        "summary": summary,
        "stop_on_loss": session.gauntlet_stop_on_loss,
        "damage": _damage_payload_from_totals(
            session.gauntlet_damage_by_species,
            session.gauntlet_damage_display,
        ),
        "results": [asdict(result) for result in results],
    }


def _species_payload(
    metadata: SpeciesMetadata,
    random_battle_sets,
    smogon_sets,
    set_source: str,
    pokedex,
) -> dict:
    override_export = load_set_override(metadata.species_id)
    if override_export is not None:
        # A checked-in override is exactly the set assembly will use, so it
        # drives the representative display (and is the only set available for
        # override-only atoms with no source set, e.g. a pooled Mega Stone set).
        member = parse_showdown_export(
            override_export, expected_members=1, source=metadata.species_id
        )[0]
        set_payload = {
            "source": "override",
            "label": "Custom set",
            "format": None,
            # Show the normalized export (Level 100, Tera stripped) so the
            # displayed set matches what assembly actually builds.
            "export": _normalize_override_export(override_export),
            "item": member.get("item", ""),
            "ability": member.get("ability", ""),
            "moves": list(member.get("moves", [])),
            "observed_count": 1,
            "role_count": 1,
            "item_icon": _item_icon_payload(member.get("item", "")),
        }
    elif set_source == "smogon" and metadata.species_id in smogon_sets:
        representative = representative_smogon_set(metadata.species_id, smogon_sets)
        set_payload = {
            "source": "smogon",
            "label": representative.label,
            "format": representative.format,
            "export": representative.export,
            "item": representative.item,
            "ability": representative.ability,
            "moves": list(representative.moves),
            "observed_count": 1,
            "role_count": len(smogon_sets[metadata.species_id]),
            "item_icon": _item_icon_payload(representative.item),
        }
    else:
        representative = representative_random_battle_set(
            metadata.species_id,
            random_battle_sets,
        )
        set_payload = {
            "source": "randbats",
            "export": None,
            "item": representative.item,
            "ability": representative.ability,
            "moves": list(representative.moves),
            "observed_count": representative.observed_count,
            "role_count": len(random_battle_sets[metadata.species_id]),
            "item_icon": _item_icon_payload(representative.item),
        }
    return {
        "id": metadata.species_id,
        "name": metadata.name,
        "types": list(metadata.types),
        "debut_generation": metadata.debut_generation,
        "base_stat_total": metadata.base_stat_total,
        "legendary": metadata.legendary,
        "sprite_url": (
            f"{SHOWDOWN_ASSET_ROOT}/home-centered/"
            f"{_showdown_sprite_id(metadata, pokedex[metadata.species_id])}.png"
        ),
        "randbats_set": set_payload,
        "assembly_spread": {
            "level": FIXED_LEVEL,
            "nature": NEUTRAL_NATURE,
            "evs": {stat: NEUTRAL_EVS for stat in STATS},
            "ivs": {stat: DEFAULT_IVS for stat in STATS},
        },
    }


def _offer_payload(
    offer: DraftOffer | None,
    legality_data: LegalityData,
    random_battle_sets,
    smogon_sets,
    set_source: str,
    pokedex,
    draft_config: DraftConfig,
) -> dict | None:
    if offer is None:
        return None
    payload = {
        "round_number": offer.round_number,
        "cell": {"type": offer.cell[0], "generation": offer.cell[1]},
        "candidates": [],
        "suggested_species": offer.suggested_species,
        "skips_remaining": offer.skips_remaining,
        "thin_reroll_available": offer.thin_reroll_available,
        "candidate_cap": draft_config.candidate_cap,
        "thin_cell_threshold": draft_config.thin_cell_threshold,
    }
    for species_id in offer.candidates:
        candidate = _species_payload(
            legality_data.species[species_id],
            random_battle_sets,
            smogon_sets,
            set_source,
            pokedex,
        )
        candidate["selection_probability"] = offer.selection_probabilities[species_id]
        payload["candidates"].append(candidate)
    return payload


def create_app(
    *,
    battle_fn: Callable[..., Any] = _run_live_battle,
    battle_config_factory: Callable[[], Any] = _battle_config_from_environment,
) -> FastAPI:
    set_source = configured_set_source()
    draft_config = default_draft_config()
    legality_data = build_legality_data()
    all_cells = build_all_cells(legality_data.species)
    random_battle_sets = load_random_battle_sets()
    smogon_sets = load_usable_smogon_sets() if set_source == "smogon" else {}
    pokedex = json.loads(DEFAULT_POKEDEX_PATH.read_text(encoding="utf-8"))
    sessions: dict[str, DraftSession] = {}
    custom_bosses: dict[str, dict[str, str]] = {}
    app = FastAPI(title="rollmons draft harness")
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    def boss_name_for_id(boss_id: str) -> str:
        if boss_id in custom_bosses:
            return custom_bosses[boss_id]["name"]
        return boss_display_name(boss_id)

    def resolve_boss_name(session: "DraftSession", boss_id: str) -> str:
        if session.campaign_teams and boss_id in session.campaign_teams:
            return boss_id  # the pool team's stem is its display name
        return boss_name_for_id(boss_id)

    def resolve_boss_team(session: "DraftSession", boss_id: str) -> str:
        if session.campaign_teams and boss_id in session.campaign_teams:
            return session.campaign_teams[boss_id]
        return boss_team_for_id(boss_id)

    def boss_team_for_id(boss_id: str) -> str:
        if boss_id in custom_bosses:
            return custom_bosses[boss_id]["export"]
        return load_boss_team(boss_id)

    def boss_payloads() -> list[dict[str, str]]:
        file_bosses = [
            {
                "id": boss_id,
                "name": boss_name_for_id(boss_id),
                "source": "edited" if boss_id in custom_bosses else "file",
            }
            for boss_id in list_boss_ids()
        ]
        pasted_bosses = [
            {
                "id": boss_id,
                "name": boss["name"],
                "source": "custom",
            }
            for boss_id, boss in custom_bosses.items()
        ]
        return file_bosses + pasted_bosses

    def validate_boss_export(name: str, export_text: str) -> str:
        cleaned_export = export_text.strip()
        try:
            parse_showdown_export(
                cleaned_export,
                expected_members=6,
                source=name,
            )
            verify_team_entities_exist(boss=cleaned_export)
        except (SubmissionError, BattleEntityNotFoundError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return cleaned_export

    def get_session(session_id: str) -> DraftSession:
        session = sessions.get(session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="draft session not found")
        return session

    def species_set_options(species_id: str):
        return selectable_sets(
            species_id,
            smogon_sets=smogon_sets,
            randbats_sets=random_battle_sets,
            pokedex=pokedex,
            set_source=set_source,
        )

    def default_loadout(picks) -> dict[str, str]:
        loadout: dict[str, str] = {}
        for species_id in picks:
            options = species_set_options(species_id)
            if not options:
                raise HTTPException(
                    status_code=500,
                    detail=f"no selectable sets for {species_id}",
                )
            # Default to a non-Mega set so Mega is an opt-in choice and a fresh
            # team is not all-Mega (only one Mega can evolve per battle anyway).
            non_mega = next(
                (option for option in options if not option.is_mega), None
            )
            loadout[species_id] = (non_mega or options[0]).set_id
        return loadout

    def assemble_from_loadout(loadout: dict[str, str]) -> str:
        members = []
        for species_id, set_id in loadout.items():
            options = species_set_options(species_id)
            chosen = next(
                (option for option in options if option.set_id == set_id),
                options[0],
            )
            members.append(chosen.export)
        return "\n\n".join(members)

    def loadout_payload(session: DraftSession) -> list[dict] | None:
        if not session.draft.complete or session.loadout is None:
            return None
        entries = []
        for species_id in session.draft.picks:
            metadata = legality_data.species[species_id]
            options = species_set_options(species_id)
            entries.append(
                {
                    "species_id": species_id,
                    "name": metadata.name,
                    "sprite_url": (
                        f"{SHOWDOWN_ASSET_ROOT}/home-centered/"
                        f"{_showdown_sprite_id(metadata, pokedex[species_id])}.png"
                    ),
                    "chosen_set_id": session.loadout.get(species_id),
                    "locked": bool(session.gauntlet_boss_ids)
                    or session.battle_result is not None,
                    "sets": [
                        {
                            "set_id": option.set_id,
                            "source": option.source,
                            "label": option.label,
                            "item": option.item,
                            "item_icon": _item_icon_payload(option.item),
                            "ability": option.ability,
                            "moves": list(option.moves),
                            "is_mega": option.is_mega,
                            "export": option.export,
                        }
                        for option in options
                    ],
                }
            )
        return entries

    def serialize_session(session_id: str, session: DraftSession) -> dict:
        draft = session.draft
        return {
            "session_id": session_id,
            "level": FIXED_LEVEL,
            "complete": draft.complete,
            "round_number": len(draft.picks)
            if draft.complete
            else draft.current_offer.round_number,
            "team": [
                _species_payload(
                    legality_data.species[species_id],
                    random_battle_sets,
                    smogon_sets,
                    set_source,
                    pokedex,
                )
                for species_id in draft.picks
            ],
            "offer": _offer_payload(
                draft.current_offer,
                legality_data,
                random_battle_sets,
                smogon_sets,
                set_source,
                pokedex,
                draft_config,
            ),
            "skips_remaining": draft.skips_remaining,
            "draft_config": asdict(draft_config),
            "team_export": session.team_export,
            "loadout": loadout_payload(session),
            "battle_result": (
                asdict(session.battle_result)
                if session.battle_result is not None
                else None
            ),
            "gauntlet": _gauntlet_payload(
                session,
                boss_name_lookup=lambda boss_id: resolve_boss_name(session, boss_id),
            ),
        }

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC_DIR / "index.html")

    # ---- Set editor (authoring tool; gated by ROLLMONS_ENABLE_SET_EDITOR) ----

    @app.get("/sets-editor", include_in_schema=False)
    def sets_editor_page():
        _require_set_editor()
        # Never cache the authoring page so edits to it always land on reload.
        return FileResponse(
            STATIC_DIR / "set_editor.html",
            headers={"Cache-Control": "no-store, must-revalidate"},
        )

    @app.get("/api/species")
    def species_list():
        _require_set_editor()
        return [
            {"id": meta.species_id, "name": meta.name}
            for meta in sorted(
                legality_data.species.values(), key=lambda m: m.name
            )
        ]

    @app.get("/api/sets/{species_id}")
    def get_species_sets(species_id: str):
        _require_set_editor()
        meta = legality_data.species.get(species_id)
        if meta is None:
            raise HTTPException(
                status_code=404, detail=f"'{species_id}' is not a draftable species"
            )
        source_export = None
        source_label = None
        if species_id in smogon_sets:
            source = representative_smogon_set(species_id, smogon_sets)
            source_export = source.export
            source_label = source.label
        return {
            "id": species_id,
            "name": meta.name,
            "types": list(meta.types),
            "sprite_url": (
                f"{SHOWDOWN_ASSET_ROOT}/home-centered/"
                f"{_showdown_sprite_id(meta, pokedex[species_id])}.png"
            ),
            "set_source": set_source,
            "source_set_export": source_export,
            "source_set_label": source_label,
            "override_sets": list(load_set_overrides(species_id, sets_dir=SETS_DIR)),
        }

    @app.post("/api/sets/{species_id}/validate")
    def validate_species_sets(species_id: str, request: SetsRequest):
        _require_set_editor()
        if species_id not in legality_data.species:
            raise HTTPException(status_code=404, detail=f"unknown species {species_id}")
        results = _validate_set_blocks(species_id, request.sets)
        return {"ok": all(r["ok"] for r in results), "results": results}

    @app.put("/api/sets/{species_id}")
    def save_species_sets(species_id: str, request: SetsRequest):
        _require_set_editor()
        if species_id not in legality_data.species:
            raise HTTPException(status_code=404, detail=f"unknown species {species_id}")
        blocks = [block.strip() for block in request.sets if block.strip()]
        results = _validate_set_blocks(species_id, blocks)
        if not all(r["ok"] for r in results):
            # Refuse to write an invalid override file.
            raise HTTPException(
                status_code=422, detail={"ok": False, "results": results}
            )
        path = SETS_DIR / f"{species_id}.txt"
        if blocks:
            path.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")
        elif path.exists():
            path.unlink()  # no override sets left -> revert to the source set
        return {
            "ok": True,
            "results": results,
            "override_sets": list(load_set_overrides(species_id, sets_dir=SETS_DIR)),
        }

    @app.get("/api/matrix")
    def matrix():
        cells = []
        for pokemon_type in TYPES:
            for generation in GENERATIONS:
                cell = (pokemon_type, generation)
                eligible = all_cells[cell]
                cells.append(
                    {
                        "type": pokemon_type,
                        "generation": generation,
                        "included": cell in legality_data.matrix,
                        "state": (
                            "excluded"
                            if not eligible
                            else "thin"
                            if len(eligible) < draft_config.thin_cell_threshold
                            else "normal"
                        ),
                        "eligible_count": len(eligible),
                        "pokemon": [
                            _species_payload(
                                legality_data.species[species_id],
                                random_battle_sets,
                                smogon_sets,
                                set_source,
                                pokedex,
                            )
                            for species_id in eligible
                        ],
                    }
                )
        return {
            "types": list(TYPES),
            "generations": list(GENERATIONS),
            "included_cell_count": len(legality_data.matrix),
            "atom_count": len(legality_data.atoms),
            "set_source": set_source,
            "cells": cells,
        }

    @app.get("/api/bosses")
    def bosses():
        return boss_payloads()

    @app.get("/api/bosses/{boss_id}")
    def boss_detail(boss_id: str):
        try:
            return {
                "id": boss_id,
                "name": boss_name_for_id(boss_id),
                "source": "custom"
                if boss_id.startswith("custom-")
                else "edited"
                if boss_id in custom_bosses
                else "file",
                "export": boss_team_for_id(boss_id),
            }
        except BossTeamError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/bosses/custom")
    def add_custom_boss(request: CustomBossRequest):
        export_text = validate_boss_export(request.name, request.export)
        boss_id = f"custom-{uuid.uuid4().hex}"
        custom_bosses[boss_id] = {
            "id": boss_id,
            "name": request.name.strip(),
            "export": export_text,
        }
        return {
            "id": boss_id,
            "name": custom_bosses[boss_id]["name"],
            "source": "custom",
        }

    @app.put("/api/bosses/{boss_id}")
    def edit_boss(boss_id: str, request: CustomBossRequest):
        try:
            boss_team_for_id(boss_id)
        except BossTeamError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        export_text = validate_boss_export(request.name, request.export)
        custom_bosses[boss_id] = {
            "id": boss_id,
            "name": request.name.strip(),
            "export": export_text,
        }
        return {
            "id": boss_id,
            "name": custom_bosses[boss_id]["name"],
            "source": "custom" if boss_id.startswith("custom-") else "edited",
        }

    @app.post("/api/drafts")
    def start_draft(request: StartDraftRequest):
        if request.level != FIXED_LEVEL:
            raise HTTPException(
                status_code=422,
                detail=f"only fixed level {FIXED_LEVEL} is supported",
            )
        seed = request.seed if request.seed is not None else random.randrange(2**63)
        session_id = uuid.uuid4().hex
        session = DraftSession(
            draft=Draft(
                legality_data,
                rng=random.Random(seed),
                config=draft_config,
                skip_count=request.skip_count,
            ),
            assembly_rng=random.Random(seed + 1),
        )
        sessions[session_id] = session
        return serialize_session(session_id, session)

    @app.get("/api/drafts/{session_id}")
    def draft_state(session_id: str):
        return serialize_session(session_id, get_session(session_id))

    @app.post("/api/drafts/{session_id}/pick")
    def pick(session_id: str, request: PickRequest):
        session = get_session(session_id)
        try:
            session.draft.submit_pick(request.species_id)
        except DraftError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if session.draft.complete:
            session.loadout = default_loadout(session.draft.picks)
            session.team_export = assemble_from_loadout(session.loadout)
        return serialize_session(session_id, session)

    @app.post("/api/drafts/{session_id}/loadout")
    def choose_set(session_id: str, request: LoadoutRequest):
        session = get_session(session_id)
        if not session.draft.complete or session.loadout is None:
            raise HTTPException(status_code=409, detail="draft is not complete")
        if session.gauntlet_boss_ids or session.battle_result is not None:
            raise HTTPException(
                status_code=409,
                detail="loadout is locked once battles have started",
            )
        if request.species_id not in session.loadout:
            raise HTTPException(
                status_code=404, detail="species is not on the drafted team"
            )
        valid_set_ids = {
            option.set_id for option in species_set_options(request.species_id)
        }
        if request.set_id not in valid_set_ids:
            raise HTTPException(
                status_code=422, detail="unknown set for this species"
            )
        session.loadout[request.species_id] = request.set_id
        session.team_export = assemble_from_loadout(session.loadout)
        return serialize_session(session_id, session)

    @app.post("/api/drafts/{session_id}/skip")
    def skip(session_id: str):
        session = get_session(session_id)
        try:
            session.draft.use_skip()
        except DraftError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return serialize_session(session_id, session)

    @app.post("/api/drafts/{session_id}/thin-reroll")
    def thin_reroll(session_id: str):
        session = get_session(session_id)
        try:
            session.draft.use_thin_reroll()
        except DraftError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return serialize_session(session_id, session)

    @app.post("/api/drafts/{session_id}/battle")
    def battle(session_id: str, request: BattleRequest):
        session = get_session(session_id)
        if not session.draft.complete or session.team_export is None:
            raise HTTPException(status_code=409, detail="draft is not complete")
        try:
            boss_team = boss_team_for_id(request.boss_id)
            boss_name = boss_name_for_id(request.boss_id)
            verify_team_entities_exist(
                player=session.team_export,
                boss=boss_team,
            )
            session.battle_result = _run_battle_with_retry(
                lambda: battle_fn(
                    session.team_export,
                    boss_team,
                    battle_config_factory(),
                    player_name=os.environ.get("ROLLMONS_PLAYER_NAME", "Player"),
                    boss_name=boss_name,
                )
            )
        except BossTeamError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except BattleEntityNotFoundError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except (RuntimeError, OSError, ValueError) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return serialize_session(session_id, session)

    @app.post("/api/drafts/{session_id}/gauntlet/start")
    def start_gauntlet(session_id: str, request: GauntletStartRequest):
        session = get_session(session_id)
        if not session.draft.complete or session.team_export is None:
            raise HTTPException(status_code=409, detail="draft is not complete")
        boss_ids = tuple(
            list_boss_ids() if request.boss_ids is None else request.boss_ids
        )
        if len(boss_ids) < BOSS_ORDER_MIN:
            raise HTTPException(status_code=404, detail="no boss teams found")
        if len(boss_ids) > BOSS_ORDER_MAX:
            raise HTTPException(
                status_code=422,
                detail=f"boss rush supports at most {BOSS_ORDER_MAX} bosses",
            )
        session.campaign_teams = None
        session.gauntlet_boss_ids = boss_ids
        session.gauntlet_next_index = 0
        session.gauntlet_results = []
        session.gauntlet_stop_on_loss = request.stop_on_loss
        (
            session.gauntlet_damage_by_species,
            session.gauntlet_damage_display,
        ) = _seed_damage_tracking(
            [legality_data.species[species_id].name for species_id in session.draft.picks]
        )
        return serialize_session(session_id, session)

    @app.post("/api/drafts/{session_id}/campaign/start")
    def start_campaign(session_id: str, request: GauntletStartRequest):
        session = get_session(session_id)
        if not session.draft.complete or session.team_export is None:
            raise HTTPException(status_code=409, detail="draft is not complete")
        from rollmons.pool_loader import PoolError, build_campaign

        try:
            campaign = build_campaign()
        except PoolError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        session.campaign_teams = {battle.team_id: battle.export for battle in campaign}
        session.gauntlet_boss_ids = tuple(battle.team_id for battle in campaign)
        session.gauntlet_next_index = 0
        session.gauntlet_results = []
        session.gauntlet_stop_on_loss = request.stop_on_loss
        (
            session.gauntlet_damage_by_species,
            session.gauntlet_damage_display,
        ) = _seed_damage_tracking(
            [legality_data.species[species_id].name for species_id in session.draft.picks]
        )
        return serialize_session(session_id, session)

    @app.post("/api/drafts/{session_id}/gauntlet/next")
    def next_gauntlet_battle(session_id: str):
        session = get_session(session_id)
        if not session.draft.complete or session.team_export is None:
            raise HTTPException(status_code=409, detail="draft is not complete")
        if not session.gauntlet_boss_ids:
            raise HTTPException(status_code=409, detail="gauntlet has not started")
        if session.gauntlet_next_index >= len(session.gauntlet_boss_ids):
            return serialize_session(session_id, session)
        boss_id = session.gauntlet_boss_ids[session.gauntlet_next_index]
        try:
            boss_team = resolve_boss_team(session, boss_id)
            boss_name = resolve_boss_name(session, boss_id)
            verify_team_entities_exist(
                player=session.team_export,
                boss=boss_team,
            )
            result = _run_battle_with_retry(
                lambda: battle_fn(
                    session.team_export,
                    boss_team,
                    battle_config_factory(),
                    player_name=os.environ.get("ROLLMONS_PLAYER_NAME", "Player"),
                    boss_name=boss_name,
                )
            )
        except BossTeamError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except BattleEntityNotFoundError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except (RuntimeError, OSError, ValueError) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if session.gauntlet_results is None:
            session.gauntlet_results = []
        session.gauntlet_results.append(result)
        if (
            session.gauntlet_damage_by_species is None
            or session.gauntlet_damage_display is None
        ):
            (
                session.gauntlet_damage_by_species,
                session.gauntlet_damage_display,
            ) = _seed_damage_tracking(
                [
                    legality_data.species[species_id].name
                    for species_id in session.draft.picks
                ]
            )
        _accumulate_player_damage(
            session.gauntlet_damage_by_species,
            session.gauntlet_damage_display,
            result,
        )
        session.battle_result = result
        session.gauntlet_next_index += 1
        if session.gauntlet_stop_on_loss and result.winner != "player":
            session.gauntlet_next_index = len(session.gauntlet_boss_ids)
        return serialize_session(session_id, session)

    return app


app = create_app()
