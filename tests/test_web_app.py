import httpx
import pytest

from battle_runner import BattleResult, BattleRunnerConfig, PERMISSIVE_GEN9_FORMAT
from rollmons.web_app import app, create_app


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
    assert index.text.index('id="battle-panel"') < index.text.index(
        'id="team-export-panel"'
    )
    assert javascript.status_code == 200
    assert "/api/matrix" in javascript.text
    assert "battlePanel.scrollIntoView" in javascript.text
    assert "thinRerollDraft" in javascript.text
    assert stylesheet.status_code == 200


@pytest.mark.anyio
async def test_matrix_endpoint_exposes_all_cells_and_known_placements(client):
    response = await client.get("/api/matrix")

    assert response.status_code == 200
    matrix = response.json()
    assert matrix["atom_count"] == 508
    assert matrix["included_cell_count"] == 158
    assert len(matrix["cells"]) == 18 * 9
    assert sum(cell["included"] for cell in matrix["cells"]) == 158
    assert sum(cell["state"] == "normal" for cell in matrix["cells"]) == 125
    assert sum(cell["state"] == "thin" for cell in matrix["cells"]) == 33
    assert sum(cell["state"] == "excluded" for cell in matrix["cells"]) == 4

    fairy_gen1 = find_cell(matrix, "fairy", 1)
    assert fairy_gen1["included"]
    assert fairy_gen1["state"] == "thin"
    clefable = next(
        pokemon for pokemon in fairy_gen1["pokemon"] if pokemon["id"] == "clefable"
    )
    assert clefable["base_stat_total"] == 483
    assert clefable["randbats_set"]["moves"]
    assert clefable["sprite_url"].startswith(
        "https://play.pokemonshowdown.com/sprites/home-centered/"
    )
    assert clefable["randbats_set"]["item_icon"]["url"].startswith(
        "https://play.pokemonshowdown.com/sprites/itemicons-sheet.png"
    )
    assert clefable["assembly_spread"]["level"] == 100
    assert set(clefable["assembly_spread"]["ivs"].values()) == {31}

    fire_gen1 = find_cell(matrix, "fire", 1)
    flying_gen1 = find_cell(matrix, "flying", 1)
    assert "charizard" in {pokemon["id"] for pokemon in fire_gen1["pokemon"]}
    assert "charizard" in {pokemon["id"] for pokemon in flying_gen1["pokemon"]}


@pytest.mark.anyio
async def test_api_driven_six_round_draft_completes_with_level_100_export(client):
    started = await client.post(
        "/api/drafts",
        json={"level": 100, "skip_count": 1, "seed": 2026},
    )
    assert started.status_code == 200
    state = started.json()
    session_id = state["session_id"]

    skipped = await client.post(f"/api/drafts/{session_id}/skip")
    assert skipped.status_code == 200
    state = skipped.json()
    assert state["skips_remaining"] == 0

    while not state["complete"]:
        candidates = {item["id"] for item in state["offer"]["candidates"]}
        probabilities = {
            item["id"]: item["selection_probability"]
            for item in state["offer"]["candidates"]
        }
        suggested = state["offer"]["suggested_species"]
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
