# engine-bench spike

Measures single-thread MCTS throughput of the wasm engine build against the
native binary, on the ten states in `engine/bench/states.txt` (first ten
lines of poke-engine's `data/gen9randombattle.txt`, MIT).

```
# native
cd engine && cargo run --release --bin bench -- 100

# wasm (build once)
cd engine && wasm-pack build --release --target web --out-dir pkg

cd spikes/engine-bench && npm install
npm run node            # V8 in Node, same wasm as the browser
npm run chrome          # headless Chrome, inside a Web Worker (needs Chrome installed)
npm run serve           # then open http://localhost:8974/spikes/engine-bench/
```

Each row is the number of MCTS iterations completed in the budget. The
`mean` line is what to compare across runs.
