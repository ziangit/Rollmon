"""Local single-user development harness for inspecting and exercising drafts."""

from __future__ import annotations

import json
import os
import random
import re
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

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
    verify_team_entities_exist,
)
from rollmons.team_assembly import (
    DEFAULT_IVS,
    FIXED_LEVEL,
    NEUTRAL_EVS,
    NEUTRAL_NATURE,
    STATS,
    assemble_team,
    load_random_battle_sets,
    representative_random_battle_set,
    representative_smogon_set,
)

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
    skip_count: int = Field(default=1, ge=0)
    seed: int | None = None


class PickRequest(BaseModel):
    species_id: str


class BattleRequest(BaseModel):
    boss_id: str = "ash"


class GauntletStartRequest(BaseModel):
    boss_ids: list[str] | None = None


@dataclass
class DraftSession:
    draft: Draft
    assembly_rng: random.Random
    team_export: str | None = None
    battle_result: Any | None = None
    gauntlet_boss_ids: tuple[str, ...] = ()
    gauntlet_next_index: int = 0
    gauntlet_results: list[Any] | None = None


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
        search_parallelism=int(os.environ.get("ROLLMONS_SEARCH_PARALLELISM", "1")),
        search_threads=int(os.environ.get("ROLLMONS_SEARCH_THREADS", "1")),
    )


def _run_live_battle(*args, **kwargs):
    from battle_runner import run_battle

    return run_battle(*args, **kwargs)


def _gauntlet_payload(session: DraftSession) -> dict:
    boss_ids = session.gauntlet_boss_ids
    next_index = session.gauntlet_next_index
    results = session.gauntlet_results or []
    return {
        "bosses": [
            {
                "id": boss_id,
                "name": boss_display_name(boss_id),
                "complete": index < next_index,
                "current": index == next_index and next_index < len(boss_ids),
            }
            for index, boss_id in enumerate(boss_ids)
        ],
        "next_index": next_index,
        "complete": bool(boss_ids) and next_index >= len(boss_ids),
        "results": [asdict(result) for result in results],
    }


def _species_payload(
    metadata: SpeciesMetadata,
    random_battle_sets,
    smogon_sets,
    set_source: str,
    pokedex,
) -> dict:
    if set_source == "smogon" and metadata.species_id in smogon_sets:
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
    legality_data = build_legality_data()
    all_cells = build_all_cells(legality_data.species)
    random_battle_sets = load_random_battle_sets()
    smogon_sets = load_usable_smogon_sets() if set_source == "smogon" else {}
    pokedex = json.loads(DEFAULT_POKEDEX_PATH.read_text(encoding="utf-8"))
    sessions: dict[str, DraftSession] = {}
    app = FastAPI(title="rollmons draft harness")
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    def get_session(session_id: str) -> DraftSession:
        session = sessions.get(session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="draft session not found")
        return session

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
            ),
            "skips_remaining": draft.skips_remaining,
            "team_export": session.team_export,
            "battle_result": (
                asdict(session.battle_result)
                if session.battle_result is not None
                else None
            ),
            "gauntlet": _gauntlet_payload(session),
        }

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC_DIR / "index.html")

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
                            if len(eligible) <= 2
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
        return [
            {
                "id": boss_id,
                "name": boss_display_name(boss_id),
            }
            for boss_id in list_boss_ids()
        ]

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
            session.team_export = assemble_team(
                session.draft.picks,
                rng=session.assembly_rng,
            )
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
            boss_team = load_boss_team(request.boss_id)
            boss_name = boss_display_name(request.boss_id)
            verify_team_entities_exist(
                player=session.team_export,
                boss=boss_team,
            )
            session.battle_result = battle_fn(
                session.team_export,
                boss_team,
                battle_config_factory(),
                player_name=os.environ.get("ROLLMONS_PLAYER_NAME", "Player"),
                boss_name=boss_name,
            )
        except BossTeamError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except BattleEntityNotFoundError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except (RuntimeError, OSError, ValueError) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return serialize_session(session_id, session)

    def validate_gauntlet(session: DraftSession, boss_ids: tuple[str, ...]) -> None:
        errors = []
        for boss_id in boss_ids:
            try:
                boss_team = load_boss_team(boss_id)
                verify_team_entities_exist(
                    player=session.team_export or "",
                    boss=boss_team,
                )
            except (BossTeamError, BattleEntityNotFoundError) as exc:
                errors.append(f"{boss_id}: {exc}")
        if errors:
            raise HTTPException(
                status_code=422,
                detail="invalid gauntlet boss team(s): " + "; ".join(errors),
            )

    @app.post("/api/drafts/{session_id}/gauntlet/start")
    def start_gauntlet(session_id: str, request: GauntletStartRequest):
        session = get_session(session_id)
        if not session.draft.complete or session.team_export is None:
            raise HTTPException(status_code=409, detail="draft is not complete")
        boss_ids = tuple(request.boss_ids or list_boss_ids())
        if not boss_ids:
            raise HTTPException(status_code=404, detail="no boss teams found")
        validate_gauntlet(session, boss_ids)
        session.gauntlet_boss_ids = boss_ids
        session.gauntlet_next_index = 0
        session.gauntlet_results = []
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
            boss_team = load_boss_team(boss_id)
            boss_name = boss_display_name(boss_id)
            verify_team_entities_exist(
                player=session.team_export,
                boss=boss_team,
            )
            result = battle_fn(
                session.team_export,
                boss_team,
                battle_config_factory(),
                player_name=os.environ.get("ROLLMONS_PLAYER_NAME", "Player"),
                boss_name=boss_name,
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
        session.battle_result = result
        session.gauntlet_next_index += 1
        return serialize_session(session_id, session)

    return app


app = create_app()
