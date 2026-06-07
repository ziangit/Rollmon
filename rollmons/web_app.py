"""Local single-user development harness for inspecting and exercising drafts."""

from __future__ import annotations

import random
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from rollmons.draft import Draft, DraftError, DraftOffer
from rollmons.legality_matrix import (
    GENERATIONS,
    TYPES,
    LegalityData,
    SpeciesMetadata,
    build_all_cells,
    build_legality_data,
)
from rollmons.team_assembly import FIXED_LEVEL, assemble_team

STATIC_DIR = Path(__file__).resolve().parent / "web_static"


class StartDraftRequest(BaseModel):
    level: int = FIXED_LEVEL
    skip_count: int = Field(default=1, ge=0)
    seed: int | None = None


class PickRequest(BaseModel):
    species_id: str


@dataclass
class DraftSession:
    draft: Draft
    assembly_rng: random.Random
    team_export: str | None = None


def _species_payload(metadata: SpeciesMetadata) -> dict:
    return {
        "id": metadata.species_id,
        "name": metadata.name,
        "types": list(metadata.types),
        "debut_generation": metadata.debut_generation,
        "legendary": metadata.legendary,
        "legendary_tags": list(metadata.legendary_tags),
    }


def _offer_payload(
    offer: DraftOffer | None,
    legality_data: LegalityData,
) -> dict | None:
    if offer is None:
        return None
    return {
        "round_number": offer.round_number,
        "cell": {"type": offer.cell[0], "generation": offer.cell[1]},
        "candidates": [
            _species_payload(legality_data.species[species_id])
            for species_id in offer.candidates
        ],
        "suggested_species": offer.suggested_species,
        "skips_remaining": offer.skips_remaining,
    }


def create_app() -> FastAPI:
    legality_data = build_legality_data()
    all_cells = build_all_cells(legality_data.species)
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
                _species_payload(legality_data.species[species_id])
                for species_id in draft.picks
            ],
            "offer": _offer_payload(draft.current_offer, legality_data),
            "skips_remaining": draft.skips_remaining,
            "team_export": session.team_export,
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
                            _species_payload(legality_data.species[species_id])
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

    return app


app = create_app()
