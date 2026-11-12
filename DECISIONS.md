# Decisions

The decisions in force, by theme: `date — decision — reason`. A decision that changes is rewritten in place (its date becomes the new one) and the line it replaces goes, word for word, to the journal `docs/archive/decisions-journal-2026.md`, which also holds every decision up to 2026-11-12. A new document is justified by a line here. Code comments and docs/interface/ cite decisions by date and first words; one that is not here is in the journal.

## Scope and licences
- 2026-09-27 — v1 scope is "see" only; exposure per street segment is kept as the future routing cost — roadmap order: see, avoid, survey.
- 2026-09-27 — Code under AGPL-3.0-or-later, derived data under ODbL 1.0 — requested licences; ODbL is required by OSM-derived databases.
- 2026-10-11 — Product name « Surveillance World » (was « Surveillance.Fun »); the offbeat tone and gadgets stay, but no mocking visual is ever tied to a named operator — the map shows facts, it mocks no one.
- 2026-10-22 — Metropolitan France, Corsica included, opened in one go; overseas is a later region (other projections, own basemap); participation tables, API and browser metric plane stay in Lambert-93 — user decision.
- 2026-09-27 — Camera catalogue (catalogue/models.csv, tenders.csv) from manufacturer pages, datasheets and tenders readable without an account only; optics left empty when unpublished — clean-room rule.
- 2026-10-13 — Contributions are CC0 so the layer can be published under ODbL; four legal pages; each account can download its data as JSON; PUBLISHER_IDENTITY shown in the legal notice only when filled — user decision.
- 2026-10-14 — Third-party licence notices are served (/licences.txt built from the shipped packages; a package without a text stops the build); credit « construit avec Protomaps », data © OSM contributors — user decision.

## Data and pipeline
- 2026-09-28 — Python pipeline (uv, pyosmium, shapely 2) writing GeoParquet, no database; PostGIS for contributions only — the batch stays reproducible, contributions are live shared state.
- 2026-10-22 — France is built in 22 parts (former regions) cut along their départements widened by 480 m, merged by ownership (camera, segment midpoint, building) with one set of filters and numbers — one France build needs 125–170 GB.
- 2026-10-23 — Build id = region + latest camera edit + 8 hex of inputs, rules and pipeline code (participation API excluded), in meta.json and the database; the basemap has its own id, so a basemap change forces no France rebuild — user decision.
- 2026-09-28 — Communes, arrondissements, départements from IGN ADMIN EXPRESS COG CARTO (Licence Ouverte 2.0), never versioned; Paris, Lyon, Marseille are replaced by their arrondissements found from the data — user decision.
- 2026-09-28 — Street and filmed length per commune are cut at the limits (distance along the segment) and the build fails unless they add up; a stretch within 10 m of a commune goes to it — user decision.
- 2026-10-23 — A camera outside France's OSM outline and over 10 m from every commune is left out; one inside France but outside every commune goes to the nearest within 500 m — user decision.
- 2026-10-16 — Streets rule 3.1: the map measures and colours every drawn way, but published shares count street axes only (not sidewalks, crossings, paths beside a road, path, bridleway, track, motorway); both carriageways of a road count — user decision.
- 2026-10-22 — Unfilmed segments are drawn only in communes where a camera stands, and tracks, paths, motorways, bridleways only where filmed (elsewhere the basemap's roads) — tile weight; user decision.

## Viewshed and exposure
- 2026-09-27 — Exact viewshed (rays to building corners ± epsilon, cone edges, sampled range arc), no fixed angular step — accuracy is a first-rank criterion.
- 2026-10-08 — Wall cameras are snapped 0.5 m out of their building, at most 10 m deep (deeper = data error, no view); a camera a participant places inside a footprint stops that building blocking within 10 m — user decision.
- 2026-09-27 — QA fails the build on a leak (view passing between two buildings under 30 cm apart), a property violation or an uncut view; grazing wedges accepted; 30 cm and 0.25 m2 stay [TO ADJUST] — user decision. [to check]
- 2026-09-28 — Uncertain optics: a (resolution, hfov) range per camera, sampled; rules/optics.yaml holds p10/p50/p90 per type × generation from the catalogue (`lacarte calibrate`), sparse cells pooled and visible; the ≤2015 generation stays certainty default — user decision.
- 2026-10-06 — Levels follow IEC 62676-4:2014 DORI (25 / 62.5 / 125 / 250 px/m); three are drawn, named identifier / reconnaître / détecter (25 px/m, the display floor); ranges are rounded up to the metre in the pipeline — user decision.
- 2026-09-30 — Two hypotheses, Standard (p ≥ 0.5, default) and Prudent (p ≥ 0.1); « certain » (p ≥ 0.9) is computed but not shown; each estimate and level is measured on the union with the more certain / demanding ones so they nest — user decision.
- 2026-09-27 — Filled fields capped at 180 m; camera:angle is read as tilt only between 5 and 80 deg and when height is at least estimated.
- 2026-10-08 — A camera without a surveyed direction keeps every band, computed as for any other, and is drawn as a full circle like the others (no hatching); its sheet says « Direction non relevée » — user decision.
- 2026-09-30 — PTZ: the filled field is the wide-angle one; the zoomed reach is not drawn (a risk of being targeted, not a zone filmed) and is only quoted in the sheet — user decision.
- 2026-09-30 — Exposure per level on the p ≥ 0.5 band plus expected length as the future routing cost; it overestimates for cameras without direction, the « avoid » phase will use the direction model — user decision.
- 2026-09-30 — A camera whose drawn field is under 10 m2 or drawn over 10 m inside a building reads « Position ou direction à vérifier », with no reach — user decision.

## Cameras and certainty
- 2026-09-27 — Four operator classes (public / private outdoor / private indoor / unknown); « films the public street » is a computed badge — OSM tags rarely say who films.
- 2026-10-23 — Operator names are normalised in rules/operators.yaml, class « estimated » when tags are silent (priority operator:type, name table, patterns, surveillance=*); municipal and département names take the official « Ville de X » — user decision.
- 2026-10-01 — « Particulier » = household: private, no CNIL signal, no complaint link, never a name list, never exported — user decision.
- 2026-10-23 — A multi-dome is its own kind (`multidome`: camera:type=dome, camera:count ≥ 2), dome optics, full circle; published as camera:type=dome + camera:count only when N is known — user decision.
- 2026-10-05 — No new camera type until a type-by-type table (optical class, effect on the field, recognisable from the street, OSM tag) is approved; the shape question keeps four answers (petit dôme, tube, grosse boule, je ne sais pas) — user decision.
- 2026-09-30 — A camera verified gone leaves fields, streets, shares and counts but stays in the tiles and database (grey pictogram only with its advanced filter); distinct from the fixme « maybe gone » badge — user decision.
- 2026-09-30 — Advanced filters sit in a drawer; freshness = max(check_date, survey:date) in < 1 y / 1–3 y / > 3 y / never; capabilities come from tags only; what a filter excludes is hidden, not faded — user decision.

## Tiles and basemap
- 2026-09-27 — tippecanoe → PMTiles served statically over HTTP Range, MapLibre GL JS; everything heavy is precomputed and the browser only renders vector tiles — cheapest self-hostable stack, no tile server.
- 2026-10-23 — The basemap is ours: self-hosted Protomaps extract in light and dark flavours, no points of interest, French and English names only, landuse the style never draws removed (`lacarte basemap strip`) — user decision.
- 2026-10-23 — Zoomed out the region stays whole and centred; départements from z4, commune outlines from z7.5, streets from z11 (merged axes to z14, portions with cameras and exact filters from z15) — user decision.
- 2026-10-09 — Fixed classes for communes and départements: < 5, 5–15, 15–30, 30–50, ≥ 50 % of streets in range (rules/admin.yaml), same for both and for « Publiques » — user decision.
- 2026-10-22 — No tile above 500 KiB in any archive; a new region's tiles are checked tile by tile against its first build — user decision.
- 2026-10-16 — Punk map: basemap roads above the fields from z15 (paths z16), water see-through over them, every street at least as wide as the basemap's road of its class — user decision.

## Interface and redesign
- 2026-10-23 — The classique design is removed: punk is the site; every colour, font, radius, shadow, texture and duration goes through tokens (theme/punk/), so a sober theme later costs one tokens file — user decision.
- 2026-10-05 — The redesign changes the look, not what is drawn (exact fields cut by buildings, IEC levels, Standard / Prudent, certainty chips, participation rules, privacy, published figures) — user decision.
- 2026-10-07 — Fidelity to the mockup comes first: each component starts from the mockup's rendered HTML and CSS as is; a deviation needs a cited reason and a row in its zone's « Écarts à la maquette » table in docs/interface/; touch targets only for what is touched — user decision.
- 2026-10-07 — Fidelity stop point before every deploy: each screen against its board at the board's size (960×581 @2 wide, 390×845 @2 phone), same mode, real data, deviations listed; the owner validates fidelity first — user decision.
- 2026-10-08 — One palette anchored on 17a's electric pink in light and dark: the more vivid, the more filmed; 3:1 comes from a darker outline, never darker fills; the three levels differ by shape (halftone density, solid / dashed / dotted outline); highest level shown, never a sum — user decision.
- 2026-10-06 — Animations: ≤ 400 ms for whatever delays access to content; a longer decorative one must block nothing, stop under reduced motion, flash ≤ 3 times a second and never loop forever — user decision.
- 2026-10-09 — Dark mode follows the phone; one sun/moon button keeps the choice on the device; colour pairs are held by contrast tests (text 4.5:1, graphics 3:1) — user decision.
- 2026-10-05 — Fonts self-hosted: Archivo (OFL 1.1, variable, weights 800–900) and Special Elite (Apache 2.0); other glyphs are SVG icons — user decision.
- 2026-09-28 — Phone first: touch targets ≥ 44 px, smoke tests in WebKit (iPhone 14 profile) with real taps; the estimate bar shows on desktop too — user decision.
- 2026-10-17 — Welcome panel at the first visit only (remembered on the device), reopened by « ? »; title « The most magical place on Earth », « imaginé par lagayayuya » with a mailto from CONTACT_EMAIL, no FAQ; icons are logo L3 (variant C at 16/32 px) — user decision.

## Map and sheets
- 2026-09-30 — Top bar offers Standard and Prudent (links ?est=prudent); the URL follows the map; a camera is shared with « Partager » (?cam=) — user decision.
- 2026-10-08 — Focus on a camera: the rest dims to 15 %, the three levels are a choice (identifier default), the map shows the chosen level with one label, the camera's whole zone always shows; driven by style only — user decision.
- 2026-10-18 — A tapped camera leaves the map where it is, moving only to bring its tap target out from under the panels (300 ms, zoom kept); every gesture leaves « Suivi » — user decision.
- 2026-10-08 — Camera sheet after 17a: sourced facts as rows with a source tag (« OSM », « sur place » only if on site, « supposé », « réponse », « contribution », « en attente de revue »); certainty in 17a's language (identified: value; estimated: after « ~ »; default: in the « Supposé » box), never by colour alone; distances rounded up, no « Vérifié » stamp — user decision.
- 2026-10-13 — Dates are months, never days (reviewers and the person's own list keep the day); « sur place » is said only when on_site is true — user decision.
- 2026-10-09 — Pending proposals (adds, moves, disappearances) are shown to every account, no author on the map, drawn only from the stickers' zoom with the « correction en attente » tape — user decision.
- 2026-10-19 — A camera's public sheet ends with its history: accepted contributions only, each with what changed, the month and « par un contributeur » (pseudonym only if its author opted in, off by default), two lines at most — user decision, to validate. [to check]
- 2026-10-08 — CNIL box suspended in the punk interface until further notice; the signal's wording needs a legal review before any public release — user decision. [to check]
- 2026-10-06 — Area sheets show only Y, the share of streets within reach of at least one camera (Prudent, every camera, direction ignored), worded as a maximum; X is not shown — user decision.
- 2026-11-11 — Area sheets follow board 12: a shared « Combien en manque-t-il ? » block (cameras on the map vs authorised in the register, « + N », « au moins + N » when acts are not tied to a commune, « non lu », never 0); a département opens framed whole and is named with its article — Ju validated.

## Contributions, review and accounts
- 2026-10-01 — Contributions are idempotent (uuid v4 in the request body, never in a URL; same body = no-op, other = 409), queued offline, and keep the camera's OSM tags and version and the build id — user decision.
- 2026-10-16 — No contributor position, IP or time of day is stored, only the day; on_site comes from the phone's last fix (≤ 60 s, ≤ 50 m), else unknown; the position never leaves the device; logs never name a camera — user decision.
- 2026-10-09 — « Modifier » replaces Compléter, Déplacer and Corriger; adding and modifying are one component (Position / Forme / Direction / Hauteur et inclinaison / Exploitant), one idempotent send with a summary; placement is always free; « Je ne sais pas » first on every line and never overwrites in Modifier — user decision.
- 2026-10-09 — In an add, a line left on the preselected « Je ne sais pas » sends nothing; a tap on it sends « je ne sais pas » — my reading, to be confirmed. [to check]
- 2026-10-13 — Questions: height in metres (~2, ~4, 6 m et +), stored as classes at certainty estimated; tilt asked for a tube and a small dome, as classes never degrees; photos are not coded (design: cropped on the camera, resized, stripped, source kept in the database) — user decision.
- 2026-10-12 — Who films: a name not in rules/operators.yaml may be proposed only after Public or Commerce, never after Particulier, and is shown nowhere until a reviewer keeps, replaces or drops it — user decision.
- 2026-10-01 — A camera the map lacks is an `add` (id `c` + 12 hex of its uuid); an OSM camera within 5 m of its final position is a duplicate conflict unless the contributor was shown it or the review kept both — user decision.
- 2026-10-16 — Validation is manual (peer validation off; agreement only orders the queue); accepted contributions (validated, applied, superseded) are exported and replayed at every build, latest move or sighting wins; a validated correction wins over the OSM version it saw, a later OSM change makes it a conflict — user decision.
- 2026-10-16 — Hidden cameras: a server list (id and day only) dropped at the build's first stage from every output, managed from /revue — user decision.
- 2026-10-11 — Every contribution needs an account; reading needs none. Sign-in is OpenStreetMap only (OAuth 2.0 PKCE, token revoked at once, only the numeric OSM id kept); password accounts remain for reviewers and tests; stored: pseudonym, hash, role, month, flags, hashed session (30 days); no email, no IP — user decision.
- 2026-10-10 — « Supprimer mon compte » keeps contributions without author; points (rules/leaderboard.yaml) count accepted contributions only, in the month of the decision; the leaderboard is opt-in and never shows test, disabled or placeholder accounts — user decision.
- 2026-10-16 — Roles: contributor, reviewer, administrator (accounts, roles, hidden cameras, settings, journal, statistics, CSV export); reviewers sign in to /revue only, behind its Caddy password, 8 h; destructive actions ask the password again; action journal kept 12 months, no time, no address — user decision.
- 2026-10-16 — Contributions and sign-ups open/closed are database settings changed from /revue; an administrator can suspend an account and reject its waiting sends in one gesture, reversible — user decision.
- 2026-10-02 — The author may withdraw a pending contribution; test accounts (TEST_AUTHORS) are stored and marked, never exported nor published — user decision.

## OSM publishing
- 2026-10-10 — OpenStreetMap is the only third-party service the site calls at use, only when the person chooses it (sign-in; publishing in their name); the map never calls it — user decision; exception to « no third-party service at runtime ».
- 2026-10-16 — Publishing is a synchronisation the person chooses in « Compte » (their consent): their on-site contributions received after the choice, accepted one by one by a reviewer and applied by a build, leave under their own OSM account, never in the project's name — user decision (not an automated edit, not an import).
- 2026-10-16 — It sends exactly what the person sent, at the version they saw; an existing value is never overwritten (conflict to the review), a vertex camera never moved, an add stops within 5 m of an OSM camera; one changeset per person per pass every 15 min, ≤ 4 a day, ≤ 50 cameras, tagged #SurveillanceWorld — user decision.
- 2026-10-23 — What leaves: shape → camera:type, direction → camera:direction, « Toujours là » → check_date (the day: accepted exception), a move → position, an add → man_made=surveillance node with surveillance=outdoor (an existing surveillance never touched), business → operator:type=private, a public operator → name only; never household, height/tilt classes, « introuvable », « je ne sais pas » — user decision.
- 2026-10-16 — Writing to OSM's live server is /revue's setting `osm_write_live`, off at deploy (writes go to the test server) and switched on by the author after the wiki activity page, the forum message and two weeks; `osm_sync` suspends all — user decision.

## Register: sources and reading
- 2026-11-01 — The robot goes through one module (fetch.py): robots.txt by RFC 9309, named `SurveillanceWorld/<version> (+<contact>)`, one request per interval per IP address, never around a 401, a 403 or an anti-robot page — the source stops and says so.
- 2026-11-03 — No request at all to the prefectures' platform (www.<département>.gouv.fr) until Ju has an answer to the message sent; an act without Attrap's text stays « non lu ». [to check]
- 2026-11-01 — Prefectoral acts are found and read through Attrap at collection time only, never by the site, which does not name it; acts Attrap gets past an anti-robot check are used, our robot never asks those hosts — Ju.
- 2026-11-01 — DECP via data.gouv.fr's tabular API; the BOAMP's records API is not read (robots.txt), notices come from the DILA archives (history over FTPS); SIRENE via API Recherche d'entreprises; grants from the DGCL — Ju.
- 2026-11-04 — The register hosts no PDF (act id, recueil address, page, SHA-256); recueil texts are kept on the server only, compressed, 12 months, deleted on request, moved to the Mac only for a lot — Ju.
- 2026-11-11 — A field of a prefectoral act is published per département and kind only if blind references on a fresh draw give 95 % (video protection) or 85 % (drones) and no wrong number of cameras; else « non lu »; only a drawing never seen measures a rule — Ju.
- 2026-11-07 — A model may fill a published field only when the act's text proves it (verbatim passage, numbers, dates, hours, commune checked; Opus arbitrates, else empty); API budget $110, no automatic sending, paused by Ju — Ju.
- 2026-11-11 — Camera acts: commune placement by rule is served (49 of 50 right; 48 of 50 needed to switch it on) for one establishment's act only; `cam_aut` gives the cameras authorised by holder, null when not read — Ju.
- 2026-11-09 — Drone acts: only an act authorising captation of images (bans, jamming, shows excluded); abrogations and withdrawals end the act they cite; an unnamed aircraft counts as a drone, helicopters apart; motive served only for classes ≥ 48/50 right; no model — Ju.
- 2026-11-04 — Places a drone act cites are placed from local data only, never a geocoding service, drawn approximate; an arrondissement is hatched alone, otherwise the whole commune.

## Register: publication rules
- 2026-10-28 — No human review: acts are read by a program and the site says so once, links the official recueil and « Signaler une erreur »; unreadable acts are kept and listed with what failed; a figure not read is « non lu », never 0 (2026-11-09).
- 2026-10-29 — « Signaler une erreur » is a form on every document, no account, nothing of the sender kept, contact erased at decision (90 days at most); an accepted correction in /revue is re-applied at every build — owner's decision.
- 2026-11-11 — Coverage is published: last update, what each source covers, per département collected / not / impossible; a commune's acts are « lu », « au moins N » (not tied to a commune) or « non lu ».
- 2026-11-09 — Names: a public function may be named as the act names it; a legal person only if verified in SIRENE; a private individual or sole trader never (token `ei`, SIREN masked even in free text); no natural person in served data — owner's decisions.
- 2026-10-30 — Sentences state sourced facts, never the conditional, an insinuation, a judging adjective or a political label (« Ce qui ressort » removed); the register never crosses its documents with crime figures — owner's decision.
- 2026-11-07 — Amounts follow one build rule (`compte`): the planned amount of each signed contract, without national buyers' contracts, central ceilings, mixed contracts (sûreté and autres families stay out), amounts to verify, copies or a probable typing error (> 500 % raise); one source per figure — Ju.
- 2026-11-07 — A commune's public money is said on three levels side by side, never added; ranks only within its size stratum, among communes with contracts, none under five — Ju.
- 2026-11-05 — Contract natures come from written rules (never a model); dossier links are « sûr » or « suggéré », the latter never shown as fact; procurement signals are exploration, not published.
- 2026-10-29 — One page per commune and per decree (a commune buyer and a decree have none of their own); a missing page says « Page introuvable ».
- 2026-11-07 — The home's « caméras sur la carte » is France's whole count, not the listed communes' sum — Ju.

## Register: interface
- 2026-11-08 — The register opens over the map (modal on wide screens, sheet on phones), every /registre path being the map's page; one modal at a time; Escape closes — owner's brief.
- 2026-10-28 — Pages come from a template engine of its own (dc.ts) over the mockups' markup: values escaped, no eval nor innerHTML, strict CSP; words only from fr.json; `noindex` until the public opening.
- 2026-10-30 — Every fiche has one skeleton (identité, L'essentiel, Dans le temps, Avec qui, Documents, Sources), empty sections left out; four type families (territories yellow, buyers green, companies lilac, documents blue): the colour says the type — owner's brief.
- 2026-10-30 — Every mention of something with a fiche is a link (a sole trader never); no link is repeated on every row of a list; a place is linked only when designated by its code or a unique exact name — owner's rule.
- 2026-11-08 — Redesign v3, theme A: the boards' classes with the site's tokens, phone and dark as CSS on one markup; lists have « Afficher » tabs and « Classer par »; one name per type — Ju.
- 2026-11-11 — Every date says which it is (« signé le », « publié le », « daté du », « attribuée le », « vol le »); a drone act is dated and sorted by its publication — Ju.
- 2026-10-31 — Search is server-side (GET /api/registre/recherche), bounded for everyone at once (2 running, 24 waiting, then 503), answers cached, questions bounded — the site keeps no address.
- 2026-10-30 — The drone view draws on the site's own map in 3D (the tilted commune map is gone); a zone covering ≥ 80 % of its commune is a hatched band; its count is the build's `dr` — Ju.

## Hosting, deploy and security
- 2026-09-28 — Preview: Caddy with basic auth, no access log, noindex, PMTiles never re-encoded; rsync of timestamped releases with an atomic swap; host, names and secrets only in environment variables — the repository stays publishable.
- 2026-10-13 — One site template, two modes (SITE_MODE): preview (all behind a password) and public (open, /revue behind its own password); HSTS, nosniff, 256 KB body cap, no rate limit by address, no client address in any log, IPv4 only — user decision.
- 2026-10-21 — A fresh Debian 13 is set up by deploy/bootstrap.sh alone (idempotent, run by the author with sudo): Caddy from its apt repository, SSH by key only, firewall 22/80/443; site and ssh may share the one IPv4 — user decision.
- 2026-09-29 — The API listens on 127.0.0.1 only, no proxy headers, no access log; the client IP never reaches it; on the public server Caddy's global log filters remote_ip, client_ip and uri — user decision.
- 2026-10-01 — Participation tables are prepared on the build machine (every prepared building of the region) and loaded by db/load.sh in one transaction; the 4 GB server never prepares buildings — user decision.
- 2026-10-22 — A load keeps the replaced build one back and deploy/rollback.sh swaps it back at once; the web release hard-links unchanged files — user decision.
- 2026-10-17 — A deploy is refused when the served build id differs from the database's, when validated contributions or hidden cameras differ from the build's export, or when a test account's contribution is present — user decision.
- 2026-10-17 — Site statistics without tracking: server-side counters (map loads, welcomes, sign-ins), by hour for 8 days, then days (13 months), then months; nothing on the device; robots uncounted; administrators only; retention runs daily in the API; backups are a daily pg_dump kept 14 days — user decision.

## Process and documentation
- 2026-10-20 — CI: a push runs check, the CI extract's build and two WebKit smoke tests; the full matrix runs by workflow_dispatch and must be green on the commit a deploy ships; `make smoke` is the local gate before any push — user decision.
- 2026-10-06 — Working method: one push per lot after the local gate; sub-agents in parallel only on disjoint files, each in its own worktree; the main session alone integrates, pushes, builds and deploys; an agent never reviews its own work — user decision.
- 2026-10-07 — Every interface state is catalogued in docs/interface/states.md and web/bench/states/catalogue.mjs, updated in the same commit; axe-core checks the chips, the account screen and the leaderboard in the gate.
- 2026-09-27 — CI fixture: a 600 m box at La Défense (densest directional cameras, streets under the slab) with a versioned basemap extract; geometry changes need frozen cases — user decision.
- 2026-11-12 — DECISIONS.md holds only the decisions in force, by theme, about 150 lines; a changed decision is rewritten in place and its old line goes word for word to docs/archive/decisions-journal-2026.md (the journal up to 2026-11-12, kept as is) — 711 lines and 330 KB could no longer be read whole.
- 2026-11-12 — docs/interface/ replaces docs/interface.md: one file per screen or zone (in force and deviations), an index README.md, the state catalogue whole in states.md — 520 KB in one file; web/bench/shots-states.mjs reads the catalogue as one table per screen.
- 2026-11-12 — Update an existing document before creating one; every new document is justified by a line here — supersedes « no other docs unless asked ».
- 2026-11-12 — Work runs as missions: one written brief, one session that orchestrates alone (sub-agents in worktrees on disjoint files); a long data run may keep its own session and speaks only through files; a session stops to ask only for the irreversible (production, data, public push, spending), the story or positioning, taste on a finished design, legal or identity exposure, and what its mission lists; anything else it settles and writes here — Ju.
