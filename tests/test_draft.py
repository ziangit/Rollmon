import random

import pytest

from rollmons.draft_config import DraftConfig
from rollmons.draft import (
    Draft,
    DraftCompleteError,
    NoSkipsRemainingError,
    TEAM_SIZE,
    ThinRerollUnavailableError,
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


class FirstCellWeightedRng(random.Random):
    def choice(self, sequence):
        return sequence[0]


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
            base_stat_total=500,
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
    draft = Draft(build_legality_data(), rng=random.Random(14), skip_count=2)
    original_cell = draft.current_offer.cell

    first_replacement = draft.use_skip()
    second_replacement = draft.use_skip()

    assert first_replacement.cell != original_cell
    assert second_replacement.cell
    assert draft.skips_remaining == 0
    assert second_replacement.skips_remaining == 0
    with pytest.raises(NoSkipsRemainingError):
        draft.use_skip()


def test_thin_landing_offers_free_reroll_without_consuming_skip():
    species = {
        species_id: SpeciesMetadata(
            species_id=species_id,
            name=species_id,
            types=("fire",) if species_id == "thin" else ("water",),
            debut_generation=1,
            base_stat_total=500,
            legendary=False,
        )
        for species_id in ("thin", "two", "three", "four", "five", "six", "seven")
    }
    data = LegalityData(
        atoms=tuple(species),
        species=species,
        matrix={
            ("fire", 1): ("thin",),
            ("water", 1): tuple(
                species_id for species_id in species if species_id != "thin"
            ),
        },
    )
    draft = Draft(data, rng=FirstChoiceRng(), skip_count=2)

    assert draft.current_offer.thin_reroll_available
    replacement = draft.use_thin_reroll()

    assert replacement.cell == ("water", 1)
    assert not replacement.thin_reroll_available
    assert draft.skips_remaining == 2
    with pytest.raises(ThinRerollUnavailableError):
        draft.use_thin_reroll()


def test_thin_reroll_does_not_accumulate_skip_currency():
    species = {
        species_id: SpeciesMetadata(
            species_id=species_id,
            name=species_id,
            types=("fire",) if species_id == "thin" else ("water",),
            debut_generation=1,
            base_stat_total=500,
            legendary=False,
        )
        for species_id in ("thin", "two", "three", "four", "five", "six", "seven")
    }
    data = LegalityData(
        atoms=tuple(species),
        species=species,
        matrix={
            ("fire", 1): ("thin",),
            ("water", 1): tuple(
                species_id for species_id in species if species_id != "thin"
            ),
        },
    )
    draft = Draft(data, rng=FirstChoiceRng(), skip_count=0)

    assert draft.current_offer.thin_reroll_available
    draft.use_thin_reroll()

    assert draft.skips_remaining == 0
    with pytest.raises(NoSkipsRemainingError):
        draft.use_skip()


def test_offer_caps_overstuffed_cell_to_configured_candidate_count():
    species = {
        species_id: SpeciesMetadata(
            species_id=species_id,
            name=species_id,
            types=("water",),
            debut_generation=1,
            base_stat_total=500,
            legendary=False,
        )
        for species_id in (
            "eight",
            "five",
            "four",
            "nine",
            "one",
            "seven",
            "six",
            "three",
            "two",
        )
    }
    data = LegalityData(
        atoms=tuple(species),
        species=species,
        matrix={("water", 1): tuple(species), ("fire", 1): ("one",)},
    )
    draft = Draft(
        data,
        rng=FirstChoiceRng(),
        config=DraftConfig(candidate_cap=5),
    )

    assert len(draft.current_offer.candidates) == 5
    assert set(draft.current_offer.candidates).issubset(species)


def test_small_cells_are_not_candidate_capped():
    species = {
        species_id: SpeciesMetadata(
            species_id=species_id,
            name=species_id,
            types=("water",),
            debut_generation=1,
            base_stat_total=500,
            legendary=False,
        )
        for species_id in ("one", "two", "three", "four", "five")
    }
    species["extra"] = SpeciesMetadata(
        species_id="extra",
        name="extra",
        types=("fire",),
        debut_generation=1,
        base_stat_total=500,
        legendary=False,
    )
    data = LegalityData(
        atoms=tuple(species),
        species=species,
        matrix={
            ("water", 1): ("one", "two", "three", "four", "five"),
            ("fire", 1): ("extra",),
        },
    )
    draft = Draft(
        data,
        rng=FirstChoiceRng(),
        config=DraftConfig(candidate_cap=5),
    )

    assert draft.current_offer.candidates == data.matrix[("water", 1)]


def test_offer_cap_uses_legendary_weight_for_candidate_sampling():
    species = {
        "normal": SpeciesMetadata(
            species_id="normal",
            name="normal",
            types=("water",),
            debut_generation=1,
            base_stat_total=500,
            legendary=False,
        ),
        "legend": SpeciesMetadata(
            species_id="legend",
            name="legend",
            types=("water",),
            debut_generation=1,
            base_stat_total=700,
            legendary=True,
        ),
        **{
            f"extra{index}": SpeciesMetadata(
                species_id=f"extra{index}",
                name=f"extra{index}",
                types=("fire",),
                debut_generation=1,
                base_stat_total=500,
                legendary=False,
            )
            for index in range(4)
        },
    }
    data = LegalityData(
        atoms=tuple(species),
        species=species,
        matrix={
            ("water", 1): ("normal", "legend"),
            ("fire", 1): tuple(f"extra{index}" for index in range(4)),
        },
    )
    rng = FirstCellWeightedRng(12345)
    picks = [
        Draft(
            data,
            rng=rng,
            config=DraftConfig(candidate_cap=1, legendary_weight=0.10),
        ).current_offer.candidates[0]
        for _ in range(5_000)
    ]
    ratio = picks.count("legend") / picks.count("normal")

    assert ratio == pytest.approx(0.10, abs=0.025)


def test_offer_exposes_capped_candidate_list_and_soft_suggestion():
    data = build_legality_data()
    draft = Draft(data, rng=random.Random(5))
    offer = draft.current_offer

    assert set(offer.candidates).issubset(data.matrix[offer.cell])
    assert 1 <= len(offer.candidates) <= DraftConfig().candidate_cap
    assert offer.suggested_species in offer.candidates
    assert set(offer.selection_probabilities) == set(offer.candidates)
    assert sum(offer.selection_probabilities.values()) == pytest.approx(1)
