// Node (V8, same engine as Chrome) run of the wasm build. Requires
// `wasm-pack build --release --target web` to have produced engine/pkg.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runBench, formatReport, parseStates } from "./bench-shared.js";

const budgetMs = Number(process.argv[2] ?? 100);
const here = fileURLToPath(new URL(".", import.meta.url));
const engine = await import("../../engine/pkg/rollmons_engine.js");
engine.initSync({ module: readFileSync(`${here}/../../engine/pkg/rollmons_engine_bg.wasm`) });
const states = parseStates(readFileSync(`${here}/../../engine/bench/states.txt`, "utf8"));

// Warm-up: let V8 tier up the wasm (Liftoff -> TurboFan) before measuring.
engine.mcts(states[0], 300, 0);

console.log(formatReport(runBench(engine, states, budgetMs, `node ${process.version}`)));
