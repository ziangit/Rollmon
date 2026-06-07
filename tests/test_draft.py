import random

import pytest

from rollmons.draft import (
    Draft,
    DraftCompleteError,
    NoSkipsRemainingError,
    TEAM_SIZE,
)
from rollmons.legality_matrix import LegalityData, SpeciesMetadata, build_legality_data


def play_suggestions(draft):
    offers = []
    while not draft.complete:
        offer = draft.current_offer
        offers.append(offer)
        draft.submit_pick(offer.suggested_species)
    return offers


class FirstChoiceRng:
    def choice(self, sequence):
        return sequence[0]

    def choices(self, population, weights, *, k):
        return [population[0]]


def test_full_seeded_draft_completes_without_duplicates():
    draft = Draft(build_legality_data(), rng=random.Random(1001))

    offers = play_suggestions(draft)

    assert len(offers) == TEAM_SIZE
    assert len(draft.picks) == TEAM_SIZE
    assert len(set(draft.picks)) == TEAM_SIZE
    assert draft.current_offer is None
    with pytest.raises(DraftCompleteError):
        draft.submit_pick(draft.picks[0])


def test_seeded_draft_is_reproducible():
    first = Draft(build_legality_data(), rng=random.Random(90210))
    second = Draft(build_legality_data(), rng=random.Random(90210))

    first_offers = play_suggestions(first)
    second_offers = play_suggestions(second)

    assert [(offer.cell, offer.suggested_species) for offer in first_offers] == [
        (offer.cell, offer.suggested_species) for offer in second_offers
    ]
    assert first.picks == second.picks


def test_drafted_species_is_removed_from_all_later_offers():
    draft = Draft(build_legality_data(), rng=random.Random(77))
    first_pick = draft.current_offer.suggested_species
    draft.submit_pick(first_pick)

    while not draft.complete:
        offer = draft.current_offer
        assert first_pick not in offer.candidates
        draft.submit_pick(offer.suggested_species)


def test_near_exhausted_cell_is_never_offered():
    species = {
        species_id: SpeciesMetadata(
            species_id=species_id,
            name=species_id,
            types=("fire", "water") if species_id == "shared" else ("water",),
            debut_generation=1,
            legendary=False,
        )
        for species_id in ("shared", "two", "three", "four", "five", "six")
    }
    data = LegalityData(
        atoms=tuple(species),
        species=species,
        matrix={
            ("fire", 1): ("shared",),
            ("water", 1): tuple(species),
        },
    )

    draft = Draft(data, rng=FirstChoiceRng(), skip_count=0)
    assert draft.current_offer.cell == ("fire", 1)
    draft.submit_pick("shared")

    while not draft.complete:
        offer = draft.current_offer
        assert offer.cell == ("water", 1)
        assert offer.candidates
        assert "shared" not in offer.candidates
        draft.submit_pick(offer.candidates[0])


def test_skip_rerolls_cell_and_is_bounded():
    draft = Draft(build_legality_data(), rng=random.Random(14), skip_count=1)
    original_cell = draft.current_offer.cell

    replacement = draft.use_skip()

    assert replacement.cell != original_cell
    assert draft.skips_remaining == 0
    assert replacement.skips_remaining == 0
    with pytest.raises(NoSkipsRemainingError):
        draft.use_skip()


def test_offer_exposes_full_candidate_list_and_soft_suggestion():
    data = build_legality_data()
    draft = Draft(data, rng=random.Random(5))
    offer = draft.current_offer

    assert offer.candidates == data.matrix[offer.cell]
    assert offer.suggested_species in offer.candidates
