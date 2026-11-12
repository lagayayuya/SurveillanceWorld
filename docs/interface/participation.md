# Participation and /revue

Journeys (« Toujours là ? », add, « Modifier »), the send queue and the review screen.

## In force

### 1.6 Journeys

- « Toujours là ? »: three answers, « Je ne la trouve pas » confirmed in two steps
  (2026-09-29); punk, on a camera verified gone, two: « Elle n'est plus là (je confirme) »
  and « Elle est toujours là » (2026-10-08, « Punk, until further notice… »).
- « Modifier » and the punk « ＋ Ajouter », one component (2026-10-08): a sheet whose
  lines — the shape (five tiles, « Multi-boules » last, then its « Nombre de boules »: « Je
  ne sais pas », 2 to 6, 2026-10-23), the direction (« Je ne sais pas », or a crosshair posed
  on the map from where the send puts the camera), the height (every shape but the big
  ball), the tilt (a tube or a small dome, on the line under it: 2026-10-13, « The tilt is
  asked for a tube and a small dome… », rules/questions.yaml tilt.kinds, questions@5), who
  films — show their choices
  under them (2026-10-08, « The add / « Modifier » sheet shows each line's choices under
  it… »: all of them in an add; in « Modifier » what the camera assumes, the others
  unfold on a tap); « Je ne sais pas » first on every line, checked when nothing else is
  (2026-10-09: an add sends it, the absence of information; « Modifier » sends nothing for
  it and shows the camera's own value pressed); the position ticket opens the map; the
  sheet is the summary. The
  position is always free (no magnet), its field computed once the pin stops when its
  direction is known (the lot of 2026-10-12, `modify-field-under`); until then, the pin
  being placed or no direction chosen, only its possible field, thin and dotted over a very
  light fill (2026-10-13, « While a camera is placed and no direction is chosen… »,
  `modify-possible-field`); an add starts
  there and lists the cameras within 5 m. « Modifier »'s changed pieces leave in one send
  (one batch, idempotent, in the queue), the review decides it whole and its author
  withdraws it whole; a validated send wins over the OSM version it saw and is a conflict
  when the node changes since (2026-10-05, « Corriger »). The add and its answers leave in
  one queue transaction, « je ne sais pas » included.
- Proposals (moves, « introuvable », adds) for every account: a dot, then a badge and a pale
  pictogram; « Je confirme » / « Ce n'est pas ça »; « Valider » / « Rejeter » in two steps for
  the review account (2026-09-29); « Retirer » (2026-10-02); a pending add's field from its
  answers (2026-10-05), in punk outlined and its answers listed on its sheet (2026-10-08).
  A pending proposal is dated by its month: `GET /api/proposals` gives
  the public its month, never its day (2026-10-13, « The public API dates a pending
  proposal by its month… », refining 2026-09-30); the reviewers' routes and the person's
  own « Vos contributions » keep the day.
- The send queue (IndexedDB, resent on reconnect) and its counter (2026-09-29); « sur place »
  from « Me localiser »'s last fix only (2026-10-02). A send answered 401 (no session) is
  never dropped: the queue keeps it and sends nothing more until a login; punk's counter
  says « Reconnectez-vous pour envoyer N contributions » and leads to the login
  (`queue-relogin`; lot « comptes », 1.7).
- « Vos contributions »: what is stored and what never is, every contribution with its
  status, « Retirer » (2026-09-29, 2026-10-02). Punk, the OSM synchronisation offered
  (2026-10-16): under a contribution that went or may still go to OSM, a line of its own
  « OSM : partira après relecture », « OSM : publiée · changeset n° N ↗ »… (1.7's words),
  matched by uuid in GET /api/osm/sync's history, asked when « Vos contributions » opens
  (never when a sheet opens) and kept for the page; one sent since, from its send's answer
  (`osm: "will_publish"`): « partira après relecture » (`mine-sync`).
- `/revue`, reviewers and administrators only, by its own entry (lot 2 « Administrer »,
  1.7: anyone else reads « Connexion à la revue » and its form); redesigned by lots 1
  « Modérer », 2 « Administrer » and 4 « Statistiques » (2026-10-16, plan-revue, boards P1
  to P6; no mockup):
  views at their own addresses, each with one h1 focused when it opens, the browser's back
  button between them, phone first; tabs by role (GET /api/review/me: a reviewer « File »;
  an administrator « File · Comptes · Retraits · Réglages · Statistiques · Journal », on a
  phone a row of their own, scrolling sideways).
  « Statistiques » (lot 4, board P6, `review/stats.ts`, GET /api/review/stats): one block
  per question (« Le site est-il utilisé ? », « La file grossit-elle ? », « Qui contribue ? »,
  « Quelle part part sur OSM ? », « Retraits »), its sentence first, a one-line ink chart
  where a curve helps (map loads a day, sends waiting each day), « Voir les chiffres » (its
  tables), and under the API's threshold only « Pas encore assez de données (n = …) »;
  publishing not offered, « Publication non ouverte. » whatever the count.
  The site's counters (`hit.ts`): the map page sends POST /api/hit
  {"event":"map"} once it is shown (at once, at its first visibilitychange to visible, after
  a prerender's activation; never for a page never shown), the punk welcome
  {"event":"welcome"} each time it shows; nothing under navigator.webdriver, no cookie
  (credentials omitted), nothing stored on the device, fire and forget.
  « File » (`review/queue.ts`, GET /api/review/queue): « N en attente · la plus ancienne :
  D jours », the filters À traiter (default: confirmed on site first, then the oldest) /
  Conflits / Noms / OSM / Tout with their counts (« OSM », `?file=osm`, the OSM
  synchronisation: the cameras with a publication in conflict or uncertain, their rows
  tagged « conflit OSM » / « envoi OSM incertain » on 26a's yellow; `review-queue-osm`), a search (street, commune, pseudonym, id),
  both in the address (`?file=conflicts&q=…`; the map's `?status=conflict` and
  `&kind=add` open « Conflits »); one row per camera, a link: its label (kind, operator,
  street and commune; never an id), what waits in one line, its signals, age, author and
  record (the CSV left for the administrator's « Réglages » in lot 2).
  A camera (`review/camera.ts`, `?camera=<id>`, the queue's filter kept; GET
  /api/review/camera): « ‹ File » and its label as h1, the small map (`review/map.ts`,
  its legend naming shapes), the signals, the author's record, and the oldest waiting send
  to decide — a « Modifier » send, an add with its author's answers, or one contribution —
  as a « Sur la carte | Proposé » table of the fields it touches (with where « sur la
  carte » comes from), its notes (neighbours, no effect, a conflict's reason), the
  operator name's choice, its destination; the other waiting sends listed, decided one by
  one after it. A bar fixed at the bottom decides in one tap (Rejeter · Valider; « Valider
  ce qui est fait sur place (N) » only when it does more than Valider); after a decision
  taken from `pending`, « Validée. » / « Rejetée. » with « Annuler (8 s) » (POST
  /api/review/undo), read aloud and reached by Tab; then the camera's next send, else the
  queue's next camera in the order it was shown, else « File » with « File vide » (« Fin de
  la liste. » under a search or a filter other than « À traiter »). An error
  is said above the bar and aloud, never a greyed button. « Détails »: the id with
  « Copier », OpenStreetMap's version, history and tags, the decisions with « Changer la
  décision » (two steps), the withdrawn ones. The statistics, the histograms, the
  gesture's duration, « Retirées » and « Ajouts » are gone (the statistics come back for
  the admin in lot 4).
- « Me localiser »: off, « Localisation… » (from the tap to the first position, `aria-busy`; a tap cancels), « Suivi », « Recentrer », « Position indisponible » (2026-10-02), « Pas de position : réessayez » (no position 15 s after permission, 4 s, then off). The first position known moves the map in a 400 ms ease (a jump when it is out of view or under reduced motion), a coarse one first then the precise one; later positions move it only beyond max(5 m, half the accuracy radius) (lot M, 2026-10-17). Any gesture on the map (a drag, a pinch, the wheel, the keyboard, the zoom buttons, a tap) leaves « Suivi » for « Recentrer »: no position moves the map after it (lot U, 2026-10-18; `locate.ts` movestart and wheel).
- Punk, signed in (lot « comptes », board 26a; 2026-10-10: the account's screen is the
  leaderboard and only it — 25b's profile is not shipped, one's contributions stay in each
  camera's « Vos contributions » with « Retirer »): the account square opens in place of the
  camera sheet the pseudonym cut out, « Compte · depuis <mois> », this month or « Depuis le
  début », Total or one sort with its colour, the podium rising (none under reduced motion),
  « Vous · Ne » with its detail and its points awaiting review, ranks, pseudonyms and points
  only, « Apparaître dans le classement des autres » (off by default), the scale the API
  reads from rules/leaderboard.yaml, « Changer le mot de passe » (the current one and a new
  one of 12 characters at least), « Se déconnecter », « Supprimer mon compte » with the
  password. `src/profile/leaderboard.ts` openLeaderboard(ctx), called by the account square
  (`account/index.ts`). Lot U (2026-10-18): « Afficher mon pseudonyme sur les caméras que
  j'ai relevées » under the first switch, off by default, what it reveals said under it;
  « Mes caméras ↓ » before the scale unfolds the person's collection (its numbers, the
  stickers by kind, a little map drawn on the paper, 25b's cameras by commune and their
  journal, each contribution « en attente », « acceptée », « sur la carte », « publiée sur
  OSM » or « refusée »), GET /api/me/contributions asked when it unfolds; a tap on a camera
  opens its sheet in place of the screen, « ← Mes caméras » back: a button of the head's
  top row beside ↑ and ×, as high, the sticker and the title under it where every camera
  sheet has them (lot U2; `src/profile/cameras.ts` backLink, theme/punk/sheet.css
  `.has-return`).

## Deviations from the mockup (« Écarts à la maquette »)

### Participation (lot 3.4)

Boards: 3a (wide screen) and 4a (phone): step 1 for the position, step 2 for the add's
sheet, its tiles and tickets, step 3 for the direction, screen 4 « Corriger » for
« Modifier »; 16a for the stickers; 8a for the send; 17a for the button. Adding and
« Modifier » are one component (DECISIONS 2026-10-08); « Toujours là ? » is the current
screen in the punk tokens.

| Mockup | Code | Reason |
|---|---|---|
| « Corriger » (3a, 4a screen 4, 8a); 17a's « Compléter » and « Déplacer » on the sheet | « Modifier », one button always shown, in place of both | DECISIONS 2026-10-08 « « Modifier » replaces « Compléter », « Déplacer » and « Corriger »… » |
| 17a's « ? » on « Compléter » always | on « Modifier » only while a value is assumed that it asks (a dome's height included) | the « ? » means « à compléter » (the lot 3.2 row above); the button itself is always there (DECISIONS 2026-10-08) |
| The add's sheet holds every choice inline (tiles, tickets, « Viser sur la carte › »), « Corriger »'s rows open their tickets under them | the same for both: an add shows every line's choices, « Modifier » the lines the camera assumes and the touched ones, the others unfold on a tap; only the direction opens the map | DECISIONS 2026-10-08 « The add / « Modifier » sheet shows each line's choices under it… » |
| « Corriger »: four rows, no position | the position ticket first (4a step 2's card: the sticker, the street, « Position actuelle » or « Déplacée de N m » and the commune, « Modifier ») | DECISIONS 2026-10-08 (the position included in « Modifier ») |
| 4a step 2's card: « Allée Baltard · Position posée · Les Halles » | the nearest named street within 50 m (the basemap's streets and paths; railways, tramways and metro lines left out), « Position posée · » the commune (ours, IGN: a Paris arrondissement in place of its commune), never a district; « Position posée » alone when no street is near | DECISIONS 2026-10-08 « The add / « Modifier » sheet shows each line's choices under it… » (from the tiles already loaded); no geocoder, no third-party runtime service (CLAUDE.md) |
| Forme: five tiles and more (Je ne sais pas, Petit dôme, Tube, Grosse boule, Œil 360°, Lecteur de plaques, Sonnette) in a scrolled row, « Je ne sais pas » first (4a), last (3a) | five tiles, Je ne sais pas, Petit dôme, Tube, Grosse boule (4a's order), then Multi-boules, on one row | DECISIONS 2026-10-08 (four answers); 2026-10-09 « « Je ne sais pas » comes first… »; 2026-10-04 (the rare kinds are not told apart from the pavement); the user's decision of 2026-10-23 (DECISIONS 2026-10-23, the multi-dome: a new category, last so that 4a's four keep their places) |
| No multi-dome anywhere (16a's stickers, 3a/4a's tiles, no number of domes) | its own sticker in 16a's vocabulary (the dome's half-disc three times under one housing bar, its ceiling plate and rod, the middle eye half-closed); « Nombre de boules » on a line under « Forme » when the shape is « Multi-boules »: « Je ne sais pas » first, then « 2 » to « 6 » as tickets, no direction line choices (« toutes (plusieurs boules) »), no tilt | the user's decision of 2026-10-23 (DECISIONS 2026-10-23: a new category, published with its number of domes only); the line in 4a's own vocabulary (a line and its tickets, « Je ne sais pas » first: DECISIONS 2026-10-09) |
| 8a: the badge alone under the tickets | for a multi-dome sent without its number by someone who publishes on OSM, a line under the badge: « Sans le nombre de boules, cette réponse reste sur Surveillance World : elle ne sera pas publiée sur OpenStreetMap. » (the « Sera publiée sur OSM… » strip's place and look) | DECISIONS 2026-10-23 (camera:count only with a known number: the API answers `osm: "kept"`); the strip is the OSM synchronisation's own (`score-osm`) |
| Hauteur: RDC / 1er étage / 2e et + / Poteau | « Je ne sais pas » first, then « ~2 m », « ~4 m », « 6 m et + » (the same three classes, ground, first, upper, 2, 4 and 7 m), no « Poteau », for every shape but the big ball (rules/questions.yaml height.modify_excludes); the tilt under it for a tube or a small dome (questions@5), its line absent otherwise | the author's request of 2026-10-12, point 5 (« Poteau » did not say the height; a pole is stored as ~4 m, no `camera:mount` published), its DECISIONS line proposed with this lot (it supersedes, for the punk editor, the classes of 2026-10-08 « … the height classes (RDC, 1er, 2e et +, poteau, je ne sais pas)… »); DECISIONS 2026-10-13 « The tilt is asked for a tube and a small dome… » (supersedes 2026-10-08 « The tilt is asked for a tube only… ») |
| Values in capitals, metres included (17a's « ~3 M ») | in the editor the height's three choices and its value in metres keep a lower-case m (« ~2 m », « ~4 m », « 6 m et + »), the rest in capitals | « 4 M » reads mega: the unit is the metre's symbol, m (SI); the author's request of 2026-10-12, point 5 (the choices in metres) |
| Exploitant: Public / Commerce / Particulier, « Public » preselected | Je ne sais pas / Public / Commerce ou entreprise / Particulier, « Je ne sais pas » checked when nothing else is (never « Public »), then (not after « Particulier ») 20a's « Exploitant précis » search over every listed name, the names around first, a name setting its class; a name not listed proposed after « Public » or « Commerce ou entreprise » only, « Nom (à relire) », shown nowhere before /revue accepts it | DECISIONS 2026-10-09 « « Je ne sais pas » comes first… »; 2026-10-08 (the operator's four answers, nothing preselected, then the nearby operators); 2026-10-06 « No answer is preselected… »; the author's request of 2026-10-12, point 6 (RATP could not be chosen; no private individual's name in the database), its DECISIONS line proposed with this lot; the search is 20a's own component (its tokens, machine.css #adv-operator) |
| « Je ne sais pas » preselected for the direction (4a step 2) | the same: « Je ne sais pas » first on every line, checked when nothing else is; in « Modifier » a line whose value a choice says shows that choice, and « Je ne sais pas » sends nothing; « Je ne vois pas » in the direction's view too | DECISIONS 2026-10-09 « « Je ne sais pas » comes first… » (supersedes « nothing preselected ») — no deviation left |
| A line a kind does not take | no choices, no button, its value said (a big ball's direction « toutes (motorisée) », its height « — ») | data: a direction rule and a height rule per kind (rules/direction.yaml, rules/questions.yaml) |
| Rows 34 px and tickets 40 px high (4a), about 30 px on a wide screen (3a) | rows 44 px; tickets 44 px on a phone, 36 px on a wide screen | DECISIONS 2026-10-07 « Fidelity to the mockup comes first… » (44 px for what is touched on a phone); with a mouse, 44 px tickets pushed « Viser sur la carte › » under « Je ne sais pas » in 3a's 336 px |
| « Envoyer 1 correction » | « Envoyer N modifications », off while nothing changed; the add: « Envoyer » | DECISIONS 2026-10-08 (the changed pieces leave in one send; the sheet is its summary) |
| 8a (export of 2026-10-09): the sheet crumpled into a paper ball, thrown, a « Correction envoyée » ticket stamped « Reçu » | none: 8a as redrawn for the lot of 2026-10-11 (« Envoyer et marquer des points »), the paper ball removed everywhere (it was never built) | the author's request of 2026-10-11, point 11 |
| 8a: « Envoyer » pressed 120 ms, then the sheet slides down in 440 ms | the slide starts at the tap and lasts 400 ms (the press is the buttons' own, 90 ms); 8a's later times counted from the sheet gone | DECISIONS 2026-10-06, « Animations: at most 400 ms… » (the map behind is a content the slide reveals) |
| 8a: the field a conic wedge (56°) turning from 27° to 300° | the field the send gives (POST /api/modify/preview, cut by the buildings, its three levels) turned around the camera from its direction to the one sent, 700 ms on 8a's spring; none when the direction is unchanged, not sent, or was unknown, nor for an add | data: the map draws exact fields, never wedges (DECISIONS 2026-10-05, « Redesign "Carte punk"… »); a turn needs a direction before |
| 8a: the three tickets and the total at fixed places of its 390 × 844 frame | a column at the bottom of a phone, centred (the row « 8a's phone frame » below); on a wide screen the column of the sheet that just slid away (its left and width: « Modifier »'s or the add's paper, the camera sheet for « Toujours là ? »); more than three tickets share 8a's 990 ms; a stack higher than the screen gathers its added infos on one ticket, « Fiche · 5 infos ajoutées »; « Voir le classement » 346 px wide at most | data: an add sends up to six pieces and a bonus (seven tickets: higher than a 581 px screen); the author's request of 2026-10-12, point 2 (the tickets pressed against the left edge of a wide screen; the stack too high) |
| — (8a draws no bonus) | « Tout y est · Bonus caméra complète » as a ticket of its own after the add's answers, when the server gives it; the add's own ticket « Ajout · Caméra ajoutée » | data: the leaderboard's bonus is an award of its own (DECISIONS 2026-10-10, « Points (26a…) »: « every info its shape asks 10 more »), and the tickets must add up to the total; no word twice on a ticket (« Caméra · Caméra ajoutée », « Bonus · Bonus caméra complète »): the author's request of 2026-10-12, point 2 |
| 8a: the tickets pink, light blue, yellow in the order they fall (two corrections in two colours) | each ticket in its category's colour, the leaderboard's (add pink, info light blue, correction yellow, verification the paper, bonus yellow on ink), the line starting with the legend's word, from its first frame: the category told by the phone (profile/award.ts, the server's rule over the camera's tile), the server's answer replacing it where they differ | the author's retouch of 2026-10-11 (« mêmes valeurs, mêmes couleurs, mêmes mots que la légende du classement »): one source, tokens.css --k-*; the author's request of 2026-10-12, point 2 (white tickets until the server answered) |
| 8a: the cannon at (324, 640), over « PTS » | to the right of « PTS » (8a's 324 px when the total leaves room, further right when it is wider), 28 px under the total's top; on a phone smaller (the row below) | the author's request of 2026-10-11 (« le canon recouvre « PTS » : évite-le ») |
| 8a's phone frame: the stack and the total at the left (22 px, its tickets 18 px), the cannon at full size beside the total | on a phone the column centred, its stack and its total centred in it, a margin on each side; the cannon at 0.65, at least 34 px right of « PTS », its mouth up to 10 px from the screen's edge (its body partly beyond with a four-digit total at 375 px); on every screen each stub's number raised by 22 px of padding, above the part the next ticket covers | DECISIONS 2026-10-13, « 8a on a phone… » (the author's iPhone capture: the stack off the left edge, « +50 » cut by the ticket under it: 8a's 14 px overlap and the tilts cover about 30 px of the stub) |
| 8a: online only | offline, the points route failing, or no answer within 2 s of the request (`POINTS_TIMEOUT_MS`; the pieces' own sending, before it, is not bounded), the tickets without points, no total; offline the queued wording in the badge's place and no « Voir le classement » | the contract of the lot (« never a number the server did not give »); the leaderboard needs the network; the author's request of 2026-10-12, point 2 (a short delay, then no numbers, as offline: 2 s, the API answering in tens of ms) |
| 8a: no reduced-motion version | under reduced motion the tickets, the total and « Voir le classement » at once, straight, the field at its new direction, no cannon | the author's request of 2026-10-11; DECISIONS 2026-10-06, « Animations… » |
| 8a: « Modifier »'s send only | the same scene for the add and for « Toujours là ? » on site (one ticket: « Toujours là · Vérification · vue sur place », « Disparue · Vérification · introuvable sur place »); a piece that earns nothing has no ticket, and a send that earns nothing no scene: « Envoyé · en attente de revue » alone (from afar, the sheet stays and says it) | the author's request of 2026-10-11 (« partout où elle a le même sens »); the launch lot, the author's request of 2026-10-13, point 1 (the author's iPhone showed a white « Direction · je ne vois pas » ticket without points) |
| 8a's live line « Envoyé. Direction corrigée +20, … Total +50 points, en attente de revue. » | the send's existing thanks (« Merci, 3 modifications envoyées : elles attendent la revue. ») then each ticket and the total as shown, in the scene's role=status line (`#modify-done`, where a refusal is said) | the thanks were the improvised state's words, kept for the refusal and the offline wording |
| 8a: the field turned to the new direction, with no end drawn | turned only while the tickets are shown, under « en attente de revue »; put away, the map draws the camera as the last build did and the send as a proposal (its ghost) | DECISIONS 2026-10-06, « Every state… » (nothing shown as accepted before the review), relaxed for the scene by the author's request (a DECISIONS line proposed with the lot) |
| The position (step 1): « Nouvelle caméra », « Placez l'épingle… », « Annuler » / « Ici » | the same for an add; for « Modifier »: « ← », « Position », the same sentence and buttons; no façade / libre, no magnet, no « Me localiser »; « Ici » off past 50 m for « Modifier » | DECISIONS 2026-10-08 « Placing a camera is always free… »; rules/participation.yaml move_max_m (a camera moved farther is another camera) |
| The direction (step 3): the target posed, the dotted line, the yellow tag | the same; with a mouse the target follows it until a click poses it, a drag on it moves it; on a phone it is fixed at the free map's centre and the map slides under it (a tap brings its point there), the dotted line from the camera to the centre, the field following live, « Valider » on once the target is 48 px from the camera on the screen, whatever the zoom (direction.min_target_px; 5 m, direction.min_target_m, refused at z21 a target clearly away); the arrows on it from the keyboard (on a phone they move the map) | DECISIONS 2026-10-09 « « Je ne sais pas » comes first… » (the aim under a fixed centre, after the iPhone test); 2026-10-08 (« the direction's aim a dotted line with a crosshair »); WCAG 2.1.1 (the keyboard), 2.5.7 (a tap as the drag's alternative); the author's request of 2026-10-12, point 4 (only the bearing counts) |
| 3a, 4a: the field drawn in the map's pink | each level's outline (dotted, dashed, solid) under its fill, the map's halftone pattern when the theme has it (chantier A's), else --map-field-N, else the field's pink | DECISIONS 2026-10-08 « One palette… » (the levels told by the halftone and the outline) |
| 3a, 4a: the field a pink shape laid over the map's picture | in the editor, under the buildings, the streets and every name (drawn where the map draws its own fields), its fill at 0.55 opacity, its outline kept; drawn only once its direction is known (aimed, chosen, the camera's own in « Modifier »); before, the possible field (the row below) | the author's request of 2026-10-12, point 3 (the field hid the streets and their names; a large star around a pin not aimed yet); DECISIONS 2026-10-08 « Unknown direction leaves no trace on the punk map… » |
| 3a, 4a: no field while the pin is placed nor before the direction (step 1, step 2) | the possible field: the preview's « détecte » level without a direction, a 1.5 px dotted outline over a fill of the fields' pink at 0.1, under the buildings, the streets and every name; gone once aimed | DECISIONS 2026-10-13, « While a camera is placed and no direction is chosen… » (the author's point 4 of the return on Temps 1; supersedes, for the placement, « not at all before a direction is known » of 2026-10-12) |
| 3a: the other cameras small and grey behind the paper | the same: the cameras, fields and filmed streets around dimmed as in focus (16a's dimmed stickers, the fields' one dimmed colour), the camera at hand its pin (16a's sticker whole on the stem) with the field the send gives; the proposals hidden (a pending ghost or field would read as the one at hand) | DECISIONS 2026-10-09 « « Je ne sais pas » comes first… » (supersedes for punk 2026-10-01 « During "Compléter" every field, pictogram and proposal is hidden… »); 2026-10-08 (the sticker whole, as on the map) |
| The direction's tag says only the bearing | the same, and its words said to screen readers (« Direction : 68°, à l'est »), « Visez plus loin de la caméra. » while too close, and why a field is missing (out of the region, offline, the server failing or busy, slow, a wall, the camera inside a building), each said and shown under the target on the tag's yellow paper | WCAG 4.1.3 (status messages); the author's request of 2026-10-12, point 4 (the message near the target, every case without a field its own words); « Valider » waits only while too close (DECISIONS 2026-10-01, in screen pixels since this lot) |
| The map's zoom buttons beside the paper (3a) | hidden while a paper over the map's right is open; back for the position and the direction | they would sit under the paper's right edge (WCAG 2.4.11), as lot 3.2 measured for the sheet |
| No pending add's sheet | « Caméra proposée » lists the answers its field is computed from, « pas de réponse » where none; the field outlined in the ink, dashed | DECISIONS 2026-10-08 « … a pending add draws on the map the field computed from its proposed answers and its sheet lists those answers » |

### /revue (lot 3.5)

No mockup draws /revue: lots 1 « Modérer », 2 « Administrer » and 4 « Statistiques »
(2026-10-16) are a drawing of their own (dessin propre, plan-revue), on its boards P1 to P6 (kept outside the repository), which give the direction, not the pixels. The rows below are where the code
leaves the boards.

| Mockup | Code | Reason |
|---|---|---|
| P1: the phone's tabs end on a « ☰ » | no menu: a reviewer has one tab, « File »; an administrator's six tabs take a row of their own under « Revue » and who is in, 44 px high, scrolling sideways when they do not fit (at 390 px the row scrolls: lot 4 added « Statistiques »), the current one brought in sight | the contract of lot 2 (« tabs scroll horizontally (or a menu) »): every view one tap away, nothing hidden behind a menu |
| P1: « Tube », « Dôme » as the label's kind | the served build's words, short: « Fixe », « Dôme », « Multi-boules », « Motorisée », « Panoramique », « Lecteur de plaques », « Sonnette », « Caméra » for an unknown kind | data: the label reads the build's kind (`fixed`), not the contributor's shape (« Tube » is one of its answers) |
| P1: « marie_k · 1re contribution » | « marie_k · aucune contribution décidée » | data: the queue counts the author's accepted and refused contributions, not the pending ones: « 1re » could be false |
| P2: « Rond rose : position proposée · éventail : champ proposé · losange : caméra existante à 7 m » | the shapes only (« rond plein », « rond cerclé », « contour pointillé », « zone pleine », « losange », « carré »), and only those drawn | RGAA 3.1 / WCAG 1.4.1 (no information by colour alone; the plan's §7) |
| P2: « À 7 m : n10772052370 (Dôme, OSM) — doublon possible. » | « À 7 m : Dôme, déjà sur la carte — doublon possible. »; the id only under « Détails » | the contract of lot 1 (no raw id in titles or rows; the id under « Détails » with a copy button) |
| P2: the bar Rejeter · Valider (and « Masquer la caméra… » on a wide screen) | Rejeter · Valider; « Valider ce qui est fait sur place (N) » above them only when it does more than Valider; « Fiche suivante » when nothing waits; « Masquer cette caméra » (an administrator's) in a block « Retrait » under « Détails », two taps, in both widths | a third button doing what Valider does, on a 390 px bar, said nothing more; hiding is rare and not a decision on the send: kept off the decision bar, where a slip would hide a camera (DECISIONS 2026-10-13, retraits on request) |
| P2: one table for the camera | one table for the oldest waiting send; the camera's other waiting sends listed under it, decided one by one | data: two accounts may propose different values for one field; one decision per send (DECISIONS 2026-10-08) |
| P2: « Validée. » and « ANNULER (8 S) » with a fixed « 8 s » | the seconds left, counting down; the time stops while the pointer or the focus is on the toast | WCAG 2.2.1 (timing adjustable: a keyboard or screen reader user reaching « Annuler ») |
| P5: « Caméras masquées » and « Réglages » side by side under the tab « Retraits » | two views, two tabs (« Retraits »: « Caméras masquées »; « Réglages »), each its own h1 and address | the contract's nav (Retraits and Réglages are two tabs); one h1 per view (plan-revue §7) |
| P5 (phone), P4 (phone): the head « Revue » and the current tab only, no pseudonym nor « Se déconnecter » | the head « Revue », who is in and « Se déconnecter »; the six tabs on a row under it | the contract of lot 1 (who is signed in and « Se déconnecter » in the head); every tab one tap away |
| P4: « Admin » | « Administrateur » | the role's word everywhere (the account sheet, the role's choice, the journal) |
| P4 (wide): an « État » column (« actif ») in « Équipe » | the state as a tag beside the pseudonym, in both tables, only when it is not « actif » (« désactivé », « jamais activé »; « test », « vous ») | one rule for both tables at 390 px, where a fifth column does not fit; « actif » says nothing |
| P4: « Contributeurs récents » without column heads (« 3 acceptées », « 9 refusées » in red) | a table with its heads (Pseudonyme, Dernière, Acceptées, En attente, Refusées), the numbers in columns, a refused count above 0 in the error colour and bold | WCAG 1.3.1 (a table's cells named by `th scope`; plan-revue §7); the words are in the heads, the colour only repeats them (1.4.1) |
| P3: « Compte »: Rôle…, Désactiver, Couper l'accès, Exporter ses données, Supprimer… | the same and « Réinitialiser le mot de passe »; on one's own sheet or the last administrator's, only what the API allows (Couper l'accès, Exporter ses données) with the reason in a line | the contract of lot 2 (reset shown once); the API's refusals (self, last_admin) said before a tap rather than after |
| P3: « Chaque action redemande votre mot de passe (10 min) et entre au journal. » | « Chaque action demande votre mot de passe s'il n'a pas été donné depuis 10 minutes, et entre au journal. » | data: the password given is valid 10 minutes (review.reauth_minutes); it is not asked again within them |
| P3: « Désactive le compte, coupe ses sessions, rejette ses 14 envois en attente. Réversible décision par décision. » | the same, « (« Changer la décision » sur la fiche de chaque caméra). Entre au journal. » | the contract of lot 2 (every destructive action says it enters the journal); how to reverse it named |
| P3: no list of the account's contributions | « Ses N dernières contributions » (closed), each a link to its camera's view | plan-revue §4 P3 (« contributions par statut (liens vers les fiches caméra) ») |
| P3: « Rôle… » opens nothing drawn | a group of three radios under the buttons (the current role checked), Annuler · Changer le rôle | no board: the native control that names the roles |
| P5: a switch, dark track and pink square, nothing written | the same, « Oui » / « Non » written on it (role switch) | WCAG 1.4.1: the state said in words, not by the square's side and colour alone |
| P5: the hidden list Caméra · Depuis · Sur la carte | the same, the camera's label under its id while the database knows it, and « Démasquer » on each line; what a typed id is, said under the field | the contract of lot 2 (« preview of what it is », démasquer) |
| No board for the password asked again | a modal dialog « Confirmez avec votre mot de passe » on the page's tokens, the rest inert, Annuler · Confirmer (pink) | the contract of lot 2 and plan-revue §5 (reauth, 10 minutes); a native `<dialog>` keeps the focus inside and gives it back |
| P6: « 17 comptes actifs en octobre » | « 17 comptes actifs ces 30 derniers jours » | data: the API's count (and its threshold, rules/stats.yaml `contributors.window_days`) is over the last 30 days, not the calendar month; the months are in the table |
| P6: « La file grossit-elle ? », a curve without a name | the curve is the sends waiting each day over 90 days (its text alternative says so); the weekly in and decided are the sentence (this week) and a table behind « Voir les chiffres », not a second line | the `dataviz` method: two series would need a categorical pair the theme's ink cannot give (ink fails its chroma check), and the board draws one line; one series in ink needs no legend |
| P6: curves without scale | the scale's top and 0 at the chart's left, the first and last day under it, each point's value on hover (its title) | the `dataviz` method (ticks carry the values not labelled); the values for everyone are in the table (WCAG 1.1.1, the chart's text alternative names its range and last value) |
| P6: the map loads' curve and its 7 days' average up to today | both on whole days: today's count, still running, is only in the table (« 16/10 (en cours) ») | data: a partial day drew a fall at the curve's end and lowered the average |
| P6: « Voir les chiffres » under « Le site est-il utilisé ? » only, a link | « Voir les chiffres » under every block that has data, a disclosure (`<details>`) that opens its tables in place, 44 px high | plan-revue §6 bis (every curve its table, for screen readers) and the contract of lot 4 (« Voir les chiffres » per block); a link would leave the page |
| P6: « joe 41 · lea.b 12 · marie_k 9 », plain text | the top 5, each pseudonym a link to its « Fiche utilisateur » (44 px), its accepted sends beside it, muted | the contract of lot 4 (« the top 5 linking to their account sheet ») |
| P6: « Retraits », « 2 caméras masquées en octobre » | the same, « N masquées en tout » under it, the months behind « Voir les chiffres » | plan-revue §6 bis (« caméras masquées par mois »); this month alone said nothing of the others |
| P6: « Quelle part part sur OSM ? » when publishing is not offered | « Publication non ouverte. » in its dashed box whatever the count, before « Pas encore assez de données » | data: nothing can leave while it is not offered; the box is the answer, a count would say there is too little yet |
| P6: « Le site est-il utilisé ? », one curve of the map's loads | four blocks: « Les dernières 24 heures » (bars an hour, a tick on each for the same hour's mean over the 7 days before), « Les 30 derniers jours » and « Les semaines, sur 13 mois » (the map's loads; contributions solid and decisions dashed on one axis), « Inscriptions par mois » (bars); welcomes and sign-ins in each block's muted line and tables | the « go » of 17/10 (S6's spans); two series on one axis told by their mark and a legend, never by a colour (WCAG 1.4.1); the map's loads never on the sends' axis (one scale a chart) |
| P6: nothing under the blocks | « On compte des visites et des connexions, jamais des personnes. » under the h1; « Les comptes de test n'entrent dans aucun chiffre. Heures et jours de Paris ; les heures sont gardées 7 jours… » under the blocks | the « go » of 17/10 (the screen says it counts visits and sign-ins, never people), plan-revue §6 bis (test accounts left out) |
| P6 (phone): the head « Revue » and the current tab only | the head, who is in and « Se déconnecter », the six tabs on a row that scrolls | lot 2's rule (every view one tap away), as P4 and P5 |
| No board for « Journal » | the queue's head; the type's chips (Tout · Contributions · Décisions · Administration, the queue's) and Personne with « Filtrer »; a feed, one line per entry « 17/10 · ana · a proposé un déplacement de 7 m · Fixe · Avenue de l'Arche, Courbevoie », the camera's id at its end as a link; « Plus » | the « go » of 17/10 (an activity feed; « Plus aucun identifiant brut comme texte principal de « Sur quoi » ») over plan-revue §4's table |
| No board for the sign-in | « Connexion à la revue », a line saying who may enter, the form (Identifiant, Mot de passe, Entrer), « Retour à la carte » | lot 1's sign-in, its words changed for the privileged entry (lot 2) |
