import httpx
import pytest

from battle_runner import BattleResult, BattleRunnerConfig, PERMISSIVE_GEN9_FORMAT
from rollmons import web_app
from rollmons import boss_loader
from rollmons.boss_loader import load_boss_team
from rollmons.web_app import _battle_config_from_environment, app, create_app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as test_client:
        yield test_client


def find_cell(matrix, pokemon_type, generation):
    return next(
        cell
        for cell in matrix["cells"]
        if cell["type"] == pokemon_type and cell["generation"] == generation
    )


@pytest.mark.anyio
async def test_frontend_and_static_assets_are_served(client):
    index = await client.get("/")
    javascript = await client.get("/static/app.js")
    stylesheet = await client.get("/static/styles.css")

    assert index.status_code == 200
    assert "18 × 9 legality matrix" in index.text
    assert "Interactive six-round draft" in index.text
    assert 'id="copy-team-export"' in index.text
    assert 'id="team-export-panel"' not in index.text
    assert index.text.index('id="battle-result-panel"') < index.text.index(
        'class="draft-sidebar"'
    )
    assert javascript.status_code == 200
    assert "/api/matrix" in javascript.text
    assert "/api/bosses" in javascript.text
    assert "battlePanel.scrollIntoView" in javascript.text
    assert "copyTeamExport" in javascript.text
    assert "navigator.clipboard.writeText" in javascript.text
    assert "addCustomBoss" in javascript.text
    assert "editBoss" in javascript.text
    assert "discardBoss" in javascript.text
    assert "dragBoss" in javascript.text
    assert 'draggable="true"' in javascript.text
    assert "dataTransfer" in javascript.text
    assert "MIN_BOSSES" in javascript.text
    assert "MAX_BOSSES" in javascript.text
    assert "start-real-gauntlet" in index.text
    assert "boss-order-list" in index.text
    assert "custom-boss-form" in index.text
    assert "custom-boss-id" in index.text
    assert "cancel-boss-edit" in index.text
    assert "thinRerollDraft" in javascript.text
    assert "Free re-spin (thin cell)" in javascript.text
    assert "Manual skip" in javascript.text
    assert "cell-pokemon-sprite" in javascript.text
    assert "team-pokemon-sprite" in javascript.text
    assert "gauntletReport" in javascript.text
    assert "Your record is" in javascript.text
    assert "escapeHtml(set.export)" in javascript.text
    assert "startGauntlet" in javascript.text
    assert "battle-replay-card" in javascript.text
    assert "battle-replay-summary" in javascript.text
    assert "winner-${result.winner}" in javascript.text
    assert "setTimeout(runNextGauntletBattle, 0)" in javascript.text
    assert "stop_on_loss" in javascript.text
    assert stylesheet.status_code == 200
    assert "cell-pokemon-sprite-frame" in stylesheet.text
    assert "team-pokemon-sprite-frame" in stylesheet.text
    assert "draft-sidebar" in stylesheet.text
    assert "position: sticky" in stylesheet.text
    assert "copy-button" in stylesheet.text
    assert "type-dark" in stylesheet.text
    assert "gauntlet-summary" in stylesheet.text
    assert "gauntlet-list" in stylesheet.text
    assert "winner-boss" in stylesheet.text
    assert "winner-player" in stylesheet.text
    assert "battle-replay-list" in stylesheet.text
    assert "boss-order-list" in stylesheet.text
    assert "custom-boss-form" in stylesheet.text
    assert "boss-form-actions" in stylesheet.text
    assert "boss-discard" in stylesheet.text
    assert "boss-drag-handle" in stylesheet.text
    assert "drag-over" in stylesheet.text


@pytest.mark.anyio
async def test_boss_endpoint_exposes_discovered_bosses(client):
    response = await client.get("/api/bosses")

    assert response.status_code == 200
    assert {"id": "ash", "name": "Ash", "source": "file"} in response.json()


def test_battle_config_uses_separate_player_search_time(tmp_path, monkeypatch):
    monkeypatch.setenv("ROLLMONS_SHOWDOWN_LOG_DIR", str(tmp_path))
    monkeypatch.delenv("ROLLMONS_SEARCH_TIME_MS", raising=False)
    monkeypatch.delenv("ROLLMONS_PLAYER_SEARCH_TIME_MS", raising=False)

    config = _battle_config_from_environment()

    assert config.search_time_ms == 25
    assert config.player_search_time_ms == 100


@pytest.mark.anyio
async def test_custom_boss_endpoint_validates_and_exposes_pasted_boss(client):
    response = await client.post(
        "/api/bosses/custom",
        json={"name": "Tester", "export": load_boss_team("ash")},
    )

    assert response.status_code == 200
    boss = response.json()
    assert boss["name"] == "Tester"
    assert boss["source"] == "custom"
    bosses = (await client.get("/api/bosses")).json()
    assert boss in bosses


@pytest.mark.anyio
async def test_boss_detail_and_edit_validate_before_replacing_team():
    test_app = create_app()
    transport = httpx.ASGITransport(app=test_app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as test_client:
        detail = await test_client.get("/api/bosses/ash")
        invalid = await test_client.put(
            "/api/bosses/ash",
            json={"name": "Broken Ash", "export": "Pikachu\n- Not A Move"},
        )
        unchanged = await test_client.get("/api/bosses/ash")
        edited = await test_client.put(
            "/api/bosses/ash",
            json={"name": "Edited Ash", "export": load_boss_team("ash")},
        )
        after_edit = await test_client.get("/api/bosses/ash")

    assert detail.status_code == 200
    assert detail.json()["source"] == "file"
    assert "Pikachu @ Light Ball" in detail.json()["export"]
    assert invalid.status_code == 422
    assert unchanged.json()["name"] == "Ash"
    assert unchanged.json()["source"] == "file"
    assert edited.status_code == 200
    assert edited.json() == {"id": "ash", "name": "Edited Ash", "source": "edited"}
    assert after_edit.json()["name"] == "Edited Ash"
    assert after_edit.json()["source"] == "edited"


@pytest.mark.anyio
async def test_matrix_endpoint_exposes_all_cells_and_known_placements(client):
    response = await client.get("/api/matrix")

    assert response.status_code == 200
    matrix = response.json()
    assert matrix["set_source"] == "smogon"
    assert matrix["atom_count"] == 432
    assert matrix["included_cell_count"] == 155
    assert len(matrix["cells"]) == 18 * 9
    assert sum(cell["included"] for cell in matrix["cells"]) == 155
    assert sum(cell["state"] == "normal" for cell in matrix["cells"]) == 113
    assert sum(cell["state"] == "thin" for cell in matrix["cells"]) == 42
    assert sum(cell["state"] == "excluded" for cell in matrix["cells"]) == 7

    fairy_gen1 = find_cell(matrix, "fairy", 1)
    assert fairy_gen1["included"]
    assert fairy_gen1["state"] == "thin"
    clefable = next(
        pokemon for pokemon in fairy_gen1["pokemon"] if pokemon["id"] == "clefable"
    )
    assert clefable["base_stat_total"] == 483
    assert clefable["randbats_set"]["source"] == "smogon"
    assert clefable["randbats_set"]["moves"]
    assert clefable["sprite_url"].startswith(
        "https://play.pokemonshowdown.com/sprites/home-centered/"
    )
    assert clefable["randbats_set"]["item_icon"]["url"].startswith(
        "https://play.pokemonshowdown.com/sprites/itemicons-sheet.png"
    )
    assert clefable["assembly_spread"]["level"] == 100
    assert set(clefable["assembly_spread"]["ivs"].values()) == {31}

    fire_gen3 = find_cell(matrix, "fire", 3)
    blaziken = next(
        pokemon for pokemon in fire_gen3["pokemon"] if pokemon["id"] == "blaziken"
    )
    assert blaziken["randbats_set"]["export"] == """Blaziken @ Life Orb
Ability: Speed Boost
Level: 100
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Swords Dance
- Close Combat
- Flare Blitz
- Stone Edge"""
    assert "Tera Type:" not in blaziken["randbats_set"]["export"]

    fire_gen1 = find_cell(matrix, "fire", 1)
    flying_gen1 = find_cell(matrix, "flying", 1)
    assert "charizard" in {pokemon["id"] for pokemon in fire_gen1["pokemon"]}
    assert "charizard" in {pokemon["id"] for pokemon in flying_gen1["pokemon"]}


@pytest.mark.anyio
async def test_api_driven_six_round_draft_completes_with_level_100_export(client):
    started = await client.post(
        "/api/drafts",
        json={"level": 100, "seed": 2026},
    )
    assert started.status_code == 200
    state = started.json()
    session_id = state["session_id"]
    assert state["draft_config"] == {
        "candidate_cap": 5,
        "legendary_weight": 0.10,
        "arceus_weight": 0.05,
        "manual_skip_count": 2,
        "thin_cell_threshold": 3,
    }

    skipped = await client.post(f"/api/drafts/{session_id}/skip")
    assert skipped.status_code == 200
    state = skipped.json()
    assert state["skips_remaining"] == 1

    while not state["complete"]:
        candidates = {item["id"] for item in state["offer"]["candidates"]}
        probabilities = {
            item["id"]: item["selection_probability"]
            for item in state["offer"]["candidates"]
        }
        suggested = state["offer"]["suggested_species"]
        assert len(candidates) <= state["draft_config"]["candidate_cap"]
        assert suggested in candidates
        assert set(probabilities) == candidates
        assert sum(probabilities.values()) == pytest.approx(1)
        assert not candidates.intersection(item["id"] for item in state["team"])
        picked = await client.post(
            f"/api/drafts/{session_id}/pick",
            json={"species_id": suggested},
        )
        assert picked.status_code == 200
        state = picked.json()

    assert len(state["team"]) == 6
    assert len({pokemon["id"] for pokemon in state["team"]}) == 6
    assert state["team_export"].count("Level: 100") == 6
    assert len(state["team_export"].split("\n\n")) == 6

    fetched = await client.get(f"/api/drafts/{session_id}")
    assert fetched.status_code == 200
    assert fetched.json() == state


@pytest.mark.anyio
async def test_backend_rejects_non_fixed_level(client):
    response = await client.post(
        "/api/drafts",
        json={"level": 50, "skip_count": 1},
    )

    assert response.status_code == 422
    assert "only fixed level 100" in response.json()["detail"]


@pytest.mark.anyio
async def test_bst_exclusions_are_not_marked_legendary_in_api(client):
    matrix = (await client.get("/api/matrix")).json()
    pokemon = {
        item["id"]: item
        for cell in matrix["cells"]
        for item in cell["pokemon"]
        if item["id"] in {"slaking", "regigigas"}
    }

    assert pokemon["slaking"]["base_stat_total"] == 670
    assert pokemon["regigigas"]["base_stat_total"] == 670
    assert not pokemon["slaking"]["legendary"]
    assert not pokemon["regigigas"]["legendary"]


@pytest.mark.anyio
async def test_completed_draft_can_delegate_one_battle_and_return_replay(tmp_path):
    calls = []
    expected_result = BattleResult(
        winner="player",
        turns=12,
        battle_id="battle-gen9customgame-42",
        replay_log=["|turn|12", "|win|RollmonsPlayer"],
    )
    config = BattleRunnerConfig(
        websocket_url="ws://localhost:8000/showdown/websocket",
        showdown_log_dir=tmp_path,
    )

    def fake_run_battle(
        player_team,
        boss_team,
        received_config,
        *,
        player_name,
        boss_name,
    ):
        calls.append(
            (player_team, boss_team, received_config, player_name, boss_name)
        )
        return expected_result

    test_app = create_app(
        battle_fn=fake_run_battle,
        battle_config_factory=lambda: config,
    )
    transport = httpx.ASGITransport(app=test_app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as battle_client:
        state = (
            await battle_client.post(
                "/api/drafts",
                json={"level": 100, "skip_count": 1, "seed": 2026},
            )
        ).json()
        while not state["complete"]:
            state = (
                await battle_client.post(
                    f"/api/drafts/{state['session_id']}/pick",
                    json={"species_id": state["offer"]["suggested_species"]},
                )
            ).json()

        response = await battle_client.post(
            f"/api/drafts/{state['session_id']}/battle",
            json={"boss_id": "ash"},
        )

    assert response.status_code == 200
    result = response.json()["battle_result"]
    assert result == {
        "winner": "player",
        "turns": 12,
        "battle_id": "battle-gen9customgame-42",
        "replay_log": ["|turn|12", "|win|RollmonsPlayer"],
        "player_name": "Player",
        "boss_name": "Boss",
    }
    assert len(calls) == 1
    player_team, boss_team, received_config, player_name, boss_name = calls[0]
    assert player_team.count("Level: 100") == 6
    assert boss_team.count("Level: 100") == 6
    assert "Pikachu @ Light Ball" in boss_team
    assert received_config.battle_format == PERMISSIVE_GEN9_FORMAT
    assert player_name == "Player"
    assert boss_name == "Ash"


@pytest.mark.anyio
async def test_completed_draft_can_run_boss_gauntlet_sequentially(tmp_path, monkeypatch):
    boss_dir = tmp_path / "bosses"
    boss_dir.mkdir()
    boss_team = load_boss_team("ash")
    (boss_dir / "brock.txt").write_text(boss_team, encoding="utf-8")
    (boss_dir / "misty.txt").write_text(boss_team, encoding="utf-8")
    monkeypatch.setattr(boss_loader, "BOSSES_DIR", boss_dir)
    calls = []
    config = BattleRunnerConfig(
        websocket_url="ws://localhost:8000/showdown/websocket",
        showdown_log_dir=tmp_path,
    )

    def fake_run_battle(
        player_team,
        boss_team,
        received_config,
        *,
        player_name,
        boss_name,
    ):
        calls.append((player_team, boss_team, received_config, player_name, boss_name))
        return BattleResult(
            winner="player",
            turns=10 + len(calls),
            battle_id=f"battle-gen9customgame-{len(calls)}",
            replay_log=[f"|turn|{10 + len(calls)}", f"|win|{player_name}"],
            player_name=player_name,
            boss_name=boss_name,
        )

    test_app = create_app(
        battle_fn=fake_run_battle,
        battle_config_factory=lambda: config,
    )
    transport = httpx.ASGITransport(app=test_app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as battle_client:
        state = (
            await battle_client.post(
                "/api/drafts",
                json={"level": 100, "skip_count": 1, "seed": 2026},
            )
        ).json()
        while not state["complete"]:
            state = (
                await battle_client.post(
                    f"/api/drafts/{state['session_id']}/pick",
                    json={"species_id": state["offer"]["suggested_species"]},
                )
            ).json()

        started = await battle_client.post(
            f"/api/drafts/{state['session_id']}/gauntlet/start",
            json={"boss_ids": ["brock", "misty"]},
        )
        first = await battle_client.post(
            f"/api/drafts/{state['session_id']}/gauntlet/next",
        )
        second = await battle_client.post(
            f"/api/drafts/{state['session_id']}/gauntlet/next",
        )

    assert started.status_code == 200
    assert started.json()["gauntlet"]["bosses"] == [
        {"id": "brock", "name": "Brock", "complete": False, "current": True},
        {"id": "misty", "name": "Misty", "complete": False, "current": False},
    ]
    assert first.status_code == 200
    assert first.json()["gauntlet"]["results"][0]["boss_name"] == "Brock"
    assert first.json()["gauntlet"]["complete"] is False
    assert second.status_code == 200
    payload = second.json()["gauntlet"]
    assert payload["complete"] is True
    assert payload["summary"] == "Your record is 2-0! Average turn is 11.5."
    assert [result["boss_name"] for result in payload["results"]] == ["Brock", "Misty"]
    assert [result["battle_id"] for result in payload["results"]] == [
        "battle-gen9customgame-1",
        "battle-gen9customgame-2",
    ]
    assert len(calls) == 2


@pytest.mark.anyio
async def test_boss_gauntlet_start_does_not_bulk_validate_bosses(
    tmp_path,
    monkeypatch,
):
    config = BattleRunnerConfig(
        websocket_url="ws://localhost:8000/showdown/websocket",
        showdown_log_dir=tmp_path,
    )
    validation_calls = []

    def fail_if_bulk_validated(**kwargs):
        validation_calls.append(kwargs)
        raise AssertionError("gauntlet start should not bulk-validate boss teams")

    monkeypatch.setattr(web_app, "verify_team_entities_exist", fail_if_bulk_validated)
    test_app = create_app(
        battle_fn=lambda *_args, **_kwargs: pytest.fail("runner should not be called"),
        battle_config_factory=lambda: config,
    )
    transport = httpx.ASGITransport(app=test_app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as battle_client:
        state = (
            await battle_client.post(
                "/api/drafts",
                json={"level": 100, "skip_count": 1, "seed": 2026},
            )
        ).json()
        while not state["complete"]:
            state = (
                await battle_client.post(
                    f"/api/drafts/{state['session_id']}/pick",
                    json={"species_id": state["offer"]["suggested_species"]},
                )
            ).json()

        started = await battle_client.post(
            f"/api/drafts/{state['session_id']}/gauntlet/start",
            json={"boss_ids": ["ash"]},
        )

    assert started.status_code == 200
    assert validation_calls == []
    assert started.json()["gauntlet"]["bosses"] == [
        {
            "id": "ash",
            "name": "Ash",
            "complete": False,
            "current": True,
        }
    ]


@pytest.mark.anyio
async def test_real_boss_rush_stops_after_first_player_loss(tmp_path, monkeypatch):
    boss_dir = tmp_path / "bosses"
    boss_dir.mkdir()
    boss_team = load_boss_team("ash")
    (boss_dir / "brock.txt").write_text(boss_team, encoding="utf-8")
    (boss_dir / "misty.txt").write_text(boss_team, encoding="utf-8")
    (boss_dir / "surge.txt").write_text(boss_team, encoding="utf-8")
    monkeypatch.setattr(boss_loader, "BOSSES_DIR", boss_dir)
    calls = []
    config = BattleRunnerConfig(
        websocket_url="ws://localhost:8000/showdown/websocket",
        showdown_log_dir=tmp_path,
    )

    def fake_run_battle(
        player_team,
        boss_team,
        received_config,
        *,
        player_name,
        boss_name,
    ):
        calls.append((player_team, boss_team, received_config, player_name, boss_name))
        winner = "player" if len(calls) == 1 else "boss"
        return BattleResult(
            winner=winner,
            turns=10 + len(calls),
            battle_id=f"battle-gen9customgame-{len(calls)}",
            replay_log=[f"|turn|{10 + len(calls)}", f"|win|{boss_name}"],
            player_name=player_name,
            boss_name=boss_name,
        )

    test_app = create_app(
        battle_fn=fake_run_battle,
        battle_config_factory=lambda: config,
    )
    transport = httpx.ASGITransport(app=test_app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as battle_client:
        state = (
            await battle_client.post(
                "/api/drafts",
                json={"level": 100, "skip_count": 1, "seed": 2026},
            )
        ).json()
        while not state["complete"]:
            state = (
                await battle_client.post(
                    f"/api/drafts/{state['session_id']}/pick",
                    json={"species_id": state["offer"]["suggested_species"]},
                )
            ).json()

        started = await battle_client.post(
            f"/api/drafts/{state['session_id']}/gauntlet/start",
            json={
                "boss_ids": ["brock", "misty", "surge"],
                "stop_on_loss": True,
            },
        )
        first = await battle_client.post(
            f"/api/drafts/{state['session_id']}/gauntlet/next",
        )
        second = await battle_client.post(
            f"/api/drafts/{state['session_id']}/gauntlet/next",
        )
        third = await battle_client.post(
            f"/api/drafts/{state['session_id']}/gauntlet/next",
        )

    assert started.status_code == 200
    assert started.json()["gauntlet"]["stop_on_loss"] is True
    assert first.json()["gauntlet"]["complete"] is False
    payload = second.json()["gauntlet"]
    assert payload["complete"] is True
    assert payload["stop_on_loss"] is True
    assert [result["boss_name"] for result in payload["results"]] == ["Brock", "Misty"]
    assert payload["summary"] == "Your record is 1-1! Average turn is 11.5."
    assert third.json()["gauntlet"]["results"] == payload["results"]
    assert len(calls) == 2


@pytest.mark.anyio
async def test_boss_rush_order_must_have_between_one_and_ten_bosses(tmp_path):
    config = BattleRunnerConfig(
        websocket_url="ws://localhost:8000/showdown/websocket",
        showdown_log_dir=tmp_path,
    )
    test_app = create_app(
        battle_fn=lambda *_args, **_kwargs: pytest.fail("runner should not be called"),
        battle_config_factory=lambda: config,
    )
    transport = httpx.ASGITransport(app=test_app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as battle_client:
        state = (
            await battle_client.post(
                "/api/drafts",
                json={"level": 100, "skip_count": 1, "seed": 2026},
            )
        ).json()
        while not state["complete"]:
            state = (
                await battle_client.post(
                    f"/api/drafts/{state['session_id']}/pick",
                    json={"species_id": state["offer"]["suggested_species"]},
                )
            ).json()

        empty = await battle_client.post(
            f"/api/drafts/{state['session_id']}/gauntlet/start",
            json={"boss_ids": []},
        )
        too_many = await battle_client.post(
            f"/api/drafts/{state['session_id']}/gauntlet/start",
            json={"boss_ids": ["ash"] * 11},
        )

    assert empty.status_code == 404
    assert empty.json()["detail"] == "no boss teams found"
    assert too_many.status_code == 422
    assert too_many.json()["detail"] == "boss rush supports at most 10 bosses"


@pytest.mark.anyio
async def test_battle_requires_a_completed_draft(tmp_path):
    test_app = create_app(
        battle_fn=lambda *_args: pytest.fail("runner should not be called"),
        battle_config_factory=lambda: BattleRunnerConfig(
            websocket_url="ws://localhost:8000/showdown/websocket",
            showdown_log_dir=tmp_path,
        ),
    )
    transport = httpx.ASGITransport(app=test_app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as battle_client:
        state = (await battle_client.post("/api/drafts", json={})).json()
        response = await battle_client.post(
            f"/api/drafts/{state['session_id']}/battle",
            json={"boss_id": "ash"},
        )

    assert response.status_code == 409
    assert response.json()["detail"] == "draft is not complete"
