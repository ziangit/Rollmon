#!/bin/sh
# Vercel build: the same steps as .github/workflows/pages.yml, on Vercel's
# build image (which has Node but no Rust). Installs a minimal rustup
# toolchain and wasm-pack when missing, builds the engine wasm, then the site.
#   vercel.json: installCommand "cd web && npm ci", buildCommand "sh deploy/vercel-build.sh", output web/dist
set -eu
cd "$(dirname "$0")/.."
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export PATH="$CARGO_HOME/bin:$PATH"

if ! command -v cargo >/dev/null 2>&1; then
  curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path --target wasm32-unknown-unknown
fi
rustup target add wasm32-unknown-unknown
if ! command -v wasm-pack >/dev/null 2>&1; then
  curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
fi

(cd engine && wasm-pack build --release --target web --out-dir pkg)
(cd web && npm run build -- --minify)
echo "built web/dist:" && ls web/dist
