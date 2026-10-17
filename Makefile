PY := .venv/bin/python

.PHONY: install test fmt lint harness

install: .venv/.installed

.venv/.installed: requirements-pure.txt requirements-dev.txt
	python3.11 -m venv .venv
	$(PY) -m pip install -q -r requirements-dev.txt
	touch $@

# ruff + the pure-layer suite (no Rust, Node, or Showdown needed)
test: install
	.venv/bin/ruff check
	$(PY) -m pytest -q tests

fmt: install
	.venv/bin/ruff format

lint: install
	.venv/bin/ruff check --fix

# Reference Python draft/loadout UI (battle endpoints are stubbed in v2).
harness: install
	$(PY) -m uvicorn rollmons.web_app:app --port 8973
