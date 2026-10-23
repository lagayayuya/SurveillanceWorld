# Accounts, settings and leaderboard

Sessions, the account's screen, settings and about, the leaderboard.

## In force

### 1.7 Accounts (lot « comptes »)

The lot's contract (2026-10-09, the author's decisions; its `DECISIONS.md` lines come with
the lot's merge): a session cookie the page never reads; `GET /api/me` says who is signed
in (`account/session.ts`): signed in (200), a visitor (401), unknown (offline, the API down:
the screens behave as before accounts, a send waits in the queue).

- Punk, board 25a: under the ticket's link two squares, keys as the machine's (released on
  their shadow, pressed in pink): the sun / moon and the account's. Signed out, the account
  square (25a's person) opens « Compte » in the camera sheet's place: the « Inscriptions
  fermées · pour l'instant » stamp, « La carte se lit sans compte. », « Me contacter ·
  demander un compte → » (a `mailto:` to the address the deploy gives the build,
  `VITE_CONTACT_EMAIL`, never in the repository; subject « Demande de compte
  Surveillance World » and 25a's body; none: the mail opens without an address), « Les
  caméras viennent d'OpenStreetMap : contribuez-y directement ↗ » (`account-ask`); since the lot of 2026-10-11 « Compte » holds no
  password form, and with OpenStreetMap's sign-in on it is board 28a (below). « Entrer »
  (identifiant, mot de passe, « Entrer → », « Mot de passe oublié ? Me contacter », the same
  address, subject « Mot de passe oublié »: the site sends no mail; « Contribuer sur
  OpenStreetMap ↗ », « ← Retour » to « Compte ») is reached by an address nothing links to,
  `?compte=motdepasse` (read once, removed from the address; signed in, the account's
  screen), for the accounts with a password (the review account, the test account,
  particular cases; /revue keeps its own sign-in) (`account-form`); refused, « Identifiant
  ou mot de passe faux. » on the yellow band, said (`account-form-error`); « Entrer » held
  down while the server waits (`account-form-waiting`), offline and other failures said
  (`account-form-offline`, `account-form-failed`). Signed in, the square shows the
  pseudonym's first two letters or digits (`account-square-signed`) and opens the account's
  screen, 26a's leaderboard (`profile/leaderboard.ts`; 2026-10-10). On a phone the sheets
  are the camera sheet's bottom sheet (25a's « Compte » half open, 28a's and « Entrer »
  full).
- Sign-in with OpenStreetMap (OSM lot 1, scope `openid` only; its contract of 2026-10-10,
  `account/osm.ts`): when `GET /api/osm/status` says `login: true` (asked once, when the
  page knows it is signed out; any failure says no), « Compte » is board 28a, « Compte :
  une seule entrée, OpenStreetMap » (the lot of 2026-10-11; `account-osm-key`): « Connexion
  et inscription passent par OpenStreetMap » (« OpenStreetMap » on the light blue paper,
  pink in dark), « Pas encore de compte OSM ? Vous le créerez en chemin. », the one key « Se
  connecter avec OpenStreetMap → » (a link to `/api/osm/login?then=<the page: path, query,
  hash>`, computed when it is used; from a camera sheet's greyed button, that camera's
  address, `?cam=<id>`; while sign-in goes through OSM's test server, OSM_LOGIN_SERVER dev,
  its yellow « serveur de test » label, part of its name), « Rien n'est publié sans votre
  accord. » (what describes the key), and under a dashed rule « La carte se lit sans
  compte. » and « Me contacter », a link (the same mailto); otherwise the stamp as before.
  The API sends the person back to `then` with `?osm=<outcome>` (and `?osm_why=<code>` on a
  failure, the server's short reason), read as the page starts, the map loading or not (the
  sheet says « Chargement de votre compte » until the session is known: `loading-account`;
  lot of 2026-10-12), and removed from the address at once
  (`history.replaceState`): `signup` opens « Choisissez votre pseudonyme » (« Votre nom sur
  OSM : … », the API's suggestion in « Pseudonyme », its rule, « Valider → »; full height on
  a phone; `account-osm-signup`), whose « Valider » makes the account and signs in, then
  the account's screen says « Compte créé : bienvenue, <pseudonyme>. »; a pseudonym taken,
  outside the rule (said before sending), offline or refused is said on the yellow band
  (`account-osm-signup-taken`, `-invalid`, `-failed`); the signup gone (10 min) or its OSM
  account linked meanwhile brings « Compte » back with a line (`account-osm-signup-expired`).
  The other outcomes are a line at the top of where the person lands (what did not go
  through on the yellow band, role alert; the rest role status): the
  account's screen when signed in (`board-osm-status`: « Vous êtes entré avec
  OpenStreetMap. », « Votre compte est relié à OpenStreetMap. », or why a link did not
  happen), « Compte » otherwise (`account-osm-status`: refused or failed, 28a's « La
  connexion n'a pas abouti. Réessayez. »). Back signed in to a camera (`?osm=signed&cam=`),
  that camera's sheet opens instead. With `?debug=1` only, a failure's reason is a short
  line under it, « raison : client_refuse », in a monospace face (`?osm_why=`, one of the
  server's codes, anything else dropped; never logged; on the account's screen too, for
  `write_failed`). The account's screen (`GET /api/me`'s `osm` and `password`) starts its foot with
  « Relier à OpenStreetMap » (a link to `/api/osm/link?then=…`, sign-in on;
  `board-osm-link`) or « ✓ Relié à OpenStreetMap » and, for an account with a password,
  « Délier » (`POST /api/osm/unlink`; `board-osm-linked`, `-unlinked`, `-unlink-failed`);
  « Changer le mot de passe » only for an account with a password (`board-osm-only`).
- The OSM synchronisation (the owner's decision of 2026-10-16, « Synchro OSM », replacing OSM lot 2's « À publier »; `profile/sync.ts`,
  `account/syncline.ts`, `account/osm.ts` readSync / startSync / stopSync). Offered when GET
  /api/config says `sync` (whatever contributions are: a person can always stop it) and GET
  /api/osm/sync says `offered` (the write server is the live one /revue switched to, or the
  test server while sign-in goes through it); nothing of it otherwise. Before the foot's links, under a dashed rule, « PUBLIER
  SUR OPENSTREETMAP » (the scale's heading), the states first: « Envois vers OSM suspendus
  par l'équipe : rien ne part pour l'instant, votre choix est gardé. » (`suspended`), « OSM a
  retiré l'autorisation : autorisez à nouveau pour que vos contributions repartent. »
  (`last_error: revoked`, the choice off), « OSM refuse vos envois (votre compte y est
  bloqué)… » with « Autoriser à nouveau » (`blocked`, the choice still on), « OSM limite les
  envois / ne répond pas pour l'instant : nouvel essai plus tard. » (`rate_limited`,
  `osm_down`), on 26a's yellow; « Serveur de test d'OSM : ce qui part n'apparaît pas sur la
  vraie carte. » while `server` is dev (plain). Then two exclusive choices, a real radio group
  on 26a's opt-in box: « Rester sur Surveillance World » (the default) and « Publier aussi sur
  OpenStreetMap en mon nom », « Activé depuis octobre 2026 » under the second while it is on
  (`since`, the consent's month). The text, always shown (one reads it before choosing):
  « Chaque contribution que vous ferez sur place après ce choix sera publiée sur OSM en
  votre nom après relecture : une fois acceptée, elle part à la prochaine mise à jour de la
  carte, sans autre geste de votre part. Rien de ce que vous avez envoyé avant ne part. »,
  « Ce qui part : » (an add and its position, a move; the shape `camera:type`; the direction
  `camera:direction`; « commerce » `operator:type=private` and the chosen operator's name;
  « toujours là » with the day, `check_date`: rules/publish.yaml's mapping), « Ne part
  jamais : une caméra de particulier, la hauteur, l'inclinaison, « introuvable », « je ne
  sais pas ». Une valeur changée à la relecture ne part pas non plus. », « Sous votre nom OSM,
  c'est public et permanent… supprimer votre compte ici ne retire rien d'OSM. ». Choosing
  the second unfolds « Votre mot de passe, pour autoriser » (an account with one; none: the
  key alone, focused) and « Autoriser sur OpenStreetMap → », « Annuler » (the first choice
  back, focused): POST /api/osm/sync {on: true, password, then} and OSM's page (scope
  `openid write_api`); a wrong password, a test account, contributions closed (403) or
  anything else said under it. Back with `?osm=write_on`: « Publication sur OpenStreetMap
  activée : vos contributions faites sur place à partir de maintenant partiront en votre nom
  après relecture. » at the top (`board-osm-status`), the section « Activé depuis… ».
  Choosing « Rester » while on unfolds « Ce qui n'est pas encore parti ne partira pas, même
  si vous revenez à ce choix plus tard. Ce qui est publié reste sur OSM. » and « Rester sur
  Surveillance World → », « Annuler »: POST {on: false} (the token revoked at OSM and
  deleted), the section drawn again from the answer, « Vous restez sur Surveillance World :
  plus rien ne part. Ce qui est publié reste sur OSM. » said; offline said, the choice kept.
  Last, « Vos contributions et OSM (N) », one row per contribution of GET /api/osm/sync's
  history (newest first, months only): the camera (« Dôme · Ville de Courbevoie · Rue de
  Bezons, Courbevoie »: its kind, its operator, its street and commune; « Ajout » for an add
  no build has), its question, its month and what became of it: « partira après relecture »
  (waiting, pending), « partira après la prochaine mise à jour de la carte » (waiting,
  validated), « partira au prochain envoi vers OSM » (waiting, applied), « publiée ·
  changeset n° N ↗ » (a link to `url + "/changeset/" + N`, a new window), « publiée : OSM
  avait déjà cette valeur » (no changeset), « conflit : <raison> · rien n'a été écrasé »
  (osm_version, osm_tags, osm_value, osm_deleted, osm_duplicate, osm_way — a camera that is
  a vertex of a way is never moved — in words), « envoi
  incertain : l'équipe vérifie sur OSM, rien n'est renvoyé », « en cours d'envoi »,
  « modifiée à la relecture, non publiée », « envoyée avant votre choix, reste sur
  Surveillance World ». GET /api/osm/sync is asked once per page and shared with the camera
  sheet's « Vos contributions » (1.6). States `board-sync-*`.
- Signed out in punk (the contract's « Signed out » list; `account-sheet-visitor`; the
  author's request of 2026-10-11, point 3): the camera sheet's « Modifier » and « Toujours
  là ? » greyed, `aria-disabled` (still reached by the keyboard and said), described by
  « Connectez-vous pour participer » under them; a tap or Enter on either, « Je confirme » /
  « Ce n'est pas ça », « ＋ Ajouter » and the counter's « Reconnectez-vous… » open « Compte »
  (`account-ask-from-action`); « Corriger sur OpenStreetMap ↗ » among its links; no « Vos
  contributions ». The participation says « acceptée », not « validée » (board 26a).
- `/revue`: a reviewer or an administrator opens it by its own entry (lot 2: POST
  /api/review/session, the password; a session the map opened, OpenStreetMap's or
  /api/session's, never does, and /api/session refuses these accounts); anyone else reads
  « Connexion à la revue » with its form (`review-visitor`, `review-login-error`), a
  contributor signed in on the map named above it (`review-contributor`); a session that
  ends meanwhile brings it back, said (`review-session-ended`); in the page's own layout,
  under its head « Revue ».
- Punk « Compte » with sign-ups closed (/revue's « Réglages », GET /api/config `signups`):
  « Les inscriptions sont fermées pour l'instant : seuls les comptes qui existent déjà
  peuvent entrer. » in place of 28a's lead (`account-osm-signups-closed`); a first sign-in
  refused meanwhile says so (`account-osm-signup-closed`).

## Deviations from the mockup (« Écarts à la maquette »)

### Account (lot « comptes »)

Ported from 25a's rendered DOM (`Carte punk.dc.html` v3, `25a-sheet1`, `25a-sheet1b`; dark,
wide screen); the light mode, which no frame of 25a draws (its frame 3 is empty), takes the
camera sheet's tokens.

| Mockup | Code | Reason |
|---|---|---|
| 25a's title « trois carrés », 25b's third square « ? » (« À propos de Surveillance World ») | three squares since the lot of 2026-10-11: the sun / moon, the account's, and the « ? », which opens the welcome panel (1.9) | 28a defines what the « ? » does (« troisième carré laissé en attente depuis 25b ») — no deviation left |
| 25b draws the squares flat (1.5 px edge, square corners, no shadow) | 25a's keys for both (2 px edge, rounded 5 px, 4 px offset shadow, sunk in pink while the account's sheet is open) | 25a is the access board and says so (« Les trois carrés deviennent des touches comme celles de la machine »); 25b is the profile's, another part of the lot |
| The signed-in square: 25b's flat cream « JU » | 25a's key, inverted (the ink's paper), with the pseudonym's first two letters or digits | 25a's frame 3 (signed in, light) holds no drawing; the key as 25a's text says |
| The mails written to the mockup's own address; « Mot de passe oublié » with the subject « Mot de passe oublié Surveillance World » | the address the deploy gives the build (`VITE_CONTACT_EMAIL`; none: the mail opens without one); the forgotten password's subject « Mot de passe oublié », 25a's bodies | the author's rules for the lot (2026-10-09: the address never in the repository, the site sends no mail; « Mot de passe oublié » the same mailto as « Me contacter » with that subject) |
| « Entrer » a button outside the form's submit (25a's prototype) | a submit button of the form: Enter in a field sends it | WCAG 2.1.1 (a form sent from the keyboard as any form is) |
| The fields' text 15 px | 15 px, 16 px on a phone | an iPhone zooms the whole page on a focused field whose text is under 16 px (WebKit, `WKWebViewIOS.mm` `_zoomToFocusRect`: scale = 16 / the field's font size, on a phone only) and does not zoom back out when it is let go: the page stayed zoomed, the controls off the screen (the author's report of 2026-10-23, « Zoom bloqué ») |
| The stamp in 25a's pink (#ff48b0) | dark: the same; light: the accent's ink (#b8005f) | WCAG 1.4.3: #ff48b0 on the light paper is 2.7:1, under 3:1 for large text |
| « Me contacter » and « Entrer » light blue | dark: the same; light: ink keys with light blue words, as 17a's « Compléter » | the light blue only decorates in light (web/tests/theme.test.ts, « punk light: the light blue only decorates… ») |
| The links 28 px high | 28 px with a mouse; 44 px on a phone, the OpenStreetMap link inside its sentence too | CLAUDE.md (44 px for what is touched), the camera sheet's rule |
| No waiting, offline nor other failure state | « Entrer » held down while the server waits (its delay doubles up to 30 s after refusals); offline and other failures said on the error's band | the lot's contract (the delay); real network |
| 17a's sheet: « Modifier », « Toujours là ? », links « Partager », « OpenStreetMap ↗ », « Calcul ? », « Vos contributions » | signed out: « Modifier » and « Toujours là ? » greyed (the paper, the muted ink, a dashed edge: « ＋ Ajouter »'s state below its zoom, theme/punk/map.css), `aria-disabled`, « Connectez-vous pour participer » under them; « Corriger sur OpenStreetMap ↗ » before « OpenStreetMap ↗ », no « Vos contributions » | the lot's contract, « Signed out » (2026-10-09); the author's request of 2026-10-11, point 3 (greyed, a line, `aria-disabled` so that the keyboard and VoiceOver reach them, a tap opens « Compte »); 17a draws no disabled state: the punk one that exists |
| 25a frame 1 (the stamp, « Me contacter », « Me connecter ») | sign-in with OpenStreetMap on: 28a, ported from its rendered DOM; off (an older API, offline): 25a's stamp and « Me contacter », without « Me connecter » | the author's request of 2026-10-11, point 10 (one way in, OpenStreetMap; the password form no longer in « Compte », at `?compte=motdepasse` and /revue); 28a draws no frame for a sign-in that is off (supersedes the user's decision of 2026-10-10, « the stamp becomes the key ») |
| 28a draws a phone's frames only (390 × 780) | a wide screen: the same body in the side sheet's paper (its block in the middle, its foot at the bottom); a phone: the bottom sheet at full height, under the estimate bar | 28a's text speaks of the screen, not of a size; the camera sheet's frame on each screen (25a's rule) |
| 28a's « Me contacter » underlined in #ff48b0 in light | the text pink #b8005f (`--link-line`); dark: the light blue, as 28a | WCAG 1.4.11: #ff48b0 is 2.7:1 on the paper, the wave is what tells a link (the camera sheet's rule) |
| 28a's « retour d'OSM en échec »: the band alone | the band; with `?debug=1` only, « raison : <code> » under it in a monospace face | the author's request of 2026-10-11, point 1 (the reason readable without anything sensitive, under `?debug=1` only) |
| 28a's « Nous ne gardons que votre identifiant OSM. Rien n'est publié sans votre accord. » | « Rien n'est publié sans votre accord. » (the signup's foot too) | the author's request of 2026-10-11, point 10: the first sentence is false (the pseudonym, the contributions and, for who publishes, an encrypted token are kept) |
| 28a's lead « Pas encore de compte OSM ? Vous le créerez en chemin. » | sign-ups closed (GET /api/config `signups`): « Les inscriptions sont fermées pour l'instant : seuls les comptes qui existent déjà peuvent entrer. » in its place | plan-revue §4 P5 (an administrator closes sign-ups for a wave of abuse without closing everything); 28a draws no frame for it: its lead would be false |
| No board for a sign-in started from a camera sheet | the key comes back to that camera (`?cam=<id>`): an existing account signed in (`?osm=signed`), its sheet opens, the buttons on; a first sign-in (`?osm=signup`) asks the pseudonym and lands on the account's screen, the camera not reopened; no « ← Retour » | the author's request of 2026-10-11, point 3 (« revenir à la fiche après connexion »); 28a has no « Retour »: its × closes |

### Settings and about (lot 3.6)

| Mockup | Code | Reason |
|---|---|---|

### The account's screen: the leaderboard (lot « comptes »)

Board: 26a « Classement à points » (wide screen, dark only; the mockup v3, its rendered DOM
and its code, export of 2026-10-09). 25b's profile is not shipped (2026-10-10: the account's
screen is the leaderboard, and only it), nor 25c, a contradictory variant (receipts,
stickers, counts). The paper, the cut-out title, the head and the
links are the camera sheet's (tables above).

| Mockup | Code | Reason |
|---|---|---|
| The chosen sort and headings cream on the dark paper (26a dark only) | the ink tile (`--ink-tile-bg`): cream in dark, ink in light; « Vous » and the scale white paper in light, cream in dark | dark only on the boards: the camera and commune sheets' mapping of the mockup's cream (sheet.css, area.css) |
| 26a's list: each row's bar split in its four sorts | in Total, yours in your four sorts and the others' one bar in the paper's ink; in a sort, its colour | data: the leaderboard gives each person's points, not their sorts (the contract) |
| In a sort, the podium and the list say the count (« 3 ») over the points | the points; « Vous » says its count under its points | data: the leaderboard rows carry points only |
| « Vérifications » in cream, the scale's verification « +10 » on white | cream (`--on-attrib-inset`) in both modes, outlined in ink | no token is white in light and cream in dark (tokens.css is not this lot's) |
| « Par vérification : « Toujours là ? » (oui ou introuvable), ou votre avis sur la proposition de quelqu'un d'autre. » | « Par vérification sur place : « Toujours là ? » répondu sur place (oui ou introuvable). D'ailleurs, ou votre avis sur la proposition de quelqu'un d'autre : 0. » (the API's `verification_on_site_only`) | user decision in the accounts contract (2026-10-09): 10 only on site, opinions 0 |
| The scale's values in the board's text | read from GET /api/leaderboard's `scale` (rules/leaderboard.yaml); the worked example's « 4 infos » is a count of the code | the contract: never hard-coded in the web |
| The podium's height transition from its last height when a filter changes | from the floor each time, 0.55 s on 26a's spring, under the motion query only; at its height at once under reduced motion | 26a's note (« rejoue quand on change de filtre »); DECISIONS 2026-10-06 « Animations… » (decoration that blocks nothing: the names and points are there at once) |
| « Supprimer mon compte », a link | the link, then the password (25a's field) and « Supprimer mon compte : confirmer → » (25a's « Entrer » in pink), « Annuler » | the contract: POST /api/me/delete takes the password |
| The sorts 32 px high | 44 px under a finger | DECISIONS 2026-10-07 « Fidelity to the mockup comes first… » (44 px for what a finger touches, as lot 3.3) |
| No screen for the OSM synchronisation (« écran absent de la maquette ») | « Publier sur OpenStreetMap » before the foot's links, in 26a's vocabulary as ported: the scale's heading (Archivo capitals, the pink shadow) under the foot's dashed rule; the two choices 26a's opt-in box (a real radio over the row, ✓ on pink when chosen); the states on 26a's yellow (the test server's line plain); the text and « Ce qui part » in the typewriter; 25a's field and blue key for the authorisation and for stopping; « Vos contributions et OSM (N) » the list's heading tile, each contribution a row under the scale's dashed rule, the camera in the scale's bold capitals, the changeset's link wavy-underlined as the foot's | écran absent de la maquette: the contract's « Synchro OSM » (16/10, FY) asks for the setting without a board, built from 26a's own vocabulary; the choices 44 px high under a finger (CLAUDE.md, what is touched) |
| 8a: no line about OpenStreetMap | « Sera publiée sur OSM en votre nom après relecture. » under the badge when the API says `will_publish`, the badge's black strip on a line of its own | the contract's « Synchro OSM », condition 1 (the message after each send says it); legible over the map as the badge |
| No second switch on 26a | « Afficher mon pseudonyme sur les caméras que j'ai relevées », 26a's switch again, with what it reveals under it in the typewriter | the owner's decision of 2026-10-18 (lot U: the pseudonym on the public history only by choice, the person told what it reveals) |
| 25b's cameras behind its own ticket « caméras » | a section « Mes caméras ↓ » of 26a's screen, unfolded by a key like « Comment on compte ? ↓ », on 25b's grid paper, its numbers, groups, rows and journal as 25b draws them | DECISIONS 2026-10-10 (the account's screen is 26a's; 25b's tickets are not shipped); the owner's request of 2026-10-18 (« Mes caméras » in the account's screen) |
| 25b: « Toucher une caméra ouvre sa fiche, avec « ← Profil » pour revenir » (a link) | « ← Mes caméras », a button of the camera sheet's head, in the top row beside ↑ and × and as high (the close's ink square stretched to its words), the sticker and the title under it as on every camera sheet | DECISIONS 2026-10-19 « The camera sheet opened from « Mes caméras » comes back to it with « ← Mes caméras »… » (a link in the title's column misaligned the head and did not say where it went); 44 px for what a finger touches |
| 25b's journal says « validée », « appliquée », « remplacée », « en conflit » | « acceptée », « sur la carte », « publiée sur OSM », « refusée », « en attente » (a conflict waits for the review again; a superseded one was accepted) | DECISIONS 2026-10-10 (punk says « acceptée »); the owner's request of 2026-10-18 (five words a person reads without the review's jargon) |
| 25b's journal says what was answered (« Hauteur : 1er étage ») | the change in the cameras' public history's words (« Hauteur précisée ») | one vocabulary for the same contributions on the sheet and in « Mes caméras » |
| No collection by kind, no map on 25b (25c's stickers not ported) | each kind's map sticker with its count (Archivo with the pink offset of 25b's numbers), then a little map: a drawing on the paper, a dot per camera, the communes' names; no second MapLibre map | the owner's request of 2026-10-18; the map measured on the lowend profile (CPU ×6, Slow 4G, bench/account-open.mjs): a second MapLibre map 2.0 s cold, 0.68 s warm, 120 ms of long tasks per opening, the drawing 0.07 s cold, 0.03 s warm, none |
| The fields' text 15 px (« Changer le mot de passe », « Supprimer mon compte », « Relier à OpenStreetMap », « Publier aussi sur OpenStreetMap ») | 15 px, 16 px on a phone | an iPhone zooms the whole page on a focused field whose text is under 16 px (WebKit, `WKWebViewIOS.mm` `_zoomToFocusRect`: scale = 16 / the field's font size, on a phone only) and does not zoom back out when it is let go: the page stayed zoomed, the controls off the screen (the author's report of 2026-10-23, « Zoom bloqué ») |
