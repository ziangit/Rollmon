"""Discover tiered boss pools and build a randomized 10-battle campaign.

Pure game logic: reads the checked-in ``rollmons/pool/<tier>/*.txt`` team
exports and selects opponents for a run. Does not import ``fp/`` and does not
require a battle stack. The selected teams are handed to the existing
``battle_runner.run_battle()`` seam by the caller, exactly like authored bosses.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Sequence

POOL_DIR = Path(__file__).resolve().parent / "pool"

# Ordered (tier directory, number of battles drawn from it). Sums to a fixed
# ten-battle campaign that climbs in difficulty:
#   1   level_1   cakewalk pool          (1)
#   2   level_2   meme pool              (1)
#   3   level_3   Red, fixed homage      (1)
#   4-6 middle    evil-leader pool       (3, sampled without replacement)
#   7-9 advanced  ladder-team pool       (3, sampled without replacement)
#   10  level_10  Air, fixed finale      (1)
# "Middle" and "Advanced" are act bands: each contributes several battles drawn
# from one pool, so runs vary while difficulty still climbs band to band.
CAMPAIGN_STRUCTURE: tuple[tuple[str, int], ...] = (
    ("level_1", 1),
    ("level_2", 1),
    ("level_3", 1),
    ("middle", 3),
    ("advanced", 3),
    ("level_10", 1),
)


class PoolError(ValueError):
    """Raised when the checked-in pool cannot satisfy the campaign structure."""


class CampaignRandomSource(Protocol):
    def sample(self, population: Sequence[str], k: int) -> list[str]: ...


@dataclass(frozen=True)
class CampaignBattle:
    order: int  # 1-based battle position in the run
    tier: str
    team_id: str  # file stem, e.g. "Cynthia"
    export: str  # the six-member Showdown export


def tier_teams(tier: str, *, pool_dir: str | Path = POOL_DIR) -> tuple[str, ...]:
    """Return the sorted team IDs (file stems) available in one tier."""

    directory = Path(pool_dir) / tier
    if not directory.is_dir():
        return ()
    return tuple(sorted(path.stem for path in directory.glob("*.txt")))


def load_pool_team(
    tier: str, team_id: str, *, pool_dir: str | Path = POOL_DIR
) -> str:
    """Return the Showdown export string for one pool team."""

    path = Path(pool_dir) / tier / f"{team_id}.txt"
    if not path.is_file():
        raise PoolError(f"no team {team_id!r} in tier {tier!r}")
    return path.read_text(encoding="utf-8").strip()


def build_campaign(
    *,
    rng: CampaignRandomSource | None = None,
    pool_dir: str | Path = POOL_DIR,
    structure: Sequence[tuple[str, int]] = CAMPAIGN_STRUCTURE,
) -> list[CampaignBattle]:
    """Select an ordered campaign: ``count`` distinct random teams per tier.

    Teams within a tier are sampled without replacement (no repeats inside the
    run) and appended in tier order, so the run climbs in difficulty. The same
    ``rng`` seed yields the same campaign.
    """

    random_source = rng or random.Random()
    battles: list[CampaignBattle] = []
    order = 0
    for tier, count in structure:
        available = list(tier_teams(tier, pool_dir=pool_dir))
        if len(available) < count:
            raise PoolError(
                f"tier {tier!r} needs {count} team(s) but has {len(available)}"
            )
        for team_id in random_source.sample(available, count):
            order += 1
            battles.append(
                CampaignBattle(
                    order=order,
                    tier=tier,
                    team_id=team_id,
                    export=load_pool_team(tier, team_id, pool_dir=pool_dir),
                )
            )
    return battles
