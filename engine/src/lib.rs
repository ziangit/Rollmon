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
use poke_engine::state::State;
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
    let items: Vec<String> = choices
        .iter()
        .map(|c| json_str(&c.to_string(side)))
        .collect();
    format!("[{}]", items.join(","))
}

/// Legal root choices for both sides, as `{"s1":[...],"s2":[...]}`.
/// Choice strings use poke-engine's own spelling (`"PSYSHOCK"`,
/// `"PSYSHOCK-mega"`, `"switch GARCHOMP"`), the same strings MCTS reports.
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

pub fn mcts_result_json(state: &State, result: &MctsResult) -> String {
    let side = |items: &[poke_engine::mcts::MctsSideResult], side: &poke_engine::state::Side| {
        let rows: Vec<String> = items
            .iter()
            .map(|r| {
                format!(
                    "{{\"choice\":{},\"score\":{:.3},\"visits\":{}}}",
                    json_str(&r.move_choice.to_string(side)),
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
/// Returns `{"iterations":N,"s1":[{"choice","score","visits"}...],"s2":[...]}`
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
            assert!(json.contains("\"s1\":[\""), "no options parsed: {json}");
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
    fn damage_rolls_report_both_sides() {
        let line = STATES.lines().next().unwrap();
        let s1 = parse_choice("PSYSHOCK");
        assert!(s1.is_ok());
        let json = damage_rolls(line, "psyshock", "bravebird", true).unwrap();
        assert!(json.starts_with("{\"s1\":["), "{json}");
    }
}
