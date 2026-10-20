REGION ?= ci
.PHONY: install lint test web-test check build web-assets web web-lint bench smoke smoke-full lowend try rehearse rehearse-restore lock unlock

install:
	uv sync
	npm --prefix web ci

lint:
	uv run ruff check .
	uv run ruff format --check .

test:
	uv run pytest

web-lint:
	cd web && npx biome check . && npx tsc --noEmit

# The phone's magnet against Python's frozen cases (tests/fixtures/magnet-cases.json), the
# questions, and the themes' tokens (contrast, completeness).
web-test:
	cd web && node --test --experimental-strip-types tests/*.test.ts

check: lint test web-lint web-test

# Whole pipeline from the region's .osm.pbf (see regions.yaml); fails on a QA violation.
# A build, the gate (smoke) and deploy/deploy.sh hold one lock for the whole machine
# (pipeline/lacarte/lock.py, outside the repository): taken, they stop at once and say by
# whom. `make lock` says who holds it; `make unlock` lifts it when its process is gone.
build:
	uv run lacarte build --region $(REGION)

lock:
	uv run --quiet python -m lacarte.lock status

unlock:
	uv run --quiet python -m lacarte.lock break

# Self-hosted basemap fonts/sprites + link the region's tiles into web/public.
web-assets:
	web/scripts/fetch-assets.sh $(REGION)

web: web-assets
	npm --prefix web run dev

bench:
	npm --prefix web run build
	cd web && node bench/zoom.mjs --region $(REGION)

# The local gate, before any push (web/scripts/gate.sh): CI's full matrix on the CI extract
# (map on a desktop, phone and participation in WebKit and Chromium, each on --ui classique
# and --ui punk, the themes' and the punk chips' tests in both engines), then the current
# interface pixel for pixel against the code before the redesign (shots-theme, shots-add,
# shots-complete, pixeldiff): its web tree from git (GATE_REF, default b935b91) or from a
# tarball of it kept outside the repository (GATE_REF_TAR); with neither, that step is
# skipped and said so. It builds in build/gate/: web/dist and the region linked in
# web/public stay as they are. Needs the CI extract built from the CI fixture, as CI does:
#   mkdir -p data/contrib && cp tests/fixtures/contrib-ci.jsonl data/contrib/ci.jsonl
#   make build REGION=ci
# `make smoke ONLY="participate theme"` runs the steps whose names start so; logs in
# build/gate/logs/.
smoke:
	web/scripts/gate.sh $(ONLY)

# Rehearse the pending migrations on a copy of the preview database the owner downloaded
# (db/rehearse_migrations.sh): restored into a throwaway local PostGIS cluster, migrated,
# summed up, dropped; the dump kept. make rehearse DUMP=data/backups/repetition-014.dump
rehearse:
	uv run --project pipeline python db/rehearse_local.py $(DUMP)

# Rehearse the restore on a fresh database (db/restore.sh, as the deploy role of a throwaway
# local cluster set up as bootstrap.sh sets up the server), then list the test accounts
# (db/purge_test_accounts.sh, nothing deleted): the dump kept, the cluster dropped.
#   make rehearse-restore DUMP=data/backups/<copy>.dump [TEST_AUTHORS=ivo] [KEEP=joe]
rehearse-restore:
	TEST_AUTHORS="$(TEST_AUTHORS)" KEEP="$(KEEP)" uv run python db/rehearse_restore.py $(DUMP)

# Try the site by hand (web/bench/try.mjs): the working tree's web build, the participation
# API on a throwaway database with the CI extract and its test data, accounts ivo and rev
# (the review account); http://127.0.0.1:4470/?ui=punk, ?as=rev to switch, Ctrl-C stops
# everything. SEED=empty for no contribution.
try:
	node web/bench/try.mjs $(if $(SEED),--seed $(SEED))

# The map and phone smoke tests on REGION (its tiles linked in web/public: make web-assets),
# in web/dist, with 20 repeated taps per phone engine (CI runs 5). Not a gate.
smoke-full:
	npm --prefix web run build
	cd web && node bench/smoke.mjs --region $(REGION)
	cd web && node bench/smoke-mobile.mjs --region $(REGION) --browser webkit --taps 20
	cd web && node bench/smoke-mobile.mjs --region $(REGION) --browser chromium --taps 20

# Low-end observation: phone screen, CPU x6, slow 4G, cold cache (not a gate).
lowend:
	npm --prefix web run build
	cd web && node bench/lowend.mjs --region $(REGION)
