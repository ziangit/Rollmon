//! Native MCTS throughput: iterations completed per time budget, per state.
//! Mirrors `spikes/engine-bench/` (same states, same budget) so wasm and
//! native numbers are comparable.
//!
//!   cargo run --release --bin bench -- [budget_ms] [states_file]

use poke_engine::mcts::perform_mcts;
use poke_engine::state::State;
use std::time::{Duration, Instant};

fn main() {
    let mut args = std::env::args().skip(1);
    let budget_ms: u64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(100);
    let path = args
        .next()
        .unwrap_or_else(|| concat!(env!("CARGO_MANIFEST_DIR"), "/bench/states.txt").to_string());
    let contents = std::fs::read_to_string(&path).expect("read states file");

    println!("native  budget={budget_ms}ms  {}", rollmons_engine::engine_version());
    println!("{:<6}{:>12}{:>12}", "state", "iterations", "ms");
    let mut total = 0u64;
    let mut n = 0u64;
    for (i, line) in contents.lines().filter(|l| !l.trim().is_empty()).enumerate() {
        let mut state = State::deserialize(line);
        let (s1, s2) = state.root_get_all_options();
        let start = Instant::now();
        let result = perform_mcts(&mut state, s1, s2, Duration::from_millis(budget_ms), 0);
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        println!("{:<6}{:>12}{:>12.1}", i, result.iteration_count, elapsed);
        total += result.iteration_count as u64;
        n += 1;
    }
    println!("mean  {:>12}", total / n.max(1));
}
