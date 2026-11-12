# The register (registre)

The register's screens, lots R0 to R3, v2 and the redesign v3.

## In force

### 1.12 The register (lots R0, R1a, R1b, 2026-10-28 and 29; v2 and v2.1, 2026-10-30; R3, 2026-10-31)

The register is the site's second part: the public documents on video surveillance — contracts
(DECP), tender notices (BOAMP), prefectural decrees (the préfectures' recueils, the Rhône's first)
and subsidies — tied to communes, companies and buyers. Since v2 (`design/registre/v2`) it opens
over the map: every `/registre` path is the map's page (`index.html`, rewritten by
`deploy/preview.caddy` and by Vite), under the register's strict Content-Security-Policy, not
indexed until its public opening; its code in `src/registre/` (`hote.ts` in the map's bundle, the
rest a chunk asked when a register path opens), its data the static files `lacarte-registre construire` writes under
`/data/registre/` (`pipeline/lacarte_registre/`), after exporting the corrections accepted in
`/revue` from the database; it marks the build (`data/registre/construction.json`, not served) and
the deploy refuses a register built without them (`lacarte-registre verifier`). Its rules are
DECISIONS 2026-10-28.

- **The pages.** `/registre/` (the summary: the search grouped by type, the four families and
  their counts, « Comment lire le registre », the update and the decrees not read), one list per
  type (`/registre/communes`, `…/intercommunalites`, `…/departements`, `…/acheteurs`,
  `…/entreprises`, `…/contrats`, `…/modifications`, `…/appels-d-offres`, `…/arretes`,
  `…/subventions`: the rail of the lists, « classer par » with the rank, filters each counted
  without itself, a text filter, « Afficher plus », the CSV; their state in the address),
  `/registre/couverture` (what the register covers), `/registre/glossaire[#g-<mot>]`, and the
  fiches: `/registre/commune/<insee>` (with `…/documents` and `…/autorisations[/<dossier>]`, its
  pages, `…/autorisations/<id>` a decree chosen at its section, and
  `…/carte[?mois=…&semaine=…&genre=…&acte=…&creneau=…]`, « Drones et algorithmes » on the site's map),
  `/registre/departement/<code>[?ic=<epci>]` (a département, an intercommunality),
  `/registre/acheteur/<siren>`, `/registre/entreprise/<siren>`, a document's fiche at its type's
  address (`/registre/contrat/<affaire>` a contract and its modifications, `…/avis/<affaire>` a
  notice without its contract, `…/subvention/<affaire>` a grant, `…/arrete/<affaire>` a decree;
  the old `/registre/contrat/<affaire>` of the last three answers a 301, `deploy/preview.caddy`,
  and the router replaces it in place, `routes.ts` `nouvelleAdresse`). `/registre/chiffres` and
  the old documents' search are replaced
  by their list; a buyer that is a commune, an intercommunality or a département, and a decree
  attached to a commune, by their territory's page (DECISIONS 2026-10-29 and 30). A path whose
  subject the register does not hold says « Page introuvable » (`src/registre/vues/introuvable.ts`).
- **The templates are the mockups' markup** (the direction mockups, wide; the phone is the same
  view in one column), rendered by the register's engine (`src/registre/dc.ts`): every word a
  path into the catalogue (`registre.*`), the colours the punk tokens (`theme/punk/tokens.css`,
  the register's block), every deviation in §3 « The register ».
- **The frame** (`src/registre/modale.ts`, `cadre.css`, boards V2-*): on a wide screen a modal over
  the map, 56 px from its left and right edges, 24 px from its top and bottom, its content at most
  1 200 px wide, its offset shadow the colour of the open fiche's type; on a phone a sheet over the
  map (44 px of map above a fiche, 64 px above the summary) with a handle: touched or dragged it
  goes down to half the screen, dragged far down it closes. Its head: « ← Retour » (one step back in
  the register's own history, its filters, section and scroll kept; « ← Carte » when there is none
  before, which closes to the map), the breadcrumb
  (each step with its type's square), the search, the sun / moon (the map's own toggle, both
  repaint), ✕; on a phone « ‹ <up one step> », « Partager » on a fiche, the theme, ✕. The map
  behind is inert and the focus stays in the register; Escape closes it (a share window or a
  dialog first), the browser's back goes up one step, the focus goes back where it came from. The
  map keeps its own address aside meanwhile (`url.ts`) and gets it back; a commune's page shows
  that commune on the map behind. Drones et algorithmes asks for a panel instead (`panneau()`): the
  register on the right (about 470 px), the map live, no trap. One modal at a time, in one order of
  layers written at the head of `registre.css` (the map 0, its panels 1–9, the register 50, what
  opens from it 60, the legal pages 61): opening the register closes the site's other modals; a
  dialog opened from it (« Signaler une erreur ») goes above it, the focus in it. Open, every child
  of the page but the map, the register and what opens above it is hidden, the map's controls and
  popups too; the ODbL attribution stays readable.
- **The doors from the map** (`src/registre/hote.ts`): « Le registre → », a link of the ticket on the row of « Filtres et légende » (17a's links; the row of squares has no room for a fifth, a line of its own covered the map);
  « Voir dans le registre » in a commune's or a département's sheet when the register holds its
  page. Every link to a register page, on the map or in the register, moves the page's history
  without reloading it.
- **The types** (`src/registre/types.ts`, V2-Types): four families, each a pictogram, a word and a
  colour (`--type-territoire` #ffe800, `--type-acheteur` #9be7c4, `--type-entreprise` #c9b8ff,
  `--type-document` #7fd4ff, the same in both modes); the colour says the type, never a value; pink
  stays the frame's and the map's. A fiche's head: its type's sticker and its name in cut-out
  letters (the real h1 read, the scraps hidden); its band, stuck at the top: the type, the name,
  the sections (the one being read marked) and « Partager ».
- **Every mention that has its fiche is a link** (the owner's rule): a commune, a département, an
  intercommunalité, a buyer, a company or a document, in a sentence, a table, the panel, a
  tooltip, the frieze, a search result, the breadcrumb; the link carries its target's square and
  an underline of its colour, in a list the square alone (`src/registre/liens.ts`). A name without
  a fiche stays words, a sole trader is never a link. `tests/test_registre_liens.py` renders every
  page of the fixture's build (`web/tests/registre-liens/rendre.ts`, no browser) and fails on a
  name of the lexicon left as words outside a link.
- **One skeleton** for every fiche: identity (its head), L'essentiel, Dans le temps, Avec qui,
  Documents, Sources, always in this order, an empty section left out, the others numbered. A
  collectivité has one fiche, its territory and its purchases. The panel of the detail stays on
  the right on a wide screen; on a phone it rises as a drawer once something is chosen. At rest it
  says only what to hover or choose; a row hovered or focused is shown in it, a row chosen (click,
  Enter, tap) is selected (`aria-selected`, a ground, its type's bar at its left), the panel
  scrolled to be seen whole and its arrival marked by a 400 ms flash of its outline (none under
  reduced motion); the lists have it too (`src/registre/vue.ts`: `survol`, `choisir`, `affiche`).
- **Rows and columns** (`cadre.css`, « rows »): a row that leads somewhere is its main link's
  target across its width (`.r`, `a.rl`; rails, summary, search results, tables, breadcrumb),
  hovered its title underlined; no link repeated on every row (« Voir l'arrêté », « Signaler une
  erreur », « Sur la carte » are in the panel). A column of numbers has its head and values right
  on one edge, a column of text both left; a head that does not read alone carries a sentence
  (`.aide`). `web/bench/smoke-registre.mjs` (a gate step per engine) and
  `web/bench/smoke-colonnes-registre.mjs` (any register page, against a server with the data)
  check the edges.
- **Drones et algorithmes** (« Surveillance par drones et par algorithmes »,
  `src/registre/vues/carte.ts`, `drones.ts`): the drone zones and the algorithmic-analysis decrees
  in one view, a filter « drones » / « algorithmes », both in the documents' colour, drones solid,
  algorithms hatched; a zone over 80 % of its commune or more a hatched band on the ground
  (« toute la commune »), the others opaque volumes; the hover a feature state, the selection in
  ink (a thin outline hovered, full with a thick outline and its label chosen, the others aside);
  board B (lot R4.2): three ways of saying where, all in the drones' blue (`--drone-trait`): a
  drawn zone its volume, a cited sector hatched (`drones.formes`, under the cameras), a zone not
  read a dotted commune edge with a label set on the boundary (« zone non lue · N arrêtés »), a
  click on it keeping the list to the acts without a drawn zone (`?zone=non-lue`); « Jours de vol
  autorisés », a calendar (a cell per day, a column per week from 2024; on a phone a row per
  month, the latest on top), darker by the acts of the day, a day clicked (`?jour=`) filtering
  the map, the tickets and the list, its sentence under the calendar; the tickets « arrêtés »,
  « avec horaires lus », « zones tracées », « zones non lues »; a row its date, hours, service,
  reason and zone's state, nothing for a field not published; an act's panel its authority,
  number and date, « Où » (cited sector, zone), reason, service, purposes, cameras; a decree
  opens in its panel, the view's state in its address. Opening it frames the commune and tilts
  the map, which turns by itself only around a drawn volume; closing the register leaves the
  map there.
- **« Partager »** (`src/registre/partage.ts`): a small window on a wide screen (the fiche's
  preview image when the build has made it, « Copier le lien », « Copier le texte » when the build
  has written one), a drawer on a phone (the image, « Partager… » through the device's own share
  sheet, « Copier le lien »). The link opens the fiche again at the section being read; a list
  keeps its filters. No social network's button, nothing loaded from another site.
- **No human review.** One line where decrees are listed says they are read by a program and
  that an error is possible; a decree's panel links its source (« Voir l'arrêté (recueil de la
  préfecture) »).
- **« Signaler une erreur »** (lot R1b, `src/registre/signaler.ts`): every document's panel links
  its record's form (`/registre/<type>/<affaire>?doc=<id>#signaler`), on a phone in the drawer of
  the row touched, with « Voir l'arrêté » or the source; the record has the button
  beside « Copier la référence »; a click opens the form in a dialog: what is wrong (nine
  choices), the correction, an optional source and contact, no account; posted to
  `POST /api/registre/signalement` (`pipeline/lacarte/api/registre.py`). A reviewer accepts or
  refuses it in `/revue` « Registre »; an accepted correction is applied at the next build and
  the record, and the document's panel, say « Corrigé le <date> », the value read now and the source's value struck
  (`src/registre/corrige.ts`). The decrees that could not be read entirely are counted on the home
  and listed on the coverage page with what failed; an unreadable camera count counts in the
  decrees, never in the cameras.
- **Dates from the data.** The home says when it was last updated; a commune's Autorisations says
  « Dernier recueil lu : <date> », or that its département's decrees are not collected, or why
  they cannot be.
- **Discreet mentions.** An amount shows alone; one line under the money says « Montant prévu au
  contrat : une enveloppe, pas forcément dépensée en entier. »; « date à vérifier » and « lien
  probable » are a small mark beside the datum, named for assistive technologies and explained
  in the panel and under « i ».
- **Loading.** The summary reads `index.json` (its counts, `comptes`) and `couverture.json`; a
  search asks `listes.json` once (the names) and the search API (`GET /api/registre/recherche`,
  the documents, by kind: one request for the counts, one per kind found); a list of names reads
  `listes.json`, a list of documents asks the API a page of 20 at a time (lot R3); a fiche's file
  is asked as its path opens. Carte et drones draws on the site's map, already there: its outline is the head of
  `/data/registre/carte/<insee>.json` (the read cancelled once it has arrived), its volumes the
  commune file's slots; measured (`web/bench/registre-carte.mjs`, Apple M3): Lyon 5.3 MB cold,
  1.4 MB with the map loaded, 449 images/s tilting, 358 turning; Paris 7.4 MB and 3.4 MB, 494 and
  435.

- **All of France (lot R3).** The contracts, modifications and notices come from their sources
  for all of France (`lacarte-registre collecter`: the DECP, the BOAMP, SIRENE and the communes,
  the network through `fetch.py` only); the decrees, drone zones and subsidies still from the
  pilot. Every name a page shows carries its record's reference when the record exists
  (`ref`, `*_ref`, `mentions`: the data contract, PR « Registre R3 »); the current pages link a
  company, a buyer or a commune as before, and no link leads to a record not written (a commune
  without a document has none). Each record's file holds its share (`partage`: its text, its
  three figures, its image), its entry page is served at its address with its Open Graph tags
  and its content readable without JavaScript, and its preview image (1200 × 630) is drawn at
  build over the V2-Partage mockup's layers; the share button and its window are the redesign's.
  Every département and overseas collectivity is named from the catalogue
  (`registre.departement.nom_`, `art_`, `dans_`, `du_<code>`; `depArt`, `depDans` in
  `src/registre/commun.ts`, `partage.dep_*` in the build): « dans le Rhône », « à Paris »,
  « en Guadeloupe », never « département 30 ».
  An intercommunality is named by France's reference wherever it is listed (`listes.json`
  `dico.epcis`: `nom`, `ref` to its buyer's fiche when the build writes one, else
  `sans_fiche`): the list of intercommunalities no longer says « Intercommunalité, SIREN … »
  for one that does not buy; such a row links nowhere.
  A buyer no source names (the DECP, France's reference, SIRENE) carries `nom_inconnu: true`
  in every dictionary and on its fiche (`acheteur.nom_inconnu`): the share says « Un acheteur
  public (SIREN 130 001 902) », the pages are to say the same, never its SIREN as its name.
  Every decree says where it comes from (`provenance`: `collecte`, its département's own
  recueils; `zone`, a zone préfecture's act for another département of its zone, published in
  its seat's recueils, `recueil_dep` that seat; `autre_prefecture`, another préfecture's act;
  `exploration`, read one by one in recueils not collected), and the summary's coverage
  sentence adds them to « Arrêtés : Rhône. »: « S'y ajoutent 18 arrêtés d'autres départements
  (…) : d'une préfecture de zone, de la préfecture d'un autre département ou relevés un à un,
  hors collecte. » (couverture.json `resume[].arretes_hors_collecte`).

### 1.13 The register's redesign v3, lot 1 (2026-11-08): theme A, the home, the lists

The boards of the design canvas « Registre » (theme A, validated by Ju on 2026-11-07) replace
v2's on the views they draw, one lot at a time; lot 1 is the shared kit, the home and the lists.
The other views keep v2's kit until their lot.

- **The kit.** `src/registre/socle-a.css` holds the boards' classes as they are (`.hero`, `.fig`,
  `.card`, `.seg-ctl`, `.btn`, `.chip`, `.kind`, the name cut out `.cut c0`–`c3`, `.docs`,
  `.tip`, `.sbar`), under `.rg .va`; a view in theme A has `va` on its root. Their colours are
  the site's tokens (`theme/punk/tokens.css`), so the dark mode is the tokens' and a vivid
  background keeps black text (`--on-accent`). `socle-a.ts` gives the cut-out letters
  (`coupe`), a folded card's state (`repli`), « ⤢ Plein écran » (`pleinEcran`: the visual copied
  into a dialog over the screen, ✕ or Escape back to its button), the boards' amounts
  (`montantA`: « 80,0 M€ », « 1,8 Md€ ») and the nearest commune of a point (`plusProche`).
- **The phone layer** (under 960 px, the same markup): the head's figures lighter (the figure and
  one line), a card marked `.repli` folds behind a 52 px `button[aria-expanded]` (its title and
  « N lignes »), a thin visual has « ⤢ Plein écran », a table becomes cards (each cell half the
  width, its column's name copied from `data-label`), the bubbles do not exist.
- **The home** (`/registre/`, `vues/sommaire.*`): the sticker « Registre public » and the name cut
  out, the lead, the big search (results grouped by type as before, Enter or « Chercher » runs it
  at once), « Essayer » (Lyon, Electriox City, drones à Paris, Rhône: a fiche when the build holds
  it, else the words searched), « ◎ Autour de moi » (the device's position, never sent: the
  nearest commune by the communes' points in `listes.json`, its fiche opened); the four figures
  (documents, public money `totaux.montant`, authorisations, cameras on the map `totaux.carte`,
  « sur la carte, toute la France »), each a link and a bubble; « Par où commencer », four
  entries; « Cette semaine »: the six latest documents of `index.json` `recents` by tab (Tous,
  Contrats, Arrêtés, Drones), « Publiés avant le vol ? » « non lu »; « La France en un coup
  d'œil »: the départements drawn from `geo/departements.json` (IGN Admin Express COG Carto, its
  attribution under the legend) in five classes of the measure chosen (Argent, Caméras, Arrêtés,
  Drones: `listes.json` `lignes.departements`), the five largest named, a bubble on hover and a
  click to the fiche, on a phone a touch shows the figures under the map and a second its fiche;
  the six largest contracts (`gros`), every buyer and company a link; « Comment ça marche » and the
  sources (folded on a phone). The map's data are asked once the page is drawn.
- **The lists** (`vues/liste.*`, rows and rules `listes.ts`): « Liste » and the name cut out, the
  count in a sentence, the big search (the list's words; « Autour de moi » for the communes),
  « Exporter (CSV) », « Copier le lien de cette liste »; « Afficher » (the family's levels as
  tabs: communes, intercommunalités, départements; Tous and the buyers' four categories; the
  five kinds of document; none for the companies); a card with « Classer par » (segments),
  « Taille » (communes) and the menus (« Département ▾ », « Intercommunalité ▾ », « Métier ▾ »,
  « Depuis ▾ »: every value with its count, several at once, a search in the long ones), the
  table (the order's column marked in its head and its cells; a row clicked follows its link;
  ↑ ↓ from row to row), 20 rows then « Voir 100 de plus » and « Voir les N » at the end.
  Communes: habitants, cameras for 1 000 inhabitants, the commune's own money and per
  inhabitant, contracts of all buyers, camera and drone decrees (« non lu » where the decrees are
  not read); by cameras for 1 000 inhabitants within « 20 000 à 100 000 » by default
  (`?taille=toutes` lifts it). Companies: amount, contracts, clients, départements (the first
  two named), since; by amount. On a phone: the levels full width, « Classer par ▾ » (the orders
  in a sheet) and « Filtres · N » (the Filters panel: the sizes as radios, the place, « Voir les N
  communes »), the active filters as chips, a row its rank, its name and the order's column.

### 1.14 The register's redesign v3, lot 2 (2026-11-08): a commune's fiche

`/registre/commune/<insee>` is board Lyon-A-theme-actuel (`vues/commune.*`, its computations
`vues/commune-a.ts`, its rules `vues/commune-a.css`; root `v-commune-a`, so v2's `.v-commune`
rules, still read by the documents and authorisations pages, do not reach it).

- **The head.** « Commune » and the name cut out; the département's and the intercommunality's
  chips (links); its inhabitants, its INSEE code, its prefecture's last recueil read; a sentence
  of its figures (money since its first contract, per inhabitant and its rank, cameras on the
  map, days of flight); « Partager » (the existing share), « Citer » (the fiche's citation
  copied).
- **The four figures**: cameras on the map (`carte.n`), money per inhabitant (its own counted
  contracts over its population), days of flight over twelve months (`listes.json` `jv`, the
  calendar's own count until it is in), competition (its contracts on one offer among those
  that publish their offers; « non publiée » when none does). Each its rank among the communes
  of its size (200 000 and more, 100 000 to 200 000, 20 000 to 100 000, 5 000 to 20 000, fewer),
  dots when they are 15 or fewer.
- **« Vue 3D »**: the door to the live map on the commune, its drone view (`/registre/commune/
  <insee>/carte`, `?jour=` today's flights when there are some); lot 5 adds its tabs.
- **The table of contents**, yellow, stuck at the top of the frame's scroll: the numbered
  sections present, « Documents », « Sources », « Vue 3D ↗ ».
- **The sections**, each left out when empty, numbered in turn: 1 · the cameras the camera
  decrees authorise (the latest of each dossier) by kind of beneficiary (mairie, shops and
  banks, others), those on the map, the largest systems (named only when published, never the
  mairie); 2 · the counted contracts on its territory by year, stacked by buyer (the city, the
  transports, the others), all buyers, the city alone or per inhabitant, a bubble per year;
  3 · the suppliers of its own contracts (amount, contracts, years, their other buyers from
  `listes.json`) and their graph (squares by amount, « +N » their other buyers); 4 · its own
  affairs with more than one document, the largest three, their steps; 5 · the calendar of
  days of flight (twelve months, a click opens the drone view on that day), today's acts, the
  days by motive (« non lu » until the motive is served), « Publiés quand ? » (`drones.
  publication`, « non lu » when nothing is counted: Lyon); 6 · its rank in its
  intercommunality and in its size, by cameras for 1 000 inhabitants, money per inhabitant or
  days of flight. Then « Tous les documents » (its contracts, the notices, the decrees, the
  grants, ten of each, the full list on its documents page) and « D'où viennent ces chiffres ».
- **On a phone**: the figures lighter, the suppliers, the dossiers, the documents and the
  sources folded, the chart, the graph and the calendar with « ⤢ Plein écran », the table of
  contents a strip scrolled sideways.
- **Behaviours** (board Lyon-A-comportements; `registre/bulle.ts`, one bubble for the frame,
  beside the view, kept inside the screen): a shape carries its bubble in `data-bh` (heading),
  `data-bl` (lines, a swatch as `§class§`), `data-bc` (« Clic : … ») and `data-go`; its group
  (`data-bg`) pales the others while one is read. Hover reads; a keyboard focus reads (Tab),
  Enter clicks, Escape closes the bubble and only it; on a phone the first tap reads, « Ouvrir »
  in the bubble (or a second tap) clicks. Wired: the head figures (definition, « Clic : section
  N » by the number the section has) and their rank dots (each city, its value, its fiche); a
  part of the cameras' bar (number, share; click: those decrees in « Tous les documents ») and
  the map's bar (the live map on the commune); a year's column (total, each buyer's amount and
  contracts, the others pale; click: that year's contracts there, its dossiers outlined); the
  legend (hover: its series stands out; click: hidden or shown); a supplier's row (its node
  stands out); a node (amount with the commune, its other buyers, the rest pales); a calendar
  day (weekday and date, its acts; click: the drone view that day); a motive's bar (its days;
  click: the calendar on that motive, a chip lifts it); a part of « Publiés quand ? » (number,
  share; click: those acts, the latest published first); a neighbour (value, rank, fiche); the
  documents' Date and Montant headers (sort), a row (its document).

### 1.15 The register's redesign v3, lot 3 (2026-11-08): a département's fiche

`/registre/departement/<code>` is board Departement-Rhone-A (`vues/departement.*`, its computations
`vues/departement-a.ts`, its rules `vues/departement-a.css` under `.rg .va.dep`). The head: the name
cut out word by word, its code, its communes with documents, its prefecture's last recueil read, a
sentence of its figures; « Partager », « Citer ». Four figures (public money, cameras on the map,
camera decrees, drone decrees), each ranked among the départements and collectivities of
`couverture.json` (the decrees among the 100 read). Sections, each left out when empty: 1 · its
communes with a document as points at their town hall on the IGN outline (Lambert-93), by cameras
for 1 000 inhabitants, € per inhabitant, camera or drone decrees, a métropole's members ringed, the
best equipped; 2 · who pays (by class of buyer), the largest buyers, the contracts by year (a column
opens that year's contracts list); 3 · the companies; 4 · the decrees by year and the communes with
the most, or why they are not read; 5 · the four rankings. Then « Toutes les communes » (métropole
or not, the intercommunality's menu, sort, twelve rows, CSV) and the sources. Behaviours on
`bulle.ts`: the figures, a commune's point, a part of who pays, a year's column. An
intercommunality's fiche (`?ic=`) stays v2's, in the same module, until it has a board.

### 1.16 The register's redesign v3, lot 3 (2026-11-08): a company's fiche

`/registre/entreprise/<siren>` is board Entreprise-Electriox-A (`vues/entreprise.*`,
`vues/entreprise-a.ts`, `vues/entreprise-a.css` under `.va.ent`). The head: the name cut out word by
word, its NAF activity (a link to that code's companies), its SIREN (never a sole trader's), its
SIRENE record (build of 09/11; a legal person's only): INSEE's category as the board's chip, its
words in a bubble, « siège à <commune> » linked to the commune's fiche when one exists (the file's
lexicon, else listes.json once read) with its département, « créée en <year> », the headcount band
and its year; the contracts' collection day, a sentence; « Partager », « Citer », « Exporter » (its documents as CSV),
« Comparer avec… ». Four figures: public money (its largest client's share), clients by
département, running contracts, offers received. Sections: 1 · its clients by amount, coloured by
a rule (its largest client, that client's département, elsewhere); 2 · its contracts by year
(amounts or counts; a column: that year in « Tous les documents »); 3 · « Ses contrats, par nature »:
the counted contracts by the build's `natures` (installation = fourniture_installation or
travaux_genie_civil, maintenance, lecture de plaques, autre = the rest; a contract can count in
several cases, a case with none is not drawn; a case filters « Tous les documents », a chip lifts
it, a case of one contract opens it), and « Le même métier, dans les mêmes départements », the
build's `pairs` (5 shown, the number the nature × département couples they share); 4 · joint contracts, offers,
the graph centred on it (a node opens `/registre/graphe/<buyer>`), the companies that worked for its
clients; 5 · the frieze of its contracts, the running ones outlined. Then « Tous les documents »
(Année ▾, Acheteur ▾, sort, CSV) and the sources. A duration over 240 months is not drawn.

### 1.17 The register's redesign v3, lot 3 (2026-11-08): a document's record

`/registre/<contrat|avis|subvention|arrete>/<affaire>` is board Contrat-Lyon-2026-A (`vues/contrat.*`,
`vues/contrat-a.ts`, `vues/contrat-a.css` under `.va.ctr`). The head: the type's sticker, the object
whole (smaller beyond 70 and 110 characters), the buyer's and holders' chips (a communal buyer
« Ville de <commune> »), « accord-cadre · signé le … », the DECP reference, a sentence (« a confié à »);
« Partager », « Citer », « Voir les documents d'origine ». Four figures: ceiling or amount (mixed,
rise « à vérifier », the amount at signature), duration and planned end (eForms `duree_mois`),
competition (offers from the DECP, else the award notice, else « non lu »; the procedure), the
modifications. Sections: 1 · who buys what (the natures the build reads and the CPV codes, the
contract's first, labels « libellé non lu »; the objet and dispositif only without a code;
« Commandes » and « Conditions » « non lu » per case); 2 · the parcours (documents at equal
intervals, the real gap written, the planned end computed, today's point; the call for tenders'
bubble its lots, renewals and price weight (`poids_prix`), « Date limite des offres : non lue »;
the award notice's the price weight); 3 · before and after (the previous lots from
`parcours.precedent.lots`). Then « Les documents » (a row opens its source) and the sources. A call
for tenders, a grant or a decree take the same grammar; a call for tenders' record adds Nature,
Codes CPV and Lots rows.

### 1.18 The register's redesign v3, lot 4 (2026-11-08): the centred graph, Comparer, Chemin entre deux

- **The centred graph** (`/registre/graphe/<siren>`, boards Graphe-plein, Graphe-grammaire;
  `vues/graphe*`): a company or a buyer in the middle (`?role=` for a SIREN that is both), its
  partners around it (size: the edge's amount, never a sum of edges), at the edge their other
  partners, between two those they share; at most 12 / 40 / 8 drawn, the rest as « +N ». Hover or
  focus keeps a node's lines; a click, Enter or a second tap opens its detail in the side card
  (« Recentrer » to `/registre/graphe/<it>`, its fiche); double click recentres; « Vue tableau »
  (`?vue=tableau`) gives the same links as rows; « Exporter » the neighbourhood's edges. Phone: a
  window panned and pinched over the drawing, « Plein écran ». Without a centre: a chooser. The
  neighbourhood is computed in the browser from `graphe/aretes.json`.
- **Comparer** (`/registre/comparer?communes=…` or `?entreprises=…`, up to four; `vues/comparer*`):
  chips with ✕, « + Ajouter » (a search in the lists' names, never a sole trader), a sentence of
  the figures, « Partager », « Exporter (CSV) », « Chemin entre les deux » for two companies; a row
  per figure, every figure `listes.json`'s, the highest in yellow on the figures as written (ties
  included); each value a bubble and its fiche at its section; the address follows the columns.
- **Chemin entre deux** (`/registre/chemin?de=&a=`, a SIREN or an INSEE code; `vues/chemin*`): two
  fields searching the graph's names, ⇄, « Trouver »; the shortest paths (breadth first from both
  ends, at most 6 steps, all counted, the 5 largest drawn), each a chain of linked nodes and amounts,
  its sentence, « Voir dans le graphe → »; states for no path, beyond 6 steps, the graph not served.

### 1.19 The register's redesign v3, lot 5 (2026-11-08): the live map's panel, « Fiche » and « Drones »

`/registre/commune/<insee>/carte` keeps the live map and its drone layers (`vues/carte.*`,
`drones.ts`); its panel opens in theme A (board Vue3D-Paris-fiche): « Commune · vue 3D », the
name cut out, two tabs (the ARIA tabs pattern: the arrows move between them).

- **« Fiche »** (`?onglet=fiche`): a sentence of its figures; four figures with their rank
  (`vues/carte-fiche.ts`, on `commune-a.ts`'s rules, so the panel and the fiche agree: cameras on
  the map, money per inhabitant, days of flight with a door to the other tab, contracts on one
  offer); « Sur la carte, ici » (the map's pink streets, three classes); « Caméras autorisées »
  (what the read decrees authorise, or that they are not read); « La fiche complète ↗ »,
  « Comparer … avec… »; the collection's date.
- **« Drones »** (the default, so that every door keeps its address): four figures (acts and those
  with hours, days of flight, the share published before the flight against France's, drawn
  zones); « À venir » (the next five days an act flies, each « Afficher ce jour »); « Publiés avant
  le vol ? » for the commune and for France (`drones.publication`, « non lu » when nothing is
  counted); then the period's calendar, the chosen slot's detail (its motive « non lu » when not
  served) and the slots, as before.
- **On a phone** the panel is the sheet; the sticker is dropped, the figures keep their whole line.

### 1.20 The register after Ju's test of 2026-11-09 (lots 1 to 5)

Verified in the modal at its real widths (908, 1164 and 1324 px of frame for 1024, 1280 and
1440 px windows; 390 on a phone), dark first. **One bubble** (`bulle.ts`, used by every view, the
home's map and figures included): it stands whole inside the frame's visible scroll, or the 3D
panel, under the stuck contents bar: above its element, else below, else beside it; a swatch takes
its series' colour from the view; an element whose bubble promises « Clic : … » is clicked whole.
**One row hover**: a listed, ranked or table row that holds a link is lit `--warn-bg`, takes the
pointer and is clicked whole; the page's own row stays `--type-territoire`, without its dashed rule.
Figures never break (no-break spaces in thousands; `t()` puts a no-break space before « : ; ? ! »
and inside guillemets). Nothing changes height on hover (the 3D view's day line keeps two lines, its
sentence in a bubble). The lists keep the name column at 11 em and drop secondary columns in a
narrow frame (container queries); a control's segments each draw their frame, so a wrapped control
leaves no empty box; a legend's entry wraps under its own text; a cut-out name wraps only after a
hyphen or a space (`coupeMots`). **One figure per measure**, the build's: a commune's drone acts are
`dr` (Paris 641) on the list, the fiche, Comparer, « Publiés quand ? » and the 3D view, which leaves
out acts placed in other communes, helicopters' and ends of authorisations; a département shows
`dr_commune` (acts flying in its communes) with `dr_autorite` (signed by its authorities, the
police prefecture for Paris) on its line; helicopters are a mention apart. A family whose
`couverture_actes` is `non_lu` says « non lu », never 0. The home's « Le graphe » opens the graph;
only the 104 official départements are listed; Comparer holds four communes at 1024 px. The 3D
view: « ← Retour », the whole commune hatched where the act's place is not read and the cited
arrondissement alone where it is, a click on the map centres it in the free part or opens another
commune's view, the opening tab follows the door, twelve months by default.

### 1.21 The register after Ju's look at the production of 2026-11-10

The 3D view hatches every commune with drone acts, from the site's admin tiles when the commune has
no outline of its own (134 of 142): light over the period, full on the day chosen or hovered; every
date it shows says whether it is a day of flight or of publication; « Publiés avant le vol ? » sets
each label over its bar, the second naming the départements it counts. The home's search shows each
result's name on its own line, two columns at most on a wide screen and one on a phone, five per
type then « Voir les N ». A list of documents filters by one « Année ▾ » menu beside
« Département ▾ », every control of a row the same height; a filter with a single value and a column
empty on every row shown are hidden; the decrees' list says « Arrêtés lus dans N départements » with
a fold that lists them. Every date a list or a fiche shows says which it is (« publié le », « vol
le », « signé le », « arrêté du »…), and a drone act is ordered by its publication everywhere; the
commune's « Aujourd'hui » says the days the day's acts were published. Every chart's value axis
takes its unit from its maximum and round steps (socle-a.ts `axeA`). A graph node opens a card with
« Ouvrir la fiche → » and « Centrer ici » (Enter does it, Escape closes it); on a phone the graph
stands whole in the width. The contract's parcours places « Aujourd'hui » among its steps. Where a
département is collected but its acts are placed in no commune, pages say « Arrêtés de … lus, pas
encore rattachés aux communes », never « non lu ». Comparer recalls what its yellow means.

### 1.22 The register with Ju's answers of 2026-11-11

A commune's camera and drone acts read as the build serves `couverture_actes`: `lu` the number
alone (0 means 0); `non_rattache` « au moins N » (« aucun encore rattaché » for 0) with « Une partie
des arrêtés du département n'est pas encore rattachée à une commune »; `non_lu` « Arrêtés de
<département> pas encore lus » (the département a link), « pas encore lus » in a narrow cell. This
replaces § 1.21's « Arrêtés de … lus, pas encore rattachés aux communes ». A minimum sorts at its
known number, has no rank, and a Comparer row holding one has no yellow (its note says so); in the
3D view « aucun encore rattaché » takes the muted, dashed look of a missing figure. Dates say which
they are: « signé le » (a contract), « publié le » (a notice, a drone act's recueil, a decree read
in a recueil), « daté du » (a decree's own day, the pilot's), « attribuée le » / « attribuée en
<année> » (a subsidy), « vol le » (a day of flight). A graph node's card holds only « Ouvrir la
fiche → » and « Centrer ici », with its ✕ (the only visible way to close it on a phone); its detail
stays in the side panel. The 3D legend says a volume's height is its hours of flight authorised
over the period shown; the département's map says what its grey points are in the acts' modes.

## Deviations from the mockup (« Écarts à la maquette »)

### The register (lots R0 and R1a)

The direction mockups (wide; Registre, Registre-chiffres, Commune-grand, Documents-grand,
Autorisations-grand) are ported as their markup (`src/registre/vues/*.html`, made by
`web/scripts/gabarits.mjs` from the prototype's templates, where every change from the mockup was
logged with its reason). The rows below are those changes and what the port adds; a hole (a
figure, a link, a shared part) is no deviation.

| Mockup | Code | Reason |
|---|---|---|
| Every view: « au maximum » beside an amount; yellow tags « date à vérifier », « lien probable » | the amount alone; one line under the money (« Montant prévu au contrat : une enveloppe, pas forcément dépensée en entier. »), the detail under « i »; a small « ? » beside the date, named « date à vérifier » for assistive technologies, explained in the panel | DECISIONS 2026-10-28 « Discreet mentions » |
| Every view: « lu par programme, à relire », « relu à la main » | gone; one line where decrees are listed (« Ces arrêtés sont lus par un programme : une erreur reste possible. Consultez l'arrêté ou signalez une erreur. »); a decree's panel: « Voir l'arrêté (recueil de la préfecture) » and « Signaler une erreur » | DECISIONS 2026-10-28 « no human review » |
| Every view: the work plane's fixed 1180 px column | a column of 1180 px at most, following the screen from 960 px; under 960 px the view in one column (the panel a fixed band, a table's rows that unfold, the tabs scrolling sideways) | the screen's width (the mockups are drawn at 1280); the phone mockups are out of date (the owner, 2026-10-25): the phone is the wide view in one column |
| Every view: the crumbs' links not underlined | underlined | WCAG 1.4.1 / RGAA 10.6 (2.86:1 against the text: a link must show without its colour) |
| Every view: a chart holding buttons or links as `role="img"` | `role="group"` with its name | axe-core nested-interactive (an image cannot hold controls) |
| Every view: « autorisations de la préfecture » for every decree | « arrêtés » for everything a préfecture publishes, « autorisations de caméras » for video protection alone, « arrêtés de drones » | one word per perimeter (the 11th pass's rule): a drone decree is not a camera authorisation |
| Every view: Archivo 400–700 | Archivo 400–900 served by the site (`theme/fonts/archivo-400-900-62-100.woff2`), widths 62–100 % | none left (the font is the mockups'); a slanted Archivo where the mockups set italic (« nom non publié »): the site serves no italic face |
| Every view: names as the mockups typed them (« Société Générale », « MDTP ») | the name as published (« Societe Generale », « Mdtp ») | data: the names SIRENE and the decrees publish; the mockups had retyped them |
| Every view: a person or a sole trader named | « nom non publié » | DECISIONS 2026-10-28 (names in the register) |
| Registre: 6 759 documents, 2 616 tender notices | 6 517, 2 374 | data: 242 BOAMP notices were in the pilot export twice, byte-identical; the build keeps them once |
| Registre: « Maquette : la liste et la recherche portent sur un extrait de 250 documents » | gone | the search covers every document |
| Registre: the latest document a subsidy dated « 2026 » | a decree of 23 October 2026 first | a document dated by its year only sorts at the start of that year (the build's order, the same before and after the search file arrives) |
| Registre: « Télécharger cette sélection (CSV, JSON) », one zip | two links, CSV (UTF-8 with its BOM) and JSON | no dependency added (the prototype zipped with fflate); the licence in the JSON's `meta` |
| Registre: no line under the list | the line on decrees read by a program and « N arrêtés n'ont pas pu être lus entièrement → » when the list holds decrees | DECISIONS 2026-10-28 (the unread decrees published) |
| Registre: the filters always shown, on a phone too | on a phone (under 960 px) behind « Filtres (N) », in the phone mockup « Filtres »'s sheet | the 12th pass: the filters took the whole screen before the first result |
| Registre-chiffres: « Montant max. » | « Montant » | DECISIONS 2026-10-28 « Discreet mentions » |
| Registre-chiffres: 760 buyers | 508 | buyers of at least one signed contract (the mockup counted every buyer of the dictionary, notices included) |
| Registre-chiffres: the amounts of 2026-10-24 (Serfim 45 M€…) | the build's (`compte`): Spie 91 M€, Serfim 47 M€ | data, one counting rule (DECISIONS 2026-10-28 « Amounts in the register ») |
| Commune-grand: an illustration of the map | the tilted map itself (the site's France basemap masked by the commune, the cameras, filmed streets and fields of view, the drone zones flat and hatched), after the content, its attribution under it | DECISIONS 2026-10-28 (the tilted map); the licences (ODbL, Protomaps) |
| Commune-grand: « Où sont les 115 autres ? », « La carte n'en connaît que 10 » | « Où sont les 118 autres ? » with its « i », « La carte en connaît 7 publiques » | the 10th and 12th passes: compared with the map's public cameras only |
| Commune-grand: the legend « champ de vision », « zone de drones autorisée · aucune à Mions » | « champ de vision · de près, dans Carte et drones »; « 2 arrêtés de drones (zones partagées avec d'autres communes) » | the map shows no field of view at a whole commune's scale; data |
| Commune-grand: « versés à une seule entreprise » | « signés avec une seule entreprise » | « versés » would contradict the envelope's line (DECISIONS 2026-10-28 « Discreet mentions ») |
| Commune-grand: a chronology of 8 lines | 12 at Mions: the three elections since the dossier opened, the drone decrees | data (the register's mandates and decrees) |
| Commune-grand: « Demander la liste à la mairie » a link | a button that opens the request's text to copy | the request templates work (lot R1a) |
| Commune-grand: « Me prévenir (RSS) » | absent | lot R1a: not yet |
| Commune-grand: « Nos sources » a button | a link to « Ce que couvre le registre » | the dates come from the data, never a text |
| Commune-grand: one line per end of authorisation in « À surveiller » | one line « Fin de N autorisations de la préfecture, la dernière le … » | data that do not fit (Lyon: 30 dossiers of the mairie) |
| Commune-grand: the frieze and the chronology always there | absent when they would be empty | data (a commune with no document) |
| Documents-grand: 17 documents, Autorisations · 9 | 19, 11 | data: two drone decrees name Mions among other communes; a shared decree appears in each commune it names |
| Documents-grand: who « la mairie », « entreprises et commerces », « nom non publié » | « État » added | data: the police's and gendarmerie's drone decrees are neither a business nor the mairie |
| Documents-grand: names as text | names as links, in the text's colour, underlined | every name is a link (the 11th pass); WCAG 1.4.1 |
| Documents-grand: 960 px, the same three columns | from 960 to 1179 px: filters 170 px, panel 220 px, gaps 16 px; long codes wrap | real data: at 960 the middle column was narrower than the table |
| Documents-grand: a row only hovered | a row hovered, focused or touched fills the panel | WCAG 2.1.1 (the panel's links reachable by keyboard) |
| Autorisations-grand: 9 decrees, « Drones : aucun » | 11, « 2 arrêtés », each « partagé avec N communes » with the communes linked | data (the shared drone decrees); the 12th pass's rule |
| Autorisations-grand: nothing under the introduction | « Dernier recueil lu : 23 octobre 2026 »; a département not collected or impossible to collect says so instead of figures | DECISIONS 2026-10-28 (dates from the data; a missing figure is not zero) |
| Autorisations-grand: on a phone, two close dates on the steps' axis; « valable jusqu'au » across the « auj. » line | the second date hidden on a phone (the table gives them all); the label above the line | 390 px: they overlapped |
| Autorisations-grand: the drones' list, date beside text | on a phone, the date above | 390 px: 130 px of date left a word per line |
| (no board) « Ce que couvre le registre » | the kit's vocabulary: crumbs, title, lead, tables, typewriter notes | DECISIONS 2026-10-28 (the coverage page) |
| The header: Carte · Registre · Glossaire in the work plane's header, in style attributes | the same, its styles in `registre.css` | the register's Content-Security-Policy allows no inline style in the page's own markup |

### The register (lot R1b)

The direction mockups CarteTemps-grand, Contrat-grand, Entreprise-grand, Acheteur-grand,
Departement-grand and Glossaire, ported as their markup by `web/scripts/gabarits.mjs` from the
prototype's templates (`design/registre/prototype/vues/`; the changes made there are logged in
`design/registre/ecarts/`). The lot R0/R1a rows above hold here too (amounts alone and the money
line, discreet marks, no « relu », names as published, underlined links, the work plane's width);
the rows below are what R1b adds.

| Mockup | Code | Reason |
|---|---|---|
| CarteTemps-grand: the list stops at 8 slots | every slot of the period or the selection | the list is the tilted map's text alternative (« La liste sous la frise dit la même chose en texte », WCAG 1.1.1) |
| CarteTemps-grand: « durée non lue », a 110 px column | « horaires non précisés », the column at least 110 px | the owner's wording, longer (data that does not fit) |
| CarteTemps-grand: one link in a slot's panel | « Voir l'arrêté » and « Signaler une erreur » | DECISIONS 2026-10-28 (« Consultez l'arrêté ou signalez une erreur ») |
| CarteTemps-grand: no list of acts without a zone | a second list, « listés, jamais dessinés » | DECISIONS 2026-10-28 (a zone not deduced is listed, not drawn) |
| CarteTemps-grand: always a frieze | no frieze and a sentence saying why when there is no slot | data that does not fit (the extract has no period; a commune without any) |
| CarteTemps-grand: « auj. » at the right edge | at today's place | a slot may end after today |
| Contrat-grand: « jusqu'à 215 000 € au maximum », « au maximum, hors taxes », « Montant maximum » | « un contrat de 215 000 € », « prévus au contrat, hors taxes », « Montant » | DECISIONS 2026-10-28 « Discreet mentions » |
| Contrat-grand: « a confié … à Serfim T.I.C. » | « a signé avec Serfim T.I.C. un contrat de … » | « signés avec » (the owner's answer 3 on lot R1a) |
| Contrat-grand: no money line; « i »: « Au maximum : le plafond… » | the money line once under « Ce que dit le contrat »; the « i » without « au maximum » | DECISIONS 2026-10-28 |
| Contrat-grand: the end « janv. 2028 » | « janv. 2028 (calculée) » | the owner: the end is said calculated, not published |
| Contrat-grand: « (lien probable) », « (à vérifier) » in the text | a « ? » beside the datum, explained once in the panel at rest | DECISIONS 2026-10-28 « Discreet mentions » |
| Contrat-grand: a step's foot « relu à la main / lu par programme » | the source's name; the decrees' one line under Sources | DECISIONS 2026-10-28 « no human review » |
| Contrat-grand: « Signaler une erreur » beside « Copier la référence » | the same button, opening the form; the link also in the panel | none: the form (lot R1b) |
| Contrat-grand: a subsidy's beneficiary linked as the commune | « nom non publié » and a « Commune » row linked | DECISIONS 2026-10-28 (names) |
| Contrat-grand: the prototype's quote dialog behind « Copier la référence » | copied at once (or selected when the clipboard refuses) | no dialog left for one line |
| Contrat-grand: no line for a correction | « Corrigé le <date> », the value read now, the source's value struck | DECISIONS 2026-10-29 (corrections) |
| Entreprise-grand: the scatter of amounts | « En cours aujourd'hui : N contrats » and « Ses plus gros contrats » | the owner's request for lot R1b (DECISIONS 2026-10-29) |
| Entreprise-grand: « 47,5 M€ au maximum », « Montant max. » | « 47 M€ de contrats », « Montant » (`format.money`) | DECISIONS 2026-10-28 « Discreet mentions »; the register's one format |
| Entreprise-grand: places in « Ce qui ressort » as text | each place a link to its buyer's page | every name is a link (lot R1a's 11th pass) |
| Entreprise-grand: names retyped (« BCS », « MDTP ») | as published, title-cased (« Bcs », « Mdtp ») | data: SIRENE's names (lot R1a's row) |
| Entreprise-grand: the section tabs in the flow | sticky tabs, the panel fixed under them | the owner asked for the panel fixed |
| Entreprise-grand: « Ses plus gros contrats », the 8 first « des N » of every contract, by maximum amount | the 8 first of the contracts a total adds (`compte`), « des 62 » for Serfim T.I.C. of its 64: an amount to be verified (Bron 2019, 2,87 M€, `hors_totaux: a_verifier`) is ranked nowhere a total would not add it | DECISIONS 2026-10-28 « Amounts in the register » (one rule, `compte`) |
| Acheteur-grand: « au maximum », « Montant max. », the « i » on maximum amounts | « de contrats », « Montant », « Montants hors taxes, à la signature… » | DECISIONS 2026-10-28 |
| Acheteur-grand: the calls for tenders' table always there | absent with « aucun appel d'offres trouvé au BOAMP » when there is none | data that does not fit (an empty table) |
| Acheteur-grand: company names under a frieze row as text | links, in the text's colour, underlined | every name is a link; WCAG 1.4.1 |
| Acheteur-grand: « Qui vend » and the calls' heads not sortable | sortable (`aria-sort`, arrow) | the owner asked for sortable tables |
| Departement-grand: « non publié » for a buyer whose contracts all stay out of the totals | « — », and « Contrats hors des totaux N » in the panel | data: its amounts are published, none counts (`compte`) |
| Departement-grand: « Qui achète » the buyers seated in the département, with their contracts anywhere | the buyers of the contracts placed in the département | one set for sellers and buyers: a contract signed elsewhere is not « dans le Rhône » |
| Departement-grand: « Autorisations » per year counting drone decrees | camera authorisations only; the year's panel adds « Arrêtés de drones » | one word per perimeter (lot R1a's row) |
| Departement-grand: « presque tous les drones » at any share; « depuis 2018 » written | « tous / toutes » at 100 %; the first year from the data | facts; dates from the data (DECISIONS 2026-10-28) |
| Glossaire: « Vérifié à la main », « Montant maximum », « Empreinte (SHA-256) », « Médiane » | gone; DECP, data.gouv.fr, affaire and groupement de commandes added (56 words either way) | DECISIONS 2026-10-28 (no review, amounts alone); no page shows a hash or a median; the owner's four words |
| Glossaire: definitions that promise a review, a maximum, a toggle for mixed contracts, « versé », a list of départements | reworded to the register's rules (« reste « nom non publié » », « Une aide accordée », « hors des totaux », « Ce que couvre le registre ») | DECISIONS 2026-10-28 |
| Glossaire: examples to the prototype's routes (#/evenement, #/affaire, #/explorer) | to the register's paths | the register's own routes |
| Glossaire: « CSV, JSON, LISEZMOI » | « CSV, JSON » | two links, CSV and JSON (the owner's answer 5 on lot R1a) |
| Glossaire: the index sticky at every width | not sticky on a phone | one column: a sticky index covers the words |
| Glossaire: the word reached by an anchor not marked | marked (`.entry.on`), focused | the owner: the anchor shows its word |
| (no board) « Signaler une erreur » | a dialog in the kit's vocabulary (.modal of R1a's request dialog) | no board draws it |
| (no board) a page whose subject the register does not hold | « PAGE INTROUVABLE » | DECISIONS 2026-10-29 |
| Every view at 390 px: the panel's links | in the row unfolded by a touch (Documents, Autorisations): « Voir l'arrêté » or the source, « Signaler une erreur »; the panel band shows its kicker and title only | the phone's panel is a band (lot R1a); the owner's decision (DECISIONS 2026-10-29) |

### The register v2 (2026-10-30)

The v2 boards (`design/registre/v2/`), the frame, the types, the lists and Carte et drones; the R1
rows above hold for the content of the fiches.

| Mockup | Site | Why |
|---|---|---|
| The boards' classes `.cut`, `.drawer`, `.share` | `.rg-cut`, `.rg-drawer`, `.rg-share` | the map's own stylesheets give those names generic rules that reached the register |
| A cut-out name broken at any letter | broken between its words only | the boards' names are short; a long one (a buyer's) broke inside a word at 390 px |
| (no board) the doors from the map | « Le registre → », a link of the ticket in 17a's face on the row of « Filtres et légende », « Voir dans le registre » in a sheet | the brief's doors; the map had none; the phone's ticket keeps its height |
| (no board) a fiche of a commune, a buyer, a département, a document | V2-Entreprise's frame, their R1 content in the five sections | the brief: the content does not change, the frame does |
| V2-Tel-Entreprise: no panel at rest | the same; a drawer once something is touched, with its ✕ | — (the board's own state, 08b) |
| V2-Liste: no panel | the detail panel, « Voir l'arrêté » (or the source) and « Signaler une erreur » in it | Ju's review B4 (kit-grand-ecran.md: no link repeated per row), DECISIONS 2026-10-30 |
| V2-Liste: « 69 Rhône », « 75 Paris » on two keys | the number on every key, its name read by assistive technologies | the board names two keys only, arbitrarily |
| V2-Liste: the rail on a phone | a horizontal band of the same rows, stuck at the top, the list shown centred | no phone board for the lists |
| V2-Tel-Sommaire: « Transports, santé, autres 107 » | four rows, one list each | a row opens one category |
| V2-Sommaire: « … pas pu être lus » | « … pas pu être lus entièrement » | DECISIONS 2026-10-28 |
| V2-Sommaire: counts (905 communes, 289 companies) | the build's (906, 412…) | real data |
| V2-CarteDrones: « Les arrêtés de la période » | « Les créneaux de la période · N », every slot | DECISIONS 2026-10-29 (a slot per row, the list the map's text alternative) |
| V2-CarteDrones: « Voir l'arrêté → » | « Voir l'arrêté (recueil de la préfecture) », in the panel | DECISIONS 2026-10-28; Ju's review B4 |
| V2-CarteDrones: a row « Drones » in the detail | the devices of the decree (« 2 drones »), « non précisé » when it does not say | data: the zone's or the decree's `cameras` |
| V2-CarteDrones: separate prisms | the part of each zone inside the commune; one covering 80 % of it or more a hatched band on the ground | data: real zones nest (one covers all of Lyon); Ju's review B1 |
| V2-CarteDrones: yellow on the volume chosen and its week | ink (a thin outline hovered; chosen full, a thick outline, the others aside) | Ju's review A1: yellow is the territories' |
| V2-CarteDrones: « zones non déduites · 21 » | « créneaux aux horaires non précisés » (13 at Lyon), « zones non déduites » only when there are some | Ju's review B2: the board's 21 counted unread hours |
| V2-CarteDrones: the panel « en bref » | what to hover or choose; filled on a choice only | Ju's review B3; a hover that filled it moved the row under the pointer |
| Drones-Paris-B-calendrier: the calendar always open, the legend open | both folded by default on a wide screen, a band « Jours de vol autorisés · … » (« Replier le calendrier » when open) | DECISIONS 2026-10-31 (the legend and the chart folded, the map left free) |
| Drones-Paris-B-calendrier: the shades rgba(17,17,17,…), the chosen day #fe48b0 | the theme's ink at the same opacities, the frame's pink (--type-registre, #ff48b0) | dark mode (the board has none); the token of the same pink |
| Drones-Paris-B-calendrier: the blue #2c6f9e | the token --drone-trait (#2c6f9e in light, the drone colour in dark) | the theme's tokens only (tests/theme.test.ts); the board has no dark mode |
| Drones-Paris-B-calendrier: « zones sur plan annexé, non lues » | « zones non lues » | data: 90 of Paris's 645 acts are not on an annexed plan (`zone: non_lue`); the brief's wording |
| Drones-Paris-B-calendrier: the list's title « … · 8 h de vol » | « · N h de vol » only when slots give hours | data: an act's hours are not published yet (`horaires_etat: non_publies`) |
| Drones-Paris-B-calendrier: the map at the 14e's scale on the chosen day | the commune framed (its box), the 14e reached by « Voir sur la carte » | the view frames its commune once and moves the camera only when asked (v2.4) |
| Drones-Paris-B-calendrier: « secteur cité · 14e » in Archivo on the map | the map's own font (Noto Sans Medium), white on the blue, set by the map with its collisions; only for a chosen day or act | the map's glyphs are not the page's fonts; on the whole period every sector at once would cover the map with labels |
| Drones-Paris-B-calendrier: the edge's label at a fixed place | on the edge's leftmost point in the free part of the map, along it, kept there while it stays free | the map moves and the page has any size |
| Drones-Paris-panneau: the « nouveau » marks | not drawn | the board's annotation of the fields new to it, not the interface's |
| Drones-Paris-panneau: « Document officiel ↗ » | « Voir l'arrêté (recueil de la préfecture) » | DECISIONS 2026-10-28 |
| Drones-Paris-panneau: the row « DSPAP · … » | the service's whole name, as published | data: no short form is published |
| Drones-Paris-panneau: « zone : 3 plans annexés, non lus » in a row | « zone non lue (plan annexé) » | brief R4.2 § 1 (the words of the zone's state) |
| Drones-Paris-panneau: the title's hours | the hours when published; else the date alone and a row « Horaires : horaires non publiés (justesse en cours de mesure) » | data (`horaires_etat`) |
| V2-* « ← Carte » | « ← Retour » when the register has a step before | Ju's review A4 |
| V2-*: the breadcrumb's steps 19 px high | 40 px rows, their ground on hover | Ju's review A2 (the row is the target); on the black bar a lighter ink (#2e2b33), the soft ground unreadable under light words |
| A sorted number column's arrow after its words | before them (« ↓ MONTANT ») | Ju's review A6: the words end where the values end |
| V2-CarteDrones: the map's pieces at fixed x | anchored to the panel's left edge | the page has any width |
| V2-CarteDrones: the legend « champs des caméras » | what the map shows at that zoom | the fields show from z15 only |
| Commune-grand: the tilted commune map | a link to Drones et algorithmes, unframed | DECISIONS 2026-10-30; Ju's review A5 (no link to the site's map) |
| Commune-grand: the frieze of contracts and calls in lanes | the amounts signed per year (bars), the contracts and the calls as lists | brief § 8 (one measure, an axis from zero, no lanes) |
| Acheteur-grand: the frieze of contracts | the amounts signed per year | brief § 8 |
| Departement-grand: the communes' bar on a square-root scale | a linear one | brief § 8 (no hidden scale) |
| Registre-chiffres: its three charts | the counts of the lists' filters (year, dispositif) and a « Drones » column | brief § 5 (the lists replace the figures) |
| Entreprise-grand: « Ce qui ressort » | removed | Ju's review B5: a juxtaposition that suggests without saying is an insinuation (facts with their source only) |
| Entreprise-grand: the stacked strip of départements | « Ses clientes sont dans » with each département a link | brief § 8 and § 3 |
| A territory's charts in its yellow | the measure in ink, the selection full of ink | DECISIONS 2026-10-30; Ju's review A1 (yellow is the territories') |
| Documents-grand: the filters in a left column | above the table | beside the panel a 220 px column left about 600 px to the table |

### The register (lot R3)

| Mockup | Code | Reason |
|---|---|---|
| V2-Partage: each card shows another crop of the dark map | one crop (the commune card's) for every image, cut once from the mockup (`apercu/fond.png`) | « Un seul gabarit pour tous les types » (the lot's brief): the image differs by what it says, not by its background; one layer drawn once keeps an image's drawing at 35 ms |
| V2-Partage: the text rendered by the browser | the name, line and figures drawn by FreeType (Pillow) with the site's own fonts and the mockup's sizes, axes and colours; one palette of 256 colours | no browser in the build (the VPS has none); the palette keeps an image near 80 kB (DECISIONS 2026-10-30) |
| V2-Entreprise: « Sources » names SIRENE without a link | « Fiche officielle », a link to the company's record in the Annuaire des entreprises (annuaire-entreprises.data.gouv.fr), nothing loaded from it; never for a sole trader | Ju's instruction (lot R3): a legal person's official record one link away |
| V2-Sommaire: « Île-de-France, Rhône, Bouches-du-Rhône · mis à jour le … » | « mis à jour le … · Ce que couvre le registre → »; what each family of documents covers, in one sentence from couverture.json `resume`, opens the page « Ce que couvre le registre » | Ju's instructions (lot R3, then v2.3 point 10): the national data made the sentence long |

### The register v2.3 (2026-10-31)

| Mockup | Code | Reason |
|---|---|---|
| Every board: the search field, the theme button and ✕ cream (`#f2efe6`, `#111`, a blue shadow) in both modes | on the theme's tokens (`--bg-2`, `--fg`, `--line`, `--reg-shadow-ticket`): dark in the dark mode; in the light mode white with an ink shadow, which the black top bar hides | Ju's instruction (v2.3, point 3): in the dark mode the cream controls stood out of the page |
| Every board's breadcrumb: Registre › the type's plural › the fiche (« Registre › Entreprises › Serfim T.I.C. »); Drones et algorithmes under the département | the list's rail name (« Titulaires », a buyer's category, « Transports »), its link reopening the list on the fiche's row; what is under a commune under the commune (« Registre › Communes › Saint-Priest › Drones et algorithmes »); a document opened from a fiche under that fiche | Ju's instruction (v2.3, point 4): one name per type, one rule for the breadcrumb |
| V2-Entreprise, V2-CarteDrones: the band's tabs, the commune's sections then « Carte et drones » | the sections only; « Drones et algorithmes » (and « Fiche » on the pages under a commune) a door beside them, the band's tab with a pictogram; the same door on a département with drone decrees; a summary row under Documents | Ju's instruction (v2.3, point 4): sections and views no longer mix |
| V2-CarteDrones: the legend and the chart open over the map, the legend in four lines | a ticket « Légende » beside the commands and a thin band for the chart, both folded by default on a wide screen; the legend two lines | Ju's review (v2.3): at a laptop's size they hid the map, a strip left in the middle and no 3D |
| Every fiche: its name in cut-out letters | a document's name is its objet in two lines at most, in the cut-out letters' face but not cut out; its tickets without a dash | v2.2 point 5: « Appel d'offres de mars 2017 » named nothing; an objet of 100 characters does not read in cut-out letters |
| The map's ticket (mockup 17a): « Filtres et légende → » and « Le registre → », two wavy-underlined links between the title and the squares | two full-width tickets under the squares: « Filtres et légende » on paper, « Le registre » in pink with its pictogram, 44 px high at least | Ju's instruction (v2.2 point 1, v2.3 point 7): the links were ugly and badly placed |
| V2-CarteDrones: the chosen zone full with a thick ink outline, the others set back in a lighter blue, every chosen label shown | the chosen zone's volume with the frame's pink outline, the others flat at 15 %; one short label per place, lifted above its volume | Ju's mockup drones-zone-choisie and review (v2.3): the labels of a slot's zones covered each other |

### The register v2.4 (2026-10-31)

| Mockup | Code | Reason |
|---|---|---|
| Every board: the theme button and ✕ with a blue shadow | in the light mode white with the theme's blue shadow (`--type-document`) on the black top bar; the v2.3 row's ink shadow is gone | Ju's answer to v2.3's question 1 (v2.4 point 5) |
| V2-CarteDrones: the map tilted at the mockup's angle on every screen | 50° on a wide screen, 35° on a phone | Ju's capture telephone-inclinaison (v2.4 point 3): at 50° the narrow map showed the volumes more than the streets |
| V2-CarteDrones: a still map | a slow turn at the opening (one turn in 90 s), stopped for good by a hand, none under reduced motion | Ju's instruction (v2.4 point 3) |
| V2-CarteDrones: the volumes' heights as drawn (the highest about half the commune) | the tallest at 12 % of the commune's height on the screen, under the site's names | Ju's capture telephone-inclinaison (v2.4 point 3): stacked volumes hid the names |

### The register v3, lot 1 (2026-11-08)

| Mockup | Code | Reason |
|---|---|---|
| Every board: the page alone, the black top bar full width | inside the frame over the map (56 px margins), the frame's own top bar | DECISIONS 2026-10-30 (the register over the map), kept 2026-11-08 |
| Every board: theme A's colours (bg #efebe2, paper #fffdf8, pink #ff4fa3, blue #7cc0ea, lavender #b9a7f2, green #7fd1a3) | the site's tokens (#f2efe6, #ffffff, #ff48b0, #7fd4ff, #c9b8ff, #9be7c4) | Ju 2026-11-07: the site's tokens, shared with the map; the buttons' black shadow kept as the board's, to judge on the captures |
| Every dark board: the top bar cream, the map's pinks as in light, the ground #121110 | the frame's bar black, the map's dark ramp (`--map-area-*`), the ground #1c1a1f | the tokens' dark mode (same decision) |
| Accueil: six entries in three columns (Signaux, Missions de relevé) | four entries in one row of four | Ju 2026-11-07: Signaux and Missions in later sessions |
| Accueil: « Le graphe » a link | its entry dashed, « Bientôt », no link | the graph is lot 4; no link to a page that does not exist |
| Accueil: « Publiés avant le vol ? » 63 / 25 / 12 % | « non lu » | not served (besoins-donnees: the drone decrees' publication date) |
| Accueil, lists: « Suivre (RSS) » | absent (lists: « Copier le lien de cette liste ») | the register has no feed |
| Accueil: « 66 368 caméras… dans les communes du registre » | 76 987, « sur la carte, toute la France » | Ju 2026-11-08: the build's total, every commune of France |
| Accueil: the map's classes for « Argent » only; five names chosen | the board's five classes for « Argent », classes of the same spirit for Caméras, Arrêtés, Drones; the five largest of the measure named | the board draws one measure |
| Accueil: the map's outlines (an undocumented drawing) | IGN Admin Express COG Carto, its attribution under the legend | Ju 2026-11-07: a source of known licence, served by the build |
| Accueil: the latest documents' and the largest contracts' lines written by hand (« CCAS de Nice », « autorisation de drones, préfecture de Paris ») | the build's names and objects (« Centre Communal d'Action Sociale », the published object clamped to two lines) | data: no short name or object served |
| Accueil: « Essayer » chips | a chip opens its fiche when the build holds it, else searches its words | every mention that has its fiche is a link (the owner's rule); the fixture has no Paris |
| Lists: a checkbox per row and the « Comparer » bar | absent | « Comparer » is lot 4 |
| Liste-Entreprises: a « Graphe » link per row; « Client : commune, transports, État ▾ » | absent | the graph is lot 4; the clients' categories are not served |
| Liste-Communes: the département and the intercommunality under the name as words | links to their fiches, in the line's colour | every mention that has its fiche is a link (the owner's rule) |
| Lists: twelve rows, then « Voir les 414 » | twenty rows, then by a hundred, « Voir les N » at the end | thousands of rows at once do not draw on a phone |
| Liste-Communes: no « Avec arrêtés drones » | absent from the communes, kept on the départements | the board's controls; the « Drones » order covers it |
| Lists not drawn by a board (intercommunalités, départements, acheteurs, documents) | the boards' skeleton, their own columns, their names typed links with their pictogram | no board yet; kept v2's columns |
| Liste-Communes-A-tel: the table's heads gone | the heads kept for screen readers, out of sight | accessibility (a table read with its heads) |

### The register v3, lot 2 (2026-11-08): a commune's fiche

| Mockup | Code | Reason |
|---|---|---|
| Lyon-A: « Suivre (RSS) », « Exporter », « Comparer avec… » | « Partager » and « Citer » | no feed; the export is the documents page's; « Comparer » is lot 4 |
| Lyon-A: the Vue 3D block's tilted drawing of the arrondissements | no picture | the board's drawing is an example; the commune's map file is 3 MB, no light outline is served |
| Lyon-A: « Les missions » in the Vue 3D block, the « Missions de relevé » card | absent | missions later (Ju 2026-11-07) |
| Lyon-A: « À vérifier sur ce territoire » | absent | signals later (Ju 2026-11-07) |
| Lyon-A: the largest systems beside the missions | full width | the missions' card is gone |
| Lyon-A: figures from the extracts (2 114 cameras, 52 days) | the build's (2 113, 65 days `jv`) | one source per figure (Ju 2026-11-07) |
| Lyon-A: three series « Ville / Transports / Métropole, État, Département » | the city, the transports, the other buyers by their served category | the board's third figure differs from the build (A's reading) |
| Lyon-A: the suppliers' roles (« installe et entretient ») | absent | not served |
| Lyon-A: a dossier's « lien à vérifier » decree and « Sur la carte » step | absent | not served (besoins-donnees) |
| Lyon-A: the intercommunality's map | its communes ranked, around the commune | the communes' outlines are not served (besoins-donnees) |
| Lyon-A: « Année ▾ », « Entreprise ▾ », « Montant ▾ », « Exporter CSV » over the documents | the same (the amount in three bands: under 100 000 €, to 1 M€, over), Entreprise and Montant on the contracts, the notices and the grants only, a shape's filter as a chip « … ✕ »; ten rows, « Tous les documents » after them when there are more | a decree has no company nor amount; the full list stays one page away |
| Lyon-A: a dossier's title in capitals (« Vidéoprotection 2021-2025 ») | the published object in ordinary case, on one line | the real objects are long sentences in capitals (Ju 2026-11-08: like the home's largest contracts) |
| Lyon-A: « 3e sur 3 » style ranks everywhere | no rank under five communes ranked | a rank among three says nothing (Ju 2026-11-08) |
| Lyon-A: five motives (manifestation, événement, frontière, circulation, autre) | the served ones: manifestation, événement (sport, concerts, commemorations), stupéfiants on its own row, the rest « Motif non lu » | frontière and circulation are L. 242-5 purposes not read yet; stupéfiants is served and in no board class (A, 20cf0e6) |
| Lyon-A-comportements: a step's bubble quoting its document, « lien suggéré »'s reason | none | no quote nor suggested link is served |
