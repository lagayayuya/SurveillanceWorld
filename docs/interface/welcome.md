# Welcome, loading and the launch

The welcome panel, the points at send, loading, legal pages, the launch lot.

## In force

### 1.9 The welcome and the points at send (lot of 2026-10-11)

- **Welcome panel** (board 28a of « Accueil Surveillance World »; the author's request of
  2026-10-11, point 9; `welcome.ts`, `cannon.ts`, `theme/punk/welcome.css`,
  `cannon.css`): punk only, on a first visit, a ticket over the map, 28a's dark one in dark
  and the same on the paper in light (the `--welcome-*` tokens, 2026-10-15) (« SURVEILLANCE »
  and WORLD's cut-out letters, « The most magical place on Earth » (2026-10-15), the pitch
  « Tu aimes être surveillé en permanence ? … rejoins l'aventure <3 »,
  « Découvrir », « Participer », « Garanties » as labels (« Questions fréquentes » not shown
  since 2026-10-14, its texts kept in `welcome.ts`), « Voir la carte → » at its foot, always
  in view: on a phone the rest scrolls above it; right of it, on its line, « imaginé par
  lagayayuya » in the muted typewriter and under it the contact address as a `mailto:` link
  (the deploy's `VITE_CONTACT_EMAIL`, never in the repository; a build without one shows the
  credit alone), underlined, 24 px high at least; where the line does not hold (a phone)
  both go under the button, from its left (2026-10-17; above the legal links since
  2026-10-15). Its content is there from the first frame (no entrance animation); two party poppers
  behind its top corners pop and throw confetti for about 2 s (a decoration that blocks
  nothing, none but the still cones under reduced motion). A dialog: named « Bienvenue sur
  Surveillance World », the focus inside, the page behind inert; closed by ×, Escape, a tap
  outside it or « Voir la carte », the focus then on the ticket's « ? », still as its
  neighbours (28a's pulse removed, 2026-10-14). The « ? » is the third of 25a's squares
  under the ticket's link (after the mode's and the account's): it opens the panel again,
  without poppers. The visit is kept on the device under `lacarte.welcome` (« 1 », nothing
  else; storage refused, the panel shows at each visit); not shown over a return from
  OpenStreetMap (`?osm=`) or the account's own address (`?compte=`). The texts are 28a's,
  each sentence checked against the product (§3, « Welcome (28a) »). Checked by
  `bench/smoke-welcome.mjs` (WebKit and Chromium; the benches' pages are returning visits,
  `bench/ui.mjs` returning).
- **Points at send** (board 8a « Envoyer et marquer des points »; the author's request of
  2026-10-11, point 11; `participate/score.ts`, its hooks in `modify.ts` and
  `participate/index.ts` done, `theme/punk/score.css`): punk only, at « Envoyer N
  modifications », the add's « Envoyer », « Toujours là ? »'s answers (« Elle est là »,
  « Je ne la trouve pas », the gone camera's two). The sheet slides down out of the way
  (400 ms; the camera sheet of « Toujours là ? » closes); « Modifier » turns the field the
  send gives on the map from the camera's direction to the one sent (700 ms on 8a's spring,
  its yellow bearing tag beside it; none when the direction is unchanged or was unknown) and
  frames the camera above the tickets; the floating buttons step aside meanwhile (as they
  do for an open sheet). A ticket per piece sent falls (on a wide screen in the column of
  the sheet that slid away; a stack higher than the screen gathers its added infos on one
  ticket, « Fiche · 5 infos ajoutées »; lot of 2026-10-12; on a phone the column, its
  stack and its total centred, a margin on each side, every ticket on the screen with its
  tilt: 2026-10-13, « 8a on a phone… », `score.css`) and lands on the one
  before (« Direction », « Correction · 180° → 299° nord-ouest »; « Hauteur », « Info
  ajoutée · ~4 m »; …), its points on its stub, raised above the part the next ticket
  covers (8a's 14 px overlap and up to 30 px more at its left with the tilts: 22 px of
  padding under the number, on every screen; 2026-10-13), its paper in its category's colour
  (the leaderboard's: tokens.css --k-*, from its first frame, told by the phone,
  `profile/award.ts`, the server's answer having the last word; lot of 2026-10-12), then the total « +N pts » and « en attente de revue », the
  cannon (`cannon.ts`; beside the total, clear of « PTS »; on a phone, where the total is
  centred, drawn at 0.65, its mouth up to 10 px from the screen's edge, its body partly
  beyond it with a four-digit total at 375 px; `score.ts` placeCannon) swings in, shakes, has its string pulled and bursts, « Voir le
  classement → » (the account's leaderboard) comes last: 8a's times from the sheet gone.
  The numbers are only those of `GET /api/me/points` (the leaderboard's own function, asked
  once the pieces have left the phone); the category it gives replaces the phone's where
  they differ, the ticket's colour and the first word of its line, the leaderboard legend's
  (`profile/categories.ts`: board.count.one.*, « Bonus caméra complète »); the total's unit
  and « en attente de revue » are the leaderboard's (board.pending.*); an add's bonus is a
  ticket of its own (« Tout y est »). A piece that earns nothing has no ticket (the launch
  lot, the author's request of 2026-10-13, point 1: « Je ne vois pas » kept for the
  statistics, a piece the server's answer gives nothing, sent again within its month); a
  send that earns nothing at all has no tickets, total, cannon nor « Voir le classement »,
  only « Envoyé · en attente de revue » (`score.sent`) in the scene's status line
  (`score.ts` hush); a « Toujours là ? » that earns nothing (from afar, « Je ne sais pas »)
  has no scene at all: the sheet stays and says « Envoyé · en attente de revue » in its
  role=status line (`participate/index.ts` done; offline the queued wording). Offline,
  the route failing, or no answer within 2 s of the request (`POINTS_TIMEOUT_MS`; the pieces' own sending, before it, is not bounded), no number at all
  (offline: the queued wording in the badge's place, no
  total, no « Voir le classement »); a send the server refuses loses its points with its
  status (`modify-refused`). Nothing blocks: the scene lets every touch through, and a touch
  on the map, a move of the map or Escape puts it away (the editor closes, its field and
  tag with it). Under reduced motion all of it at once, straight, no cannon. The field
  turned shows the send's direction before any review, only while the tickets are shown,
  under « en attente de revue » (the author's request; its DECISIONS line is proposed with
  this lot). The paper ball of 8a's earlier export was never built. Checked by
  `bench/smoke-score.mjs` (the states' servers; `bench/score-kit.mjs` answers the points
  route until the API serves it; at 375 and 390 px, WebKit and Chromium, every ticket and
  the total within 16 px of both edges and centred, no stub's number under the next
  ticket, the cannon clear of « PTS » and half on the screen); `bench/shots-fete.mjs`
  makes the stop point's captures (`--only centred`: the phone's). The screen turned or the
  window resized while the tickets are shown (lot V, the author's « étiquettes décentrées
  après l'ajout d'une caméra… parfois un bouton sort de l'écran »): on a wide screen the
  column stays where the sheet stood, anchored to the right edge as the sheets are
  (`score.ts` columnOf: it was a left offset measured once, the sheet hidden since, and the
  tickets and « Voir le classement » went off the screen once it turned); narrowed to a
  phone's layout it is centred; a stack now higher than the screen gathers its added infos
  then, and the cannon is placed again. Checked by `bench/smoke-formats-add.mjs` (« ＋
  Ajouter » chained on the formats of `bench/smoke-formats.mjs`, the scene watched, cut
  short by Escape or a touch, the operator's search typed, the direction aimed, the screen
  turned; the column, every landed ticket and every button on the visible screen, the page
  neither scrolled nor zoomed, nothing left once put away, the floating controls apart).
  Open: on a phone held sideways 375 px high or less, an add's stack does not fit even
  gathered (its first ticket 5 to 60 px above the screen; said, not failed, by that bench).

### 1.10 The launch lot (2026-10-13)

The lot's contract (the author's request of 2026-10-13; its `DECISIONS.md` lines come with
the lot's merge).

- **What the site says of itself** (`config.ts` loadConfig, parseConfig): `GET
  /api/config`, asked once as the page starts, beside the session, answered before the
  account square, the welcome and the participation are built: `contributions` open or
  not, `publish` offered or not, `publisher` (the publisher's identity, shown when set).
  Offline, a failure, a malformed answer or more than 2.5 s: contributions open, no
  publishing, no publisher (the API's own 403 stays the guard). A change of the server's
  setting is followed at the next page load, without a rebuild. `?debug=1` shows what the
  page read (« site »).
- **Contributions closed** (`contributions: false`; point 4; `main.ts`, `welcome.ts`
  Welcome): absent, not greyed: the account square, « Compte », the OSM sign-in, the
  account's screen and its leaderboard, « ＋ Ajouter », « Modifier », « Toujours là ? »,
  « Vos contributions », the proposals (the others' pending ones too: they are
  contributions under review) and their tape, the send counter, 8a; `?osm=`, `?osm_why=`
  and `?compte=` are removed from the address unread (no sheet opens, no welcome over
  them). The welcome loses « Participer » and the two questions that speak of accounts
  (« Comment agrandir la collection ? », « Et mes données à moi ? »): four questions (none
  shown since 2026-10-14); and
  the pitch's « et rejoins l'aventure » (`welcome.pitch.closed`) and the promise
  « Contributions vérifiées » (2026-10-13; its title, which invites no one since 2026-10-15,
  stays). What
  stays: the map, the filters, the ticket's sun / moon and « ? » squares, every sheet,
  the camera sheet as a visitor's with « Corriger sur OpenStreetMap ↗ », the welcome, the
  legal pages without their account parts, the contact address (in the legal pages).
  /revue is untouched (its own sign-in). Open, everything is as before the lot.
- **Publishing offered or hidden** (point 5; since 2026-10-16 `profile/sync.ts`
  syncSection, the OSM synchronisation, 1.7): not offered (GET /api/config `sync: false`, or
  GET /api/osm/sync `offered: false`), the account's screen has no « Publier sur
  OpenStreetMap » section at all; its code stays. The public site does not offer it at the
  launch: it signs in on OSM's live server and writes to the test server
  (`OSM_WRITE_SERVER=dev`) until /revue switches writing to the live server (2026-10-14,
  superseding 2026-10-13's opening; `smoke-launch` checks that neither Compte nor the privacy
  page and the terms speak of it then).
- **Legal pages** (point 6; `legal/index.ts` openLegal, `legal/pages.ts`,
  `theme/punk/legal.css`): « Mentions légales », « Confidentialité et traceurs »,
  « Conditions d'utilisation et de contribution », « Sources et licences », each at its
  own address (`/?page=mentions-legales`, `confidentialite`, `conditions`, `sources`),
  indexable text, no board: the welcome panel's ticket as ported, dark or light with the
  mode (its backdrop, torn
  paper, ×, foot and « Voir la carte → »), the welcome's labels for the section headings,
  its typewriter for the text. A dialog named by its title, over the map or over what
  opened it (the welcome panel, a sheet), everything behind inert; the four pages linked
  under the title (« Pages légales », the current one `aria-current`), one replacing the
  other; closed by ×, Escape, a tap outside or « Voir la carte », the focus back on the
  link that opened it (else the « ? »); the page's title in the tab while open, `?page=`
  in the address while open and removed on close. An address with `?page=` opens it at
  start, in place of a first visit's welcome. The texts are `fr.json`'s (`legal.*`), as
  data in `pages.ts`: the parts that speak of accounts only while contributions are open
  (closed, the privacy page says the device keeps display settings only); the sections
  that name the publisher only when `/api/config` gives `publisher` (a text node, nothing
  in its place otherwise); the parts on publishing to OSM only while it is offered and
  contributions are open (`pages.ts` holds); the contact address only from
  `VITE_CONTACT_EMAIL` (a `mailto:` link). Since the return on Temps 1 (2026-10-13):
  « Confidentialité » gives its legal bases, the terms accepted at sign-up for the
  accounts and contributions (RGPD 6.1 b, while contributions are open) and a legitimate
  interest, informing the public about video surveillance, for the cameras and the
  OpenStreetMap data, with the right to object through the contact (6.1 f, always); says
  that sign-in and, when one publishes, the publications go through OpenStreetMap (OSM
  Foundation, United Kingdom, an adequacy the European Commission recognises) and that
  nothing else leaves the European Union; that « Télécharger mes données » only signals
  the technical secrets (hashes, tokens); and « la position, les réponses et le mois »
  (the map's dating). « Conditions » has « Publier sur OpenStreetMap » (publishing one's
  on-site surveys under one's own OSM account, each change reviewed, nothing in
  Surveillance World's name; public for good in OSM's history) while publishing is
  offered. « Sources et licences » names the basemap's sources and licences, read from
  Protomaps' own files: « construit avec Protomaps » from OpenStreetMap and Natural Earth
  (public domain), ESA WorldCover's land cover at small scales with its CC BY 4.0
  attribution verbatim, the style's CC0, its icons' MIT (Tangram Icons), Noto Sans's OFL,
  and MapLibre GL JS, PMTiles and Protomaps' styles under BSD-3 (`legal.test.ts`). cnil.fr and
  openstreetmap.org/copyright in a new window, said. Linked from: the welcome panel, after
  its labels, above « Voir la carte »; the foot of « Compte » (28a and 25a's stamp);
  the foot of the account's screen, after « Supprimer mon compte »; the pseudonym screen
  (below). A plain click or tap opens the page in place; a new tab or window follows the
  address. Checked by `bench/smoke-launch.mjs`; captures by `bench/shots-legal.mjs`.
- **Accepting the conditions** (point 6; `account/index.ts` signupForm): the pseudonym
  screen says « En validant, vous acceptez les conditions d'utilisation et de
  contribution. » between the field's rule and « Valider → », which it describes; its link
  opens « Conditions » over the sheet, the pseudonym typed kept. The link stays inline in
  its sentence on a phone (WCAG 2.5.8's exception for a link in a sentence).
- **« Télécharger mes données »** (point 6; `profile/leaderboard.ts` exportLink,
  `profile/api.ts` exportData): on the account's screen between « Changer le mot de passe »
  (or the OSM links) and « Se déconnecter », a link as the others: `GET /api/me/export`
  fetched as bytes, then saved by the browser as `surveillance-world-mes-donnees.json` (the
  API's name); the link off while it is fetched. A session gone (401): « Votre session a
  pris fin : reconnectez-vous pour télécharger vos données. »; anything else:
  « Téléchargement impossible pour l'instant (hors ligne ?) : réessayez plus tard. »; both
  under the link (role status), nothing saved. Checked by `bench/smoke-profile.mjs`;
  « Supprimer mon compte » end to end on the real API for both kinds of account by
  `bench/smoke-delete.mjs`; the button against the real API, both kinds of account, by
  `bench/smoke-export.mjs`.

### 1.11 The return on the launch's Temps 1 (2026-10-13)

The author's return on the launch lot; its `DECISIONS.md` lines are dated 2026-10-13. Each
point is written where it applies:

- the small dome's tilt in the punk editor (1.6, 1.8;
  `modify-dome-tilt`);
- the possible field while placing, the aimed field after (1.6; `modify-possible-field`);
- 8a centred on a phone, its cannon smaller, each stub's number above the next ticket
  (1.9; `score-phone-centred`);
- the filmed streets wider past z17, where they lie on a field of their own level (1.3; `map-street-wide`);
- the basemap's roads above the fields from z15, its paths from z16 (1.3, 2026-10-15; `map-roads-lifted`);
- the basemap's water over the fields from z15, see through, with a shore line (1.3, 2026-10-15; `map-water-over`);
- a pending proposal dated by its month (1.6; the `prop-*` and
  `add-pending-*` rows);
- the legal pages' legal bases, transfer, export sentence, « Publier sur OpenStreetMap »
  and Sources' licences (1.10; `legal-privacy`, `legal-terms`, `legal-publish`,
  `legal-sources`);
- the closed welcome without « et rejoins l'aventure » (1.10; `closed-welcome`);
- publishing in one's own name offered on the public site once /revue switches writing to
  OSM's live server (1.7, 1.10; `board-sync-not-offered`).

## Deviations from the mockup (« Écarts à la maquette »)

### Welcome (28a)

Board: 28a of `Accueil Surveillance World.dc.html` (the « fan-club », not 28b), its phone
frame 390 × 820 and wide frame 1180 × 740, the poppers « derrière la fiche » (its default).
The texts are 28a's but where they said what the product does not do (the author's request
of 2026-10-11: each sentence checked against the code and DECISIONS).

| Mockup | Code | Reason |
|---|---|---|
| « REJOINS UNE COMMUNAUTÉ DE PASSIONÉ.E.S!!! » | « … DE PASSIONNÉ.E.S !!! » | the spelling (the author's request); the space before « !!! » as every French string of the catalogue |
| « Tu es au bon endroit! Avec Surveillance World, ⏎ redécouvres ton quartier sous un nouveau jour et participes à l'aventure <3 » | « Tu aimes être surveillé en permanence ? Tu es au bon endroit ! Avec Surveillance World, redécouvre ton quartier sous un nouveau jour et rejoins l'aventure <3 », one paragraph | the owner's text of 2026-10-15; the forced line break fell mid-sentence on a phone |
| « Rejoins une communauté de passionné.e.s !!! » | « The most magical place on Earth », with contributions open or closed | the owner's text of 2026-10-15 (it invites no one, so it stays when contributions are closed) |
| The dark ticket in both modes | dark: 28a's inks; light: the same ticket on the paper (`--bg`), its text, rules and outlines in the ink, the light blue, pink and yellow labels as `--blue`, `--accent`, `--warn`, the first cut-out letter, the × and « Rues filmées » on the ink, « Voir la carte »'s shadow the ink | the owner's request of 2026-10-15 (a light version « avec les jetons du thème »); 28a's light blue, pink and yellow are 1.4 to 2.7:1 on paper (WCAG 1.4.3) |
| No credit | « imaginé par lagayayuya » in the muted typewriter (13 px) above the legal pages' links | the owner's request of 2026-10-15 |
| « Compléter » under « Participer » | « Corriger et compléter » | the punk sheet's one button « Modifier » corrects and completes; « Compléter » is no button any more (DECISIONS 2026-10-08, « « Modifier » replaces « Compléter », « Déplacer » and « Corriger »… ») |
| « ✓ Uniquement en France, pour l'instant » | « ✓ En France métropolitaine, pour l'instant » | the map's region is metropolitan France, Corsica included (README, the build's region `france`): overseas comes later; the author's request (2026-10-22) |
| « ✓ Rien n'est stocké, à part votre identifiant OpenStreetMap » | none | false: the pseudonym, the contributions, and the encrypted token of who publishes to OSM are stored (the author's request: no replacement sentence) |
| « C'est une vraie carte ? — Oui. Chaque caméra vient d'OpenStreetMap… Nous calculons ce qu'elle filme… » | « Oui. Les caméras viennent d'OpenStreetMap, où des contributeurs les recensent depuis des années, et des ajouts relus ici. Pour chacune, nous calculons ce qu'elle peut filmer… » | an add accepted in the review is drawn without being in OSM (DECISIONS 2026-10-01, the « Ajouter » phase); the map says what a camera can film, by hypothesis (« Peut identifier jusqu'à… »), not what it films |
| « Les trois niveaux de la norme IEC 62676-4 : … » | « Trois niveaux de la norme IEC 62676-4 : … » | the standard has four (DORI); the map draws three of them (DECISIONS 2026-09-27, « Observation levels follow IEC 62676-4 DORI… four stored, three drawn ») |
| « Standard ou Prudent ? — Deux façons de compter. Standard ne garde que les caméras dont on connaît la direction ; Prudent les garde toutes. La part de rues filmées est donnée entre les deux. » | « Deux hypothèses sur la caméra. Standard : ce qu'une caméra ordinaire de ce type peut faire. Prudent : ce qu'une caméra récente et performante (4K, zoom) peut faire. La part des rues à portée, dans les fiches des communes, est comptée en prudent, toutes caméras comprises : c'est un maximum. » | Standard and Prudent are the map's two camera hypotheses (`estimate.*.sub`); the punk commune and département sheets show Y alone, a maximum (DECISIONS 2026-10-06, « Punk commune and département sheets show only Y… »; `areapunk.ts`), never a range |
| « Toutes les caméras y sont ? — Non : seulement celles qui sont recensées dans OpenStreetMap. … » | « … seulement celles qui sont recensées dans OpenStreetMap ou ajoutées ici. … » | accepted adds are on the map (as above) |
| « Avec un compte, ouvert par OpenStreetMap : vérifier qu'une caméra est toujours là, corriger sa position, compléter sa fiche, en ajouter une. Les contributions sont relues avant d'entrer sur la carte. » | « Avec un compte, ouvert avec OpenStreetMap : vérifier qu'une caméra est toujours là, corriger sa position ou sa fiche, en ajouter une. Les contributions sont relues avant de changer la carte. » | accounts are opened through OpenStreetMap only (password accounts exist, not offered); a pending contribution is already drawn as a proposal, it changes the map's own drawing once accepted and built |
| « Et mes données à moi ? — … Si vous entrez avec OpenStreetMap, nous ne gardons que votre identifiant OSM ; rien n'est publié sur OSM. » | « … Si vous entrez avec OpenStreetMap, rien n'est publié sur OSM sans votre choix. » | the first half is false (as the guarantee above); publishing exists, by the person's choice (DECISIONS 2026-10-10, « Publishing to OSM (b): the person reviews and publishes herself… ») — the author's request |
| WORLD's « L » in Bricolage Grotesque 700, its « O » Archivo at 125 % width | Archivo 800 at 100 % for both | no other face downloaded (CLAUDE.md, no third-party service; DECISIONS 2026-10-05, « Punk fonts, self-hosted latin subsets… »): the self-hosted Archivo spans 62 – 100 % |
| The title on one line, beside the × (28a's phone frame lets WORLD slide under the ×) | on one line where it holds left of the × (a wide screen); on a phone WORLD goes on a second line under « SURVEILLANCE », never under the × | WCAG 2.5.8 (the × fully tappable) and 1.4.10 (reflow at 320 px): with the self-hosted faces, 28a's title is 17 px too wide for its own phone frame |
| The labels as loose spans under their headings | a list per heading (the heading names it), the same look | WCAG 1.3.1 (a group's items read as a list) |
| « Questions fréquentes » and its six questions, unfolding one at a time | not shown, in light and dark (the texts kept in the code, `FAQ_SHOWN`) | the owner's request of 2026-10-14 |
| Closed, the « ? » pulses (28a's `cpulse`, a pink ring) | the « ? » still, its focus ring only, as the mode's and the account's squares | the owner's request of 2026-10-14 (DECISIONS 2026-10-14, the « ? » square) |

### Loading (2c)

Board: 2c of `Chargement punk.dc.html` (maquette v5, the product owner's file, not in the
repository), « Caméra mignonne · lettres de rançon », its rendered DOM and keyframes taken as
is, two phone frames (390 × 780, light and dark), the `still` branch under reduced motion.

| Mockup | Code | Reason |
|---|---|---|
| Ransom letters in Bricolage Grotesque and in Archivo wider than 100 % (1a's cut-outs) | Archivo at 100 % for those cut-outs; the other faces as drawn (Archivo 62 – 100 %, Special Elite, Georgia) | CLAUDE.md (no third-party runtime service); DECISIONS 2026-10-05 « Punk fonts, self-hosted latin subsets… » (Archivo cut to widths 62 – 100 %, no Bricolage), as the camera sheet's title and 28a's WORLD |
| The faces from the first frame | the punk faces once the device has them (`lacarte.fonts`, theme/fonts.ts); on a first visit the letters in the system's fallbacks (« Arial Narrow », « Courier New ») | the screen shows before any script of the page has run (bench/loading-timeline.mjs: blank until 0.7 – 3.5 s on a slow phone profile); downloading the faces then would slow the map (theme/fonts.ts fetches them once the map is drawn on a first visit: their 94 KB would compete with the first tiles; DECISIONS 2026-10-05 « Punk fonts… ») |
| Two phone frames, 390 × 780; the line « de la carte » only | the first load over the whole screen at every size, the drawing at the board's scale (0.85 under 600 px high, 0.62 under 480 px, so that it stays whole); the same component in the account's sheet on a return from OpenStreetMap, on the sheet's paper (no page of its own), at 0.68 in a wide screen's side sheet, whole in a phone's full sheet, 0.5 under 500 px high, its line « de votre compte » | the author's request of 2026-10-12, point 1 (one component for both uses, only the line under the word changing); the sheet keeps the account's frame on each screen (25a, 28a); WCAG 1.4.10 (nothing cut on a short screen) |

### The launch lot (2026-10-13)

No board draws the legal pages, their links, « Télécharger mes données » nor contributions
closed: each is built from the boards' own vocabulary as ported (1.10).

| Mockup | Code | Reason |
|---|---|---|
| No legal pages (« écran absent de la maquette ») | the welcome panel's dark ticket as ported (28a: its backdrop, torn paper, ×, foot and « Voir la carte → »), its labels as the section headings (pink and yellow in turn), its typewriter for the text on a 64-character measure, the title in Archivo 900 at 62 % in capitals with the light blue shadow; the four pages' links the typewriter's words wavy-underlined in pink, the page shown on 28a's yellow; the same in light and dark, as the welcome | écran absent de la maquette: the launch lot's contract (four pages over the map, « like the welcome », linkable and indexable), built from 28a's own vocabulary (CLAUDE.md: the mockup's vocabulary before a new component); the links 44 px under a finger (CLAUDE.md, what is touched) |
| 28a (« Compte ») and 25a's stamp: nothing under « Me contacter » or the OSM line | the four legal pages' links on one wrapped line at the foot, the sheet's own links (32 px with a mouse, 44 px under a finger) | the launch lot's contract (the pages linked from « Compte »); CLAUDE.md (44 px for what is touched) |
| 26a's foot: « Se déconnecter », « Supprimer mon compte » | « Télécharger mes données » before « Se déconnecter », a link as the foot's others; the four legal pages' links after « Supprimer mon compte », as in « Compte » | the launch lot's contract, point 6 (the person's data as a file from the account's screen, which the privacy page names; the pages linked from it) |
| 28a's welcome: the questions, then « Voir la carte » | the four legal pages' links after the labels (the questions not shown, 2026-10-14), under a dashed rule, as on the pages themselves | the launch lot's contract (the pages linked from the welcome) |
| The pseudonym screen (no board; 25a's form) | « En validant, vous acceptez les conditions d'utilisation et de contribution. » in the form's hint style between the rule and « Valider → », its link inline in the sentence on a phone too (not a 44 px box) | the launch lot's contract (accepting the conditions at sign-up); WCAG 2.5.8's exception for a link in a sentence (a box of its own broke the sentence on a 390 px phone) |
| 25a's three squares; 28a's pitch, « Participer », « Contributions vérifiées » | contributions closed: the sun / moon and « ? » squares only; the welcome's pitch without « et rejoins l'aventure », without « Participer » and « Contributions vérifiées » (2026-10-13: the invitation and the promise too); the camera sheet without « Modifier » nor « Toujours là ? » — absent, nothing greyed in their place | the launch lot's contract (contributions closed: « absent — not greyed ») |
