"""Pure six-round draft mechanics built on the legality matrix."""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Protocol, Sequence

from rollmons.legality_matrix import (
    DEFAULT_LEGENDARY_WEIGHT,
    Cell,
    LegalityData,
    select_species,
    selection_probabilities,
)

TEAM_SIZE = 6
DEFAULT_SKIP_COUNT = 1


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


class Draft:
    """Stateful draft that exposes offers while leaving picks to the chooser."""

    def __init__(
        self,
        legality_data: LegalityData,
        *,
        rng: DraftRandomSource | None = None,
        skip_count: int = DEFAULT_SKIP_COUNT,
        legendary_weight: float = DEFAULT_LEGENDARY_WEIGHT,
    ):
        if skip_count < 0:
            raise ValueError("skip_count cannot be negative")
        if legendary_weight <= 0:
            raise ValueError("legendary_weight must be greater than zero")
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

    def _undrafted_candidates(self, cell: Cell) -> tuple[str, ...]:
        drafted = set(self._picks)
        return tuple(
            species_id
            for species_id in self._legality_data.matrix[cell]
            if species_id not in drafted
        )

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
        candidates = self._undrafted_candidates(cell)
        suggested = select_species(
            cell,
            {cell: candidates},
            self._legality_data.species,
            rng=self._rng,
            legendary_weight=self._legendary_weight,
        )
        probabilities = selection_probabilities(
            cell,
            {cell: candidates},
            self._legality_data.species,
            legendary_weight=self._legendary_weight,
        )
        return DraftOffer(
            round_number=len(self._picks) + 1,
            cell=cell,
            candidates=candidates,
            suggested_species=suggested,
            selection_probabilities=probabilities,
            skips_remaining=self._skips_remaining,
        )
