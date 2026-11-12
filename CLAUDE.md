# Conventions for agents

Rules for agents and humans. A rule ends with its reason when one is recorded; a date names
its line in `DECISIONS.md` or the journal.

## Hard rules
- Never clone, read or search the source code of other surveillance-mapping projects
  (PanoptiCity is under CNPLv7+, which forbids AI use; Surveillance under Surveillance…).
  Legitimate sources only: OSM data (ODbL), the OSM wiki, taginfo, manufacturers'
  datasheets, standards, public documents, library documentation.
- The repo must be publishable at any time: no secrets, no host names or addresses, no
  personal files, no downloaded data. Only small fixtures under `tests/fixtures/` are
  versioned, with OSM attribution. Servers, hosts and secrets live in environment variables.
- Everything heavy is precomputed; the browser only renders vector tiles. No tracking, no
  third-party runtime service.

## Language
- Code, identifiers, comments, commits, repo docs: English; README and CONTRIBUTING: French.
- Interface: French, every string in `fr.json`, none inlined.

## Domain
- Each camera capability has a certainty, never dropped: `identified` (exact model known),
  `estimated` (observations, detailed tags), `default` (generic assumption) — OSM rarely names
  the model, the map says what it guesses (2026-09-27).
- `camera:angle` in OSM is the **tilt**, not the field of view — the OSM wiki's definition.
- Defaults live in `rules/*.yaml`, each with an id and a rationale, never hard-coded —
  assumptions, reviewed in one place (2026-09-27).
- Street segment ids are `way_id:from_node:to_node` — the future routing graph.

## Workflow
- `make check` passes before every commit; one small commit per task.
- Commits carry no `Claude-Session:` line nor conversation link — the history is public.
- Geometry changes (viewshed, exposure) need a frozen case in `tests/` — accuracy first
  (2026-09-27).
- Record every structural decision as one line in `DECISIONS.md` (`date — decision —
  reason`), which holds those in force by theme: a changed one is rewritten in place, its old
  line moved to `docs/archive/decisions-journal-2026.md` — short enough to read whole.
- Docs: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/interface/` (by screen), updated by
  each change. Update an existing document before creating one; a new document is justified
  by a line in `DECISIONS.md`.

## Working rules
- `make smoke` (`web/scripts/gate.sh`: CI's full matrix, locally) is green before any push;
  one push per batch. A push or PR runs a light CI (check, phone in WebKit); the full matrix runs
  by `gh workflow run ci.yml --ref main` — CI time (2026-10-06).
- One build, gate or deploy at a time per machine: `lacarte build`, `make smoke`,
  `deploy/deploy.sh` share a lock and stop if taken; `make lock` says who holds it,
  `make unlock` lifts it once its holder is gone.
- Sub-agents run in parallel only on disjoint files, each in its own git worktree; the main
  session alone integrates, pushes, builds data and deploys; no agent reviews its own work
  (2026-10-06).
- Redesign: fidelity to the mockup (kept outside the repository) comes first (2026-10-07).
  Start each component from its rendered HTML and CSS as is, then wire the data. A deviation
  needs a cited reason (a DECISIONS line, an accessibility criterion that cannot be met
  otherwise, data that does not fit) and a row in its zone's « Écarts à la maquette » table
  in `docs/interface/`; without one it is a bug. Meet a rule with the mockup's own vocabulary
  before inventing a component. Touch targets are for what is touched: an information row is
  not a button.
- Before an interface change ships, each screen is compared with its board at its size
  (960×581 CSS @2 wide, 390×845 @2 phone), same mode, real data close to the board's,
  deviations listed; reviewers compare screen to board, not code to rules alone (2026-10-07).
