import httpx
import pytest

from rollmons.web_app import app


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
    assert javascript.status_code == 200
    assert "/api/matrix" in javascript.text
    assert stylesheet.status_code == 200


@pytest.mark.anyio
async def test_matrix_endpoint_exposes_all_cells_and_known_placements(client):
    response = await client.get("/api/matrix")

    assert response.status_code == 200
    matrix = response.json()
    assert matrix["atom_count"] == 508
    assert matrix["included_cell_count"] == 101
    assert len(matrix["cells"]) == 18 * 9
    assert sum(cell["included"] for cell in matrix["cells"]) == 101

    fairy_gen1 = find_cell(matrix, "fairy", 1)
    assert not fairy_gen1["included"]
    clefable = next(
        pokemon for pokemon in fairy_gen1["pokemon"] if pokemon["id"] == "clefable"
    )
    assert clefable["base_stat_total"] == 483
    assert clefable["randbats_set"]["moves"]
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
