"""Local single-user development harness for inspecting and exercising drafts."""

from __future__ import annotations

import json
import os
import random
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from battle_runner import (
    BattleEntityNotFoundError,
    BattleResult,
    BattleRunnerConfig,
    BattleRunnerError,
    result_as_dict,
    run_battle,
    verify_team_entities_exist,
)
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from rollmons.boss_loader import BossTeamError, load_boss_team
from rollmons.draft import Draft, DraftError, DraftOffer
from rollmons.legality_matrix import (
    DEFAULT_POKEDEX_PATH,
    GENERATIONS,
    TYPES,
    LegalityData,
    SpeciesMetadata,
    build_all_cells,
    build_legality_data,
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
    sprite_number = SHOWDOWN_ITEM_SPRITE_NUMBERS[item_id]
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


@dataclass
class DraftSession:
    draft: Draft
    assembly_rng: random.Random
    team_export: str | None = None
    battle_result: BattleResult | None = None


def _battle_config_from_environment() -> BattleRunnerConfig:
    log_dir = os.environ.get("ROLLMONS_SHOWDOWN_LOG_DIR")
    if not log_dir:
        raise BattleRunnerError(
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


def _species_payload(
    metadata: SpeciesMetadata,
    random_battle_sets,
    pokedex,
) -> dict:
    representative = representative_random_battle_set(
        metadata.species_id,
        random_battle_sets,
    )
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
        "randbats_set": {
            "item": representative.item,
            "ability": representative.ability,
            "moves": list(representative.moves),
            "observed_count": representative.observed_count,
            "role_count": len(random_battle_sets[metadata.species_id]),
            "item_icon": _item_icon_payload(representative.item),
        },
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
    }
    for species_id in offer.candidates:
        candidate = _species_payload(
            legality_data.species[species_id],
            random_battle_sets,
            pokedex,
        )
        candidate["selection_probability"] = offer.selection_probabilities[species_id]
        payload["candidates"].append(candidate)
    return payload


def create_app(
    *,
    battle_fn: Callable[[str, str, BattleRunnerConfig], BattleResult] = run_battle,
    battle_config_factory: Callable[[], BattleRunnerConfig] = (
        _battle_config_from_environment
    ),
) -> FastAPI:
    legality_data = build_legality_data()
    all_cells = build_all_cells(legality_data.species)
    random_battle_sets = load_random_battle_sets()
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
                    pokedex,
                )
                for species_id in draft.picks
            ],
            "offer": _offer_payload(
                draft.current_offer,
                legality_data,
                random_battle_sets,
                pokedex,
            ),
            "skips_remaining": draft.skips_remaining,
            "team_export": session.team_export,
            "battle_result": (
                result_as_dict(session.battle_result)
                if session.battle_result is not None
                else None
            ),
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
                        "eligible_count": len(eligible),
                        "pokemon": [
                            _species_payload(
                                legality_data.species[species_id],
                                random_battle_sets,
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
            "cells": cells,
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

    @app.post("/api/drafts/{session_id}/battle")
    def battle(session_id: str, request: BattleRequest):
        session = get_session(session_id)
        if not session.draft.complete or session.team_export is None:
            raise HTTPException(status_code=409, detail="draft is not complete")
        try:
            boss_team = load_boss_team(request.boss_id)
            verify_team_entities_exist(
                player=session.team_export,
                boss=boss_team,
            )
            session.battle_result = battle_fn(
                session.team_export,
                boss_team,
                battle_config_factory(),
            )
        except BossTeamError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except BattleEntityNotFoundError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except (BattleRunnerError, OSError, ValueError) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return serialize_session(session_id, session)

    return app


app = create_app()
