# Conventions for agents

Rules for coding agents (and humans) on this repository, each with its reason; a date points
to its line in `DECISIONS.md` or its journal.

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
- Interface: French, every string in `fr.json`, none inlined — titles and previews too (2026-10-07).

## Domain
- Every camera capability keeps its certainty (`identified`, `estimated`, `default`) — OSM
  rarely names the model, the map says what it guesses (2026-09-27).
- `camera:angle` in OSM is the **tilt**, not the field of view — the OSM wiki's definition.
- Defaults live in `rules/*.yaml`, each with an id and a rationale — assumptions, reviewed in
  one place (2026-09-27).
- Street segment ids are `way_id:from_node:to_node` — the future routing graph.

## Workflow
- `make check` passes before every commit; one small commit per task.
- Commits carry no `Claude-Session:` line and no conversation link — the history is public.
- Geometry changes (viewshed, exposure) come with a frozen case in `tests/` — accuracy first
  (2026-09-27).
- `DECISIONS.md` holds the decisions in force by theme (`date — decision — reason`); a changed
  one is rewritten in place, its old line moved to `docs/archive/decisions-journal-2026.md` —
  short enough to read whole.
- Docs: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/interface/` (in force, states,
  deviations, by screen), updated by each change. Update an existing document before creating
  one; every new document is justified by a line in `DECISIONS.md`.

## Working rules
- `make smoke` (CI's full matrix on the CI extract, every bench step of `web/scripts/gate.sh`)
  is green before any push; one push per batch of work. A push runs a light CI (check, phone
  in WebKit), the full matrix runs by `gh workflow run ci.yml --ref main` — CI time (2026-10-06).
- One build, gate or deploy at a time on a machine: `lacarte build`, `make smoke` and
  `deploy/deploy.sh` share a lock and stop if it is taken; `make lock` says who holds it,
  `make unlock` lifts it only when its process is gone.
- Sub-agents run in parallel only on disjoint files, each in its own git worktree; the main
  session alone integrates, pushes, builds data and deploys; no agent reviews its own work
  (2026-10-06).
- Redesign: fidelity to the mockup (kept outside the repository) comes first (2026-10-07). Start
  each component from its rendered HTML and CSS as is, then wire the data. A deviation needs
  a cited reason (a DECISIONS line, an accessibility criterion, data that does not fit) and a
  row in its zone's « Écarts à la maquette » table in `docs/interface/`; without one it is a
  bug. Use the mockup's vocabulary before inventing a component. Touch targets are for what
  is touched: an information row is not a button.
- Before an interface change ships, each screen is compared with its board at the board's
  size (960×581 CSS @2 wide, 390×845 @2 phone), same mode, real data close to the board's,
  deviations listed; reviewers compare screen to board, not only code to rules (2026-10-07).
