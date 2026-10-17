// Shared by the Node and Worker benches. `engine` is the initialised
// wasm-bindgen module namespace; `states` is the list of serialized states.
export function runBench(engine, states, budgetMs, label) {
  const rows = [];
  for (let i = 0; i < states.length; i++) {
    const t0 = performance.now();
    const result = JSON.parse(engine.mcts(states[i], budgetMs, 0));
    const ms = performance.now() - t0;
    rows.push({ state: i, iterations: result.iterations, ms });
  }
  const mean = Math.round(rows.reduce((a, r) => a + r.iterations, 0) / rows.length);
  return { label, budgetMs, version: engine.engine_version(), rows, mean };
}

export function formatReport(report) {
  const lines = [
    `${report.label}  budget=${report.budgetMs}ms  ${report.version}`,
    `${"state".padEnd(6)}${"iterations".padStart(12)}${"ms".padStart(12)}`,
  ];
  for (const r of report.rows) {
    lines.push(`${String(r.state).padEnd(6)}${String(r.iterations).padStart(12)}${r.ms.toFixed(1).padStart(12)}`);
  }
  lines.push(`mean  ${String(report.mean).padStart(12)}`);
  return lines.join("\n");
}

export function parseStates(text) {
  return text.split("\n").filter((l) => l.trim().length > 0);
}
