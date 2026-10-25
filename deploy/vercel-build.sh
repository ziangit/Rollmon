#!/bin/sh
# Vercel build on Vercel's build image (which has Node but no Rust): engine
# wasm, the site, and the leaderboard/accounts function. Emits the Build Output
# API layout (.vercel/output): static site + one Node function serving
# /api/leaderboard, /api/auth/<op> and /api/feedback (docs/ROADMAP.md §7).
#   vercel.json: installCommand "cd web && npm ci", buildCommand "sh deploy/vercel-build.sh"
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
(cd web && npm run build -- --minify && node scripts/build-api.mjs)

out=.vercel/output
rm -rf "$out"
mkdir -p "$out/functions/api"
cp -R web/dist "$out/static"
cp -R web/dist-api/api/leaderboard.func "$out/functions/api/leaderboard.func"
cat > "$out/config.json" <<'JSON'
{
  "version": 3,
  "routes": [
    {"src": "^/api/leaderboard/?$", "dest": "/api/leaderboard"},
    {"src": "^/api/auth/([a-z]+)/?$", "dest": "/api/leaderboard?auth=$1"},
    {"src": "^/api/feedback/?$", "dest": "/api/leaderboard?op=feedback"},
    {"src": "^/data/(.*)$", "headers": {"cache-control": "public, max-age=0, must-revalidate"}, "continue": true},
    {"src": "^/(.*)\\.wasm$", "headers": {"content-type": "application/wasm"}, "continue": true},
    {"handle": "filesystem"}
  ]
}
JSON
echo "build output:" && find "$out" -maxdepth 3 -not -path '*/static/*' | sort && ls "$out/static"
