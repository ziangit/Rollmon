"""Pure six-round draft mechanics built on the legality matrix."""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Protocol, Sequence

from rollmons.draft_config import DraftConfig, default_draft_config
from rollmons.legality_matrix import (
    Cell,
    LegalityData,
    select_species,
    selection_weight,
    selection_probabilities,
)

TEAM_SIZE = 6


class DraftRandomSource(Protocol):
    def choice(self, sequence: Sequence[Cell]) -> Cell: ...

    def choices(
        self,
        population: Sequence[str],
        weights: Sequence[float],
        *,
        k: int,
    ) -> list[str]: ...


class DraftError(ValueError):
    """Base class for invalid draft operations."""


class DraftCompleteError(DraftError):
    pass


class InvalidPickError(DraftError):
    pass


class NoSkipsRemainingError(DraftError):
    pass


class ThinRerollUnavailableError(DraftError):
    pass


class DraftPoolExhaustedError(DraftError):
    pass


@dataclass(frozen=True)
class DraftOffer:
    round_number: int
    cell: Cell
    candidates: tuple[str, ...]
    suggested_species: str
    selection_probabilities: dict[str, float]
    skips_remaining: int
    thin_reroll_available: bool


class Draft:
    """Stateful draft that exposes offers while leaving picks to the chooser."""

    def __init__(
        self,
        legality_data: LegalityData,
        *,
        rng: DraftRandomSource | None = None,
        config: DraftConfig | None = None,
        skip_count: int | None = None,
        legendary_weight: float | None = None,
        arceus_weight: float | None = None,
        candidate_cap: int | None = None,
        thin_cell_threshold: int | None = None,
    ):
        draft_config = config or default_draft_config()
        skip_count = (
            draft_config.manual_skip_count if skip_count is None else skip_count
        )
        legendary_weight = (
            draft_config.legendary_weight
            if legendary_weight is None
            else legendary_weight
        )
        arceus_weight = (
            draft_config.arceus_weight if arceus_weight is None else arceus_weight
        )
        candidate_cap = (
            draft_config.candidate_cap if candidate_cap is None else candidate_cap
        )
        thin_cell_threshold = (
            draft_config.thin_cell_threshold
            if thin_cell_threshold is None
            else thin_cell_threshold
        )
        if skip_count < 0:
            raise ValueError("skip_count cannot be negative")
        if legendary_weight <= 0:
            raise ValueError("legendary_weight must be greater than zero")
        if arceus_weight <= 0:
            raise ValueError("arceus_weight must be greater than zero")
        if candidate_cap < 1:
            raise ValueError("candidate_cap must be positive")
        if thin_cell_threshold < 1:
            raise ValueError("thin_cell_threshold must be positive")
        available_species = {
            species_id
            for candidates in legality_data.matrix.values()
            for species_id in candidates
        }
        if len(available_species) < TEAM_SIZE:
            raise DraftPoolExhaustedError(
                f"draft requires {TEAM_SIZE} unique species, found "
                f"{len(available_species)}"
            )
        self._legality_data = legality_data
        self._rng = rng or random
        self._legendary_weight = legendary_weight
        self._arceus_weight = arceus_weight
        self._candidate_cap = candidate_cap
        self._thin_cell_threshold = thin_cell_threshold
        self._skips_remaining = skip_count
        self._picks: list[str] = []
        self._current_offer = self._roll_offer()

    @property
    def picks(self) -> tuple[str, ...]:
        return tuple(self._picks)

    @property
    def skips_remaining(self) -> int:
        return self._skips_remaining

    @property
    def complete(self) -> bool:
        return len(self._picks) == TEAM_SIZE

    @property
    def current_offer(self) -> DraftOffer | None:
        return self._current_offer

    def submit_pick(self, species_id: str) -> DraftOffer | None:
        if self.complete or self._current_offer is None:
            raise DraftCompleteError("draft is already complete")
        if species_id not in self._current_offer.candidates:
            raise InvalidPickError(
                f"{species_id} is not eligible for {self._current_offer.cell}"
            )
        self._picks.append(species_id)
        self._current_offer = None if self.complete else self._roll_offer()
        return self._current_offer

    def use_skip(self) -> DraftOffer:
        if self.complete:
            raise DraftCompleteError("draft is already complete")
        if self._skips_remaining <= 0:
            raise NoSkipsRemainingError("no skips remaining")
        previous_cell = self._current_offer.cell if self._current_offer else None
        self._skips_remaining -= 1
        self._current_offer = self._roll_offer(exclude_cell=previous_cell)
        return self._current_offer

    def use_thin_reroll(self) -> DraftOffer:
        if self.complete or self._current_offer is None:
            raise DraftCompleteError("draft is already complete")
        if not self._current_offer.thin_reroll_available:
            raise ThinRerollUnavailableError(
                "thin-cell reroll requires an offer with 1-2 candidates"
            )
        previous_cell = self._current_offer.cell
        self._current_offer = self._roll_offer(exclude_cell=previous_cell)
        return self._current_offer

    def _undrafted_candidates(self, cell: Cell) -> tuple[str, ...]:
        drafted = set(self._picks)
        return tuple(
            species_id
            for species_id in self._legality_data.matrix[cell]
            if species_id not in drafted
        )

    def _offer_candidates(self, candidates: tuple[str, ...]) -> tuple[str, ...]:
        if len(candidates) <= self._candidate_cap:
            return candidates
        remaining = list(candidates)
        offered = []
        while remaining and len(offered) < self._candidate_cap:
            weights = [
                selection_weight(
                    self._legality_data.species[species_id],
                    legendary_weight=self._legendary_weight,
                    arceus_weight=self._arceus_weight,
                )
                for species_id in remaining
            ]
            selected = self._rng.choices(remaining, weights, k=1)[0]
            offered.append(selected)
            remaining.remove(selected)
        return tuple(sorted(offered))

    def _fillable_cells(self) -> tuple[Cell, ...]:
        return tuple(
            cell
            for cell in self._legality_data.matrix
            if self._undrafted_candidates(cell)
        )

    def _roll_offer(self, *, exclude_cell: Cell | None = None) -> DraftOffer:
        fillable = self._fillable_cells()
        if not fillable:
            raise DraftPoolExhaustedError(
                f"no undrafted species remain before round {len(self._picks) + 1}"
            )
        alternatives = tuple(cell for cell in fillable if cell != exclude_cell)
        selectable = alternatives or fillable
        cell = self._rng.choice(selectable)
        cell_candidates = self._undrafted_candidates(cell)
        offered_candidates = self._offer_candidates(cell_candidates)
        suggested = select_species(
            cell,
            {cell: offered_candidates},
            self._legality_data.species,
            rng=self._rng,
            legendary_weight=self._legendary_weight,
            arceus_weight=self._arceus_weight,
        )
        probabilities = selection_probabilities(
            cell,
            {cell: offered_candidates},
            self._legality_data.species,
            legendary_weight=self._legendary_weight,
            arceus_weight=self._arceus_weight,
        )
        return DraftOffer(
            round_number=len(self._picks) + 1,
            cell=cell,
            candidates=offered_candidates,
            suggested_species=suggested,
            selection_probabilities=probabilities,
            skips_remaining=self._skips_remaining,
            thin_reroll_available=len(cell_candidates) < self._thin_cell_threshold,
        )
