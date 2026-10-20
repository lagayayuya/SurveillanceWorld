# Conventions for agents

Working rules for coding agents (and humans) on this repository.

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
- Code, identifiers, comments, commits, repo docs: English (README and CONTRIBUTING: French).
- User interface: French, every string goes through the i18n catalogue (`fr.json`), none inlined.

## Domain
- Every camera capability has a certainty: `identified` (exact model known), `estimated`
  (from observations / detailed tags), `default` (generic assumption). Never drop it.
- `camera:angle` in OSM is the **tilt**, not the field of view.
- Default values live in `rules/*.yaml`, each with an id and a rationale; never hard-code them.
- Street segment ids are `way_id:from_node:to_node`; they are the future routing graph.

## Workflow
- `make check` must pass before committing. One small commit per task.
- Commit messages carry no `Claude-Session:` line and no link to a conversation or a session.
- Geometry changes (viewshed, exposure) need a frozen test case in `tests/`.
- Record every structural decision as one line in `DECISIONS.md`
  (`date — decision — reason`). Docs: `README.md`, `CONTRIBUTING.md`, `SECURITY.md` and
  `docs/interface.md` (the interface in force and its state catalogue), kept up to date by
  each change; no other docs unless asked.
- `DECISIONS.md` is a journal: never rewrite a past line; add a line that says what it
  supersedes and append a short marker to the old one (« → remplacée le <date> »).

## Working rules
- `make smoke` (the local gate: CI's full matrix on the CI extract, and the classic interface
  pixel for pixel against its reference when `GATE_REF_TAR` gives one) is green before any
  push.
- One push per batch of work; inside it, still one small commit per task.
- One build, gate or deploy at a time on a machine: `lacarte build`, `make smoke` and
  `deploy/deploy.sh` take a common lock and stop if it is taken; `make lock` says who holds
  it, `make unlock` lifts it only when its process is gone.
- A push or a pull request runs a light CI (check, phone in WebKit); the full matrix runs by
  workflow_dispatch (`gh workflow run ci.yml --ref main`).
- Sub-agents run in parallel only on disjoint files, each in its own git worktree. The main
  session alone integrates, pushes, builds data and deploys. An agent never reviews its own
  work.
- Redesign: fidelity to the mockup (kept outside the repository) comes first. Start every
  component from the mockup's rendered HTML and CSS, taken as is, then wire the data. A
  deviation needs a cited reason (a DECISIONS line, an accessibility criterion that cannot be
  met otherwise, or data that does not fit) and a row in the « Écarts à la maquette » table
  of `docs/interface.md`; a deviation without a reason is a bug. Meet a rule with the
  mockup's own vocabulary before inventing a component. Touch targets are for what is
  touched: an information row is not a button.
- Before a change to the interface ships, each screen is compared with its board at the
  board's size (960×581 CSS at scale 2 on a wide screen, 390×845 at scale 2 on a phone),
  same mode, real data close to the board's example, with the deviations listed. Reviewers
  compare the screen to the board, not only the code to the rules.
