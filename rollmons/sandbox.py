"""Live boss-testing sandbox using fresh pool-drafted player teams."""

from __future__ import annotations

import argparse
import html
import os
import random
import tempfile
import webbrowser
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from battle_runner import (
    BattleResult,
    BattleRunnerConfig,
    run_battle,
    verify_team_entities_exist,
)
from rollmons.boss_loader import boss_display_name, load_boss_team
from rollmons.draft import Draft
from rollmons.legality_matrix import build_legality_data
from rollmons.team_assembly import assemble_team


@dataclass(frozen=True)
class SandboxBattle:
    run: int
    drafted_species: tuple[str, ...]
    result: BattleResult
    replay_path: Path


@dataclass(frozen=True)
class SandboxSummary:
    boss_id: str
    boss_name: str
    battles: tuple[SandboxBattle, ...]

    @property
    def boss_wins(self) -> int:
        return sum(battle.result.winner == "boss" for battle in self.battles)

    @property
    def boss_losses(self) -> int:
        return sum(battle.result.winner == "player" for battle in self.battles)

    @property
    def ties(self) -> int:
        return sum(battle.result.winner == "tie" for battle in self.battles)

    @property
    def boss_win_rate(self) -> float:
        return self.boss_wins / len(self.battles)


def _replay_document(result: BattleResult) -> str:
    protocol = html.escape("\n".join(result.replay_log))
    return f"""<!doctype html>
<meta charset="utf-8">
<title>{html.escape(result.player_name)} vs {html.escape(result.boss_name)}</title>
<style>
html, body {{ margin: 0; padding: 0; font-family: Verdana, sans-serif; }}
.wrapper {{ max-width: 1180px; margin: 0 auto; }}
</style>
<div class="wrapper replay-wrapper">
  <div class="battle"></div>
  <div class="battle-log"></div>
  <div class="replay-controls"></div>
  <div class="replay-controls-2"></div>
  <script type="text/plain" class="battle-log-data">{protocol}</script>
</div>
<script src="https://play.pokemonshowdown.com/js/replay-embed.js"></script>
"""


def _draft_team(seed: int) -> tuple[tuple[str, ...], str]:
    draft = Draft(build_legality_data(), rng=random.Random(seed))
    while not draft.complete:
        offer = draft.current_offer
        draft.submit_pick(offer.suggested_species)
    return draft.picks, assemble_team(draft.picks, rng=random.Random(seed + 1))


def run_sandbox(
    *,
    boss_id: str,
    runs: int,
    config: BattleRunnerConfig,
    seed: int = 1,
    output_dir: str | Path | None = None,
    battle_fn: Callable[..., BattleResult] = run_battle,
) -> SandboxSummary:
    if runs < 1:
        raise ValueError("runs must be at least one")
    boss_team = load_boss_team(boss_id)
    boss_name = boss_display_name(boss_id)
    replay_dir = (
        Path(output_dir)
        if output_dir is not None
        else Path(tempfile.mkdtemp(prefix="rollmons-sandbox-"))
    )
    replay_dir.mkdir(parents=True, exist_ok=True)
    battles = []
    for index in range(runs):
        drafted_species, player_team = _draft_team(seed + index * 2)
        verify_team_entities_exist(player=player_team, boss=boss_team)
        result = battle_fn(
            player_team,
            boss_team,
            config,
            player_name="Player",
            boss_name=boss_name,
        )
        replay_path = replay_dir / f"{boss_id}-{index + 1}.html"
        replay_path.write_text(_replay_document(result), encoding="utf-8")
        battles.append(
            SandboxBattle(
                run=index + 1,
                drafted_species=drafted_species,
                result=result,
                replay_path=replay_path,
            )
        )
    return SandboxSummary(
        boss_id=boss_id,
        boss_name=boss_name,
        battles=tuple(battles),
    )


def _config_from_environment() -> BattleRunnerConfig:
    log_dir = os.environ.get("ROLLMONS_SHOWDOWN_LOG_DIR")
    if not log_dir:
        raise SystemExit(
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


def _boss_id(value: str) -> str:
    return Path(value).stem


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--boss", default="ash")
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--output-dir")
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    summary = run_sandbox(
        boss_id=_boss_id(args.boss),
        runs=args.runs,
        config=_config_from_environment(),
        seed=args.seed,
        output_dir=args.output_dir,
    )
    for battle in summary.battles:
        result = battle.result
        print(
            f"battle {battle.run}: winner={result.winner} turns={result.turns} "
            f"team={','.join(battle.drafted_species)} "
            f"replay={battle.replay_path.resolve().as_uri()}"
        )
        if args.open:
            webbrowser.open(battle.replay_path.resolve().as_uri())
    print(
        f"tally: boss={summary.boss_name} runs={len(summary.battles)} "
        f"wins={summary.boss_wins} losses={summary.boss_losses} "
        f"ties={summary.ties} win_rate={summary.boss_win_rate:.1%}"
    )


if __name__ == "__main__":
    main()
