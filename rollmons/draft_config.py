"""Playtest-tunable draft mechanics.

These values are intentionally centralized so pool/skip behavior can be tuned
without changing draft or matrix logic. Environment variables override the
checked-in playtest defaults:

- ROLLMONS_DRAFT_CANDIDATE_CAP: max offered candidates from one cell.
- ROLLMONS_DRAFT_LEGENDARY_WEIGHT: relative legendary offer/suggestion weight.
- ROLLMONS_DRAFT_MANUAL_SKIPS: manual cell skips per draft.
- ROLLMONS_DRAFT_THIN_CELL_THRESHOLD: cells below this size get a free reroll.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class DraftConfig:
    candidate_cap: int = 5
    legendary_weight: float = 0.10
    manual_skip_count: int = 2
    thin_cell_threshold: int = 3

    def __post_init__(self) -> None:
        if self.candidate_cap < 1:
            raise ValueError("candidate_cap must be positive")
        if self.legendary_weight <= 0:
            raise ValueError("legendary_weight must be greater than zero")
        if self.manual_skip_count < 0:
            raise ValueError("manual_skip_count cannot be negative")
        if self.thin_cell_threshold < 1:
            raise ValueError("thin_cell_threshold must be positive")


def _int_from_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return default if raw is None else int(raw)


def _float_from_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return default if raw is None else float(raw)


def default_draft_config() -> DraftConfig:
    base = DraftConfig()
    return DraftConfig(
        candidate_cap=_int_from_env(
            "ROLLMONS_DRAFT_CANDIDATE_CAP",
            base.candidate_cap,
        ),
        legendary_weight=_float_from_env(
            "ROLLMONS_DRAFT_LEGENDARY_WEIGHT",
            base.legendary_weight,
        ),
        manual_skip_count=_int_from_env(
            "ROLLMONS_DRAFT_MANUAL_SKIPS",
            base.manual_skip_count,
        ),
        thin_cell_threshold=_int_from_env(
            "ROLLMONS_DRAFT_THIN_CELL_THRESHOLD",
            base.thin_cell_threshold,
        ),
    )
