// Runs the benchmark off the UI thread, as the real battle worker will.
import init, * as engine from "../../engine/pkg/rollmons_engine.js";
import { runBench, parseStates } from "./bench-shared.js";

self.onmessage = async ({ data: { budgetMs } }) => {
  await init();
  const states = parseStates(await (await fetch("../../engine/bench/states.txt")).text());
  engine.mcts(states[0], 300, 0); // warm-up (wasm tier-up)
  self.postMessage(runBench(engine, states, budgetMs, `chrome worker ${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? ""}`));
};
