"""Battle boundary types for the reference Python layer.

In v1 this module drove foul-play + poke-engine against a local Pokémon
Showdown server. In v2 battles run in the browser (poke-engine compiled to
WebAssembly, @pkmn/sim as referee), so only the types the web app and its
tests use remain here. See docs/v1-foul-play-integration.md and the archived
v1 repo (github.com/ziangit/rollmons) for the original runner.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

WinnerRole = Literal["player", "boss", "tie"]

PERMISSIVE_GEN9_RULES = (
    "Species Clause",
    "+Past",
    "Dynamax Clause",
    "Z-Move Clause",
    "CFZ Clause",
    "Terastal Clause",
    "!! Max Move Count = 4",
    "Adjust Level = 100",
)
PERMISSIVE_GEN9_FORMAT = "gen9customgame@@@" + ",".join(PERMISSIVE_GEN9_RULES)


class BattleRunnerError(RuntimeError):
    """Base class for battle failures."""


class BattleEngineError(BattleRunnerError):
    """The search engine failed or stalled."""


class BattleTimeoutError(BattleRunnerError):
    """The battle did not finish in time."""


class BattleReplayTimeoutError(BattleTimeoutError):
    """The replay log did not appear in time."""


@dataclass(frozen=True)
class BattleResult:
    winner: WinnerRole
    turns: int
    battle_id: str
    replay_log: list[str]
    player_name: str = "Player"
    boss_name: str = "Boss"


@dataclass(frozen=True)
class BattleRunnerConfig:
    websocket_url: str
    showdown_log_dir: str | Path
    battle_format: str = PERMISSIVE_GEN9_FORMAT
    inference_format: str = "gen9ou"
    search_time_ms: int = 25
    player_search_time_ms: int = 100
    search_parallelism: int = 1
    search_threads: int = 1
    startup_timeout: float = 20
    battle_timeout: float = 60
    replay_timeout: float = 10
    close_timeout: float = 3
    seed: int | None = None
    username_prefix: str = "Rollmons"
    worker_probe_path: str | Path | None = None


def run_battle(*_args, **_kwargs) -> BattleResult:
    raise BattleRunnerError(
        "v2 runs battles in the browser; the Python battle runner lives in the "
        "archived v1 repo"
    )


def result_as_dict(result: BattleResult) -> dict:
    return asdict(result)
