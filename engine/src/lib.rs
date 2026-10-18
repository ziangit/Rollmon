//! rollmons engine: a thin wasm-bindgen surface over poke-engine.
//!
//! Everything crosses the boundary as strings: the poke-engine serialized
//! state format in, hand-formatted JSON out (no serde, to keep the wasm
//! small). The driver in `web/battle/` builds the state string from the
//! `@pkmn/sim` battle object and parses the JSON.
//!
//! Tera is compiled out of poke-engine (see Cargo.toml); `root_options` is
//! unit-tested to never emit a `-tera` choice.

use poke_engine::choices::{Choices, MoveCategory, MOVES};
use poke_engine::engine::evaluate::evaluate;
use poke_engine::engine::generate_instructions::calculate_both_damage_rolls;
use poke_engine::engine::state::MoveChoice;
use poke_engine::mcts::{perform_mcts, MctsResult};
use poke_engine::state::{PokemonIndex, PokemonMoveIndex, State};
use std::str::FromStr;
use std::time::Duration;
use wasm_bindgen::prelude::*;

pub const UPSTREAM_REV: &str = "f7b147f";

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// Upstream poke-engine commit this build wraps.
#[wasm_bindgen]
pub fn engine_version() -> String {
    format!("poke-engine@{UPSTREAM_REV} gen9 no-tera")
}

fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn choices_json(choices: &[MoveChoice], side: &poke_engine::state::Side) -> String {
    let items: Vec<String> = choices.iter().map(|c| choice_json(c, side)).collect();
    format!("[{}]", items.join(","))
}

/// Legal root choices for both sides, as `{"s1":[choice…],"s2":[…]}` using
/// the structured choice form (see `choice_json`).
#[wasm_bindgen]
pub fn root_options(state: &str) -> String {
    let state = State::deserialize(state);
    let (s1, s2) = state.root_get_all_options();
    format!(
        "{{\"s1\":{},\"s2\":{}}}",
        choices_json(&s1, &state.side_one),
        choices_json(&s2, &state.side_two)
    )
}

/// Static evaluation of the state from side one's point of view.
#[wasm_bindgen]
pub fn evaluate_state(state: &str) -> f32 {
    let state = State::deserialize(state);
    evaluate(&state)
}

/// Structured form of a choice: `{"kind":"move"|"switch"|"none","index":n,"mega":bool}`.
/// `index` is the move slot (0-3) or the team slot (0-5) in the order the
/// state string listed them, so the driver maps it back without name lookups.
fn choice_json(choice: &MoveChoice, side: &poke_engine::state::Side) -> String {
    let move_index = |i: &PokemonMoveIndex| match i {
        PokemonMoveIndex::M0 => 0,
        PokemonMoveIndex::M1 => 1,
        PokemonMoveIndex::M2 => 2,
        PokemonMoveIndex::M3 => 3,
    };
    let pkmn_index = |i: &PokemonIndex| match i {
        PokemonIndex::P0 => 0,
        PokemonIndex::P1 => 1,
        PokemonIndex::P2 => 2,
        PokemonIndex::P3 => 3,
        PokemonIndex::P4 => 4,
        PokemonIndex::P5 => 5,
    };
    let label = json_str(&choice.to_string(side));
    match choice {
        MoveChoice::Move(i) => format!(
            "{{\"kind\":\"move\",\"index\":{},\"mega\":false,\"label\":{label}}}",
            move_index(i)
        ),
        MoveChoice::MoveMega(i) => format!(
            "{{\"kind\":\"move\",\"index\":{},\"mega\":true,\"label\":{label}}}",
            move_index(i)
        ),
        MoveChoice::Switch(i) => format!(
            "{{\"kind\":\"switch\",\"index\":{},\"label\":{label}}}",
            pkmn_index(i)
        ),
        // Tera is compiled out; keep the arm so the enum match stays total.
        MoveChoice::MoveTera(_) | MoveChoice::TeamPreview(..) | MoveChoice::None => {
            format!("{{\"kind\":\"none\",\"label\":{label}}}")
        }
    }
}

pub fn mcts_result_json(state: &State, result: &MctsResult) -> String {
    let side = |items: &[poke_engine::mcts::MctsSideResult], side: &poke_engine::state::Side| {
        let rows: Vec<String> = items
            .iter()
            .map(|r| {
                format!(
                    "{{\"choice\":{},\"score\":{:.3},\"visits\":{}}}",
                    choice_json(&r.move_choice, side),
                    r.total_score,
                    r.visits
                )
            })
            .collect();
        format!("[{}]", rows.join(","))
    };
    format!(
        "{{\"iterations\":{},\"s1\":{},\"s2\":{}}}",
        result.iteration_count,
        side(&result.s1, &state.side_one),
        side(&result.s2, &state.side_two)
    )
}

/// Run single-threaded MCTS. `max_iterations > 0` makes the search
/// iteration-bounded (used by benchmarks); otherwise it runs for
/// `max_time_ms` wall-clock milliseconds (`performance.now()` under wasm).
///
/// Returns `{"iterations":N,"s1":[{"choice":{kind,index,mega,label},"score","visits"}...],"s2":[...]}`
/// where `score` is the summed rollout score, so the average is
/// `score / visits`.
#[wasm_bindgen]
pub fn mcts(state: &str, max_time_ms: u32, max_iterations: u32) -> String {
    let mut state = State::deserialize(state);
    let (s1, s2) = state.root_get_all_options();
    let result = perform_mcts(
        &mut state,
        s1,
        s2,
        Duration::from_millis(max_time_ms as u64),
        max_iterations,
    );
    mcts_result_json(&state, &result)
}

fn parse_choice(name: &str) -> Result<poke_engine::choices::Choice, String> {
    let id = Choices::from_str(name).map_err(|_| format!("unknown move: {name}"))?;
    let mut choice = MOVES
        .get(&id)
        .ok_or_else(|| format!("no move data: {name}"))?
        .to_owned();
    if name.eq_ignore_ascii_case("switch") {
        choice.category = MoveCategory::Switch;
    }
    Ok(choice)
}

/// Damage rolls for a move pair (poke-engine move ids, `"switch"` allowed),
/// as `{"s1":[...16 rolls...]|null,"s2":[...]|null}` (`null` = not damaging).
#[wasm_bindgen]
pub fn damage_rolls(
    state: &str,
    s1_move: &str,
    s2_move: &str,
    s1_moves_first: bool,
) -> Result<String, JsError> {
    let state = State::deserialize(state);
    let s1 = parse_choice(s1_move).map_err(|e| JsError::new(&e))?;
    let s2 = parse_choice(s2_move).map_err(|e| JsError::new(&e))?;
    let (d1, d2) = calculate_both_damage_rolls(&state, s1, s2, s1_moves_first);
    let fmt = |d: Option<Vec<i16>>| match d {
        Some(v) => format!(
            "[{}]",
            v.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(",")
        ),
        None => "null".to_string(),
    };
    Ok(format!("{{\"s1\":{},\"s2\":{}}}", fmt(d1), fmt(d2)))
}

/// Parse the state and serialize it back with the engine's own writer. The
/// driver uses this to check that every field of a mapped state was read as
/// intended (a field the parser treats differently shows up as a diff).
#[wasm_bindgen]
pub fn serialize_roundtrip(state: &str) -> String {
    State::deserialize(state).serialize()
}

/// Which of the comma-separated ids (poke-engine spelling: upper-case Showdown
/// ids) the engine does not know, for `kind` in species/move/item/ability.
/// Unknown names silently parse to the enum's default, so data files are
/// checked up front instead.
#[wasm_bindgen]
pub fn unknown_names(kind: &str, csv: &str) -> Result<String, JsError> {
    use poke_engine::engine::abilities::Abilities;
    use poke_engine::engine::items::Items;
    use poke_engine::pokemon::PokemonName;
    let unknown: Vec<String> = csv
        .split(',')
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .filter(|n| match kind {
            "species" => n.to_uppercase() != "NONE" && PokemonName::from_str(n) == Ok(PokemonName::NONE),
            "move" => n.to_uppercase() != "NONE" && Choices::from_str(n) == Ok(Choices::NONE),
            "item" => n.to_uppercase() != "UNKNOWNITEM" && Items::from_str(n) == Ok(Items::UNKNOWNITEM),
            "ability" => n.to_uppercase() != "NONE" && Abilities::from_str(n) == Ok(Abilities::NONE),
            _ => true,
        })
        .map(|n| json_str(n))
        .collect();
    if !matches!(kind, "species" | "move" | "item" | "ability") {
        return Err(JsError::new(&format!("unknown kind: {kind}")));
    }
    Ok(format!("[{}]", unknown.join(",")))
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATES: &str = include_str!("../bench/states.txt");

    #[test]
    fn no_tera_choices_are_ever_offered() {
        // Every fixture pokemon carries a tera type; with the feature compiled
        // out none of them may surface as a `-tera` choice.
        for line in STATES.lines().filter(|l| !l.trim().is_empty()) {
            let json = root_options(line);
            assert!(!json.contains("-tera"), "tera choice leaked: {json}");
            assert!(json.contains("\"s1\":[{\"kind\""), "no options parsed: {json}");
        }
    }

    #[test]
    fn mcts_runs_iteration_bounded() {
        let line = STATES.lines().next().unwrap();
        let json = mcts(line, 0, 2000);
        assert!(json.starts_with("{\"iterations\":"), "{json}");
        assert!(!json.contains("-tera"));
    }

    #[test]
    fn roundtrip_preserves_fixture_states() {
        for line in STATES.lines().filter(|l| !l.trim().is_empty()) {
            let once = serialize_roundtrip(line);
            assert_eq!(once, serialize_roundtrip(&once));
        }
    }

    #[test]
    fn unknown_names_flags_only_unknowns() {
        assert_eq!(unknown_names("species", "GARCHOMP,NOTAMON").unwrap(), "[\"NOTAMON\"]");
        assert_eq!(unknown_names("move", "earthquake,fakemove").unwrap(), "[\"fakemove\"]");
        assert_eq!(unknown_names("item", "LIFEORB,,BOGUSITEM").unwrap(), "[\"BOGUSITEM\"]");
        assert_eq!(unknown_names("ability", "LEVITATE,NOPE").unwrap(), "[\"NOPE\"]");
    }

    #[test]
    fn damage_rolls_report_both_sides() {
        let line = STATES.lines().next().unwrap();
        let s1 = parse_choice("PSYSHOCK");
        assert!(s1.is_ok());
        let json = damage_rolls(line, "psyshock", "bravebird", true).unwrap();
        assert!(json.starts_with("{\"s1\":["), "{json}");
    }
}
