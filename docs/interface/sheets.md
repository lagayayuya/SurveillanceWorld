# Sheets: camera, commune, arrondissement, département

The camera sheet and the area sheets (board 12, « Combien en manque-t-il ? »).

## In force

### 1.4 The camera sheet

The facts every sheet says (`sheet.ts` headline and chips, drawn by `chips.ts` below; the
classique's own layout of them, its ruler and its chips as buttons, removed on 2026-10-23):

- « Type · exploitant », « de particulier » for a household (2026-10-01); the chosen
  estimate first (2026-09-28, 2026-09-30); without a surveyed direction it films only if
  turned towards you (2026-09-30); « Filme, mais trop haute ou trop inclinée… »
  (2026-09-28); « Position ou direction à vérifier » with the OSM link (2026-09-30);
  « Disparue : introuvable (sur place) (mois) » (2026-09-30, 2026-10-01).
- Every fact with its certainty, identifiée, estimée, par défaut (CLAUDE.md, domain). A PTZ
  turns: « toutes (motorisée) » (2026-09-30). Validated contributions are months, « sur
  place » only when it was (2026-09-30, 2026-10-01); height and tilt are classes, never
  metres typed nor degrees (2026-10-04).
- « Combien en manque-t-il ? » (board 12, 2026-11-10), after « Modifier / Toujours là ? »: the
  block of the commune the camera stands in (`cameragap.ts`, the commune read under the camera
  from an invisible layer of the admin tiles, `communes-probe`), shared with the commune and
  département sheets (`gap.ts`): the cameras on the map against those the prefecture
  authorised, « non lu » while the register serves no `cam_aut`, « + Ajouter une caméra », the
  commune's page in the register. The commune and département sheets (`areapunk.ts`) are board
  12's too: one column, three figures, the 100 m street drawn, « Voir ces rues sur la carte »,
  « Qui filme ? » folded, the doors; a département's « Où sont-elles ? »; the map's legend of the
  chosen area over the map on a wide screen (`arealegend.ts`). Deviations: §3 « Map sheets v3 ».
- The CNIL box of a private camera filming the street (« Caméra privée tournée vers la voie
  publique : potentiellement non conforme », the complaint link), for a build made with
  `VITE_CNIL_SIGNAL=true` (the private preview's, `deploy/deploy.sh`; 2026-09-27), is
  suspended until further notice (DECISIONS 2026-10-08, « Punk, until further notice… »:
  `sheet.ts` PUNK_CNIL gives `chips.ts` none; neither shown nor captured). /revue never
  shows it.
- A phone shows it as a bottom sheet (peek, half, full), a wide screen as a side panel
  (2026-09-28).

The sheet (lot 3.2), ported from mockup 17a on a wide screen and 4b on a phone
(DECISIONS 2026-10-07, « Fidelity to the mockup comes first… » and « The camera sheet's facts
follow 17a… »; `chips.ts`, a chunk of its own, drawing the facts of `sheet.ts`; a sheet
asked before it arrives shows its grab and close buttons, then is drawn whole; `theme/punk/sheet.css` and `chips.css`). Where it differs from the boards and
why: §3, « Camera sheet (lot 3.2) ».

- **Paper.** A wide screen: 17a's, 372 px, 18 px from the top (from 960 px wide; below,
  80 px, under the map's zoom buttons) down to 14 px above the bottom, tilted 1°, torn at the bottom, a hard offset shadow of the same shape (light blue
  in light, pink in dark), no tape (2026-10-09, « Punk map after the iPhone test… »: the
  only tape left means « correction en attente »); the paper scrolls when its
  content is longer. A phone:
  4b's bottom sheet, its top waved over a light blue (pink) edge, no tape, no tilt; its
  top is what it shows at its lowest (peek: the title, the tickets, their note); half open
  or full, the whole paper scrolls under its head (the sticker, the title and its line,
  ↑ and ×), which alone stays, the tickets going under it with the rest (2026-10-09,
  « Punk sheets on a phone… »; the head pinned to the frame out of the scrolling flow,
  `chips.ts` pinHead keeping its room, so that `bottomsheet.ts`, unchanged, measures the
  same peek, 6 px taller (the head's own margin, which keeps the letters' tilts on its
  paper), and drags by the same top; back at its start at the peek). Once the paper
  scrolls, the pinned head folds to one bar (lot U2): the sticker smaller, the title on one
  line in the display face, cut short with « … », ↑ and ×, an ink rule under it; its room
  keeps the whole head's height, so the paper does not jump. Unscrolled, a long title (the
  longest, « Lecteur de plaques de particulier », on five lines at 320 px) pushes the
  content; `bench/smoke-formats.mjs` checks both on every format.
  While a camera sheet is open on a wide screen the floating buttons (« Me localiser »,
  « ＋ Ajouter »), the map's zoom buttons (from 960 px wide) and its attribution ride beside it, as on a phone
  they ride above it: the sheet never covers them, at any zoom.
- **Head.** The title in cut-out letters, five styles in turn and each letter tilted as 17a's
  « Dôme public » (the kind and who films: « Dôme public », « Caméra fixe privée »,
  « Caméra » when both are unknown); the current sheet's line (« Dôme · public ») is its real
  text, hidden for the eyes, and the letters are hidden from screen readers (`h2.headline`).
  A word longer than the title's line shrinks the letters until it holds (the words wrap
  between them), never under ↑ and × (2026-10-09, « Punk sheets on a phone… »).
  The × an ink square with a light blue × (cream with ink in dark), 17a's 36 px with a mouse,
  44 px under a finger (a coarse pointer, a phone). On a phone, 4b's
  sticker before the title and its « ↑ » (« ↓ » at full height) beside the ×: the handle.
- **Operator and dates.** The operator's name from OpenStreetMap under the title, in its
  column (4b; 17a's line under the title); the dates line by the month (on a phone, once the
  sheet rises above its lowest position: 4b's « réduite » has none, its « étendue » has
  them): « Vérifiée sur place : <mois> » only for a validated sighting made on
  site, « Vérifiée : <mois> » for one made elsewhere, « Vérifiée (OSM) : <mois> » from
  OpenStreetMap's check date, « Jamais vérifiée » without any, then « Modif. OSM : <mois> »
  (OpenStreetMap's last edit; the day is never written).
- **Distance tickets.** Three tickets of the chosen estimate — identifie, reconnaît, détecte,
  « X m » each, rounded up to the metre without « ~ » (5.6 m → 6 m; the map's label alike;
  « Calcul ? » says they are estimates and how they are rounded: 2026-10-08, « The punk
  sheet's « ~ »… »), « — » where the level is not reached — the first one reached on pink
  and lifted; under them, as 4b, « trop haute ou trop inclinée pour identifier », then the other estimate's
  three distances (« Prudent : 18 · 35 · 135 m »). A choice (2026-10-08, « Punk
  focus… »): a radiogroup « Niveau montré sur la carte », one tab stop, the arrows among
  the levels reached, a tap, Enter or the space bar; « identifie » chosen when a camera
  comes into focus (the first level reached when it is not), the chosen ticket pink,
  lifted, with 17a's round ✓; the map shows that level of the camera alone with its yellow
  label (1.5); a level not reached (« — ») cannot be chosen. No field
  (`pv`, `ib`, or none drawn): the yellow band « Position ou direction à vérifier
  (: champ dessiné presque nul) » and « Corriger sur OpenStreetMap ↗ » in their place.
  Verified gone: the stamp « Disparue / introuvable (sur place) · <mois> » in their place,
  with the same link.
- **Facts.** No « Vérifié » stamp (2026-10-08, « The punk sheet's « ~ »… »: the dates line
  says the verification); the rows on the paper (a `dl`, each row a `div` of `dt` and
  `dd`, never a button): label, its source tag cut as an arrow (« OSM » yellow, « sur place »
  pink only when on site, « réponse » and « contribution » pale pink, each with its month
  « · 10/26 »; « supposé » and « en attente de revue » in the same style), a dotted leader,
  the value in Archivo capitals. Rows: Exploitant (the name), Type, Statut (who films: OSM's
  class, estimated when known, as the pipeline says, or a validated answer's), Direction,
  Angle de champ, Hauteur, Inclinaison, Vision de nuit, Zoom (a PTZ), Position (a validated
  move or add). The certainty in 17a's language: identified, the value alone; an estimated
  number (Hauteur, Angle de champ, Zoom) « ~ » before it, an estimated category (Type,
  Statut, Direction, Exploitant, Inclinaison's classes) its value alone, its source tag
  saying enough (2026-10-08, « The punk sheet's « ~ »… »); default, the row in the gridded
  box, with a pink « ? » after it when « Modifier » asks it (`participate/questions.ts`
  editorAnswerable, DECISIONS 2026-10-08: the type, the direction of a kind that has one, the
  height of every kind but the big ball, a dome's included, who films while unknown; never
  the field of view, the night vision, the zoom), the box titled 17a's « Supposé · à
  compléter » when one of its rows has its « ? », 4b's « Supposé d'après le type »
  otherwise; its word (identifiée, estimée, par défaut) is in the row's hidden
  text and in « Calcul ? ». OpenStreetMap's warnings (« Signalée comme peut-être disparue », « Issue
  d'un ancien import… ») are yellow bands with their « OSM » tag, first in the body.
- **Participation** (`participate/index.ts`, its journeys unchanged): the review account's
  conflict on a yellow band; a proposal's block under the tickets, its line on 20a's yellow
  tape, its buttons the participation's, no frame; « Modifier » (17a's « Compléter »: ink
  with light blue text, a pink offset shadow, its pink « ? » while a value is assumed that
  « Modifier » asks, the rows' « ? » rule; always shown, it replaces « Compléter » and « Déplacer » since lot 3.4, DECISIONS
  2026-10-08) and « Toujours là ? » (yellow) side by side, each half the line as 17a's two;
  « Vos contributions » a link. The « Toujours là ? » question and its thanks take the
  buttons' place (the proposal and « Vos contributions » go meanwhile, as before). The sheet
  is built in the order it is seen (WCAG 1.3.2, 2.4.3): the participation puts its conflict
  and proposal and « Vos contributions » in the slots the punk sheet gives it
  (`participate/index.ts` actionSlots; its « Déplacer » slot stays empty), so that the
  keyboard and a screen reader meet the tickets, the conflict, the proposal, the facts, the
  box, « Modifier », « Toujours là ? », then « Partager », « OpenStreetMap ↗ », « Calcul ? »,
  « Vos contributions »; no CSS `order` (checked by `bench/smoke-participate.mjs --ui punk`,
  its keys pressed against the controls' places).
- **Links.** « Partager », « OpenStreetMap ↗ » (the element's page, « (nouvelle
  fenêtre) » said), « Calcul ? » (a disclosure button, its name « Calcul ? Comment c'est
  calculé »), typewriter words with a wavy underline, 28 px high with a mouse and 44 px under
  a finger (the ticket links' rule, lot 3.1), never moving. « Calcul ? »
  opens under them how the sheet is computed (certainty, tickets, the two estimates, older
  cameras, the norm, how to leave the focus) and what each row means with its certainty's
  word: the help a tap on a chip gave.
- **States** in the mockup's vocabulary: « Revenir à la caméra → » a link first in the body
  below the street level; the CNIL box (suspended, above) a yellow band, its words, its link ↗; a pending
  add's sheet « Caméra proposée » in letters, its status on the yellow tape.
- **History** (lot U, 2026-10-18, owner's decision applied by default): the
  sheet ends with « Historique », the contributions the review accepted (validated,
  applied, superseded; never pending, rejected, withdrawn nor in conflict; never a test
  account's nor a hidden camera's), newest first, each with what it changed, its month
  and « par un contributeur », or its author's pseudonym when she chose « Afficher mon
  pseudonyme sur les caméras que j'ai relevées » (off by default, read by the API at each
  request); « Son historique sur OpenStreetMap ↗ » for a publication on OSM's live server.
  GET /api/history at each opening, never awaited, last in the body; nothing when empty
  or unreachable. `src/history.ts`, `historytext.ts`. /revue keeps the whole history.

## Deviations from the mockup (« Écarts à la maquette »)

### Camera sheet (lot 3.2)

Boards: 17a (wide screen, light and dark), 4b (phone, « réduite » and « étendue »), the
analysis of the mockup v2 (§2, §3). What every screen shares is in the table above.

| Mockup | Code | Reason |
|---|---|---|
| 4b's handle « ↑ » (« ↓ » at full height), a glyph | an arrow drawn by a mask in the close's square, colour and weight (`theme/punk/sheet.css`), the system's button text under forced colours | the author's request (2026-10-10): the glyph was a thin line beside the × |
| The title's fourth letter style in Bricolage Grotesque; the second in Archivo at 125 % width | Archivo 800 at 100 %; the second clamped to 100 % | CLAUDE.md (no third-party runtime service); DECISIONS 2026-10-05 « Punk fonts, self-hosted latin subsets… » (Archivo cut to widths 62–100 %, Special Elite; no Bricolage) |
| A short title, « Dôme public » | the kind and who films (« Caméra fixe privée »), « Caméra » alone when both are unknown, the letters smaller on a phone for a word longer than « PUBLIC »; a word still longer than its line (« ARRONDISSEMENT » in « Paris 12e Arrondissement », a commune's title) shrinks every letter (`chips.ts` fitTitle, CSS zoom, down to half) until it holds, the words wrapping between them, never under ↑ and × (DECISIONS 2026-10-09, « Punk sheets on a phone… »); the current sheet's line (« Caméra de type inconnu · d'exploitant inconnu ») is the hidden real text | data that does not fit: « Caméra de type inconnu d'exploitant inconnu » in 29 px letters fills four lines of the column; the box says what is unknown |
| The floating buttons and the map's zoom buttons not drawn | « Me localiser », « ＋ Ajouter », the zoom buttons (MapLibre's, top right) and the attribution ride beside the open sheet on a wide screen, as they ride above it on a phone | the sheet keeps 17a's place and height (18 px from the top, 14 px from the bottom) without covering a control (WCAG 2.4.11: a focusable control must not sit under the sheet; journal 06/10: « Me localiser » covered below z15); the ODbL attribution stays seen |
| The sheet 18 px from the top at every width | from 960 px wide (17a's board); narrower, 80 px from the top, the zoom buttons above it at the right | measured at 700, 768, 834 and 900 px: the zoom buttons riding beside the sheet sat on the estimate bar and the sheet's top on its end (WCAG 2.4.11: a focusable control must not be covered); the 17a board is 960 px wide |
| A 548 px paper its content fills (3 sourced rows, 3 in the box) | the same paper; it scrolls when the facts are more: on 17a's twin (n998633844) 5 sourced rows, 2 in the box and the other estimate's note under the tickets, so at 960×581 the links' line shows whole and « Vos contributions » (a second line of links, below) is 22 px under the paper's torn edge, the paper scrolling 35 px; n998633886 (3 rows in the box, as 17a, and « Compléter ») shows « Vos contributions » cut by the torn edge, the paper scrolling 39 px (measured in Chromium at 960×581) | data that does not fit: every fact the camera has is a row (CLAUDE.md, a certainty is never dropped; DECISIONS 2026-09-28 « Focus draws the outlines of the chosen hypothesis only… » for the note) |
| Links about 17 px high | 28 px with a mouse, their text unchanged (a taller touch area); 44 px wherever the pointer is coarse (a phone, a tablet), the × too (17a's 36 px with a mouse) | DECISIONS 2026-10-07 « Fidelity to the mockup comes first… » (44 px for what is touched); WCAG 2.5.8 (24 px) with a mouse; the same rule as the map's ticket links (lot 3.1, above) |
| The distance tickets are buttons (aria-pressed, a ✓) choosing the level drawn on the map | the same choice as radios (role radio, aria-checked, one tab stop, the arrows), the ✓ on the chosen one; a level not reached is disabled | DECISIONS 2026-10-08 « Punk focus… » (supersedes the list of lot 3.2); one choice among three is a radiogroup (WAI-ARIA APG), not three toggles |
| « 6 m identifie »; the map's label « identification ~6 m » | « 6 m identifie » (5.6 m rounded up), « — » where the level is not reached; the map's label « identification 6 m » | DECISIONS 2026-10-08 « The punk sheet's « ~ »… » (no « ~ » on the tickets nor the yellow label, distances rounded up to the metre everywhere alike; « Calcul ? » says they are estimates) |
| One estimate's distances | the note under the tickets (4b's, without « si elle est tournée vers vous », removed 2026-10-11 by the author): « trop haute ou trop inclinée pour identifier », then the other estimate's three distances | DECISIONS 2026-09-28 « Focus draws the outlines of the chosen hypothesis only, the sheet's ruler… gives the other »; 2026-09-30 « The sheet of a camera without a surveyed direction reads… »; 2026-09-28 « Sheet headline is neutral… » (too high) |
| « Vérifié ✓ » on every sheet, without a date | no stamp: the dates line says the verification and its month | DECISIONS 2026-10-08 « The punk sheet's « ~ »… » (« the « Vérifié » stamp is removed from every sheet »; supersedes the stamp of 2026-10-07 « The camera sheet's facts follow 17a… ») |
| « Vérifiée sur place : mars 2026 » on every sheet | « Vérifiée sur place » only for a validated sighting made on site, « Vérifiée : » for one made elsewhere, « Vérifiée (OSM) : » from OpenStreetMap's check date, « Jamais vérifiée » | DECISIONS 2026-10-01 « "Sur place" is said only when it is true… »; the source of a date is said, as of every fact (2026-10-07 « Punk chips… ») |
| Three sourced rows (Exploitant, Type, Statut) and the box (Direction, Hauteur, Vision de nuit) | every fact the current sheet has: Direction, Hauteur, Inclinaison, Position on the paper when sourced; Angle de champ, Zoom (a PTZ) in the box when default | CLAUDE.md (every capability has a certainty, never dropped); a fact goes where its certainty puts it |
| « PRÉFECTURE DE POLICE », « DÔME », « PUBLIC », « ~3 M » | the same: an estimated category alone (« DÔME », « AU SUD »), an estimated number with « ~ » (« ~3 M ») | DECISIONS 2026-10-08 « The punk sheet's « ~ »… » (none on category values; supersedes 2026-10-07's « ~ » on every estimated value) — no deviation left; kept as the record of the change |
| A dark « ? » after the sourced values too | after the default values only, in both modes | the « ? » means « à compléter » (17a light; the analysis of the mockup, §2.1, calls the dark ones inconsistent); DECISIONS 2026-10-07 « The camera sheet's facts follow 17a… » |
| The box « Supposé · à compléter », a « ? » after each of its values (17a) | a « ? » only after a value a « Compléter » question can answer for this camera; the box titled « Supposé · à compléter » when one has it, else with 4b's own words « Supposé d'après le type » | data that does not fit: not every default can be asked — the field of view, the night vision and the zoom never are, a dome's height neither (rules/questions.yaml); a « ? » and « à compléter » there would ask for what « Compléter » never asks (the 17a twin n998633844 has no « Compléter » at all) |
| 4b's box « ? Supposé d'après le type » with « Les distances en dépendent. » | 17a's box; 4b's title, without its « ? » and its sentence, only when nothing in it can be completed | DECISIONS 2026-10-07 « The camera sheet's facts follow 17a… » (17a replaces 4b's sheet; the « ? » means « à compléter »); « Calcul ? » says that the distances depend on the assumed values (4b's sentence) |
| No multi-dome (17a's sticker and rows are a dome's) | a multi-dome's own sticker; a row « Boules · N boules » after « Type » (« inconnu » in the box when no one gave it); « Direction · toutes (plusieurs boules) » and « Angle de champ · N° par boule, 360° en tout », OSM's direction not said | the user's decision of 2026-10-23 (DECISIONS 2026-10-23: a new category, its field the full circle whatever its directions); the rows are 17a's |
| Tags in 12 px | 12.5 px | 7b's standard, « Corps ≥ 12,5 px » (DECISIONS 2026-10-05 « Redesign "Carte punk"… » makes it the theme's) |
| The leader a `span` between `dt` and `dd` | the row's `::after`, placed between them | HTML: a `div` in a `dl` holds only `dt` and `dd` |
| No sticker on the wide sheet; 4b's sticker on the phone | the same; the « ↑ » / « ↓ » of 4b is the phone's handle | 17a, 4b |
| Two yellow tapes over the paper's top corners (17a), one on the phone's wave (4b) | none, on the commune sheet neither; the only tape left is 20a's « correction en attente » (a proposal's line, a pending add's status) | DECISIONS 2026-10-09 « Punk map after the iPhone test… » (every decorative yellow tape removed) |
| 4b « étendue »: the sheet's top (title, tickets) above a body that scrolls | half open or full, the whole paper scrolls under the head alone (sticker, title, operator, ↑, ×): the dates and the tickets go under it with the facts; scrolled, the head folds to one bar (the title on one line in plain letters, cut short with « … », an ink rule under it) | DECISIONS 2026-10-09 « Punk sheets on a phone… » (« a half-open sheet keeps only its title fixed while the rest scrolls under it »); 2026-10-19 « Once a phone's sheet scrolls, its pinned head folds to one bar… » (a three-line title seemed to cover the content) |
| 4b frames the dates in blue | unframed on both | 17a removed the frame (analysis of the mockup, §2.1) and replaces 4b's sheet |
| 4b pins « Compléter » / « Toujours là ? » in a footer | in the flow, after the facts, as 17a's (a phone: in the scrolling body) | the phone's heights are bottomsheet.ts's (its peek is the sheet's top): a footer would cover the body's end at half height; 17a, which replaces 4b's sheet, has them in the flow |
| « Déplacer » a link | a link, but a pink button first in the buttons' line when the position is to check; since lot 3.4 none: « Modifier » holds the position (Participation, lot 3.4, below), and is the pink button when it is to check | DECISIONS 2026-09-30 (« Position ou direction à vérifier » with « Déplacer » first) |
| « OpenStreetMap ↗ » | the element's page; « Corriger sur OpenStreetMap ↗ » under the band of a camera without a field and under « Disparue » | DECISIONS 2026-09-28 « Sheet headline is neutral… » (the OSM edit link with « Position à vérifier ») |
| No « Vos contributions » | a link after « Calcul ? » | DECISIONS 2026-09-29 (one's contributions, what is stored and what never is) |
| « Toujours là ? » stamps the sheet at once (« Toujours là / vu le 05.10.26 ») | it asks its three answers; the stamp's style is « Disparue »'s | DECISIONS 2026-09-29 (« Toujours là ? »: three answers, « Je ne la trouve pas » confirmed); nothing is confirmed before the review (2026-10-06 « Every state… ») |
| No OSM warning, CNIL box, review conflict, proposal, pending add nor « Revenir à la caméra » | 17a's yellow label as a band (warnings with their « OSM » tag, no field, CNIL, conflict), 17a's « Toujours là » stamp (« Disparue »), 20a's yellow tape (a proposal's line, a pending add's status), 17a's link with its arrow (« Revenir à la caméra → ») | DECISIONS 2026-10-07 « The camera sheet's facts follow 17a… » (improvised states take a band, a stamp or a tape, never one more framed card) |
| « Compléter »'s « ? » an aria-hidden span (« Modifier »'s since lot 3.4) | a pseudo-element, its alternative text empty where the browser has the syntax | the button is participate/index.ts's (lot 3.4): no element of this lot's there |
| No proposal block (17a), so no style for its buttons | « Je confirme » / « Ce n'est pas ça », « Valider » / « Rejeter », « Retirer ma proposition » are the participation's buttons as they are, not restyled to 17a | restyled with the participation, lot 3.4 (DECISIONS 2026-10-07 « Lots after 3.0… »: 3.4 after 3.2) |
| « Toujours là ? » tilts +2° on hover | +2°: since lot 3.4 always the row's second button, after « Modifier » | DECISIONS 2026-10-07 « Punk button norm… » (-2°, +2° every second button) |
| The ×'s rest tilt (6°) always | only when motion is welcome; the other tilts (sheet, stamps, box, tags, letters, tickets) always | the ×'s tilt is its hover's starting point (DECISIONS 2026-10-07 « Punk button norm… »: what moves is under the motion query); the others never move (web/tests/theme.test.ts FIXED_DECOR) |
| No board draws a camera's history (lot U) | « Historique » last in the body under the « Supposé » box's ink-tile title, without its grid (nothing in it is assumed); each entry two lines, not 17a's rows: « Position corrigée · octobre 2026 » in the rows' letters, then « par un contributeur » or the chosen pseudonym smaller and muted on one line, no tag nor dotted leader; « Son historique sur OpenStreetMap ↗ » as 17a's links | the mockup's ink tile for the section (CLAUDE.md: meet a rule with the mockup's vocabulary); 17a's rows left out by DECISIONS 2026-10-19 « A camera's history says each entry in two lines at most… » (a row too full on a phone, « 10/26 » ambiguous); last, so that its late arrival moves nothing under a finger |

### Commune and département sheets (lot 3.3)

Board: 24a (wide screen, dark only), its rendered DOM and computed styles (export of
2026-10-06), the analysis of the mockup v2 (§8, §9). The paper (no tape), the cut-out title
and the links are the camera sheet's (table above); what follows is the commune sheet's own.

Since 2026-11-10 the commune and département sheets follow board 12 (next table): the tabs,
the cameras by type, the ramp with its cursor and the colour line of this table are gone; the
rows on Y's rounding, the 100 m street's metres, the reliability in « Calcul ? », the name's
letters and the paper still hold.

| Mockup | Code | Reason |
|---|---|---|
| The 100 m street with X and Y: « 0,6 m à coup sûr, direction connue · 0,8 km » in pink, « 24,4 m peut-être, direction inconnue · 32 km » in light blue, « 75 m hors de portée · 99 km » | Y only, worded as what may be: « 51,5 m peuvent être filmés · 10,1 km » in light blue, « 48,5 m hors de portée · 9,4 km », without « au plus » / « au moins » (« Calcul ? » says it is a maximum); X nowhere | DECISIONS 2026-10-08 « Punk commune and département sheets: the 100 m street… »; DECISIONS 2026-10-06 « Punk commune and département sheets show only Y… »; the analysis §8–§9.2 (X's « à coup sûr, direction connue » and « faute de direction relevée » are false: Y counts every camera in every direction) |
| The hidden sentence « Sur 100 mètres de rue à La Courneuve : 0,6 m filmés à coup sûr, 24,4 m peut-être filmés, faute de direction relevée pour les 46 caméras, 75 m hors de portée. » | « Courbevoie, sur 100 mètres de rue : 51,5 m à portée d'une caméra, qui peuvent être filmés ; 48,5 m hors de portée de toutes. » | the same decision; « à La Courneuve » does not hold for a département (« à Hauts-de-Seine ») |
| « 1 sur 4 » from round(100 / Y) (Y = 27 % gives « 1 sur 4 », 25 %; Y = 0 « 1 sur Infinity ») | rounded down, never above Y: the nearest below Y of « 1 sur N » (N = ⌈100 / Y⌉) and « N sur 10 » (N = ⌊Y / 10⌋), « 1 sur N » on a tie up to one street in two (27 %: « 1 sur 4 »; 51,4 %: « 5 sur 10 »); when that fraction falls more than 2 points below Y, the percentage rounded down to the unit, « 57 % / des rues à portée » (58,0 %), « 47 % » (47,4 %); « Aucune / rue à portée » at 0; the metres « peuvent être filmés » rounded up to the tenth, « hors de portée » down (the two make 100 m) | DECISIONS 2026-10-08 « Punk commune and département sheets: the 100 m street… » (rounded down, or the percentage if rounding betrays the figure: Courbevoie's « 6 sur 10 » said 9 points too much); 2 points is the betrayal allowed (« 5 sur 10 » for 51,4 % is 1,4 below; « 5 sur 10 » for 58 % would be 8); « 1 sur N » was rounded the other way (40 % said « 1 sur 2 », 10 points too much), the same rule now applies to it. The ticket says « rues à portée » instead of 24a's « au plus » (DECISIONS 2026-10-08 « Punk commune sheets: a selected commune… »): a fraction rounded down cannot say « au plus » |
| « Caméras »: the cameras by type with 16a's stickers (Dôme 22, Fixe 9, Motorisée 5, Panoramique 360° 2, Type inconnu 8), « Ouvrir la liste complète → » | the same list by type with the map's stickers (pipeline: `k_<kind>` in the area tiles, aggregate.py `KINDS`), a type without camera left out, « Multi-boules », « Lecture de plaques » and « Sonnette » too, « Type inconnu » last; « Panoramique » without « 360° »; no « Ouvrir la liste complète → »; « direction non relevée pour N % » as 24a's « direction inconnue pour les 46 », under the label when the line is full | the link opens the camera list, hidden (DECISIONS 2026-10-08 « Punk, until further notice… »); « 360° » is not known per camera (the camera sheet and the filters say « panoramique »); the extra types are real data; 12.5 px text does not fit 24a's line |
| « Plus filmée que 62 % des communes. » | no rank: the map's ramp with the area's yellow cursor on its class, « Sa couleur : la classe la plus filmée (plus de 51,4 % des rues à portée) », its class in words (the least or the most filmed, the middle one, « une classe peu filmée » or « très filmée » between) and its range « moins de X % », « de X à Y % », « plus de Y % » (DECISIONS 2026-10-09, « Punk sheets on a phone… »); « Sur la carte : hachurée, aucune caméra recensée. » when the map hatches it, no cursor | real data that does not fit: the build ships the classes' breaks (tiles/meta.json, `share_breaks`: quintiles over the areas with a camera), not each area's rank; the admin tiles hold only the areas of the tiles loaded, and loading every commune's to rank one is the heavy work CLAUDE.md keeps in the pipeline; 24a's 62 % is simulated (analysis §9.18) |
| The yellow cursor « La Courneuve ▾ » centred on its class | the name alone over the ramp, moved back by the same share of its own width as its class's middle is of the ramp's (at the most filmed class, almost its whole width), so that it never runs out of the ramp, cut with « … » when longer than it; the ▾ apart, under it, on the class's middle; nothing in the sheet is wider than its paper, which never scrolls sideways | DECISIONS 2026-10-09 « Punk sheets on a phone… » (no horizontal scroll on the area sheets: on the iPhone a long name at the ramp's end made the sheet scroll sideways) |
| The ramp: five cells #3a1029 → #ffb3dc, dark to light | the map's own classes (`--map-area-1` …), as many cells as the breaks make (two on the CI extract), the less filmed first | the cursor must sit on the area's colour on the map: DECISIONS 2026-10-06 « Punk communes and départements are opaque… » (the legend's swatches are the map's colours) and the « All screens » row on dark ramps |
| « DIRIF / filme le plus » | the first operator's name, 16 px on two lines at most when longer than 8 letters (the full name in the ticket's accessible name and in « Qui filme ? »), and « a le plus de caméras »; « 0 / exploitant nommé » without a name | real data: names are longer than « DIRIF » (CI: « Pôle universitaire Léonard de Vinci »); the tiles count an operator's cameras, not the streets they film (pipeline/lacarte/admin.py `top_operators`), hence « a le plus de caméras » rather than « filme le plus » (DECISIONS 2026-10-08 « Punk commune sheets: a selected commune… ») |
| « Exploitant non renseigné 38 » under a dashed rule, a grey bar | the same when fewer than five operators are named; « Autres exploitants ou non renseigné » when five are | real data: the tiles keep five names (admin.py `TOP_OPERATORS`), the rest may be named |
| « Qui filme ? »: the operators only | then « Par catégorie d'exploitant » and every camera by class (Publiques, Privées, extérieur, Privées, intérieur, Exploitant inconnu: the map's « Qui filme »), label, dotted leader, count, as the list by type; after 24a's operators, to decide whether before them | DECISIONS 2026-10-08 « Punk commune and département sheets… » (the operator classes go to « Qui filme » with the operators' list) |
| A ticket's second line on one line (« rues, au plus », « caméras », « filme le plus ») | wraps inside its ticket when longer (« des rues à portée », « a le plus de caméras ») | real data: those lines ran out of a 115 px ticket at 12.5 px |
| The rows are buttons (« Montrer sur la rue », aria-pressed) that isolate their part of the street | a list, not interactive | with Y only the street holds one part and its complement: nothing to isolate; CLAUDE.md, « an information row is not a button » |
| The street fills in 0.7 s after 250 ms, again on « Toutes / Publiques » and on the « Rues » ticket | drawn at once | DECISIONS 2026-10-06 « Animations: at most 400 ms… » (the figure readable after 0.95 s) |
| « Compléter » with its « 46 ? » at the foot, « Partager » and « Calcul ? » stacked beside it | no « Compléter »; « Partager » and « Calcul ? » on one line after the ramp, as the camera sheet's links | nothing to complete on a commune: the button is a camera's, and « Modifier » replaces it (DECISIONS 2026-10-08 « « Modifier » replaces… ») |
| « Toutes / Publiques » 26 px high; text at 12 px (the keys, the tickets' second line, the cursor), 11 px (the rows' kilometres), 10.5 px (the street's scale) | 26 px with a mouse, 44 px under a finger; every text at 12.5 px | DECISIONS 2026-10-07 « Fidelity to the mockup comes first… » (44 px for what is touched; WCAG 2.5.8 with a mouse); 7b's « Corps ≥ 12,5 px », as the camera sheet's tags |
| « Toutes / Publiques » (the board does not say whether the map follows) | the sheet's own: it opens on the map's « Qui filme », recounts the sheet (street, first ticket, ramp), leaves the map as it is | the map's « Qui filme » is main.ts's (another lot's file); to decide |
| The reliability (the current sheet's « Fiabilité bonne — … ») absent | in « Calcul ? », with what it means | real data 24a has no place for (DECISIONS 2026-09-28 « Commune and département tiles carry… a département's reliability comes from its cameras ») |
| Dark only | light: the camera sheet's (17a): the paper, the panel white ruled in light blue with an ink shadow, ink label tiles; the street ink in both modes (dark: the night's #141216), the light blue only on it and in its swatch framed in ink; the metres that « peuvent être filmés » in `--blue` (#0060a0 in light, 24a's light blue in dark) | DECISIONS 2026-10-07 « Second accent after 17a… » (the light blue, 1.4:1 on the paper, decorates only; 11.5:1 on the ink) |
| No département, no phone | IMPROVISED: the département takes the same sheet, « Département (92) », ranked among départements; the phone 4b's bottom sheet: the title, its line and the tickets at the peek, the panel, the ramp and the links below; half open or full, everything but the title and its line scrolls under them (DECISIONS 2026-10-09, « Punk sheets on a phone… ») | the camera sheet's vocabulary (DECISIONS 2026-10-07 « The punk camera sheet after 17a and 4b… ») |
| The paper 400 px wide, 16 px from the top | the same from 960 px wide (the floating buttons, the zoom and the attribution ride beside it); narrower, 80 px from the top as the camera sheet | the camera sheet's rule (table above: the zoom buttons over the paper below 960 px) |
| The name's letters wrap between words (« LA / COURNEUVE ») | also after a hyphen (« HAUTS- / DE- / SEINE ») | real data: « Hauts-de-Seine », one word of 14 letters, ran under the × at 400 px |

### Map sheets v3: camera, commune, département (board 12, 2026-11-10)

Board: « 12 · Fiches de la carte (v3) », its mockups Carte3-Camera, Carte3-Commune,
Carte3-Departement (wide screen and phone, dark; built on the production of 2026-10-31, only the
sheets' content changing), ported as rendered (theme/punk/area.css, areapunk.ts, gap.ts,
arealegend.ts). Its figures are examples (05/11 extracts); the code reads the tiles and the
register's département file (placedata.ts).

| Mockup | Code | Reason |
|---|---|---|
| « Autorisées » 6 356 (Lyon: mairie 404, commerces et banques 3 739, autres 2 213) and « + 4 243 »; Vaulx-en-Velin 609 and « au moins + 379 » | the register's `cam_aut` (from ae7c813): « + N » when every category and file is read and the acts tied, « au moins + N » otherwise (`dossiers_non_lus` > 0, acts `non_rattache`); a category not read « non lu »; a fourth row « bénéficiaire non lu » for `non_classees`, counted in the total; where nothing is served the dashed « non lu » bar, and « non rattaché » (never 0) where the acts are not tied to their commune | real data: the reading rises night after night (2026-11-11: 76 % of the totals, 57 % of the holders, 19 % of the street); the brief's rule « non lu, et jamais 0 »; Ju, 2026-11-11 (« au moins » or « non rattaché », never 0) |
| Vaulx-en-Velin « Sur la carte » publiques / autres « non lu » | the tiles' counts (`n_pub`, `n` − `n_pub`): 75 / 155 | real data the tiles serve |
| A camera in Lyon: « À Lyon », publiques 982 / autres 1 131 | « À Lyon » with the register's map count (2 113), publiques / autres « non lu » | the tiles count by municipal arrondissement; Lyon's split needs its 1.3 MB file |
| The département's « à Lyon : + 4 243 … Le total du département n'est pas encore calculé. », « Lyon seule », « Vaulx-en-Velin (commerces) » under « Autorisées » | the block of the département alone, its categories « non lu » | example content, not a rule; a département's block counts the département |
| « 5e sur 51 de la Métropole » | the same for a métropole; « … de l'intercommunalité » otherwise, cut at its syllables in the figure's box; « non lu » without a population (an arrondissement) | real data: most intercommunalities are not métropoles |
| « Drones : 2 arrêtés · de déc. 2025 à juil. 2026 · les zones et les jours, en 3D » | « Drones : N arrêtés · les zones et les jours de vol, en 3D », no dates; « Drones : non lu » when the acts are not read | the dates are in the commune's own file only |
| « Dans le registre · 1,4 M€ de contrats (Serfim T.I.C.) · 29 arrêtés de caméras » | without the company's name; « les contrats et les arrêtés de la commune » when its acts are not read | the company is in the commune's own file only |
| The département's « 127 arrêtés de drones »; its drone door to the 3D | `dr_commune` (the acts that fly in its communes), or `dr_autorite` « signés par ses autorités » when it is 0; the door opens the département's page | donnees-pour-l-interface 09/11 (the two counts); the register has no 3D view of a département |
| « 141 communes dans le registre » | the communes of the file with a document | the same count, read |
| « + Ajouter une caméra » about 37 px high; « Qui filme ? » 40 px; « Où sont-elles ? »'s names 17 px | 44 px; the names 44 px under a finger | RGAA 13.x / the repository's 44 px rule for what is touched |
| « Voir ces rues sur la carte → » a link | a button that reads as the board's link: the commune framed at a zoom where its streets within reach are drawn (z ≥ 11.75), the sheet kept (a phone lowers it to its peek) | it acts, it does not go anywhere (RGAA 7.1, a button's role); the board does not say what « allume la couche » does: the streets layer is the map's from z11.5 |
| « + Ajouter une caméra » always drawn | drawn when the map's « ＋ Ajouter » is offered (session known, contributions open); from a commune's or a département's sheet the map goes to the street level where the person is when they shared a position less than 10 minutes old inside it, otherwise in the middle of the area with « Placez la caméra sur la carte » on the add's position step | the add's own rule (participate/index.ts); Ju, 2026-11-11 |
| The 100 m street's two cameras at 9 m and 61 m | the same while the share fits; moved in towards the ends when it is longer (each stretch half of it) | real data: a share above 80 % does not fit the board's places |
| No legend on the phone mockups | hidden under 700 px | as the board |
| Lyon's sheet (the list's first commune) not drawn | the commune drawn from the register alone (state `area-parent`): « 9 / arrondissements, rues à portée calculées pour chacun », « Rues à portée : calculées par arrondissement » with each arrondissement a link to its sheet | the tiles split Lyon, Paris and Marseille into arrondissements; Ju, 2026-11-11 (no « non lu » for their streets) |
| The département's sheet over the map at the communes' level, « Couleur d'une commune », « Le Rhône : contour bleu » | a click on a département frames it whole in the free map (at most z10.5): over its communes when it fits at their zoom (Rhône, Territoire de Belfort on a wide screen), else lower, over the départements' colours, the legend then « Couleur d'un département » (Gironde; most départements on a phone); its outline from `admin-deps`, the same tiles read up to z8 and drawn larger beyond, shown only while a département is open | Ju, 2026-11-11: never crop a département; the départements are in the tiles up to z8 only |
