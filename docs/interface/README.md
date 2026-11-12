# Interface

What the web interface shows today, every state its code can be in, and every place where
it differs from the mockup. One file per screen or zone; the state catalogue stays whole in
`states.md`, because `web/bench/shots-states.mjs` reads it as one table per screen against
`web/bench/states/catalogue.mjs`.

A change to the interface updates, in the same commit, its zone's file here (what is in
force, its deviations) and, when it adds, alters or removes a state, that state's row in
`states.md` and its entry in `web/bench/states/catalogue.mjs`.

| File | Holds | Was in `docs/interface.md` |
|---|---|---|
| [shared.md](shared.md) | one interface, the punk bricks every screen shares | §1.1, §1.2; §3 « All screens » |
| [map.md](map.md) | the map by zoom, filters and legend, focus and the zoom-out marker | §1.3, §1.5; §3 « Map, filters and legend » |
| [sheets.md](sheets.md) | the camera sheet, the commune, arrondissement and département sheets | §1.4; §3 « Camera sheet », « Commune and département sheets », « Map sheets v3 » |
| [participation.md](participation.md) | journeys (« Toujours là ? », add, « Modifier »), the send queue, /revue | §1.6; §3 « Participation », « /revue » |
| [accounts.md](accounts.md) | accounts, the account's screen, settings and about, the leaderboard | §1.7; §3 « Account », « Settings and about », « The account's screen » |
| [welcome.md](welcome.md) | the welcome panel and the points at send, loading, the launch lot | §1.9 to §1.11; §3 « Welcome », « Loading », « The launch lot » |
| [register.md](register.md) | the register (registre): lots R0 to R3, v2, the redesign v3 | §1.12 to §1.22; §3 « The register … » |
| [planned.md](planned.md) | decided, not yet built | §1.8 |
| [states.md](states.md) | the state catalogue (§2): counts, one table per screen, how captures are made | §2 and the old preamble |

The section numbers kept in the headings (« 1.4 The camera sheet ») are those of the old
single file, so that a reference such as « §1.4 » or « §3 « Map sheets v3 » » in the code,
the journal or a commit still finds its text through the table above.

## In force

Each point gives the `DECISIONS.md` line (by date) it rests on. A line cited by its date
and first words that is no longer in `DECISIONS.md` is in the journal,
`docs/archive/decisions-journal-2026.md`.

## Deviations from the mockup (« Écarts à la maquette »)

The punk interface ports the mockup (`Carte punk.dc.html`, export of 2026-10-06, the product
owner's file, not in the repository) as it is drawn; every place where the code differs has a
row in its zone's « Deviations » table with its reason — a DECISIONS line, an accessibility
criterion that cannot be met otherwise, or real data that does not fit (DECISIONS
2026-10-07, « Fidelity to the mockup comes first… »). A deviation without a row is a bug. One
table per screen, filled by the screen's lot; `shared.md` holds what every screen shares.
