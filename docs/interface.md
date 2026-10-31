# Interface

What the web interface shows today and every state its code can be in, each with the data
that produces it on the CI extract and the name of its capture. The redesign lots keep it
up to date: a change that adds, alters or removes a state updates its row here and its
entry in `web/bench/states/catalogue.mjs` in the same commit.

Captures: `node bench/shots-states.mjs --out DIR` (from `web/`, after `npm run build` on
the CI extract built with `tests/fixtures/contrib-ci.jsonl`; DIR, required, outside the
repository or in a folder git ignores) writes, for every row whose Capture cell holds its
own name, `<state>-<clair|sombre>-<phone|desktop>.png` (four files, two when the cell
names one kind of screen), and an `index.md`; `--only PREFIX`, `--device`, `--mode`,
`--list`; `--cnil` when the build served
(`LACARTE_DIST`) was made with `VITE_CNIL_SIGNAL=true`, as the preview's is: the rows
marked « (`--cnil`) » are captured only then, every other one as the preview shows it, and
whether the build shows the CNIL box is checked against the option before any capture (it
fails, exit 1, when they disagree, or when the camera it opens has lost the signal in the
tiles). Before anything runs, `--list` included, it fails (exit 1) when this catalogue and
its registry (`web/bench/states/catalogue.mjs`) disagree (a captured row without its entry
or the reverse, other screens) or when the counts below are no longer
those of the rows. After the captures it fails (exit 1) when a capture fails, when a file
the run's options ask for is missing, or when the folder holds a file no row of this
catalogue names whatever the options (a short run into the folder of a full one passes). A
browser, the API or its database killed by another process mid-way is started again and
the capture tried once more. It needs the ports 4460, 4461 and 8799, on 127.0.0.1 only,
and refuses to start (exit 2) when one is taken; Ctrl-C, SIGTERM, SIGHUP or an uncaught
error stop its browsers, servers and database and remove its temporary folder before it
exits (128 + the signal's number, or 1); a second signal meanwhile kills the servers and
stops the database at once. A full run on the CI extract wrote 682 files (`sheet-cnil` was
not captured yet) in 48 min (2026-10-06, on the author's Mac with the local gate running
beside it).

## 1. The interface in force

Each point gives the `DECISIONS.md` line (by date) it rests on.

### 1.1 One interface

- **punk**, the only interface since 2026-10-23 (the author's decision: the classique, the
  interface before the redesign, and its `?ui=` choice removed). `?ui=classique`,
  `?ui=classic`, `?ui=punk` and a choice kept on the device (`lacarte.ui`) are ignored: the
  site as on any visit (`web/tests/loading.test.ts`, `bench/smoke-theme.mjs`). The page
  keeps `data-ui="punk"`, under which every rule of `theme/punk/` is written (`theme.ts`
  initTheme). Light or
  dark, following the phone on a first visit, then the ticket's sun / moon button's choice
  kept on the device (`lacarte.mode`; 2026-10-09, « Punk map after the iPhone test »,
  replacing the Clair / Sombre / Auto keys of 2026-10-08; `map-mode-toggle`), or
  `?mode=clair|sombre|auto`, kept alike; a change
  of the phone's mode repaints the open map in place (2026-10-05), a change met while the
  map is loading waiting for its next idle and repainting once from the colours last
  painted (2026-10-06, « A change of mode while the map is loading waits for its next
  idle… »; `main.ts` restyle). Its tokens and rules are `theme/punk/punk.css` and its files
  (1.2; fonts after the first idle; its basemap without points of interest, 2026-10-05,
  nor road number shields, 2026-10-06), its communes and départements opaque (2026-10-06,
  « Punk communes and départements are opaque… »; `theme.ts` themeAreaOpacity), every name on
  the map, the basemap's and the focus reach labels, in one colour, the ink, on an opaque
  2 px halo of the map's paper (2026-10-06, « Punk map names in one colour… »;
  `basemap.ts:50` basemapLayers, `theme.ts:241` labelHalo), the legend's named level
  samples (2026-10-06), the focus rules below, and lot 3.0's shared bricks (1.2); its own
  screens (mockup 16a, 17a, 18a, 20a, 24a) come with the redesign lots (2026-10-06). It
  became the default on the author's agreement (2026-10-05), given for the launch lot
  (2026-10-13), and the only interface on 2026-10-23.

### 1.2 The punk interface's shared bricks (lot 3.0)

Lot 3.0 gives the punk interface what every later lot builds on (2026-10-06, « Lots of the
redesign: 3.0 alone… »; DECISIONS 2026-10-07, lot 3.0).

- **One CSS file per screen.** `theme/punk/punk.css` is the entry `theme.ts` imports; it
  holds nothing but `@import`s, in the cascade's order: `tokens.css` (every
  token, light then dark), `base.css` (less motion, the keyboard focus, MapLibre's own
  controls), `map.css` (the estimate bar, the canvas, the legend's swatches; lot 3.1),
  `sheet.css` (« Revenir à la caméra »; lot 3.2), `chips.css`, then `buttons.css`, last so
  that its states apply whatever a screen sets. Its header names the file each later lot
  adds before `buttons.css`: `area.css` (3.3), `participate.css` (3.4), `review.css`
  (3.5), `settings.css` (3.6). The build inlines them into one stylesheet, one request;
  `web/tests/theme.test.ts` checks that every file of the folder is imported there once,
  `tokens.css` first.
- **The second accent** (`tokens.css`, after 17a): a light blue, #7fd4ff, 1.4:1 on the
  paper, so in light it only decorates (the offset shadows of panels, sheet and small
  buttons, the grid of a box of guessed values), never text nor meaning (`theme.test.ts`
  keeps it out of every other property); in dark it is the second accent (the primary
  button's fill, the links' underline, the titles' and values' offsets, the tickets' and
  floating buttons' shadows) and the pink goes under the surfaces. Role tokens:
  `--accent-2-fill` and `--on-accent-2` (the primary button: ink with paper text in light,
  where 17a writes the light blue on ink; the light blue with ink text in dark),
  `--shadow-accent-2`, `--link-line` (the text pink #b8005f in light, 17a's #ff48b0 being
  2.7:1), `--shadow-title`, `--shadow-value`, `--shadow-ticket`, `--shadow-ticket-off`,
  `--grid-line`. Only the chips read any of them today (`--accent-2-fill` and
  `--on-accent-2` for the « supposé » tag, `--shadow-value` under the values); the others
  wait for their screens' lots.
- **Buttons** (`theme/punk/buttons.css`, after 17a): one norm for the estimate bar, the
  floating buttons and the queue counter, the sheets' buttons (the ×, the chips,
  « Partager », « Revenir à la caméra ») and the panels' (the machine's ×, « Tout
  réafficher » and « Légende ↑ », the participation's, « Vos contributions »'s ×); /revue has its own (review/review.css: a press shifts 2 px under less motion's absence, nothing on hover; lot 1 « Modérer »). A hover
  moves, never selects nor recolours, and only where a pointer hovers and motion is
  welcome (`(hover: hover) and (prefers-reduced-motion: no-preference)`; the phone of the
  captures, Playwright's iPhone 14, reports no hover): *lift*, 2 px up and tilted -2° (+2°
  every second button), a pressed or checked button, the panel-wide rows (the filters'
  head, the sheet's chips) and the move's placement segments (clipped by their frame)
  lifting without a tilt; *toggle*, the estimate bar's pastilles ×1.06 and tilted 8°
  unless pressed; *close*, the × ×1.1 and -12°. A press (`:active`) sinks the button 3 px
  down and right, the panel-wide rows straight down (sideways they would overflow their
  panel); the floating buttons' and the counter's offset shadow shrinks meanwhile (the
  counter's is 2 px), the other buttons' shadow travels with them. Focus is `base.css`'s
  `:focus-visible`, a 3 px dashed outline (ink in light, yellow in dark), never after a
  mouse click; on a chip it goes inside the row (the sheet's body clips at its sides). Motion: individual translate, rotate and scale, 300 ms on
  17a's spring, 90 ms for the press; under reduced motion nothing moves, and a press only
  shrinks the floating buttons' and the counter's shadow. A disabled button (`:disabled`,
  `aria-disabled`) never moves. The queue counter is 44 px high (32 px in the shared
  styles). Checked statically by `theme.test.ts` and in the browser by
  `bench/smoke-theme.mjs`.
- **Stickers** (`stickers.ts`, inks from the tokens; after 16a): the punk map's pictograms
  are several-colour stickers (unknown a star with a big « ? », the dome a half-disc under
  its plate with a half-closed eye, the fixed camera a tilted box on a wall arm, the PTZ a
  globe under a short rod; panorama, plate reader and doorbell in mockup 2a's shapes, the
  same style), plain images and not signed distance fields, so one image per state, chosen
  by `icon-image` (`layers.ts:200` stickerImage): `-full`, `-dim` for the others while one
  is in focus (16a's « version atténuée », an image, never an opacity), `-gone` for a
  camera verified gone (grey, no pink, crossed-out eyes), `-full-big` and `-gone-big` for
  the selected camera; a proposal's ghost (`participate/proposals.ts`, `cam-<kind>`) is
  the ghost sticker, every ink at 0.4 over the outline. The focus marker below z15 shows
  the full sticker on its paper disc; the filter panel's type samples and its
  verified-gone sample, the sheet's pictogram (pale on a pending add's sheet) and the pin
  of « Déplacer » and « ＋ Ajouter » are stickers too (`icons.ts:127` cameraCanvas). A live
  change of mode draws every sticker again (`main.ts:163` restyle, `icons.ts:316`
  addImages), but for the list of possible duplicates of « ＋ Ajouter », drawn once
  (`add.ts:163`, no onTheme: lot 3.4). « Maybe gone » is 20a's dashed ring with a « ? »,
  unhatched (lot 3.1; 1.3); /revue never loads the stickers: its small map draws shapes of its
  own (review/map.ts: a ring, a disc, a diamond, a square; lot 1 « Modérer »).
- **Chips** (`chips.ts`, `theme/punk/chips.css`, after 17a; a chunk the punk interface
  alone loads): each fact of the camera sheet is a row as wide as the sheet, its label, a
  source tag cut as an arrow, a dotted leader, the value, then its certainty as a drawn
  mark (a ring, half or wholly filled) and its word (identifiée, estimée, par défaut) in a
  frame, never by colour alone (`sheet.ts:470` fill). The tag: « OSM » (a value from
  OpenStreetMap's tags, on yellow), « sur place » (a validated contribution observed on
  site, on pink), « réponse » (a validated « Compléter » answer made elsewhere) and
  « contribution » (another validated contribution made elsewhere: a move, a sighting, an
  add, « introuvable »), both on pale pink (wine in dark), « supposé » (a default value;
  ink in light, light blue in dark), « en attente de revue » (on the proposals' blue; set
  by no code path today, see the Camera sheet's table). A tag never carries a date: the
  month stays in the value, which therefore repeats « sur place » on a contribution's chip
  until lot 3.2. Every chip with a certainty has a tag. A freshness phrase has no label:
  « Vérifiée il y a 2 ans » tagged « OSM » without certainty, a validated sighting's
  « Vérifiée sur place (octobre 2026) » with its tag and « identifiée »; OpenStreetMap's
  « À vérifier » warnings are tagged « OSM » without certainty, the « À vérifier » of a
  field drawn almost nil has neither, and « Disparue » is a warning with both. The
  accessible name is the visible text in reading order then the certainty (« Type, OSM :
  fixe, estimée »), so that what one sees is what a voice command says (WCAG 2.5.3). A tap
  still explains (the chip pink, an ink bar on its left edge).
- **The product's name** (2026-10-06, « The product is named « Surveillance.Fun »… »; renamed 2026-10-11, « Renamed « Surveillance World »… »):
  « Surveillance World » in the page titles and share metadata:
  `index.html`'s `<title>`, description and Open Graph tags (since 2026-10-15: og:title and
  og:description of their own (`share.*`), `twitter:card` summary_large_image, and og:url,
  og:image (`/og.jpg`, the A2 preview, 1200×630) with its type, size and alt, absolute from
  the deploy's host (`VITE_SITE_URL`, left out of a build without it); the logo L3 as the
  favicon (SVG following the system's mode, PNG 16 / 32 light and dark: variant C, the bar and the tilted head, 2026-10-15), the Apple icon and the manifest's
  192 / 512 px; checked by `smoke-launch`), /revue's
  « Revue des contributions · Surveillance World », written at build time from `fr.json`
  (`app.name`, `app.description`, `review.title`) by `web/vite.config.ts`'s head-strings
  plugin (`%t:key%`; an unknown key stops the build); /revue no longer sets its title at
  run time. What is left is in 1.8.
- **Checks**: `web/bench/smoke-chips.mjs` (the punk chips in light and dark, on a phone
  and a wide screen: six CI sheets, then every certainty against every source drawn by
  `chips.ts` in the open sheet; per chip its tag, its mark, 44 px, a name holding the
  visible text, contrast, a tap to explain and to close; axe-core's
  label-content-name-mismatch and WCAG 2.2 A and AA) runs in the local gate
  (`web/scripts/gate.sh`, chips-webkit and chips-chromium) and in CI's full matrix, not in
  the push's light CI; axe-core is a dev dependency.
- **No pinch-zoom of the interface** (the author's request of 2026-10-11, point 7;
  `gestures.ts`, `theme/punk/base.css`): the estimate bar, the ticket, the filters machine,
  the floating buttons, the sheets, the camera list, the participation's panels, « Vos
  contributions », the send counter and MapLibre's controls say `touch-action: pan-x pan-y`
  (scrolling and taps; `manipulation` would keep the pinch: MDN, it is « pan-x pan-y
  pinch-zoom »), at the lowest specificity so that a part that says less keeps it (a phone
  sheet's head `none`); WebKit's `gesturestart` and `gesturechange` are cancelled when they
  start on those elements. The
  map keeps its own zoom (MapLibre's canvas, `none`). The viewport keeps no `maximum-scale`
  nor `user-scalable`, the text no `-webkit-text-size-adjust`: Safari's text size (« aA »)
  works as before.
- **A phone's keyboard** (the author's request of 2026-10-11, point 4; `keyboard.ts`,
  `bottomsheet.ts`): on each change of `visualViewport` and each focus,
  `data-keyboard="open"` on the root while a field is focused over a keyboard (the layout
  viewport's bottom covered). A field of the camera sheet's panel focused on a phone (the
  password form, the pseudonym's choice, the account screen's passwords, the publication's
  comment): the sheet takes the tallest height the visible part allows and stands on the
  keyboard; the filters machine ends above it (its operator); the focused field and its
  form's submit button are scrolled into the visible part of their panel (under a phone
  sheet's pinned head), again once the sheet has reached its height; the keyboard gone, the
  page scrolled back to the top if iOS left it scrolled. In punk (2026-10-15, the owner's
  point 3: the pseudonym screen jumped on a tap in and out of its field), the field let go,
  the sheet stays on the keyboard until it has gone, and its lift eases with its height
  (`theme/punk/sheet.css`): its top stays where it is both ways. Checked in WebKit at a phone's
  size (`web/bench/smoke-keyboard.mjs`: the viewport shrunk, and `visualViewport` alone
  shrunk as on iOS); the real keyboard only on an iPhone. /revue's sign-in is a page, not
  a panel: the browser's own behaviour.
- **/revue** (lot 1 « Modérer », 2026-10-16): the mode as the map's (light or dark,
  reloaded on a change of the phone's mode), one layout on the punk tokens
  (`review/review.css`; since 2026-10-23 they alone, `theme/punk/tokens.css`): the display
  face for titles, tabs, filters and buttons, a system sans for the body (`--font-review`,
  never the typewriter face), square corners and 2 px ink rules, one primary button (pink,
  its offset shadow), the ink toast. Its pre-paint is a file (`public/revue-prepaint.js`):
  the page's Content-Security-Policy (`deploy/preview.caddy`) allows no inline script.

### 1.3 The map, by zoom

| Zoom | Drawn | Legend at that zoom | Decisions |
|---|---|---|---|
| 5 – 8.5 | Départements, coloured by Y (the high end of "between X % and Y %"), five quantile classes (punk: fixed classes < 5, 5 – 15, 15 – 30, 30 – 50, ≥ 50 %, the same for communes and départements, rules/admin.yaml; 2026-10-09); hatched without camera; fading into communes over 8 – 8.5 | « Jusqu'à … % des rues, par département », « Aucune caméra recensée », quantiles note | 2026-09-28 (city view), 2026-09-29 (fade), 2026-09-30 (Y, fixed) |
| 8 – 12.5 | Communes or municipal arrondissements, same scale; fading into the streets over 12 – 12.5; punk: five classes spread evenly (1.5:1 apart, light #ffeef6 → #c9006e, dark #36202d → #fe48b0), opaque, cut apart by a thin light-blue border (#7fd4ff, dark #80d4ff, `--map-area-border`; 0.75 px at every zoom, 2026-10-09 « Punk map after the iPhone test »), the open area outlined in the light blue, 3 px, on a 5 px near-black edge so that it stands out on the vivid classes (2026-10-09; `--map-area-selected`, `--map-area-selected-edge`) | « …, par commune » | 2026-09-28, 2026-09-29 (hexagons removed), 2026-09-30, 2026-10-08 (« The more vivid… ») |
| 12 – 15 | Only what is filmed, in the colour of the highest level reached (identifier / reconnaître / détecter; punk: the one palette (2026-10-08, « One palette… », « The more vivid… »): from pale (little filmed) to 17a's vivid pink (much filmed) in light and dark, each street one pink stroke of its level, the ramp's classes 3, 4, 5, no casing): merged axes at 12 – 13, portions with their cameras from 14; unfilmed segments grey from 14; no proposal mark before the stickers' zoom (as 20a, 2026-10-09) | street levels, « Seul ce qui est filmé est coloré » below 14, « Non filmé » from 14 | 2026-09-30 (tronçons, points 1 and 6), 2026-10-06 (« détecter »), 2026-10-07 (« Lots after 3.0… », lot 3.1) |
| 15 + | Fields: the IEC 62676-4 levels (2026-10-08: each level an opaque layer of its own map-aligned pattern, drawn détecte, reconnaît, identifie, so that each point shows the highest level reached, never a sum: the overlaps of one level draw the same pixels; the levels differ by shape, the halftone's density — one dot, two, four per 8 px — and the outline — dotted, dashed, solid — each outline under its own fill so that only the union's edge shows; since the second round (« The more vivid… ») a fine, close halftone as 20a's — two, four, eight dots per 8 px tile, about 2 px each — on pale pink grounds, never white (light #ffd6eb / #ffc2e3 / #ffaed9, dark the dull wines #36202d / #62284c / #ab347a), the dots 17a's pink; the basemap's buildings drawn over the fields at their own opacity (fading in with the streets, never over the communes); the filmed streets drawn over the fields; past z17 the filmed streets widen with the map (6 px at z18, 10 at z19, 16 at z20, the same colour, no edge; up to z17 unchanged; since 2026-10-16 never narrower than the basemap's road of their class, filmed or not: web/src/streetwidth.ts), so that at house-number zooms, where a portion lies on a field of its own level, the stroke stays a band and not one more row of dots (2026-10-14, « Punk streets keep their style… »; the ink edges of 2026-10-13 removed); no trace of an unknown direction, its field a full circle drawn like every other); pictograms (shape = type: 16a's stickers, 1.2), the maybe-gone mark (20a's dashed ring with a « ? », unhatched), a proposal's mark (20a's yellow tape across the sticker, the ghost taped too, a pending add's ghost with a camera's 20 px target and hover ring); sidewalks, crossings and paths beside a road from 16; no direction cone, no PTZ zoom outline | level samples (exactly the three fields' samples, their halftone and outline, named identifier, reconnaître, détecter), maybe gone, verified gone, proposal badge and ghost, IEC note | 2026-09-27 (zoom scheme, one hue), 2026-09-29 (pictograms, badge), 2026-09-30 (hatching, cones and PTZ outline removed, paths from 16), 2026-10-06 (named samples; stickers, DECISIONS 2026-10-07, lot 3.0; the unhatched « maybe gone »), 2026-10-07 (« Lots after 3.0… », lot 3.1: halftone, tape), 2026-10-08 (« Unknown direction leaves no trace… », « One palette… »), 2026-10-14 (« Punk streets keep their style… »: wider past z17) |

At every zoom: the estimate bar, « Standard » (the map opens on it) or « Prudent »
(`?est=prudent`) (2026-09-30); filters hide what they exclude, nothing is faded
(2026-09-30); below the street level « Qui filme » switches between the two precomputed
sets and the counts are approximate (« ≈ », by commune) (2026-09-27, 2026-09-29); at street
level the counts take the view widened by the farthest field (2026-09-30).

Punk, at every zoom (lot 3.1; 2026-10-07, « Lots after 3.0… »; mockups 20a, 18a and 17a's
map side; `machine.ts`, a chunk of its own): 20a's light blue dot
screen over the map's paper, lighter than the machine's (the earth's own pattern, icons.ts
paper, --map-paper-dots; roads and paths edged in grey, roadedge.ts; 2026-10-19, « A2 + B »);
the header ticket
« Surveillance World » (`app.name`), without 20a's
scotch (the map's only tape means « correction en attente », 2026-10-09), with 17a's link
« Filtres et légende → » (the page's own `#fab-filters`, moved: « (n) » while filters
restrict, at every zoom) and under it 25a's squares, keys as the machine's: the sun / moon
(`map-mode-toggle`) and the account's (`account-square`, `account-square-signed`; 1.7); filters
set in the street view told by the machine at every zoom, « N filtres actifs en vue rue ·
Tout réafficher » (`filters-street-active`), and a short ticket under the header one when
they hide every camera or every filmed street of the view, « Les filtres cachent toutes
les caméras (rues filmées) de la vue. Tout réafficher » (`map-filtered-empty`,
`map-filtered-empty-streets`; 2026-10-09); « Liste des caméras → » (the cameras in view the filters keep, nearest first,
each opening its sheet; below the street level it offers to zoom in) is hidden until
further notice, its code kept (2026-10-08, « Punk, until further notice… »); 17a's round Standard / Prudent pastilles
beside it (on a phone narrower than 375 px stacked at the top right, beside the ticket; lot M, 2026-10-17); 20a's floating buttons (on a phone 18a's: beside the attribution, at the bottom left, 22 px from the edges, folded to a compact « ⓘ » that a tap unfolds into its ink inset of typewriter lines at 11 px (`map-attribution-open`; 2026-10-09); on a screen narrower than 390 px above it while it is unfolded, the credit then on top of the header ticket, which it reaches on a phone held sideways; 10 px apart, as 18a and 20a draw them; gone while the machine or the camera list, which cover them, is open; on a phone a sheet opening slides them away to the right and the header ticket to the left, 300 ms, at once under reduced motion, back when it closes, 2026-10-09); « ＋ Ajouter » active from the street level, a tap below z17 zooming there first, then opening the add (`map-add-zooms-in`; 2026-10-09); the filters' machine, closed until asked for (the ticket then drops 25 px, on a wide screen centred over the machine's slot and no wider, 250 px, 21 px on a phone, centred over the machine's slot at every width (44 px from the left at 390 px), and goes up to the top at its own width while it prints the legend, as 20a and 18a move it), risen in
300 ms under the ticket's title and usable from its first frame (2026-10-06, « Animations:
at most 400 ms… »), built once and patched at each idle so that the keyboard focus, a tap
and the slide survive the map's moves (Escape inside it closes it and gives the focus back
to its link); its legend printed on the ticket by « Légende ↑ »; « État de la fiche »
hides the maybe-gone or the pending cameras (20a). The machine and the list never show
together.

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

### 1.5 Focus and the zoom-out marker

- A camera whose sheet is open is in focus: the other fields and streets at 15 %, dimmed
  and not hidden as in the mockup (2026-10-06, doc audit c5); punk (2026-10-08, « Punk
  focus… », « The more vivid… »): the other fields in one opaque dimmed colour, outline
  included (`--map-field-dim`, `layers.ts` fieldPaint: no transparency that adds up), the
  camera's whole zone drawn above them as the map draws every field (`focus-zone-1..3`),
  and on top the level its sheet's tickets choose, « identifie » first, its outline half as
  wide again (`focus-field`, `bands-fan`, `filters.ts` setLevel), with that level's
  yellow label alone, on a phone too, always wholly in the visible map: at the farthest
  vertex of the level whose label lies in the part the panels leave free and off the
  floating buttons and map controls (« Me localiser », the zoom, the attribution), else the
  one that overflows least (`focus.ts` reachLabelPoints, `main.ts` labelRoom, placed again
  at each idle); the streets it films stay highlighted whole whatever
  the level, in the filmed streets' one style (the tiles' portions carry the highest level
  reached by any camera, not by this one), the other pictograms in
  their dimmed sticker (`layers.ts` stickerImage; 1.2), it 1.5 times larger
  (2026-09-29; punk: its `-big` sticker); its outlines for the chosen estimate with its
  reach written, every level's on a wide screen's hover (2026-09-28; punk: 17a's yellow
  tag cut as an arrow, ink in the typewriter face, one image per text drawn on demand,
  `icons.ts:137` putTag; lot 3.1); the streets it films highlighted (2026-09-28). A tap
  elsewhere, the cross or Escape leaves it.
- Punk only (2026-10-06, « Focus then zoom out (punk) »; commits abd9a32 and 0612bf7,
  refined by dd78610, 11b1a1b, facd5e0): the streets are dimmed only where the fields are
  drawn (z15 +, `layers.ts:270 opacities`); below z15, where neither the camera nor its
  field is drawn, a marker (its full sticker on a paper disc ringed in the field colour,
  edged in ink) stands in; a tap on it, or the sheet's « Revenir à la caméra », frames its
  field again; a camera the filters hide has neither.
- Punk only (2026-10-06, « Punk focus marker kept clear of the panels… »; commits 79863c5
  and 33c249c): when a gesture (pinch, drag, wheel, zoom buttons, keyboard) ends with the
  marker on the screen but under a panel or the estimate bar, the map pans just enough to
  bring the whole marker into the part the panels leave free, once the map is still
  (`main.ts:642` keepMarkerFree, `main.ts:647` nudgeMarker); never after the app's own
  moves, for a marker off the screen, or while a finger is down. Since lot 3.1 the free
  part's top is the lowest of the pastilles and the header ticket, on a phone its bottom above the attribution (18a's inset, riding over the sheet), and on a wide screen
  its left edge is the machine's or the list's while one is open (`main.ts:425`
  freePadding). No state of the catalogue
  shows the nudge itself: `map-focus-far` frames the marker in the free part from the
  start.
- A tapped or clicked camera (lot U, 2026-10-18): the map moves only when its 20 px tap
  target lies outside the part the panels leave free, then just enough to bring it in, in
  300 ms, the zoom kept, once the map is at rest (`main.ts` revealCamera, `nudge.ts`); a
  step of the sheet or a change of the visible height does at most the same; a ?cam= link,
  the camera list, a new estimate, the marker and « Revenir à la caméra » frame its field
  (`main.ts` fitField). On a phone the punk ticket, slid away while a sheet is open, is not
  part of the panels then (`main.ts` freePadding).

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

### 1.8 Decided, not yet built

Each item names the `DECISIONS.md` line that decides it (its date and first words), then
says what the code does today.

- Settings and about, lot 3.6 (the same line; the mode chosen by hand, 2026-10-05, « Dark
  mode follows the phone's setting… »): today the mode is chosen by the sun / moon square or
  `?mode=` (`theme.ts` modeChoice; one interface since 2026-10-23), and there is no about
  page: the welcome panel and
  the four legal pages (1.10) say what the site is and what it stores.
- Height and tilt (2026-10-08, « The tilt is asked for a tube only… »; for the tilt
  superseded by 2026-10-13, « The tilt is asked for a tube and a small dome… »): in punk
  the height for every shape but the big ball (rules/questions.yaml height.modify_excludes,
  in the meta once the extract is built again; a build before it offers every kind a
  height) and the tilt for a tube and a small dome (tilt.kinds, questions@5, read from the
  meta's `tilt_kinds`: a build made before it, the CI extract's and the IDF one's today,
  says `["fixed"]` and offers it to a tube only). The meta's `tilt_kinds` (rules/questions.yaml
  tilt.classique_kinds, written by the pipeline) is read by the « Compléter » code alone
  (`participate/questions.ts` mountParts), the classique's, which no screen opens since
  2026-10-23.
- The product's name (2026-10-06, « The product is named « Surveillance.Fun »… »; renamed 2026-10-11, « Renamed « Surveillance World »… »): the
  page titles and the share metadata say it (1.2), the README too, and the punk
  interface's ticket says « Surveillance World » (lot 3.1); the share titles say « Caméra de vidéosurveillance »
  (`sheet.share_title`) and « Vidéosurveillance : <commune> » (`area.share_title`).
- Animations (2026-10-06, « Animations: at most 400 ms… »): `theme/punk/machine.css` holds
  « BOUM ! »'s keyframes (played once, only when motion is welcome; lot 3.1); what moves is the punk buttons' hover and press (1.2: transitions of 300 ms
  and 90 ms, none under reduced motion; `theme/punk/buttons.css`), the phone's sheet, its
  height over `--dur-sheet`, 0.22 s (`style.css`; 0 s under reduced motion,
  `theme/punk/base.css`), and the map's own
  moves: `easeTo` to a camera's field (`main.ts:367` fitField) and to a pending add
  (`main.ts:430` openPending), `fitBounds` to an area (`main.ts:658` fitArea, animated
  when an area is tapped), `panBy` of the focus marker's nudge (`main.ts:574`
  nudgeMarker), `flyTo` to the first position fix then `easeTo` over 300 ms
  (`locate.ts:143`, `locate.ts:148`). None is `essential`: under reduced motion MapLibre
  makes them jumps (its `easeTo` and `flyTo` documentation, `maplibre-gl.d.ts`).

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
  makes the stop point's captures (`--only centred`: the phone's).

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
  `/registre/acheteur/<siren>`, `/registre/entreprise/<siren>`, `/registre/contrat/<affaire>`
  (a document's fiche, of its type). `/registre/chiffres` and the old documents' search are replaced
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
  ink (a thin outline hovered, full with a thick outline and its label chosen, the others aside;
  the week chosen full of ink on the chart); its tickets « arrêtés », « heures autorisées, hors
  créneaux sans horaires », « créneaux aux horaires non précisés » (and « zones non déduites » when
  there are some); « N créneaux, dans M arrêtés »; a decree opens in its panel, the view's state in
  its address. Opening it frames the commune and tilts the map; closing the register leaves the
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
  its record's form (`/registre/contrat/<affaire>?doc=<id>#signaler`), on a phone in the drawer of
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

## 2. State catalogue

One table per screen; in each, the improvised states (Mockup cell holding **IMPROVISED**)
come first, then those the mockup draws, the unreachable ones last within each group.

### Counts

| Screen | States | Improvised | Reachable | Captured | Files | Not reachable |
|---|---|---|---|---|---|---|
| Map | 49 | 35 | 45 | 36 | 128 | 4 |
| Filters and legend | 21 | 12 | 21 | 20 | 76 | 0 |
| Camera sheet | 61 | 39 | 49 | 40 | 144 | 12 |
| Proposals in the camera sheet | 18 | 18 | 18 | 17 | 68 | 0 |
| A pending add's sheet | 7 | 7 | 7 | 7 | 28 | 0 |
| Commune, arrondissement, département | 13 | 9 | 10 | 10 | 38 | 3 |
| Participation: « Toujours là ? » | 6 | 5 | 6 | 6 | 24 | 0 |
| Participation: « Déplacer » | 3 | 3 | 3 | 2 | 8 | 0 |
| Participation: « Compléter » | 1 | 1 | 0 | 0 | 0 | 1 |
| Participation: « Modifier » | 40 | 25 | 40 | 24 | 96 | 0 |
| Participation: « ＋ Ajouter » | 2 | 2 | 2 | 2 | 8 | 0 |
| « Vos contributions » and the send queue | 10 | 10 | 10 | 9 | 36 | 0 |
| Account (lot « comptes ») | 20 | 14 | 20 | 18 | 72 | 0 |
| /revue | 60 | 60 | 56 | 50 | 200 | 4 |
| Errors | 6 | 6 | 6 | 6 | 24 | 0 |
| Leaderboard | 44 | 38 | 43 | 38 | 152 | 1 |
| « Mes caméras » (lot U) | 7 | 6 | 7 | 3 | 12 | 0 |
| Welcome (28a) | 3 | 0 | 3 | 1 | 4 | 0 |
| Loading (2c) | 3 | 1 | 3 | 0 | 0 | 0 |
| Legal pages (launch lot) | 10 | 10 | 10 | 0 | 0 | 0 |
| Contributions closed (launch lot) | 4 | 4 | 4 | 0 | 0 | 0 |
| The register (lots R0 and R1a) | 29 | 23 | 28 | 0 | 0 | 1 |
| **Total** | 417 | 328 | 391 | 289 | 1118 | 26 |

The multi-dome (DECISIONS 2026-10-23) adds four states, all improvised (no board draws
it): `add-multidome`, `add-multidome-count` and `add-multidome-kept` in « Modifier »,
`sheet-multidome` in the camera sheet (its tile attributes injected by the bench: the CI
extract has no multi-dome).

The classique's removal (2026-10-23) drops its 34 states, all of them its own (the
`(classique)` rows): `map-proposals-dots`, `filters-legend`, `filters-collapsed`,
`sheet-chip-help`, `sheet-cnil`, eight of « Déplacer » (`move-*` but `move-sent` and
`move-queued`), eleven of « Compléter » (`complete-*` but `complete-none`), eight of
« ＋ Ajouter » (`add-*` but `add-sent` and `add-queued`), `add-pending-sent` and
`account-classique-visitor`; a row's « (punk) » no longer narrows anything. The paragraphs
below are the catalogue's history, when two interfaces lived side by side.

Lot U (2026-10-18) adds 13 states, 12 improvised, all reachable (two by a route), 6
captured in four files each, in punk only but `sheet-history` and `sheet-history-signed`
(both interfaces): 3 to the camera sheet (its public history, the chosen pseudonym, the
link to OSM's live server), 3 to the leaderboard (« Afficher mon pseudonyme sur les
caméras que j'ai relevées », on, offline) and the 7 of a new section, « Mes caméras ».
Every sheet of a camera with an accepted contribution (on the seed full) now ends with
« Historique », which the captures of a full sheet may show at its foot.
The account's screen, the leaderboard (lot « comptes »), adds 18 states, 12 improvised, all
reachable with the account routes answered by the page (`web/bench/profile-mock.mjs`),
all captured in four files, in punk only.
Publishing to OpenStreetMap (OSM lot 2) added 10 states to the leaderboard's screen; the
OSM synchronisation (2026-10-16) replaces them with 12 (`board-sync-*`), and adds
`mine-sync` to « Vos contributions », `score-osm` to « Modifier » (no capture of its own)
and 5 to /revue (`review-settings-osm`, `-osm-live`, `review-queue-osm`,
`review-camera-osm`, `review-account-sync`), all improvised (no board), all reachable, in
punk only.
Sign-in with OpenStreetMap (OSM lot 1) adds 13 states, all improvised (but `account-osm-key`, board 28a since 2026-10-11), 7 to the account's
sheets and 6 to the leaderboard, all reachable with the `/api/osm/*` routes answered by the
page, all captured in four files, in punk only.
The welcome (lot of 2026-10-11) adds 4 states, none improvised (28a draws them), all
reachable, 2 captured in four files, in punk only. The points at send (8a, the same lot)
add `score-reduced` (improvised, not captured: the captures run with motion) and make
`modify-done` and `add-done` 8a's (no longer improvised).
The lot of 2026-10-12 adds 15 states, 11 improvised, all reachable, none captured by this
script (each names its bench's captures instead): 8 to « Modifier » (the aim's missing
fields, the field under the streets, the heights in metres, who films' search and a
proposed name, 8a's tickets mid-fall, gathered, or without points after 2 s), 1 to « Vos
contributions », 3 to /revue (the reviewer's choice of a proposed name) and the 3 of a new
screen, « Chargement » (2c).
The launch lot (2026-10-13) adds 17 states, all improvised, all reachable, none captured
by this script (`bench/shots-legal.mjs` makes the captures its rows name): 1 to « Modifier »
(8a's send the server gives nothing), 3 to the leaderboard (« Télécharger mes données »),
the 9 of the legal pages and the 4 of contributions closed; it changes `verify-sent`,
`verify-queued` (punk from afar: no scene), `add-done`, `account-osm-signup`,
`account-osm-key`, `account-ask`, `welcome-first` and `board-publish-off` (since 2026-10-16 `board-sync-not-offered`).
The return on the launch's Temps 1 (2026-10-13) adds 5 states, all improvised, all
reachable, none captured by this script (each names its bench's captures, or none):
`map-street-wide` to the map (`bench/shots-streets.mjs`, on an IDF build);
`modify-possible-field`, `modify-dome-tilt` (reached with the meta routed until the CI
extract is built again) and `score-phone-centred` (`bench/shots-fete.mjs --only centred`)
to « Modifier »; `legal-publish` to the legal pages. It changes `map-z16-street`, `map-focus`, `add-place`,
`modify-position`, `modify-field-under`, `add-sheet-filled`, `modify-done`, `add-done`,
`score-mid-fall`, the `prop-*` and `add-pending-*` rows that quoted the classique's day
(both interfaces now write the month), `legal-privacy`, `legal-terms`, `legal-sources`,
`legal-closed`, `closed-welcome` and `board-publish-off` (since 2026-10-16 `board-sync-not-offered`).
Before them: states the code can produce: 284, of which 205 improvised (184 of them reachable).
Reachable on the CI extract: 261. Captured under their own name: 243, 222 in four files
(light and dark, phone and wide screen) and 21 in two: 10 states existing on one kind of
screen only (`map-focus-labels`, `filters-collapsed`, `sheet-share` on a wide screen;
`filters-legend`, `sheet-peek`, `sheet-full`, `map-landscape`, and in punk
`map-attribution-open`, `sheet-half-scrolled` and `area-half-scrolled` on a phone; the two
`filters-*` in the classique only), and the punk
buttons' 5 hovers (no phone hovers) and 6 presses (a touch cannot be held) on a wide
screen; 930 files, the four of `sheet-cnil` from a preview build only (`--cnil`), in the
classique (punk suspends the box, 2026-10-08). In one interface only: the « Compléter »
rows, the `move-*` rows but `move-sent` and `move-queued`, and the « ＋ Ajouter » rows of the
position and the questions in the classique (punk has « Modifier »'s component there), the
« Modifier » section's rows in punk, the account's rows and `queue-relogin` in punk, `account-classique-visitor` in the classique. Without a capture of their own, on another state's
screen: `map-mode-toggle` and `account-square-signed` (every punk map state's ticket), `account-ask-from-action` (`account-osm-key`'s), `prop-sent` (`prop-move-mine`'s),
six punk row states (`chip-answer`, `chip-contribution`, `chip-wrap`, `chip-osm`,
`chip-assumed`, `chip-on-site`: camera sheets), seven punk button states, at rest or disabled
(`button-*-rest`, `button-fab-disabled`, `button-panel-disabled`), `modify-aim-closer` and
`button-panel-disabled` (`modify-aim-waiting`'s). Not reachable: 23, each with what it needs
(18 data or a setup the CI extract and its contributions do not give, `complete-none` and
`chip-pending` dead branches, the three states of the punk camera list, hidden until
further notice).
`shots-states.mjs` checks this table against the rows below. The settings screens, which
no code produces yet, are in 1.8.
The « go » of /revue (2026-10-17) adds `review-journal-filtered` and `review-stats-figures` to /revue (improvised, reachable, captured; `bench/shots-revue-journal-stats.mjs` captures both views at the boards' sizes) and changes `review-journal` (an activity feed), `review-stats` and `review-stats-empty` (S6's spans): their API answers mocked by the page until S6 is integrated.
The fixes of 2026-10-15 add 2 states, improvised, reachable, not captured by this script:
`map-roads-lifted` to the map (`bench/shots-roads.mjs`, on an IDF build); then `map-water-over`
(`bench/shots-water.mjs`, on an IDF build).

### Improvised states against the 2026-10-06 rules

The rules improvised states must keep are those of the 2026-10-06 line « Every state the
code can produce is catalogued in docs/interface.md… ». Today these break them:

- « the month, never the day »: the day is written by every `mine-*` row (« 2026-10-05 · … », a panel of lot 3.4) and /revue (the review account only: lines, contributions,
  decisions « rev, 16/10/2026 », « reçue le … »), which DECISIONS 2026-10-13 keeps to the day for
  the person and the reviewers (the `prop-*` and `add-pending-*` rows, public, write the
  month since then);
- « never colour alone »: /revue's legend named colours (« Cercle blanc », « rouge ») until
  lot 1 « Modérer » (2026-10-16), which names the shapes drawn instead (« rond cerclé »,
  « rond plein », « contour pointillé », « zone pleine », « losange », « carré »);
- « the month, never the day », by decision: `board-sync-off` says that a « toujours là »
  leaves for OSM with the day of the passage (`check_date` is a day, 2026-10-10; the person
  is told before choosing);
- and, beside those rules, a decided proposal or add still asks for opinions
  (`prop-validated`, `add-pending-validated`).

### Columns

- **State**: the id.
- **Description**: what the screen shows in that state, read on its captures.
- **Code**: `file:line function` under `web/src/` as merged with main at d96dd7b (lines
  move: the function name holds; a function name after a line number is the function the
  line is in).
- **Mockup**: the screen of the product owner's mockup (v2, not in the repository) that
  draws the state, with what differs; **IMPROVISED** when no screen does. References: 17a
  camera sheet (desktop, light and dark), 20a filters (desktop) and 18a (phone), 16a
  stickers, 24a commune sheet (dark, desktop); older screens still in the mockup: 1a six
  views, 2b and 4b camera sheets, 3a and 4a add and correct, 8a send; 7b, the accessible
  camera sheet, for its dashed focus outline only. 9a, 11a, 12a are left aside. A row
  counts as improvised whenever its Mockup cell holds IMPROVISED, « partly … » included:
  what the mockup does not draw of it is invented.
- **Test data**: on the CI extract (`tests/fixtures/ci.osm.pbf`, contributions of
  `tests/fixtures/contrib-ci.jsonl` applied by the CI build). A link is `?query#zoom/lat/lon`.
  `who=` is the account (ana by default; rev is the review account; tess a test account;
  bob and cara contribute in the seed; dan, eve, fay and gil, outside the seed, each send
  in one state only: `verify-sent`, `move-sent`, `add-sent`, `add-pending-sent`).
  **seed** is the participation data (`web/bench/states/seed.mjs`): *empty*, or *full*:
  ana's move of n1925222793 (m1); ana's move of n1925222796 with bob agreeing and cara not
  (m2); bob's « introuvable » on n1988182438; cara's move of n1925180682, validated; ana's
  move and bob's « introuvable » on n2001233184; bob's move of n1879237395, rejected; cara's
  « introuvable » on n1945922096, withdrawn; adds by ana (c5eed0a010000, pending), bob
  (c5eed0a020000, on site) and cara (c5eed0a030000, validated); answers: direction 120 on
  n5442645358, « Commerce » and « Je ne sais pas » on n9622344410, height on n13610509865;
  tess's « Elle est là » on n1879237460; then the fixture's history posted with its own ids
  where they are uuids (a1, b1, b2, c1, c2, d1, d2, 91, e1, add00003), validated and settled
  with the CI build's outcome as a deploy does (applied, superseded, two conflicts).
  **offline**: the browser goes offline once the page is in. **route**: the server's answer
  is simulated by the script. **fake send**: the script answers the contribution POSTs
  itself, nothing is stored. **geo**: the position the browser gives. **fx.camera**: the
  first outdoor camera 3 – 30 m from a facade (`tests/apiserver.py`: n10181637847), with
  fx.target 2 m off that facade and fx.inside 2 m inside it.
- **Capture**: the state's own name when the script captures it, as
  `<id>-<clair|sombre>-<phone|desktop>.png`; « (phone) » or « (desktop) » when the state
  exists on that kind of screen only, or is captured there only (two files: a press, which
  a phone's touch cannot hold, the cell saying so); « (punk) » when it exists in that
  interface only; « (`--cnil`) » when it needs a preview build (`VITE_CNIL_SIGNAL=true`);
  another state's name when it is that state's screen (no capture of its own); « — » when
  it is not reachable.
- **Reachable**: yes (with the CI extract and the API), or no and what is missing.

### Map

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `map-mode-toggle` | Punk: the sun / moon square, the first of 25a's squares under the ticket's link, a 44 px key as the machine's (edged in the ink, rounded 5 px, tilted -2°, on its 4 px offset shadow; sunk onto it while pressed): the moon in light, named « Passer en mode sombre », the sun in dark, « Passer en mode clair » (no pressed state but the press, its name says what a tap does); a first visit follows the phone, a tap repaints the map in place (theme.ts toggleMode, chooseMode, the live switch of followMode) and keeps the other mode (`lacarte.mode`, `?mode=` when the link has it); hidden with the ticket's links while the machine is open | machine.ts modeToggle; theme.ts toggleMode; theme/punk/map.css .ticket-square | 25a (the sun on its key, dark); partly IMPROVISED: the moon in light (25a draws no light frame) | `#16.5/48.8963/2.2382` | `map-z16-street` (punk) | yes, without a capture of its own: every punk map state's ticket |
| `map-no-data` | The opening view without a position in the URL (z13 on Châtelet); outside the built region nothing but the empty basemap, and nothing says so | main.ts:95 (default centre) | IMPROVISED | `/` (Châtelet is outside the CI extract) | `map-no-data` | yes |
| `map-z7-departements` | Départements by quantile class (punk: by fixed class), hatched without camera; on CI one département (Hauts-de-Seine, cut to the extract), so two classes in the legend and nothing hatched | layers.ts:333 areaLayers (deps) | IMPROVISED (1a draws communes, streets, street: no département view) | `#7.60/48.89/2.23` | `map-z7-departements` | yes |
| `map-filtered-public` | « Caméras publiques seules » below z15 (here z13.2, the communes faded out): only the streets public cameras film, « Filtres (1) »; punk: chosen in the machine (« Publiques seules », one of its two keys below the street level), the machine closed by its ×: the ticket's link reads « Filtres et légende (1) » | filters.ts:447 render (radios), 219 apply, 401 (button); punk machine.ts:604 render | IMPROVISED (no screen shows a filtered map) | `#13.2/48.8965/2.2385`, Filtres, « Caméras publiques seules » (punk: « Filtres et légende », « Publiques seules », ×) | `map-filtered-public` | yes |
| `map-filtered-advanced` | An advanced filter at street zoom: the other cameras, their fields and streets hidden; punk: the ticket's link reads « Filtres et légende (1) » | filters.ts:269 apply, advanced.ts:114 expression | IMPROVISED | `?f=fresh_never#16.5/48.8963/2.2382` | `map-filtered-advanced` | yes |
| `map-filtered-empty` | An operator search matching nobody: no camera, field nor filmed street, the streets grey (« Non filmé »), « Filtres (1) » (punk: « Filtres et légende (1) », and under the header ticket « Les filtres cachent toutes les caméras de la vue. Tout réafficher », role status, 2026-10-09) | advanced.ts:99 operatorIds | IMPROVISED | `?op=zzz#16.5/48.8963/2.2382` | `map-filtered-empty` | yes |
| `map-filtered-empty-streets` | Punk, z14.5, the same search: no camera is loaded below z15, every filmed street of the view hidden: « Les filtres cachent toutes les rues filmées de la vue. Tout réafficher » (by the filter bits below z15, by the marks from z15 since 2026-10-17); « Tout réafficher » clears every filter, the keyboard focus to « Filtres et légende » | filters.ts hiddenWhole; machine.ts render, resetLink; theme/punk/map.css .filters-empty | IMPROVISED (DECISIONS 2026-10-09; no board) | `?f=ptz#14.5/48.8963/2.2382` (an operator search no longer hides streets below z15) | `map-filtered-empty-streets` (punk) | yes |
| `map-attribution-open` | Punk, a phone: the credit unfolded from its « ⓘ » (a 44 px disclosure button, « Sources et licence de la carte »): « © contributeurs OpenStreetMap · données ODbL », the basemap's and IGN's credits, 11 px typewriter on the ink inset, on top of the header ticket where it reaches it (a phone held sideways, 320 px high); narrower than 390 px the floating buttons rise above it meanwhile; another tap folds it | main.ts (attrib-toggle); theme/punk/map.css .attrib-toggle | IMPROVISED (DECISIONS 2026-10-09; 18a draws the credit unfolded) | `#16.5/48.8963/2.2382`, a tap on « ⓘ » | `map-attribution-open` (phone) (punk) | yes |
| `map-focus-labels` | Wide screen, the mouse over the focused field: every level's reach written; punk: each as 17a's yellow tag cut as an arrow on its left, ink in the typewriter face, tilted -4°, one image per text drawn when the map asks for it and again once the punk fonts are in | main.ts:336, filters.ts:285 setAllLabels; layers.ts:638 focus-labels; icons.ts:137 putTag; stickers.ts:580 tagLabel | IMPROVISED (17a writes the chosen level only, as its yellow tag) | `?cam=n1879237466#18/48.896425/2.239968`, mouse 6 m south of it | `map-focus-labels` (desktop) | yes |
| `map-focus-far` | Punk: the camera in focus, the map zoomed out below z15: its marker, its full sticker on a paper disc ringed in the field colour; « Revenir à la caméra » in the sheet | main.ts:313 markFar, 458 selectAt; layers.ts:419 focusMarkerLayers; sheet.ts:455 | IMPROVISED | sheet of n1879237466, then z13.5, the camera in the middle of the part of the map the panels leave free | `map-focus-far` (punk) | yes |
| `map-focus-far-filtered` | Punk: the same, the camera hidden by a filter: no marker, no « Revenir à la caméra » | main.ts:316, filters.ts:306 refreshFocus | IMPROVISED | `?cam=n1879237466&f=fresh_lt1#18/48.896425/2.239968`, then z13.5 as above | `map-focus-far-filtered` (punk) | yes |
| `map-proposals-street` | z15+: the pending badge (top left) on proposed cameras, a pale pictogram at each proposed position linked by a dotted line (a pending add: `map-proposal-add`); in punk 20a's yellow tape « correction en attente » across the proposed camera's sticker instead of the badge, and the ghost sticker (every ink at 0.4 over the outline) taped too, so that a ghost never looks like a dimmed camera in dark; the dotted link 3 px wide on a 7 px halo of the map's paper, above the fields (2026-10-08, « The more vivid… ») | participate/proposals.ts:78 ensure; stickers.ts:98 variantInks, 371 paintSticker, 555 tape; layers.ts:805 proposalTapeLayers, proposalLinkHalo; main.ts:288 | partly 20a (the pending mark, as yellow tape); the ghost (16a draws none), its tape (DECISIONS 2026-10-07, « The stickers as delivered are accepted… ») and the dotted link IMPROVISED | seed full, `#17.4/48.8962/2.238` | `map-proposals-street` | yes |
| `map-proposal-add` | A pending add: pale pictogram with its badge, tappable (punk: the ghost sticker with 20a's tape across it, no badge) | proposals.ts:257 draw; stickers.ts:371 paintSticker | IMPROVISED (16a draws no ghost) | seed full, `#18.6/48.8981364/2.2403746` (ana's add) | `map-proposal-add` | yes |
| `map-gone-filter` | A camera verified gone: hidden, grey with the filter « Disparue (vérifiée) »; in punk its gone sticker (grey body, no pink, crossed-out eyes) | layers.ts:170 pictoColour, 180, 200 stickerImage; filters.ts:276 | IMPROVISED (20a lists « disparue » in the drawer only; 16a has no gone sticker) | `?f=gone#18.5/48.895771/2.239842` (n1923568277, fixture d2) | `map-gone-filter` | yes |
| `map-locate-follow` | « Me localiser » on: dot and accuracy circle, the map follows, « Suivi » | locate.ts:71 tap, 137 recentre | IMPROVISED (1a, 20a draw the button at rest) | geo 48.8962, 2.2385 ±15 m; `#15/48.8963/2.2382`, the button | `map-locate-follow` | yes |
| `map-locate-free` | After a gesture on the map (a drag, a pinch, the wheel, the keyboard, a tap; lot U): the dot stays, « Recentrer » | locate.ts:82 | IMPROVISED | the same, then a drag | `map-locate-free` | yes |
| `map-locate-error` | Position refused or unavailable: « Position indisponible » on the button for 4 s | locate.ts:168 failed | IMPROVISED | no geolocation permission | `map-locate-error` | yes |
| `map-locate-waiting` | From the tap to the first position: « Localisation… » on the button, `aria-busy`, its name « Localisation en cours : toucher pour annuler » | locate.ts tap | IMPROVISED (no board: lot M, 2026-10-17) | a geolocation that never answers | not captured by the catalogue | yes |
| `map-locate-timeout` | No position 15 s after permission: « Pas de position : réessayez » for 4 s, then off | locate.ts, tracker.ts timeout | IMPROVISED (no board: lot M, 2026-10-17) | a geolocation that never answers, 15 s | not captured by the catalogue (lot M captures) | yes |
| `map-add-zoom` | Below z17 (punk: below z15, where no sticker shows) « ＋ Ajouter » greyed; a tap says « Zoomez pour ajouter » for 3 s | participate/index.ts (the add button's label and click) | IMPROVISED (1a, 20a draw it enabled) | `#16.4/48.8981364/2.2403746` (punk `#14.6/…`), a tap | `map-add-zoom` | yes |
| `map-add-zooms-in` | Punk: « ＋ Ajouter » tapped between z15 and z17: the sheet closes, the map eases to z17 (400 ms, a jump under reduced motion), then the add opens (its position view); a finger stopping the zoom halfway stops the add too | participate/index.ts (the add button's click) | IMPROVISED (DECISIONS 2026-10-09) | `#16.4/48.8981364/2.2403746`, a tap | `map-add-zooms-in` (punk) | yes |
| `map-queue-counter` | Something waits on the phone: « 1 en attente d'envoi » bottom left (under the sheet on a phone while it is open) | participate/index.ts:75-93, 270 renderCounter | IMPROVISED | n1879237466's sheet, offline, « introuvable » confirmed, Escape | `map-queue-counter` | yes |
| `map-debug` | `?debug=1`: the band (camera, sheet box, viewport, queue, position, events) | debug.ts, main.ts:781 | IMPROVISED (developer tool) | `?cam=n1879237466&debug=1#18/48.896425/2.239968` | `map-debug` | yes |
| `map-landscape` | A phone held in landscape: the sheet at its tallest is 60 % of the height | bottomsheet.ts:39 max | IMPROVISED | iPhone 14 in landscape (750 × 340), `sheet-full` | `map-landscape` (phone, held in landscape) | yes |
| `button-estimate-press` | Punk, wide screen: the mouse button held on « Prudent »: it sinks 3 px down and right, its hover's ×1.06 and 8° kept, nothing selected until the button is released | theme/punk/buttons.css:136 (press) | IMPROVISED (17a draws no press; the 3 px sink is the mockup's press() of 20a's filter keys) | `#16.5/48.8963/2.2382`, the mouse held on « Prudent » | `button-estimate-press` (desktop) (punk); phone: not captured (pointer state: a touch cannot be held, Playwright's touchscreen only taps) | yes |
| `button-fab-hover` | Punk, wide screen: the mouse over « Me localiser »: up 2 px and tilted -2° (+2° on every second button of the column), never recoloured; the queue counter lifts alike; « ＋ Ajouter », disabled below z15 (2026-10-09), does not move; no hover on a phone | theme/punk/buttons.css:75 (lift), 88, 101 | partly 17a (« Compléter »'s lift); on the floating buttons IMPROVISED | `#16.5/48.8963/2.2382`, the mouse over « Me localiser » | `button-fab-hover` (desktop) (punk) | yes |
| `button-fab-press` | Punk, wide screen: the mouse button held on « Me localiser »: it sinks 3 px down and right onto its offset shadow, which shrinks to none meanwhile (pink in light, light blue in dark), its hover's tilt kept; nothing asked until it is released; the queue counter alike | theme/punk/buttons.css:136, 141, 144 | IMPROVISED (17a draws no press; the 3 px sink is the mockup's press() of 20a's filter keys) | as `button-fab-hover`, the mouse held | `button-fab-press` (desktop) (punk); phone: not captured (pointer state: a touch cannot be held, Playwright's touchscreen only taps) | yes |
| `button-fab-press-reduced` | Punk, less motion asked (`prefers-reduced-motion: reduce`): « Me localiser » held neither lifts nor sinks, only its shadow goes; the floating buttons and the queue counter are the only ones with a shadow rule, so every other button shows nothing at all when pressed | theme/punk/buttons.css:141, 144 | IMPROVISED | `button-fab-press` with less motion emulated | `button-fab-press-reduced` (desktop) (punk); phone: not captured (pointer state: a touch cannot be held, Playwright's touchscreen only taps) | yes |
| `button-fab-disabled` | Punk: « ＋ Ajouter » below z15 (aria-disabled; 2026-10-09: active as soon as the stickers show): paper, muted text, a dashed ink edge instead of 20a's yellow; neither a hover nor a press moves it | style.css:1153; theme/punk/map.css:409; theme/punk/buttons.css:135 (`:not(:disabled, [aria-disabled="true"])`) | IMPROVISED (1a, 20a draw it enabled) | `#16.5/48.8963/2.2382` | `map-z16-street` (punk) | yes, without a capture of its own: `map-z16-street`'s screen |
| `map-street-wide` | Punk, past z17: the filmed streets widen with the map (6 px at z18, 10 at z19, 16 at z20; the focused camera's streets alike), the same colour, no edge; up to z17 the curve unchanged: at house-number zooms a portion lies on a field of its own level (pink on pink) and stays a band | layers.ts streetLayers; streetwidth.ts (since 2026-10-16: at least the basemap's road width of the segment's class `c`, rules/streets.yaml tile_class, filmed, unfilmed and focused alike) | IMPROVISED (the author's iPhone capture of 2026-10-13, « Prudent » at Place Denfert-Rochereau, z18 – z19; the ink edges first tried were removed, 2026-10-14) | the captures on an IDF build at `#z/48.8338/2.3324` | — (shots-streets.mjs on an IDF build, a phone: apres-z15 … z20, prudent, light and dark, beside avant-*) | yes, without a capture of its own: every punk map state past z17 |
| `map-z10-communes` | Communes by quantile class of Y (punk: by fixed class, < 5 % … ≥ 50 %) | layers.ts:333 areaLayers | 1a (Ville, z11); 24a (dark) | `#10.30/48.895/2.23` | `map-z10-communes` | yes |
| `map-z12-streets` | Filmed streets, merged axes, by level reached | layers.ts:518 portions | 1a (Quartier, z13) | `#12.60/48.8977/2.2377` | `map-z12-streets` | yes |
| `map-z14-portions` | Filmed portions, unfilmed segments grey (since 2026-10-17 the z14 portions are the merged intervals of z12-13, without their cameras, which start at z15; punk since 2026-10-16: as wide as the basemap's road of their class, as the filmed ones; the unfilmed tracks, paths, bridleways, motorways and motorway links are not in the tiles, the basemap draws them, rules/streets.yaml unfilmed_not_drawn; since 2026-10-22 no unfilmed segment of a commune without a camera either, its streets are the basemap's alone, unfilmed_only_where_cameras) | layers.ts:504 streets | 1a (Quartier: unfilmed streets drawn) | `#14.50/48.8977/2.2377` | `map-z14-portions` | yes |
| `map-roads-lifted` | Punk, from z15: the basemap's roads, quays, ramps and bridges drawn in their own style above the fields (fill and outline) and the buildings, its paths (`other`: footways, sidewalks, cycle tracks) from z16 where their portions start, under the filmed streets and every label; tunnels, railways and the pedestrian areas stay below; nothing changes below z15. Since rule:streets@3 the motorways, trunks, cycleways, paths, steps, tracks and bridleways are coloured where filmed, since rule:streets@3.1 the busways too; our streets are at least as wide as these roads (streetwidth.ts) | layers.ts drawnBasemap (`<id>-lifted` copies), stacked; main.ts restyle | IMPROVISED (the owner's captures of 2026-10-15 at Bercy: the paths lost under the fields, worst in « Prudent ») | `#18.31/48.82642/2.39073`, `?est=prudent#17.79/48.82615/2.39061` on an IDF build | — (shots-roads.mjs on an IDF build: avant / apres, Standard and Prudent, z15 – z19, light and dark) | yes, without a capture of its own: every punk map state from z15 |
| `map-water-over` | Punk, from z15: the basemap's water drawn again over the fields, see through (`--map-water-opacity` 0.7), the halftone guessable under it, a 1 px shore line a little darker (`--map-water-shore`); the fields' outlines under it with their fills; the focused camera's zone above it; the fields not cut, counts unchanged | layers.ts waterOver, drawnBasemap, stacked; theme.ts waterOverFields | IMPROVISED (the owner's request of 2026-10-15) | Bercy `?est=prudent#16.40/48.82509/2.39018`, the canal Saint-Martin at z17, on an IDF build | — (shots-water.mjs on an IDF build: avant / apres, light and dark) | yes, without a capture of its own: every punk map state from z15 with water |
| `map-z16-street` | Fields, no hatching without direction (a full circle like the others), pictograms (punk: 16a's full stickers, only the dome, fixed and unknown kinds on CI), sidewalks; punk: the one palette's fields (each level an opaque halftone on its pale ground, pink dots in both modes, two, four or eight per 8 px, its outline dotted, dashed or solid; overlaps of one level alike, the highest level on top), the buildings over them, the filmed ones one pink stroke of their level, wider past z17 (`map-street-wide`); 20a's light blue dot screen over the whole map, under our layers; the header ticket « Surveillance World » with « Filtres et légende → » and « Liste des caméras → », the round pastilles beside it, 20a's floating buttons (« ＋ Ajouter » enabled from z15, « Me localiser » on the ink, the zoom buttons ink squares) | layers.ts punkFields (field-1..3, field-1..3-line), streetLayers (portions), stacked (buildings), paper-dots, cameras; stickers.ts fieldPattern, paperDots; machine.ts:226 buildTicket | 1a (Rue, z16.8), 16a (street view), 17a and 20a (the halftone, the ticket, the pastilles, the floating buttons); the mockup dots an unknown direction: the classique hatches it, punk leaves no trace (2026-10-08); its halftone discs are our exact fields (§3) | `#16.5/48.8963/2.2382` | `map-z16-street` | yes |
| `map-z18-street` | Close up: a dome's hatched disc (punk: its plain full disc), the pictograms' shapes (punk: the stickers' eyes and plates readable); punk: the halftone over the outermost band | the same; layers.ts:200 stickerImage | 16a | `#18.2/48.8979/2.2378` | `map-z18-street` | yes |
| `map-prudent` | « Prudent » chosen: larger fields, its button pressed, `?est=prudent`; punk: the round « Prudent » pastille pink with its ✓, a solid edge and an ink offset, « Standard » paper, dashed and smaller | filters.ts:588 renderEstimateBar, 93 initialEstimate | 17a (Prudent pastille pressed) | `?est=prudent#16.5/48.8963/2.2382` | `map-prudent` | yes |
| `map-focus` | A camera in focus: the others dimmed (punk: their dim sticker, the body half-way to the outline, never an opacity), it larger (punk: its big sticker), its outlines and reach, its streets highlighted; a phone's sheet at its top only; punk: the camera's whole zone over the other fields in one dimmed colour, its « identifie » level on top (pattern and a wider solid outline) and its reach as 17a's yellow tag (« identification 6 m », rounded up), on a phone too | filters.ts:219 apply; layers.ts:200 stickerImage, 604 bands-fan, 589 focus-streets, 618 focus-labels, 692 camera-selected; layers.ts:638 focus-labels (punk: icons.ts:137 putTag) | 17a, 4b (focus map); 16a (the « version atténuée ») | `?cam=n1879237466#18/48.896425/2.239968`, phone: the handle twice | `map-focus` | yes |
| `map-list` | Punk: « Liste des caméras » from the ticket: the cameras in view that the filters keep, nearest the map's centre first, each a button (its sticker, its line « Type · exploitant », its distance) opening its sheet; « N caméras dans la vue (filtres compris) »; a paper panel under the ticket, closed by its × or Escape; the machine closes when it opens and the reverse | machine.ts:837 CameraList, 914 show, 935 render; main.ts:258 listedCameras | IMPROVISED (17a draws the link « Liste des caméras → », not the list) | `#17.4/48.8963/2.2382`, « Liste des caméras » | — | no: hidden until further notice (DECISIONS 2026-10-08, « Punk, until further notice… »), its code kept |
| `map-list-zoom` | Punk: the list below the street level, where no camera is loaded: « Zoomez au niveau de la rue pour lister les caméras de la vue. » and « Zoomer ici » (to z16) | machine.ts:935 render; main.ts:241 | IMPROVISED | `#13.2/48.8965/2.2385`, « Liste des caméras » | — | no: hidden until further notice (DECISIONS 2026-10-08, « Punk, until further notice… »), its code kept |
| `map-list-more` | Punk: more than 60 cameras in view: the 60 nearest, then « … et N autres : zoomez pour les voir. » | machine.ts:935 render (MAX) | IMPROVISED | `#15.2/48.8963/2.2382`, « Liste des caméras », scrolled to its end | — | no: hidden until further notice (DECISIONS 2026-10-08, « Punk, until further notice… »), its code kept |
| `map-add-enabled` | From z17 (punk: from z15): « ＋ Ajouter » enabled | participate/index.ts:146 | 1a, 20a | `#17.6/48.8981364/2.2403746` | `map-add-enabled` | yes |
| `button-estimate-rest` | Punk: 17a's round pastilles « Standard » and « Prudent », 76 px (64 on a phone; on one narrower than 375 px stacked at the top right, Standard above Prudent, lot M): the chosen one pink with a ✓ above its name, a solid ink edge and an ink offset, tilted -8°; the other paper, its edge dashed, smaller (×0.86) and tilted 3°; not by colour alone (✓, edge); straight and full size under reduced motion; the pastilles change state in place, so that 17a's spring plays between them | theme/punk/map.css:312, 334, 357; filters.ts:750 renderEstimateBar; machine.ts:821 estimateBar | 17a, 20a (the round Standard / Prudent pastilles) | `#16.5/48.8963/2.2382` | `map-z16-street` (punk) | yes, without a capture of its own: `map-z16-street`'s screen |
| `button-estimate-hover` | Punk, wide screen: the mouse over « Prudent »: ×1.06 and tilted 8°, its colours unchanged (a hover never selects); the pressed « Standard » would grow keeping the tilt it rests at (-8°); no hover on a phone | theme/punk/buttons.css:104-109 (toggle); theme/punk/map.css:357 | 17a (the pastilles' hover) | `#16.5/48.8963/2.2382`, the mouse over « Prudent » | `button-estimate-hover` (desktop) (punk) | yes |
| `button-estimate-focus` | Punk: the keyboard on the estimate bar: a 3 px dashed outline 3 px off the pastille (ink in light, yellow in dark), whole, the bar no longer clipping it | theme/punk/base.css:11; theme/punk/map.css:6 | 7b (the accessible sheet's dashed focus) | `#16.5/48.8963/2.2382`, Tab (Option+Tab in WebKit) to it | `button-estimate-focus` (punk) | yes |
| `button-fab-rest` | Punk: 20a's floating buttons at rest: « ＋ Ajouter » yellow with an ink edge, tilted 2° (greyed below z15: `button-fab-disabled`), « Me localiser » on the second accent's fill (the ink with light-blue text in light, the light blue with ink text in dark) on a hard offset shadow (pink in light, light blue in dark), tilted -1.5°; MapLibre's zoom buttons the same fill, 44 px squares, tilted; the queue counter as lot 3.0 drew it, 44 px high | style.css:194; theme/punk/map.css:398, 414, 453; theme/punk/buttons.css:149 | 20a (the floating buttons and the zoom buttons at rest); 1a | `#16.5/48.8963/2.2382` | `map-z16-street` (punk) | yes, without a capture of its own: `map-z16-street`'s screen |
| `button-fab-focus` | Punk: the keyboard on « Me localiser »: the dashed outline around it | theme/punk/base.css:11 | 7b | `#16.5/48.8963/2.2382`, Tab (Option+Tab in WebKit) to « Me localiser » | `button-fab-focus` (punk) | yes |
| `map-maybe-gone-badge` | A camera flagged maybe gone (fixme): a grey badge at the pictogram's top right; in punk 20a's « peut-être disparue » without its hatching: a dashed ring (ink in light, cream in dark) around the full sticker, edged with the map's paper, and a « ? » on a disc hooked at its top right (the mockup's yellow on ink in light; ink on cream in dark, the yellow on cream being 1.2:1) | layers.ts:159 MAYBE_GONE, 707 camera-gone; stickers.ts:532 maybeGone | 20a (a hatched dashed ring with « ? »; the hatching dropped: DECISIONS 2026-10-06, « Hatching keeps one meaning… ») | — | — | no: no CI camera has fixme « plus présente » (IDF: n12657479946); needs one in `ci.osm.pbf` |

### Filters and legend

On a phone the legend is folded until « Légende » is tapped (`filters-legend`): the phone
captures of the other rows show the panel without it. In punk the panel is the machine of
20a (wide screen) and 18a (phone), closed until the ticket's « Filtres et légende » opens it
on either screen; the legend is printed on the ticket by « Légende ↑ »
(`filters-ticket-legend`), and the captures of the other rows show the machine open without
it.

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `filters-z7` | Département zoom: classes « Jusqu'à … % des rues, par département », « Aucune caméra recensée », quantiles note; « Qui filme » as two radios with « ≈ » counts; advanced counts « — », « Zoomez au niveau de la rue… »; punk: the machine: the counter « N caméras dans la vue · ≈ : par commune », « Qui filme » as two keys « Toutes » / « Publiques seules » with « ≈ » counts, « Types et état de la fiche : au zoom de la rue. », « Plus de filtres » (counts « — »), the notes; the classes printed by « Légende ↑ » (`filters-ticket-legend-areas`) | filters.ts:613 areaScale, 447 render (radios), 501, 583; punk filters.ts:786 machineView, machine.ts:604 render | partly 1a (its five-class legend strip); the panel at this zoom IMPROVISED | `#7.60/48.89/2.23`, phone: « Filtres » | `filters-z7` | yes |
| `filters-z10` | Commune zoom: the same, by commune; punk: the machine as at `filters-z7`, by commune | the same | partly 1a; the panel IMPROVISED | `#10.30/48.895/2.23` | `filters-z10` | yes |
| `filters-z13` | z12.5 – 14: street levels, « Seul ce qui est filmé est coloré », the proposals' dot row (from z13), radios; punk: the machine's two keys; the street lines in the ticket's legend | filters.ts:631 streetScale, 690 proposalRows | partly 20a (street legend); radios at this zoom IMPROVISED | `#13.2/48.8965/2.2385` | `filters-z13` | yes |
| `filters-z14` | z14 – 15: « Non filmé » added; punk: in the ticket's legend, « rue non filmée » | filters.ts:637 | partly 20a; the panel at this zoom IMPROVISED | `#14.50/48.8977/2.2377` | `filters-z14` | yes |
| `filters-z13-active` | Filters below z15 (z14 until 2026-10-17): « Tronçons concernés : comptés à partir du zoom rue (15) », « …les filtres combinés sont approximatifs… », « La recherche par exploitant… (15) »; punk: the same notes at the machine's foot, « Plus de filtres (3) », « Filtres et légende (3) » | filters.ts:502-514 | IMPROVISED | `?f=fresh_never,direction_unknown&op=Courbevoie#13.2/48.8965/2.2385` | `filters-z13-active` | yes |
| `filters-street-active` | Punk, below the street level with a filter set in the street view (here an operator search): the machine's first line « 1 filtre actif en vue rue · Tout réafficher », at every zoom while such filters are on (all but « Publiques seules », which every zoom shows); « Filtres et légende (1) » | filters.ts streetActiveCount; machine.ts render, resetLink; theme/punk/machine.css .street-active | IMPROVISED (DECISIONS 2026-10-09; 20a and 18a draw no such line) | `?op=zzz#13.2/48.8963/2.2382`, « Filtres et légende » | `filters-street-active` (punk) | yes |
| `filters-operator-none` | An operator search with no match: count 0, « Aucun tronçon concerné dans la vue », « Filtres avancés (1 actifs) » (the plural kept for one: `adv.title_n`); punk: « Plus de filtres (1) », « Filtres et légende (1) » | filters.ts:536 advancedDrawer, 506 | IMPROVISED | `?op=zzz#16.5/48.8963/2.2382` | `filters-operator-none` | yes |
| `button-panel-hover` | Punk, wide screen: the mouse over the machine's ×: ×1.1 and tilted -12° (the close norm, as the sheet's); no hover on a phone | theme/punk/buttons.css:116 (close) | partly 17a (the ×'s hover on the sheet); on the machine IMPROVISED | `#16.5/48.8963/2.2382`, « Filtres et légende », the mouse over the machine's × | `button-panel-hover` (desktop) (punk) | yes |
| `button-panel-press` | Punk, wide screen: the mouse button held on « Tout réafficher » with a filter on: it sinks 3 px down and right; nothing is reset until it is released | theme/punk/buttons.css:136 | IMPROVISED (17a draws no press; the 3 px sink is the mockup's press() of 20a's filter keys) | `?f=fresh_never#16.5/48.8963/2.2382`, « Filtres et légende », the mouse held on « Tout réafficher » | `button-panel-press` (desktop) (punk); phone: not captured (pointer state: a touch cannot be held, Playwright's touchscreen only taps) | yes |
| `filters-z16` | Street zoom: level samples, hatching, maybe gone, verified gone, proposals; « Qui filme » and « Type de caméra » checkboxes with counts, rows absent from the view omitted; drawer closed. Punk: 20a's machine (18a's on a phone, across the width under the ticket's title, the pastilles gone meanwhile) risen in 300 ms under the ticket's title, usable from its first frame: the cut-out title « FILTRES », « Légende ↑ », the counter's drums « 90 caméras affichées sur 90 dans la vue » and « Tout réafficher » (the mushroom, inert until a filter is on), « Qui filme » as four keys with their counts (pressed: pink with a ✓), « Type de caméra » as round stickers with yellow count labels (types absent from the view omitted), « État de la fiche » (« Peut-être disparue », « Correction en attente »), « Plus de filtres »; the case, its handle, tray, crank and screws a decoration | filters.ts:642 levelScale, 464-500, 672; icons.ts:127 cameraCanvas; punk machine.ts:282 buildMachine, 604 render, 694 drumsTo; theme/punk/machine.css | 20a (desktop), 18a (phone), 16a (the stickers); the machine's 1.7 s opening shortened (DECISIONS 2026-10-06, « Animations: at most 400 ms… ») | `#16.5/48.8963/2.2382`, phone: « Filtres » | `filters-z16` | yes |
| `filters-ticket-legend` | Punk: « Légende ↑ » pressed: the ticket prints the legend, « Rue filmée, la caméra peut… (hypothèse Standard, tournée vers vous) », the three levels named, below z15 each with 20a's swatch in its street colour, from z15 with its field's sample alone (halftone and outline as the map draws them; 2026-10-08, « One palette… »), « rue non filmée », « champ de vision : identifier au centre, détecter au bord », « peut-être disparue », « disparue (vérifiée) », « correction en attente », « position proposée », « Calcul ? » (the three names each as wide as itself, the free width between them: at 272 px « reconnaître » and « détecter » 20 px apart, 2026-10-08); the machine slides under the whole ticket, its key reads « Ranger ↓ »; on a phone the ticket takes the pastilles' place | machine.ts:714 renderLegend, 577 setLegend, 214 place; stickers.ts fieldSample | 20a, 18a (« Légende ↑ » prints the ticket); the level samples (DECISIONS 2026-10-08, « One palette… »), « disparue (vérifiée) » and « position proposée » IMPROVISED | `#16.5/48.8963/2.2382`, « Filtres et légende », « Légende ↑ » | `filters-ticket-legend` (punk) | yes |
| `filters-ticket-legend-areas` | Punk, commune zoom, the legend printed: « Jusqu'à … % des rues, par commune », the five classes with their swatches, « Aucune caméra recensée » | machine.ts:714 renderLegend (areas) | IMPROVISED (20a prints the street legend only; the classes as 1a's strip) | `#10.30/48.895/2.23`, « Filtres et légende », « Légende ↑ » | `filters-ticket-legend-areas` (punk) | yes |
| `filters-legend-calc` | Punk: « Calcul ? » under the ticket's title, open: what the chosen hypothesis means and the levels' norm (IEC 62676-4) | machine.ts:226 buildTicket (calc), 714 renderLegend | partly 20a (« Calcul ? » is a link to nothing there); its text IMPROVISED | as `filters-ticket-legend`, then « Calcul ? » | `filters-legend-calc` (punk) | yes |
| `filters-state-hidden` | Punk « État de la fiche »: « Correction en attente » released: the cameras with a pending move or « introuvable » hidden with their fields, their tape, the ghosts and dotted links; « Filtres et légende (1) » | filters.ts:229 toggleState, 266 findPending; filters.ts apply (proposal layers' visibility) | 20a (« appuyer masque ou réaffiche ces caméras ») | seed full, `#17.4/48.8962/2.238`, « Filtres et légende », « Correction en attente » | `filters-state-hidden` (punk) | yes |
| `filters-reset` | Punk « Tout réafficher » with a filter on: every filter off at once, the keys pressed again; « BOUM ! » played once over the button (1.2 s, a decoration that blocks nothing; none under reduced motion), caught 250 ms in | machine.ts:590 boom; filters.ts:248 reset | 20a (its reset, taken from 18a) | `?f=fresh_never#16.5/48.8963/2.2382`, « Filtres et légende », « Tout réafficher » | `filters-reset` (punk) | yes |
| `filters-advanced` | Drawer open: À jour ? / Complète ? / Qui exactement ? (search) / Que peut-elle faire ? (rows absent from the view hidden); punk: « Plus de filtres » open: 20a's groups of chips with yellow count labels (« Vérifiée il y a… », « Il manque… », « Elle peut… », « À vérifier »), « Exploitant précis » and its search box, « Les % des communes ne suivent que « Qui filme ». » | filters.ts:524 advancedDrawer; punk machine.ts:512 buildDrawer | 20a (« Plus de filtres » drawer) | z16, « Filtres avancés » | `filters-advanced` | yes |
| `filters-advanced-active` | Two rows on: the drawer opens by itself, « Filtres avancés (2 actifs) », « Filtres (2) », « N tronçons concernés dans la vue »; punk: the two chips pressed, « Plus de filtres (2) », « Filtres et légende (2) », the streets line under the counter | advanced.ts:164 fromParams; filters.ts:502 | 20a (pressed keys with ✓; the streets line is not drawn) | `?f=fresh_never,direction_unknown#16.5/48.8963/2.2382` | `filters-advanced-active` | yes |
| `filters-operator` | An operator search with matches: its count, the streets line; punk: in « Exploitant précis », its count as a yellow label | filters.ts:536-559 | 20a (« Rechercher un exploitant ») | `?op=Vinci#16.5/48.8963/2.2382` | `filters-operator` | yes |
| `filters-unchecked` | A type unchecked: its cameras and fields hidden; punk: the type's round key released (paper, no ✓) | filters.ts:479-499 | 20a (a released key) | z16, uncheck « fixe » | `filters-unchecked` | yes |
| `button-panel-rest` | Punk: the panel's own buttons at rest: the ticket's links (17a's typewriter face, a wavy pink underline, 28 px with a mouse, 44 under a finger), the machine's × (an ink square, its × in the light blue), « Légende ↑ » (a yellow key on an ink offset) | machine.ts:226 buildTicket, 282 buildMachine; theme/punk/map.css:69; theme/punk/machine.css:259, 716 | 17a (the ticket's links), 20a, 18a (the machine's × and « Légende ↑ ») | `#16.5/48.8963/2.2382`, phone: « Filtres » | `filters-z16` (punk) | yes, without a capture of its own: `filters-z16`'s screen |
| `button-panel-focus` | Punk: the keyboard on the ticket's « Filtres et légende »: the dashed outline | theme/punk/base.css:11; machine.ts:226 buildTicket | 7b | `#16.5/48.8963/2.2382`; Tab (Option+Tab in WebKit) to « Filtres et légende » | `button-panel-focus` (punk) | yes |

### Camera sheet

The sheet is 17a's on a wide screen and 4b's on a phone (lot 3.2, 1.4); a row's « punk: »
says what the sheet shows where its first words, older, describe the classique's (removed
on 2026-10-23).

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `sheet-peek` | Phone: the sheet at its lowest (handle, line, headline; punk: 4b's « réduite », the sticker, the title in letters with the operator under it, « ↑ » and ×, the three tickets and their note; the dates come when it rises, as in 4b's « étendue »); the same screen as `map-focus` on a phone | bottomsheet.ts:52 visible; chips.ts:539 punkSheet (`.sheet-top`) | IMPROVISED (4b « réduite » is our peek) | `sheet-fixed`, the handle twice | `sheet-peek` (phone) | yes |
| `sheet-half-scrolled` | Punk, phone: the sheet half open, its paper scrolled 120 px: the head alone stays, folded to one bar (lot U2: the sticker, the title on one line in plain letters cut short with « … », « ↑ » and ×, an ink rule under it), the dates, the tickets and the facts went under it; back at its start at the peek (2026-10-09, « Punk sheets on a phone… ») | chips.ts:197 pinHead; theme/punk/sheet.css (a phone) | IMPROVISED (4b draws no scrolled sheet) | `sheet-fixed`, the paper scrolled 120 px | `sheet-half-scrolled` (phone) (punk) | yes |
| `sheet-how` | « Comment c'est calculé ? » open (punk: « Calcul ? » opened under the links: certainty in 17a's language, the tickets and the two estimates, then each row's meaning with its certainty's word, aria-expanded) | sheet.ts:451 renderSheet; chips.ts:460 how | IMPROVISED (17a, 4b: the « Calcul ? » link only) | `sheet-fixed`, full, the summary (punk: « Calcul ? ») | `sheet-how` | yes |
| `sheet-share` | Wide screen: « Partager » copied the link, « Lien copié » for 3 s (punk: a link of 17a's) | sheet.ts:652 shareButton | IMPROVISED (4b: a « Partager » link) | `sheet-fixed`, Partager (clipboard allowed, no share sheet) | `sheet-share` (desktop) | yes |
| `sheet-history` | Lot U: the sheet ends with « Historique », the contributions the review accepted (validated, applied, superseded), newest first: what each changed (« Ajoutée », « Vérifiée », « Introuvable », « Position corrigée », « Forme précisée », « Direction relevée », « Hauteur précisée », « Inclinaison précisée », « Exploitant précisé »), its month and « par un contributeur ». Lot U2: two lines an entry at most, even 320 px wide, « Position corrigée · octobre 2026 » then, smaller, « par un contributeur » on one line (a long pseudonym cut short with « … »); under the « Supposé » box's ink tile, no tag nor dotted leader. Asked at each opening (GET /api/history, no-store), never awaited: it comes in last in the body, under every button and link; nothing at all when the list is empty or the API unreachable | history.ts historySlot, section; historytext.ts; sheet.ts renderSheet (`history`); chips.ts punkSheet (`parts.history`); main.ts historyOf | IMPROVISED (no board draws a camera's history; 17a's rows and its box's title tile) | n1925180682 (cara's move, validated), seed full, the sheet full, the section in view | `sheet-history` | yes |
| `sheet-history-signed` | The same once its author chose « Afficher mon pseudonyme sur les caméras que j'ai relevées »: « par cara » (punk « PAR CARA »), at the next opening of the sheet; taken back, « par un contributeur » again | history.ts; pipeline/lacarte/api/app.py camera_history (HISTORY_WHO) | IMPROVISED | as `sheet-history`, cara's choice on (PUT /api/me/history-pseudonym) | `sheet-history-signed` | yes |
| `sheet-history-osm` | A contribution published on OpenStreetMap's live server: « Son historique sur OpenStreetMap ↗ » under the history (punk: a link of 17a's), to the node's history there; never a test server's object | history.ts outLink; historytext.ts osmLinks, parseHistory (OSM_LIVE) | IMPROVISED | route: GET /api/history with a live publication (bench/smoke-profile.mjs, the dome n998633844 opened from « Mes caméras ») | — | yes, route: no live publication on the CI data |
| `sheet-household` | « Caméra fixe · de particulier » (a validated answer; punk: the title « Caméra fixe de particulier », the Statut row tagged « réponse · 10/26 », « ~UN PARTICULIER ») | sheet.ts:79 headLine, 211 chips; chips.ts:285 shortTitle, 300 rows | IMPROVISED | n1864927349 (fixture k3), `#18/48.897241/2.239254` | `sheet-household` | yes |
| `sheet-no-field` | A field under 10 m² or drawn inside a building (tiles `pv`): « Position ou direction à vérifier », no ruler, the OSM edit link under the headline, « Déplacer » first and filled, chip « À vérifier : champ dessiné presque nul » (punk: no tickets, the yellow band « Position ou direction à vérifier : champ dessiné presque nul », « Corriger sur OpenStreetMap ↗ », « Modifier » pink (`primary`, as « Déplacer » was before lot 3.4) first in the buttons' line, then « Toujours là ? ») | sheet.ts:451 renderSheet; chips.ts:539 punkSheet (band); participate/index.ts actions | IMPROVISED | n1925222794, `#18/48.8960185/2.23791` | `sheet-no-field` | yes |
| `sheet-private-indoor` | « Caméra fixe · privée (intérieur) »: an indoor camera has no field at all, so the headline reads « Position ou direction à vérifier » with the OSM edit link, while nothing is to check (no chip says why; « Déplacer » not first): the no-field branch does not tell an indoor camera apart (punk: the same band, without its reason; Statut « ~PRIVÉ (INTÉRIEUR) ») | sheet.ts:451 renderSheet (noField) | IMPROVISED | n2001235418 (also n2001231961), `#18/48.896392/2.238238` | `sheet-private-indoor` | yes |
| `sheet-too-high` | Height and tilt known (OSM height 6 m, camera:angle 45): « Filme, mais trop haute ou trop inclinée pour identifier (~X en prudent) » (punk: the identify ticket « — », « reconnaît » on pink, the note « trop haute ou trop inclinée pour identifier · Prudent : ~10 · ~13 · ~37 m », the sentence the tickets' name; in a preview build the CNIL box below the chips too, as in `sheet-cnil`) | sheet.ts:160 headline; chips.ts:370 tickets | IMPROVISED (no tilt in the mockup) | n1925222792, `#18/48.895987/2.237501` | `sheet-too-high` | yes |
| `sheet-too-high-prudent` | The same under Prudent: « Peut identifier jusqu'à ~X (en standard, trop haute ou trop inclinée pour identifier) » (punk: the Prudent tickets, the note « Standard : — · ~9,2 · ~19 m »; in a preview build the CNIL box below the chips too, as in `sheet-cnil`) | sheet.ts:160 headline; chips.ts:370 tickets | IMPROVISED | n1925222792 with `&est=prudent` | `sheet-too-high-prudent` | yes |
| `sheet-height-tilt-answered` | Height and tilt from validated answers: « Hauteur : 1er étage (≈ 4 m) (punk, the editor's metres since the lot of 2026-10-12: « ~4 m »), d'après une réponse sur place (octobre 2026) », « Inclinaison : un peu vers le bas, d'après une réponse (octobre 2026) », « Vérifiée sur place (octobre 2026) » (the on-site answer); the note under the links still says « Aucune date de vérification ; dernière modification OpenStreetMap le … » (sheet.ts reads OpenStreetMap's survey date only). Punk: Hauteur tagged « sur place · 10/26 », « ~1ER ÉTAGE (≈ 5 M) », Inclinaison « réponse · 10/26 », the dates line « Vérifiée sur place : octobre 2026 · Modif. OSM : juillet 2024 » (no stamp since 2026-10-08): no contradiction | sheet.ts:211 chips; chips.ts:342 dates | IMPROVISED (17a: « Hauteur ~3 m », no tilt) | n12035135119 (fixture l1 – l4), `#18/48.897946/2.233871` | `sheet-height-tilt-answered` | yes |
| `sheet-gone` | Verified gone: grey pictogram (punk: the gone sticker), « Disparue : introuvable sur place (septembre 2026) », the OSM link, no ruler, chip « Disparue » (punk: no tickets, the stamp « Disparue / introuvable sur place · septembre 2026 » in their place, « Corriger sur OpenStreetMap ↗ », no « Vérifié » stamp) | sheet.ts:451 renderSheet; chips.ts:539 punkSheet (stamp) | IMPROVISED (20a: a filter « disparue » only; the stamp is 17a's « Toujours là ») | `?cam=n1923568277&f=gone` (fixture d2) | `sheet-gone` | yes |
| `sheet-position-corrected` | A validated move made on site: « Position : corrigée sur place (septembre 2026) », « Vérifiée sur place (septembre 2026) » (punk: the Position row tagged « sur place · 09/26 », « CORRIGÉE », the dates line, no stamp) | sheet.ts:211 chips; chips.ts:300 rows | IMPROVISED (3a, 4a draw the correction form, not its result) | n1925222790 (fixture a1), `#18/48.896031/2.237693` | `sheet-position-corrected` | yes |
| `sheet-position-corrected-off` | The same not on site: « corrigée (septembre 2026) », « Vérifiée (septembre 2026) » (punk: tagged « contribution · 09/26 », « Vérifiée : septembre 2026 ») | sheet.ts:211 chips | IMPROVISED | n1923568246 (fixture b1, b2) | `sheet-position-corrected-off` | yes |
| `sheet-verified-off` | Seen by a validated « Elle est là » not made on site: « Vérifiée (octobre 2026) » (punk: the dates line « Vérifiée : octobre 2026 », no stamp) | sheet.ts:211 chips; chips.ts:342 dates | IMPROVISED (17a has « sur place » only) | n1925180657 (fixture c1, c2) | `sheet-verified-off` | yes |
| `sheet-never-verified` | No check date: « Jamais vérifiée », and « Aucune date de vérification ; dernière modification OpenStreetMap le … » (punk: the dates line « Jamais vérifiée · Modif. OSM : <mois> », by the month, no stamp) | sheet.ts:425 freshness, 451; chips.ts:342 dates | IMPROVISED (17a always has dates) | n1835838252, `#18/48.896952/2.239633` | `sheet-never-verified` | yes |
| `sheet-added` | An add a build applied, made on site: « ? » pictogram (punk: the unknown sticker), « Position : ajoutée sur place (octobre 2026) » (punk: the Position row tagged « sur place · 10/26 », « AJOUTÉE »), no OSM link | sheet.ts:211 chips, 451; chips.ts:300 rows | IMPROVISED | cadd000010000 (fixture add00001) | `sheet-added` | yes |
| `sheet-added-answered` | An applied add with its answers (shape, direction, who films), not on site (punk: tagged « contribution » and « réponse », each « · 10/26 »; its own add is its only sighting: no « Vérifiée », no stamp) | sheet.ts:211 chips; chips.ts:342 dates | IMPROVISED | cadd000020000 (fixture add00002, a2…21 – 23) | `sheet-added-answered` | yes |
| `sheet-reviewer-conflict` | The review account: « 1 contribution en conflit avec OpenStreetMap sur cette caméra », « Voir dans la revue » (punk: a yellow band under the tickets) | participate/index.ts:439 renderConflicts | IMPROVISED | seed full, who=rev, n1891366478 (fixture e1, settled in conflict) | `sheet-reviewer-conflict` | yes |
| `sheet-multidome` | A multi-dome's sheet (DECISIONS 2026-10-23): its sticker (three domes under one housing), the title « Caméra multi-boules … » in letters, smaller on a phone; « Boules · 3 boules » (its source: OSM's camera:count, or the answer and its month; « inconnu » in the « Supposé » box when no one gave it); « Direction · toutes (plusieurs boules) » whatever OSM's direction (the field is the full circle); « Angle de champ · N° par boule, 360° en tout » | sheet.ts chips (`multi`, `around`); chips.ts rows (`domes`); stickers.ts STICKERS.multidome | IMPROVISED (no board draws a multi-dome; 17a's rows) | the public dome n5442645358, its tile read as a multi-dome by the bench (`k` multidome, `dn` 3, `dnc` 1, `km` 2026-10: the CI extract has none) | `sheet-multidome` | yes, its attributes injected |
| `chip-answer` | Punk: the « réponse · 10/26 » tag (on pale pink, wine in dark), a validated « Compléter » answer made elsewhere: on n12035135119 « Type », « Direction » and « Inclinaison », their values without the source and the month the tag says, « ~ » before them (estimated) | chips.ts:88 factRow; theme/punk/chips.css (`.chip-tag.answer`) | IMPROVISED (17a tags « OSM » and « sur place » only) | n12035135119 (fixture l1 – l4), full, rows | `sheet-height-tilt-answered` (punk) | yes, without a capture of its own: `sheet-height-tilt-answered`'s screen |
| `chip-contribution` | Punk: the « contribution · 10/26 » tag (as « réponse »), another validated contribution made elsewhere: the Position row « AJOUTÉE » (cadd000020000) | the same | IMPROVISED | cadd000020000 (fixture add00002), full, rows | `sheet-added-answered` (punk) | yes, without a capture of its own: `sheet-added-answered`'s screen |
| `chip-no-certainty` | Punk: what has a source but no certainty: the dates line (« Vérifiée (OSM) : <mois> », OpenStreetMap's check date) and the no-field band (« champ dessiné presque nul », computed, neither tag nor certainty); beside them « Type », « Direction », « Hauteur », « Inclinaison » tagged « OSM », « ~ » (estimated), and « Angle de champ », « Vision de nuit » in the box « Supposé d'après le type », no « ? » (default, never asked) | chips.ts:342 dates, 539 punkSheet (band) | IMPROVISED (17a draws the check date as a stamp) | n1932117216, `#18/48.896421/2.239843`, full, rows | `chip-no-certainty` (punk) | yes |
| `chip-wrap` | Punk: a long value wraps on its own lines, its label kept on one, the leader shrinking between them: « ~1ER ÉTAGE (≈ 5 M) » on a phone | theme/punk/chips.css (`.fact dd`) | IMPROVISED (17a's values are short) | n12035135119, full, rows | `sheet-height-tilt-answered` (punk) | yes, without a capture of its own: `sheet-height-tilt-answered`'s screen |
| `button-sheet-hover` | Punk, wide screen: the mouse over « Toujours là ? »: it lifts 2 px and tilts +2°, the second of its line after « Modifier » (« Modifier » -2°: the participation's norm); the links (« Partager », « OpenStreetMap », « Calcul ? », « Revenir à la caméra ») never move, as 17a's; no hover on a phone | theme/punk/buttons.css (lift; links) | 17a (« Compléter » / « Toujours là ? »'s lift) | `?cam=n1879237466#18/48.896425/2.239968`, the mouse over « Toujours là ? » | `button-sheet-hover` (desktop) (punk) | yes |
| `button-sheet-press` | Punk, wide screen: the mouse button held on « Toujours là ? »: 3 px down and right in place of the hover's lift; its question opens only on release | theme/punk/buttons.css (press) | IMPROVISED (17a draws no press; the 3 px sink is the mockup's press() of 20a's filter keys) | as `button-sheet-hover`, the mouse held | `button-sheet-press` (desktop) (punk); phone: not captured (pointer state: a touch cannot be held, Playwright's touchscreen only taps) | yes |
| `button-close-press` | Punk, wide screen: the mouse button held on the sheet's ×: 3 px down and right, its hover's ×1.1 and -12° kept; the sheet closes only on release | theme/punk/buttons.css:136 | IMPROVISED (17a draws no press; the 3 px sink is the mockup's press() of 20a's filter keys) | `?cam=n1879237466#18/48.896425/2.239968`, the mouse held on the × | `button-close-press` (desktop) (punk); phone: not captured (pointer state: a touch cannot be held, Playwright's touchscreen only taps) | yes |
| `sheet-ptz` | Motorised, its sticker (a globe under a rod) on the map and in the sheet: « Direction : toutes (motorisée) », « ~58° grand angle, orientable sur 360° », « Zoom : orientable jusqu'à ~300 m », no direction question (punk: Direction « ~TOUTES (MOTORISÉE) »; Angle de champ and Zoom in the box) | sheet.ts:211 chips | IMPROVISED (16a: its sticker only) | — | — | no: no PTZ in the CI extract (IDF n6229035257); a validated shape « ptz » in `contrib-ci.jsonl` (on n9622344411, say) would make one |
| `sheet-panorama` | A panoramic camera's sheet, its sticker on the map and in the sheet (punk: the title « Caméra panoramique … », smaller letters on a phone) | sheet.ts:79 headLine | IMPROVISED (16a sticker) | — | — | no: none in CI; a validated shape « multi » in `contrib-ci.jsonl` would make one |
| `sheet-alpr` | « Lecteur de plaques · … », its sticker on the map and in the sheet | sheet.ts:79 headLine | IMPROVISED (16a sticker) | — | — | no: no plate reader in CI (IDF n14140601101); needs one in `ci.osm.pbf` |
| `sheet-doorbell` | « Sonnette connectée · … », its sticker on the map and in the sheet | sheet.ts:79 headLine | IMPROVISED (16a sticker) | — | — | no: no doorbell in CI; needs one in `ci.osm.pbf` |
| `sheet-maybe-gone` | Chip « À vérifier : Signalée comme peut-être disparue » (punk: a yellow band with its « OSM » tag, first in the body) | sheet.ts:211 chips; chips.ts:539 punkSheet | IMPROVISED (20a: the map marker only) | — | — | no: no fixme in CI (IDF n12657479946) |
| `sheet-legacy-import` | Chip « Issue d'un ancien import, jamais revérifiée » (punk: a band as `sheet-maybe-gone`) | sheet.ts:211 chips | IMPROVISED | — | — | no: needs a camera with source sous-surveillance and no check date after 2012 in `ci.osm.pbf` |
| `sheet-gone-off` | « Disparue : introuvable (mois) », not on site (punk: the stamp « Disparue / introuvable · <mois> ») | sheet.ts:451 renderSheet; chips.ts:539 | IMPROVISED | — | — | no: the fixture's « introuvable » (d2) is on site; needs one without `on_site` in `contrib-ci.jsonl` |
| `sheet-detect-only` | « N'identifie probablement pas ; détecte jusqu'à ~X » (punk: the tickets « — », « — », « X m », the last on pink) | sheet.ts:160 headline | IMPROVISED | — | — | no: every CI camera without an identification band has a known mount |
| `sheet-high-only` | « Ne peut identifier qu'en prudent : jusqu'à ~X » | sheet.ts:160 headline | IMPROVISED | — | — | no: same reason |
| `sheet-too-high-both` | « Filme, mais trop haute ou trop inclinée pour identifier », nothing in Prudent either | sheet.ts:160 headline | IMPROVISED | — | — | no: no CI camera lacks identification in both estimates |
| `chip-pending` | Punk: the « en attente de revue » tag, on the proposals' blue | chips.ts:23 Source; theme/punk/chips.css (`.chip-tag.pending`) | IMPROVISED | — | — | no: no code path sets it (sheet.ts tags a value only from a validated contribution, `via`, or from its certainty); bench/smoke-chips.mjs draws it |
| `sheet-fixed` | Half (phone) or panel: line, headline (Standard first), « Toujours là ? / Déplacer / Compléter », « Vos contributions », ruler, chips with their certainty (here ◐ and ○), « Vérifiée il y a 4 ans », how, Partager, OSM links. Punk (17a, 4b): the title « Caméra fixe publique » in letters, the dates line, the tickets « ~5,5 m identifie / ~11 m reconnaît / ~55 m détecte » and « Prudent : ~13 · ~25 · ~126 m », the stamp « Vérifié ✓ 07/22 », the rows tagged « OSM » with « ~ », the box « Supposé d'après le type » (Angle de champ, Vision de nuit: never asked, no « ? »), « Modifier » without its « ? » (nothing it asks is assumed) and « Toujours là ? », the links | sheet.ts:451 renderSheet; chips.ts:539 punkSheet; participate/index.ts:382 actions | 17a (desktop), 4b (phone) | `?cam=n1879237466#18/48.896425/2.239968` | `sheet-fixed` | yes |
| `sheet-prudent` | « Prudent » chosen: the headline turned round, « … (~X en standard) » (punk: the Prudent tickets, the note « Standard : … ») | sheet.ts:160 headline; chips.ts:370 tickets | 17a (Prudent pastille) | the same with `&est=prudent` | `sheet-prudent` | yes |
| `sheet-full` | Phone: the whole sheet (punk: 4b's « étendue », the buttons in the body's flow) | bottomsheet.ts:99 step | 4b (étendue) | `sheet-fixed`, the handle | `sheet-full` (phone) | yes |
| `sheet-no-direction` | Dome without a surveyed direction: « Peut identifier jusqu'à ~X si elle est tournée vers vous (~Y en prudent) », a full hatched disc (punk: the note « Prudent : … » under the tickets, without « si elle est tournée vers vous » since 2026-10-11, as 4b; on the map a full disc drawn like every other field, no hatching) | sheet.ts:160 headline; chips.ts:370 tickets; filters.ts:100 withoutDirection | 2b, 4b (« tournée vers vous » as a note; not in 17a); the mockup's dots: nothing (DECISIONS 2026-10-08) | n5442645358, `#18/48.898154/2.237327` | `sheet-no-direction` | yes |
| `sheet-no-direction-prudent` | The same under Prudent | sheet.ts:160 headline | as above | with `&est=prudent` | `sheet-no-direction-prudent` | yes |
| `sheet-no-direction-chips` | Its chips: « Direction : non relevée » ○, « Angle de champ : 360° (direction non relevée) », « Hauteur : 5 m » ○ (punk: the « Supposé · à compléter » box, « Direction » and « Hauteur » with their « ? » (« Modifier » asks a dome's height), « Angle de champ » « 360° » and « Vision de nuit » without: never asked) | sheet.ts:211 chips; chips.ts punkSheet; participate/questions.ts editorAnswerable | 17a (box « Supposé · à compléter ») | n5442645358, full, rows | `sheet-no-direction-chips` | yes |
| `sheet-unknown` | Type and operator unknown: « ? » pictogram (punk: the unknown sticker, a star with a big « ? »), « Caméra de type inconnu · d'exploitant inconnu », « Type : inconnu » ○ (punk: the title « Caméra » in letters, Type and Statut « INCONNU » in the « Supposé · à compléter » box with their « ? », Direction and Hauteur too, Angle de champ and Vision de nuit without) | sheet.ts:79 headLine, 211 chips; chips.ts:285 shortTitle | 17a (« ? » values, « Compléter » with its « ? »), 16a (unknown sticker) | n9622344410, `#18/48.897761/2.239971` | `sheet-unknown` | yes |
| `sheet-height-default` | Height by default (○; punk: in the box, « 4 M ? »); a validated tilt without height is not shown | sheet.ts:211 chips | 17a (« Hauteur ~3 m » in the « Supposé » box) | n13610509865 (fixture l6, l7), `#18/48.900309/2.241589` | `sheet-height-default` | yes |
| `sheet-level-chosen` | Punk: « reconnaît » chosen among the tickets (a radiogroup « Niveau montré sur la carte », one tab stop, the arrows among the levels reached, a tap, Enter or the space bar): its ticket pink, lifted, with 17a's round ✓; on the map the camera's recognise field alone (its pattern, its dashed outline) and its label « reconnaissance 11 m » | chips.ts tickets; filters.ts setLevel; layers.ts focus-field, bands-fan | 17a (the tickets a choice with a ✓; DECISIONS 2026-10-08, « Punk focus… ») | n998633844, `#18/48.897281/2.238583`, « reconnaît » | `sheet-level-chosen` (punk) | yes |
| `sheet-direction-answered` | Direction from a validated answer: « au sud, d'après une réponse (octobre 2026) » (punk: tagged « réponse · 10/26 », « ~AU SUD »; the 17a twin: a public dome, « Ville de Courbevoie », verified) | sheet.ts:211 chips | 17a (a source tag per value) | n998633844 (fixture k2) | `sheet-direction-answered` | yes |
| `sheet-operator-answered` | Who films from a validated answer: « Qui filme : public, d'après une réponse (octobre 2026) » (punk: the Statut row tagged « réponse · 10/26 », « ~PUBLIC ») | sheet.ts:211 chips; chips.ts:300 rows | 17a (the Statut row with its source) | n9622344411 (fixture k4) | `sheet-operator-answered` | yes |
| `sheet-verified-on-site` | A validated sighting made on site: « Vérifiée sur place (mois) »; the same camera and screen as `sheet-position-corrected` (also on n12035135119, `sheet-height-tilt-answered`, through its on-site answer) (punk: the dates line « Vérifiée sur place : <mois> », no stamp) | sheet.ts:211 chips; chips.ts:342 dates | 17a (« Vérifiée sur place : … » drawn unconditionally there; its « Vérifié ✓ » stamp removed, DECISIONS 2026-10-08) | n1925222790 (fixture a1) | `sheet-verified-on-site` | yes |
| `chip-osm` | Punk: the « OSM » tag on yellow, a value from OpenStreetMap's tags, alone when a category (on CI every such value is estimated): « Type OSM … FIXE » (n1925222790) | chips.ts:88 factRow; theme/punk/chips.css (`.chip-tag.osm`) | 17a (the yellow « OSM » tag) | n1925222790 (fixture a1), full, rows | `sheet-position-corrected` (punk) | yes, without a capture of its own: `sheet-position-corrected`'s screen |
| `chip-assumed` | Punk: a default value: its row in the box, no tag (the box's title says it; a contribution's tag stays), a pink « ? » when « Modifier » asks it: « Type : INCONNU ? », « Direction : NON RELEVÉE ? », « Hauteur : 4 M ? », « Angle de champ » and « Vision de nuit » without (n9622344411); the box « Supposé · à compléter » when a row has its « ? », else 4b's « Supposé d'après le type » (`sheet-fixed`) | chips.ts:70 factText, 539 punkSheet; participate/questions.ts editorAnswerable; theme/punk/sheet.css (`.sheet-assumed`) | 17a (the box, its « ? »); 4b (« Supposé d'après le type ») | n9622344411, full, rows | `sheet-operator-answered` (punk) | yes, without a capture of its own: `sheet-operator-answered`'s screen |
| `chip-on-site` | Punk: the « sur place · 09/26 » tag on pink, a validated contribution observed on site: « Position … CORRIGÉE » (n1925222790), « Hauteur » on n12035135119; the value no longer repeats « sur place » | sheet.ts:211 via; chips.ts:88 factRow | 17a (the pink « sur place · 03/26 » tag) | n1925222790 (fixture a1), n12035135119, full, rows | `sheet-position-corrected` (punk) | yes, without a capture of its own: `sheet-position-corrected`'s and `sheet-height-tilt-answered`'s screens |
| `button-close-rest` | Punk: the sheet's × at rest: an ink square with a light blue × (cream with ink in dark), tilted 6° | sheet.ts:439 topButtons; theme/punk/sheet.css (`.sheet-head .close`) | 17a | `?cam=n1879237466#18/48.896425/2.239968` | `sheet-fixed` (punk) | yes, without a capture of its own: `sheet-fixed`'s screen |
| `button-close-hover` | Punk, wide screen: the mouse over the sheet's ×: ×1.1 and tilted -12° (« Vos contributions »'s × and the participation's alike); no hover on a phone | theme/punk/buttons.css:111-114 (close) | 17a (the ×'s hover) | `?cam=n1879237466#18/48.896425/2.239968`, the mouse over the × | `button-close-hover` (desktop) (punk) | yes |
| `button-close-focus` | Punk: the keyboard on the sheet's ×: the dashed outline | theme/punk/base.css:11 | 7b | `?cam=n1879237466#18/48.896425/2.239968`, Tab (Option+Tab in WebKit) to the × | `button-close-focus` (punk) | yes |
| `button-sheet-rest` | Punk: the sheet's buttons and links at rest: « Modifier » (17a's « Compléter »: ink, its text light blue, a pink offset shadow, its « ? » while a value is assumed that it asks), « Toujours là ? » (yellow), the links with their wavy underline; « Revenir à la caméra → » a link (`map-focus-far`'s) | theme/punk/sheet.css; sheet.ts:652 shareButton | 17a | `?cam=n1879237466#18/48.896425/2.239968` | `sheet-fixed` (punk) | yes, without a capture of its own: `sheet-fixed`'s screen (« Revenir à la caméra »: `map-focus-far`'s) |
| `button-sheet-focus` | Punk: the keyboard on « Calcul ? »: the dashed outline around the link (a link's focus, 7b's) | theme/punk/base.css:11; chips.ts:460 how | 7b | `?cam=n1879237466#18/48.896425/2.239968`, full, Tab (Option+Tab in WebKit) to « Calcul ? » | `button-sheet-focus` (punk) | yes |
| `chip-identified-osm` | Punk: « OSM » with an identified value, the value alone (no « ~ »), an exact model known from OpenStreetMap's tags | chips.ts:70 factText | 17a (the « OSM » tag) | — | — | no: no CI camera has a type, direction or height certainty of 2 (`kc`, `dc`, `hc` in the CI tiles); bench/smoke-chips.mjs draws it |

### Proposals in the camera sheet

In punk (lot 3.2) the proposal block sits under the distance tickets, without a frame: its
line on 20a's yellow tape (« correction en attente »), its counts and notes on the paper, its
buttons the participation's (1.4). The words are participate/index.ts's; it dates the
proposal by its month (« déplacée de 7,2 m en octobre 2026 », « signalée
introuvable en octobre 2026 »; DECISIONS 2026-09-30, « Dates of contributions on the map
are months… »): `GET /api/proposals` gives the public `month`, never the day (DECISIONS
2026-10-13, « The public API dates a pending proposal by its month… »).

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `prop-move-mine` | One's own pending move: « Proposition en attente : déplacée de 7,2 m en octobre 2026 », « C'est votre proposition. », « Retirer ma proposition »; the proposed field drawn | participate/index.ts:239 renderProposal; proposals.ts:275 select | IMPROVISED (20a: the map's tape only) | seed full, n1925222793 (m1) | `prop-move-mine` | yes |
| `prop-move-other` | Another account: « Je confirme » / « Ce n'est pas ça » | participate/index.ts:316-323 | IMPROVISED | seed full, who=bob, m1 | `prop-move-other` | yes |
| `prop-move-reviewer` | The review account: « Valider » / « Rejeter » | participate/index.ts:306; decide.ts:70 decisionButtons | IMPROVISED | who=rev, m1 | `prop-move-reviewer` | yes |
| `prop-reviewer-armed` | « Valider : confirmer » (6 s) | decide.ts:13 twoStep | IMPROVISED | who=rev, m1, « Valider » once | `prop-reviewer-armed` | yes |
| `prop-answered-agree` | « confirmée par 1 contributeur · contestée par 1 contributeur », « Vous avez répondu : je confirme. », « Retirer mon avis » | participate/index.ts:282-292, 313 | IMPROVISED | who=bob, n1925222796 (m2) | `prop-answered-agree` | yes |
| `prop-answered-disagree` | « Vous avez répondu : ce n'est pas ça. » | the same | IMPROVISED | who=cara, m2 | `prop-answered-disagree` | yes |
| `prop-counts-mine` | The author sees the counts | participate/index.ts:282-305 | IMPROVISED | who=ana, m2 | `prop-counts-mine` | yes |
| `prop-withdraw-opinion-armed` | « Retirer mon avis : confirmer » | participate/index.ts:341 withdrawButton | IMPROVISED | who=bob, m2, once | `prop-withdraw-opinion-armed` | yes |
| `prop-not-found` | Reported not found, waiting for the review: « Proposition en attente : signalée introuvable en octobre 2026 » | participate/index.ts:265 | IMPROVISED (20a draws OSM's maybe-gone, not this) | seed full, n1988182438 (bob's) | `prop-not-found` | yes |
| `prop-validated` | « Proposition validée, pas encore appliquée à la carte : déplacée de 5,2 m en octobre 2026 »; « Je confirme » / « Ce n'est pas ça » still offered on a decided proposal (in a preview build the CNIL box below the chips too, as in `sheet-cnil`) | participate/index.ts:274 | IMPROVISED | n1925180682 (cara's move, validated) | `prop-validated` | yes |
| `prop-validated-reviewer` | The review account on a validated one: « Valider » off, « Rejeter » (in a preview build the CNIL box below the chips too, as in `sheet-cnil`) | decide.ts:81-83 | IMPROVISED | who=rev, n1925180682 | `prop-validated-reviewer` | yes |
| `prop-more` | Two proposals on one camera: « et 1 autre proposition » (in a preview build the CNIL box below the chips too, as in `sheet-cnil`) | participate/index.ts:293-298 | IMPROVISED | n2001233184 (ana's move, bob's « introuvable ») | `prop-more` | yes |
| `prop-withdraw-armed` | « Retirer ma proposition : confirmer » | participate/index.ts:341 | IMPROVISED | m1, once | `prop-withdraw-armed` | yes |
| `prop-withdraw-offline` | « Hors ligne : retrait impossible pour l'instant, réessayez avec du réseau. » | participate/index.ts:343-352 | IMPROVISED | m1, offline, twice | `prop-withdraw-offline` | yes |
| `prop-withdraw-busy` | « Trop de demandes en une minute : réessayez dans un instant. » | participate/index.ts:349-351 | IMPROVISED | m1, route withdraw → 429 | `prop-withdraw-busy` | yes |
| `prop-withdrawn` | Withdrawn: the box and the proposed field gone | participate/index.ts:329 withdraw | IMPROVISED | m1, twice (writes) | `prop-withdrawn` | yes |
| `prop-queued` | Offline, an « introuvable » still on the phone: « Votre proposition, en attente d'envoi : signalée introuvable en … » (the month of the day it was made on the phone), « Retirer ma proposition » | proposals.ts:197 queued; participate/index.ts:301 | IMPROVISED | seed empty, n1879237466, offline, « introuvable » confirmed, sheet closed and opened again | `prop-queued` | yes |
| `prop-sent` | Left the phone, no refresh of the proposals back yet: the same words and screen as pending (« prop.status.sent » is « Proposition en attente : ») | proposals.ts:231 draw | IMPROVISED | a move sent while the proposals' refresh is answered late, as for `add-pending-sent` | `prop-move-mine` (the same screen) | yes, without a capture of its own: `prop-move-mine`'s screen |

### A pending add's sheet

In punk (lot 3.2): « Caméra proposée » in cut-out letters (smaller on a phone, a word longer
than « PUBLIC »), the pale sticker before it on a phone, its status on 20a's yellow tape, then
the proposal block, its line on the paper (chips.ts punkPendingSheet), dated by the month
(« Ajoutée en octobre 2026 », « Ajoutée sur place en octobre 2026 »), since the public API
gives no day (DECISIONS 2026-10-13). Under that line punk lists the answers its field is computed from
(DECISIONS 2026-10-08; participate/index.ts addAnswers, the API's add_answers): Forme,
Direction, Hauteur (Inclinaison when one is kept), Qui filme, « pas de réponse » where none
is; and the map outlines that field in the ink, dashed (proposals.ts `proposal-field-line`),
while the sheet is open. The seed's adds carry no answer: on their captures every row says
« pas de réponse ».

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `add-pending-other` | « Caméra proposée », « En attente de validation », « Ajoutée en octobre 2026 », « Je confirme » / « Ce n'est pas ça »; its field from its answers | sheet.ts:554 renderPendingSheet; main.ts:414 openPending; participate/index.ts:209 | IMPROVISED | seed full, who=bob, `?cam=c5eed0a010000#18.5/48.8981364/2.2403746` | `add-pending-other` | yes |
| `add-pending-mine` | The author: « C'est votre proposition. », « Retirer ma proposition » | participate/index.ts:301 | IMPROVISED | who=ana, the same | `add-pending-mine` | yes |
| `add-pending-reviewer` | « Valider » / « Rejeter » | participate/index.ts:306 | IMPROVISED | who=rev | `add-pending-reviewer` | yes |
| `add-pending-on-site` | « Ajoutée sur place en octobre 2026 » | participate/index.ts:272 | IMPROVISED | who=ana, c5eed0a020000 (bob's, on site), `#18.5/48.8985/2.2385` | `add-pending-on-site` | yes |
| `add-pending-validated` | « Validée, visible à la prochaine mise à jour », « Ajoutée en octobre 2026 »; « Je confirme » / « Ce n'est pas ça » still offered on a decided add | sheet.ts:570 | IMPROVISED | c5eed0a030000 (cara's, validated), `#18.5/48.899/2.2405` | `add-pending-validated` | yes |
| `add-pending-conflict` | The review account only: « En attente de vérification », « … une caméra OpenStreetMap a été cartographiée tout près », « Voir dans la revue » | participate/index.ts:269-281 | IMPROVISED | seed full (add00003 settled: duplicate), who=rev, `?cam=cadd000030000` | `add-pending-conflict` | yes |
| `add-pending-queued` | An add sent offline, its pale pictogram tapped: « En attente d'envoi » | proposals.ts:200-205 | IMPROVISED | `add-summary`, offline, « Envoyer l'ajout » (punk: `add-sheet-filled`, offline, « Envoyer », « Terminer »), a tap on it | `add-pending-queued` | yes |

### Commune, arrondissement, département

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `area-tab-cameras` | Punk: the « 94 caméras » ticket chosen: « La liste des caméras », « direction non relevée pour 10 % » (under the label when the line is full), the cameras by type with the map's 16a sticker (redrawn on a change of mode), a dotted leader to each count — Dôme 6, Fixe 85, Type inconnu 3 —, a type without camera left out; « Types non comptés dans ces données. » on tiles built before 90e5a9a | areapunk.ts:229 cameras, 215 countRow, 373 punkAreaSheet; area.ts:58 (the sticker, icons.ts cameraCanvas) | 24a (its tab, panel and list by type); no « Ouvrir la liste complète → » (§3) | `?insee=92026`, « 94 caméras » | `area-tab-cameras` (punk) | yes |
| `area-half-scrolled` | Punk, phone: the commune sheet half open, its paper scrolled 120 px: the title alone stays, folded to one bar (lot U2), the tabs and the panel went under it (2026-10-09, « Punk sheets on a phone… ») | areapunk.ts:373 punkAreaSheet; chips.ts:197 pinHead | IMPROVISED (24a draws no phone) | `?insee=92026`, the paper scrolled 120 px | `area-half-scrolled` (phone) (punk) | yes |
| `area-how` | « Calcul ? » open under the links: « À portée », et les mètres qui « peuvent être filmés »… (a maximum), the street length, the rounding (the fraction never above Y, the percentage when it falls more than 2 points below), the cameras by type, « Qui filme ? » counts cameras and ends with the classes, the quantiles, the area's reliability, « Standard / Prudent… », the source | area.ts renderAreaSheet; areapunk.ts:327 how | IMPROVISED (24a: the « Calcul ? » link only) | `?insee=92026`, full, « Calcul ? » | `area-how` | yes |
| `area-departement` | « Hauts-de-Seine », « Département (92) »; punk: 24a's sheet, its ramp the départements' (`meta.departements`) | area.ts:43 areaLine; areapunk.ts:107 mapClass | IMPROVISED (24a draws a commune only) | `?insee=92` | `area-departement` | yes |
| `area-no-camera` | No camera, no street within reach: « Aucune rue à portée », « 0 caméra », « 0 exploitant nommé », the street empty (0 m, 100 m hors de portée), « Sur la carte : hachurée, aucune caméra recensée. » | area.ts renderAreaSheet; areapunk.ts:82 streetShare, 285 place | IMPROVISED | `?insee=92035` (La Garenne-Colombes) | `area-no-camera` | yes |
| `area-no-camera-filmed` | No camera, yet streets within reach of the next commune's: « 57 % / des rues à portée » (Y = 58,0 %: « 5 sur 10 » would fall 8 points below), 58 m « peuvent être filmés », « Aucune caméra recensée ici : ces rues sont à portée de caméras voisines. », no cursor on the ramp (the map hatches it) | area.ts renderAreaSheet; areapunk.ts:82 streetShare, 149 streets | IMPROVISED | `?insee=92050` (Nanterre) | `area-no-camera-filmed` | yes |
| `area-arrondissement` | « Arrondissement · Paris (75) » (punk: the same line under the cut-out name, ranked among the communes) | area.ts:43 areaLine | IMPROVISED | — | — | no: no municipal arrondissement in `tests/fixtures/ci-admin` (IDF `?insee=75104`) |
| `area-no-operator-info` | Cameras without a precise operator: among « Exploitant non renseigné » (or « Autres exploitants ou non renseigné ») of « Qui filme ? » | areapunk.ts:254 who | IMPROVISED | — | — | no: no CI camera's operator value says nothing (n_no_operator_info 0) |
| `area-reliability-low` | « Fiabilité moyenne » or « faible » with its reason (punk: in « Calcul ? ») | area.ts renderAreaSheet; areapunk.ts:327 how | IMPROVISED (24a drops the reliability) | — | — | no: Courbevoie and Hauts-de-Seine are « bonne » on CI |
| `area-commune` | 24a: the name in cut-out letters, its line, three tickets that are tabs — « 5 sur 10 / rues à portée » (Y = 51,4 %, rounded down), « 94 / caméras », the first operator's name (clamped to two lines) / « a le plus de caméras » — the « Rues » panel: « Sur 100 m de rue », « Toutes / Publiques », the 100 m street (51,5 m in light blue on the ink), « 51,5 m peuvent être filmés · 10,1 km » and « 48,5 m hors de portée · 9,4 km »; the map's ramp with « Courbevoie » over it and a ▾ on its class (the name never runs out of the ramp), « Sa couleur : la classe la plus filmée (plus de 51,4 % des rues à portée) »; Partager, Calcul ? | area.ts renderAreaSheet; areapunk.ts:373 punkAreaSheet, 149 streets, 285 place | 24a (dark, desktop); punk: Y only (§3) | `?insee=92026` (Courbevoie) | `area-commune` | yes |
| `area-commune-public` | The map's « Publiques seules »: the sheet opens on « Publiques »: « 47 % / des rues à portée » (Y = 47,4 %: « 4 sur 10 » would fall 7 points below), 47,5 m, the ramp on the public set's breaks | area.ts renderAreaSheet; main.ts:681; areapunk.ts:149 streets | 24a (« Toutes / Publiques ») | `?insee=92026`, Filtres, « Caméras publiques seules » | `area-commune-public` | yes |
| `area-sheet-public` | Punk: « Publiques » pressed in the sheet itself (the map's « Qui filme » unchanged): the street, its rows, the first ticket and the ramp recounted for the public cameras, the keyboard focus kept on « Publiques » | areapunk.ts:373 punkAreaSheet setPub | 24a (« Toutes / Publiques » in the « Rues » panel) | `?insee=92026`, « Publiques » | `area-sheet-public` (punk) | yes |
| `area-tab-who` | Punk: the first operator's ticket chosen: « Qui filme ? », each named operator with its count and a pink bar of its share of the cameras, then under a dashed rule « Exploitant non renseigné » (fewer than five names: every camera left has none) or « Autres exploitants ou non renseigné » (five names) in grey; then « Par catégorie d'exploitant » and every camera by class with a dotted leader — Publiques 43, Privées, extérieur 46, Privées, intérieur 2, Exploitant inconnu 3 (« Aucun exploitant renseigné. » above them when no name) | areapunk.ts:254 who | 24a (« Qui filme ? »); the classes IMPROVISED (§3) | `?insee=92026`, the operator's ticket | `area-tab-who` (punk) | yes |

### Participation: « Toujours là ? »

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `verify-question` | « Cette caméra est-elle toujours là ? »: Elle est là / Je ne la trouve pas / Je ne sais pas / Annuler, the on-site line with « Me localiser » | verify.ts:12 verifyPanel; onsite.ts:60 onSiteHelp | IMPROVISED (17a: « Toujours là ? » stamps at once) | n1879237466, « Toujours là ? » | `verify-question` | yes |
| `verify-gone` | Punk, on a camera verified gone: « Elle n'est plus là (je confirme) » (one tap: its words confirm; it says « introuvable » again) / « Elle est toujours là » / Annuler, the on-site line | verify.ts verifyPanel (`data-gone`, set by sheet.ts renderSheet) | IMPROVISED (DECISIONS 2026-10-08, « Punk, until further notice… ») | n1923568277 with `&f=gone`, « Toujours là ? » | `verify-gone` (punk) | yes |
| `verify-armed` | « J'ai bien cherché autour : confirmer » (6 s) | verify.ts:52-67 | IMPROVISED | « Je ne la trouve pas » once | `verify-armed` | yes |
| `verify-queued` | Offline: « Merci, c'est enregistré sur ce téléphone ; envoi dès que le réseau revient. », its proposal waiting; punk on site: the sheet gone, 8a's ticket « Disparue · Vérification · introuvable sur place » on the map without points (on a wide screen in the column of the camera sheet that slid away), that sentence in the badge's place, no total; punk from afar (the test's case; launch lot): it earns nothing, no scene, the sheet stays with that sentence | participate/index.ts done; punk participate/score.ts; profile/award.ts awardOf | IMPROVISED (8a draws the send online) | offline, « introuvable » confirmed | `verify-queued` | yes |
| `verify-on-site-waiting` | « Position en cours, précision insuffisante pour l'instant. » | onsite.ts:72-78 | IMPROVISED | geo ±400 m, « Me localiser » in the line | `verify-on-site-waiting` | yes |
| `verify-sent` | « Merci, c'est enregistré. »; punk from afar (the test's case; the launch lot, the author's request of 2026-10-13, point 1): it earns nothing, no scene: the sheet stays and says « Envoyé · en attente de revue » (role status); punk on site (8a, the author's request of 2026-10-11): the sheet gone, one ticket « Toujours là · Vérification · vue sur place » in the verification's colour from its first frame falling on the map, on a wide screen in the column of the camera sheet that slid away, its points, « en attente de revue », the cannon; « Merci, c'est enregistré. » said | participate/index.ts done; verify.ts; punk participate/score.ts, columnOf; profile/award.ts awardOf | 17a (the « Toujours là » stamp and « Présence confirmée »: drawn as confirmed before any review, against the rules); punk 8a | who=dan, « Elle est là » (writes), no position: from afar | `verify-sent` | yes |

### Participation: « Déplacer »

No move mode (DECISIONS 2026-10-08, « Placing a camera is always free… »; the classique's
removed on 2026-10-23): the position is « Modifier »'s position view (below), with no façade / libre
choice and no magnet; there `move-sent` and `move-queued` come after « Ici », « Envoyer 1
modification » and « Terminer ».

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `move-sent` | Back on the map, nothing said: the proposal drawn (badge, pale pictogram, dotted line); punk: once 8a's tickets are put away | move.ts:398 submit; modify.ts send (punk); participate/index.ts:101-109 | IMPROVISED | who=eve, fx.camera, façade, slid, Valider; punk: « Modifier », its position slid to fx.target, « Ici », « Envoyer 1 modification », Escape (writes) | `move-sent` | yes |
| `move-queued` | Sent offline: the proposal drawn from the queue (badge, dotted line, a pale « ? » pictogram: a queued proposal does not know the camera's type), « 1 en attente d'envoi » | proposals.ts:197 queued | IMPROVISED | the same, offline before Valider (punk: before « Envoyer ») | `move-queued` | yes |
| `button-panel-disabled` | Punk: a participation button disabled (the direction's « Valider » until a target is posed, `:disabled`): faded to 0.45, and neither a hover nor a press moves it | style.css:636; theme/punk/buttons.css:135 (`:not(:disabled, …)`) | IMPROVISED (3a, 4a draw « Valider » enabled) | n9622344410, « Modifier », « Forme » petit dôme, « Direction » | `modify-aim-waiting` (punk) | yes, without a capture of its own: `modify-aim-waiting`'s screen |

### Participation: « Compléter »

The classique's, removed with it on 2026-10-23: « Modifier » replaces it on the camera
sheet and the add is « Modifier »'s component (DECISIONS 2026-10-08). Its code
(`participate/complete.ts`) stays, opened by no screen; its one row, a dead branch.

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `complete-none` | « Aucune réponse envoyée. » | complete.ts:894 | IMPROVISED | — | — | no: dead branch (every screen sends before it goes on; `offers()` guards an empty list) |

### Participation: « Modifier »

Punk only (DECISIONS 2026-10-08; lot 3.4): adding a camera and « Modifier » are one
component (participate/modify.ts), 3a's paper on a wide screen (at the right, the map
beside it drawing the camera as its pin and the field the send gives, POST
/api/modify/preview), 4a's on a phone (over the screen). While it is open the cameras,
fields and filmed streets around stay, dimmed as in focus (16a's dimmed stickers, the
fields' one dimmed colour, the streets dimmed where the fields are
drawn; DECISIONS 2026-10-09, « « Je ne sais pas » comes first… »; participate/slide.ts
dimAround), no camera
in focus; the proposals (ghosts, their moves and fields) are hidden. Its sheet: the position ticket (as its title the
nearest named street within 50 m, under it « Position posée », « Position actuelle » or
« Déplacée de N m » and the commune, read from the loaded tiles: the basemap's roads, our
communes kept loaded by an invisible layer while the component is open; the state alone
as its title when no street is near), then the lines Forme,
Direction, Hauteur, Inclinaison (a tube or a small dome: DECISIONS 2026-10-13, questions@5)
and Exploitant, each with its answer (the
summary before « Envoyer ») and its choices directly under it, answered in place, « Je ne
sais pas » first on every line and checked when nothing else is (DECISIONS 2026-10-09,
« « Je ne sais pas » comes first… »: in an add a line left on it is sent as « je ne sais
pas », the absence of information; in « Modifier » it sends nothing and never overwrites
the camera's value, and a line whose value a choice says shows that choice pressed, not
« Je ne sais pas »): an add shows every line's choices; « Modifier » only the lines
the camera assumes (questions.ts editorAssumed: a default type or height, an unsurveyed
direction, an unknown operator; 4a-f4's height) and the ones touched, any other line a
button that unfolds it. Only the position and the direction open the map (« Viser sur la
carte › »), a paper at the bottom.
« Modifier » opens from the camera sheet, in place of « Compléter » and « Déplacer »; the
punk « ＋ Ajouter » opens its position first. Where it differs from the boards and why: §3,
« Participation (lot 3.4) ».

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `modify-operator-names` | « Exploitant » after « Public »: the classes, then 20a's « Exploitant précis » search (« Rechercher un exploitant », 44 px) and under it the names around as tickets, 8 at most (POST /api/operators without `class`: `near`); a name is pressed in place and sets its own class (« Public » or « Commerce ou entreprise »), a second tap leaves the class alone; no search after « Particulier »; offline the session's last list without the names around (none yet: « Liste des exploitants indisponible hors ligne. »), a list refused or malformed « Liste des exploitants indisponible pour l'instant. » | participate/modify.ts choices, operatorSearch, fillNames, pickName, loadOperators; questions.ts searchOperators | IMPROVISED (4a: the three tickets only; the search is 20a's) | n9622344410, « Modifier », « Exploitant », « Public » | `modify-operator-names` (punk) | yes |
| `modify-abandon` | « ← » or « × » with changes not sent: « Abandonner ces modifications ? Rien n'a encore été envoyé. », « Reprendre » / « Abandonner » | modify.ts leave | IMPROVISED | `modify-changed`'s, then « × » | `modify-abandon` (punk) | yes |
| `modify-done` | 8a, sent: the sheet slid down (400 ms), the camera's field turned on the map from its direction to the one sent with its yellow bearing tag (here no direction: no turn), a ticket per piece fallen one on the other, blue from its first frame (the leaderboard's info, told by the phone: profile/award.ts awardOf; the server's category replaces it where they differ), on a wide screen in the column the sheet left (its left and width), on a phone centred (`score-phone-centred`), the server's points on their stubs (« +10 Hauteur · Info ajoutée · ~4 m », « +10 Inclinaison · Info ajoutée · un peu vers le bas »), the total « +20 pts », « en attente de revue », the cannon burst, « Voir le classement → »; « Merci, 2 modifications envoyées : elles attendent la revue. » and the points said; held at rest (6 s); the pieces stored as one batch | modify.ts send, scored, turn; participate/score.ts Score (paint, columnOf); profile/award.ts awardOf; cannon.ts | 8a | who=hal, n1879237466, ~4 m, un peu vers le bas, « Envoyer 2 modifications » (writes); the points from score-kit.mjs | `modify-done` (punk) | yes |
| `modify-done-offline` | Offline: 8a's tickets in their category's colour without points, no total, « Merci, 2 modifications enregistrées sur ce téléphone ; envoi dès que le réseau revient. » in the badge's place, no « Voir le classement »; the pieces wait in the queue together | modify.ts scored; participate/score.ts; queue.ts addAll | IMPROVISED (8a draws the send online) | n1879237466, ~4 m, un peu vers le bas, offline, « Envoyer 2 modifications » | `modify-done-offline` (punk) | yes |
| `modify-refused` | A piece of a send refused by the server (a 4xx but 429): the whole send dropped, its pieces already arrived withdrawn; « Modification refusée à l'envoi : rien n'en est gardé. » in place of 8a's status (the tickets lose their points, no total, no « Voir le classement »), and on the queue's counter for 12 s (a tap opens « Vos contributions »); withdrawn meanwhile (`batch_closed`), dropped silently | queue.ts run, refuse; participate/index.ts:281 sayRefused; participate/score.ts refused | IMPROVISED | smoke-participate 4b' and smoke-score (punk): /api/contributions answering 422 to a send's second piece | — | yes, by a server refusal only |
| `score-reduced` | Under reduced motion, 8a's scene at once and straight: the sheet gone, the tickets, the total and « Voir le classement » shown together, the field at its new direction, no cannon, nothing animated | participate/score.ts; theme/punk/score.css (motion query) | IMPROVISED (the author's request of 2026-10-11) | `modify-done`'s, reduced motion | — | yes, without a capture of its own (the states' captures run with motion; checked by smoke-score) |
| `modify-aim-closer` | A target closer to the camera than 48 px on the screen, whatever the zoom (direction.min_target_px, rules/questions.yaml; a build without it counts min_target_m, 5 m): « Visez plus loin de la caméra. » under the target on the tag's yellow paper (`#edit-warn`, 30 px below its centre, kept on the screen) and in the paper's status line, said, « Valider » off, no bearing tag, no field; on a phone this is the view's first state, the fixed crosshair over the camera until the map slides | modify.ts tooClose, aimStatus, placeWarn | IMPROVISED | `modify-aim`'s, the target tapped on the camera (a phone: the view as it opens); smoke-editor: at z21 a target 0.4 m away (about 16 px) | — (smoke-editor.mjs --shots: 4b-closer-phone, 4b-closer-wide) | yes, without a capture of its own: `modify-aim-waiting`'s screen |
| `modify-aim-waiting` | The direction before a target is posed. With a mouse: the crosshair dim at the centre of the free map (it follows the mouse), « Valider » off, no bearing tag. On a phone (DECISIONS 2026-10-09): the crosshair fixed at the free map's centre, over the camera (or 20 m along a direction already known), « Faites glisser la carte jusqu'à poser la cible sur ce que regarde l'objectif. », « Valider » off until the centre is 48 px from the camera on the screen (`modify-aim-closer`) | modify.ts enterAim, aimPosed, centredInput | IMPROVISED (3a, 4a draw it posed) | n9622344410, « Forme » petit dôme, « Direction » | `modify-aim-waiting` (punk) | yes |
| `modify-position-too-far` | « Modifier »'s position 60 m away: « Trop loin : 50 m au plus. Est-ce bien la même caméra ? », « Ici » off (rules/participation.yaml move_max_m) | modify.ts positionReady | IMPROVISED | fx.camera, « Modifier », its position ticket, the map slid 60 m east | `modify-position-too-far` (punk) | yes |
| `add-place-duplicates` | The punk add's « Est-ce l'une de celles-ci ? » after « Ici »: the camera's type and nearest street (« Caméra fixe · … », never its id) « à 2 m » with its sticker, « ‹ Position », « Non, c'en est une autre » | modify.ts here, enterDuplicates | IMPROVISED | `#18/48.8967635/2.2384109`, « ＋ Ajouter », « Ici » | `add-place-duplicates` (punk) | yes |
| `add-sheet-abandon` | The punk add's « × » after an answer: « Abandonner cet ajout ? Rien n'a encore été envoyé. », « Reprendre » / « Abandonner » | modify.ts leave | IMPROVISED | `add-sheet`'s, « Forme » petit dôme, « × » | `add-sheet-abandon` (punk) | yes |
| `add-done` | 8a for the punk add: « +50 Ajout · Caméra ajoutée » (pink), a ticket per answer (« +10 Forme · Info ajoutée · Petit dôme », blue, …; none for « Je ne vois pas », which earns nothing: the launch lot), each in its colour from its first frame (profile/award.ts: every answer on an added camera is an info), on a wide screen in the column the sheet left, on a phone centred (`score-phone-centred`), « +10 Tout y est · Bonus caméra complète » (yellow on ink) when the server gives it; a stack higher than the screen gathers the answers on one ticket (`score-gathered`); the total, « en attente de revue », the cannon, « Voir le classement → »; « Merci : la caméra et vos 4 réponses sont envoyées, elles attendent la revue. » said; held at rest; the add and its answers in one queue transaction | modify.ts send, scored; participate/score.ts Score (paint, gather); profile/award.ts awardOf | 8a (the bonus ticket: §3) | who=fay, `add-sheet-filled`'s, « Envoyer » (writes); the points from score-kit.mjs | `add-done` (punk) | yes |
| `add-done-offline` | Offline: the add's tickets in their colours without points, « Merci : la caméra et vos 4 réponses sont enregistrées sur ce téléphone ; envoi dès que le réseau revient. » in the badge's place | modify.ts scored; participate/score.ts; queue.ts addAll | IMPROVISED (8a draws the send online) | `add-sheet-filled`'s, offline, « Envoyer » | `add-done-offline` (punk) | yes |
| `modify-aim-no-field` | A target posed far enough and no field, with why, under the target on the tag's yellow paper (`#edit-warn`) and in the paper's status line (said), « Valider » still on (only the bearing counts): out of the built region (422 `outside_region`) « Hors de la zone de la carte : aucun champ ici. » (in the position view « Ici » waits too); offline « Hors ligne : champ indisponible, l'envoi reste possible. »; the server failing « Champ indisponible pour l'instant, l'envoi reste possible. »; 429 « Trop de calculs à la suite : bougez la cible dans un instant. »; no answer after 3 s « Le champ tarde à venir, l'envoi reste possible. » (the field drawn and the line gone when it comes); nothing to draw « Un mur cache tout dans cette direction : aucun champ. », the camera inside a building (`inside_footprint`) « La caméra est dans un bâtiment : aucun champ. »; a target moved clears it | modify.ts preview, said, aimStatus, placeWarn | IMPROVISED (the author's request of 2026-10-12, point 4) | `modify-aim`'s at z21, a target 2 m away; route POST /api/modify/preview → 422 outside_region, 500, 429, aborted, 4.5 s late, or its bands emptied (with `inside_footprint`) | — (smoke-editor.mjs --shots: 4c-outside-phone, 4c-outside-wide; 4a-z21-2m-phone and -wide the 2 m target with its field) | yes, with a route; without a capture of its own |
| `modify-operator-search` | « Exploitant précis » with text typed: the listed names whose folded form (questions.ts fold: no case, no accents, punctuation as spaces) holds the folded text, the names around first, then the list's order, 8 at most: « ratp » finds RATP alone among every name of rules/operators.yaml; none « Aucun exploitant de la liste ne correspond. »; a name tapped sets its class (RATP: « Public » pressed, the line's value « RATP ») | questions.ts searchOperators, fold; modify.ts fillNames, pickName | IMPROVISED (the search is 20a's « Exploitant précis », a filter of the map) | `add-sheet`'s, « ratp » typed (smoke-editor answers POST /api/operators itself) | — (smoke-editor.mjs --shots: 6a-ratp-search-phone, 6a-ratp-search-wide) | yes, without a capture of its own |
| `modify-operator-proposed` | A name not in the list typed after « Public » or « Commerce ou entreprise »: « Proposer « Boulangerie du Coin » » (a dashed ticket) and « Un nom proposé est relu avant d'apparaître sur la carte. »; pressed, the line's value « Boulangerie du Coin (à relire) »; checked as the API checks it (NFC, trimmed, spaces collapsed, 2 to 60 characters, a letter or a digit first, then letters, digits, spaces and ' ’ - . & ( ) , /): outside, « Proposer » off and why (« Entre 2 et 60 caractères. », « Commencez par une lettre ou un chiffre… »); after « Je ne sais pas » no « Proposer » but « Pour proposer un nom absent de la liste, choisissez d'abord « Public » ou « Commerce ou entreprise ». »; after « Particulier » no search at all; sent as `operator_proposed`, never with `operator_name`; its 8a ticket says « Public · nom à relire », never the name | questions.ts tidy, proposedProblem, listedAs; modify.ts fillNames, propose, scored | IMPROVISED (the author's request of 2026-10-12, point 6) | `add-sheet`'s, « Public », « Boulangerie du Coin » typed, « Proposer » (smoke-editor answers the send with a proposed name itself) | — (smoke-editor.mjs --shots: 6b-proposed-phone, 6b-proposed-wide) | yes, without a capture of its own |
| `score-mid-fall` | 8a's tickets a third into their fall (1.58 s after the tap): each already in its category's colour with its word (told by the phone, profile/award.ts awardOf, before GET /api/me/points answers); on a wide screen the column takes the left and width of the sheet that slid away (`#modify-panel`; `#sheet` for « Toujours là ? »), on a phone the column centred (`score-phone-centred`; 2026-10-13) | participate/score.ts Score (columnOf, paint, categoryOf); profile/award.ts awardOf, known; participate/index.ts (the column of `#sheet`) | partly IMPROVISED: 8a, its phone frame; the wide screen's column the author's request of 2026-10-12, point 2 | 8a's dome n998633844, « Modifier »: a direction aimed, ~4 m, « Public » and its first name, « Envoyer 3 modifications » (writes), held at 1580 ms; the points from score-kit.mjs | — (shots-fete.mjs --only column: column-wide-clair, column-wide-sombre, column-phone-clair, column-phone-sombre; the sheet's former place dashed by the bench on a wide screen) | yes, without a capture of its own (an instant of an animation) |
| `score-gathered` | A stack that would rise above the screen (its top under 16 px once the total and the bonus are in): the added infos on one ticket where the first of them was, « Fiche · 5 infos ajoutées » (blue), its points their sum; the others as they are | participate/score.ts tooHigh, gather | IMPROVISED (the author's request of 2026-10-12, point 2) | who=fay, a tube added with its five answers on a 960 × 581 screen, « Envoyer » (writes), reduced motion | — (shots-fete.mjs --only column: column-wide-add-clair, column-wide-add-sombre) | yes, without a capture of its own |
| `score-timeout` | GET /api/me/points not answered within 2 s (`POINTS_TIMEOUT_MS`; asked once the pieces have left the phone, whose sending is not bounded): the request dropped, the tickets stay as they fell, in their colours, without points, no total, no « Voir le classement », as when the route fails | participate/score.ts fetchPoints | IMPROVISED (the author's request of 2026-10-12, point 2: the delay is the lot's) | `modify-done`'s, route GET /api/me/points answered after 2 s | — | yes, with a route; without a capture of its own |
| `score-osm` | The API answered a piece of the send `osm: "will_publish"` (her synchronisation on, the piece able to leave): « Sera publiée sur OSM en votre nom après relecture. » under the badge, the badge's black strip on a line of its own, in the status line (said when it comes); kept when the scene goes quiet | participate/score.ts; participate/queue.ts publishes | IMPROVISED (the contract's « Synchro OSM », no board) | the real API's answer with `osm` added (smoke-score) | — | yes, without a capture of its own (checked by smoke-score) |
| `score-quiet` | 8a, a send the server's answer gives nothing (every piece sent again within its month): once GET /api/me/points answers, the tickets, the bonus, the cannon and « Voir le classement » go, no total, « Envoyé · en attente de revue » (`score.sent`) alone in the scene's status line, said again | participate/score.ts fetchPoints, hush | IMPROVISED (the launch lot, the author's request of 2026-10-13, point 1) | `modify-done`'s, route GET /api/me/points giving each piece 0 | — | yes, with a route; without a capture of its own (checked by smoke-score) |
| `modify-possible-field` | Punk, while the camera is placed and no direction is chosen (the position view once the pin stops, the sheet before a direction, the aim without a target or with one too close, after « Je ne vois pas »): its possible field, the « détecte » level of the preview asked without a direction (POST /api/modify/preview: the ring cut by the buildings), a fill of the fields' pink at 0.1 and a 1.5 px dotted outline (dots every 2.5 widths, round caps) in the fields' outline colour, both where the edit field goes, under the buildings, the streets, the portions and every label; aimed (a target far enough, a direction chosen, or in « Modifier » the camera's own), the field instead (`modify-field-under`) and the possible one gone; a big ball, no direction asked, has its field at once; cleared at 8a's scene; a failing preview draws neither | modify.ts addLayers (edit-possible, edit-possible-line; POSSIBLE_OPACITY, POSSIBLE_WIDTH, POSSIBLE_DASH), preview, aimed, scored | IMPROVISED (the author's request of 2026-10-13, point 4; 3a and 4a draw no field before the aim: §3) | `add-place`'s, the pin stopped; then « Ici », « Petit dôme »; then « Viser sur la carte › » before a target | — (smoke-editor.mjs --shots: 3a-placement-light-phone, 3a-placement-dark-phone, 3a-placement-light-wide, 3a-placement-dark-wide) | yes, without a capture of its own: `add-place`'s screen |
| `add-multidome` | The add's sheet after « Multi-boules » (DECISIONS 2026-10-23), the fifth tile, last: the tile pressed, the pin on the map wearing the multi-dome's sticker; « Nombre de boules » on the line under « Forme »: « Je ne sais pas » (pressed), « 2 » to « 6 » (the build's `dome_count`); « Direction · toutes (plusieurs boules) » without choices (all around: no direction asked); « Hauteur » asked, no « Inclinaison »; in « Modifier » the line comes with the shape (folded on a multi-dome whose number is known) | modify.ts TILES, shapeTiles, row, choices (`count`), current, setShape | IMPROVISED (no board has the tile nor the line; 3a/4a's tiles and tickets) | `add-place`'s, « Ici », « Multi-boules » | `add-multidome` | yes |
| `add-multidome-count` | The same, « 3 » pressed: « Nombre de boules · 3 boules »; sent, the shape's piece carries `dome_count` 3 (its ticket « Multi-boules · 3 boules ») | modify.ts pick, shapePiece, send, ticket | IMPROVISED (as above) | `add-multidome`, « 3 » | `add-multidome-count` | yes |
| `add-multidome-kept` | 8a for a multi-dome sent with « Je ne sais pas » by someone who publishes on OSM: the API's `osm: "kept"`, `osm_reason` multidome_count_unknown, said under the badge on its black strip: « Sans le nombre de boules, cette réponse reste sur Surveillance World : elle ne sera pas publiée sur OpenStreetMap. »; « Compte »'s history says « reste sur Surveillance World : sans le nombre de boules, une multi-boules n'est pas publiée » (`kept_rule`) | participate/score.ts (`kept`); participate/queue.ts keptReason, onKept; account/syncline.ts stateParts | IMPROVISED (the contract's « Synchro OSM », no board) | who=fay, `add-multidome`, « ~4 m », « Envoyer », the real API's answer with `osm` added (the bench's accounts do not publish) (writes) | `add-multidome-kept` | yes, its answer routed |
| `modify-dome-tilt` | Punk, a small dome (its shape answered, or the camera's kind in « Modifier »): « Inclinaison » on the line under « Hauteur », as a tube's: « Je ne sais pas » (pressed while nothing else is), « vers l'horizon », « un peu vers le bas », « fortement vers le sol »; without a height « L'inclinaison ne compte qu'avec une hauteur : indiquez-la aussi. »; in « Modifier » folded unless the height is assumed; an answer changes the field the send gives (the same optical model as a tube's: a blind zone at the foot, the reach capped on the ground); never a big ball, a panorama or an unknown kind | questions.ts editorParts (meta `editor_tilt_kinds`); modify.ts tilts, row, choices; rules/questions.yaml tilt.kinds (questions@5) | IMPROVISED (the author's request of 2026-10-13, point 1; DECISIONS 2026-10-13, « The tilt is asked for a tube and a small dome… ») | `add-place`'s, « Ici », « Petit dôme », the meta's `tilt_kinds` answered `["fixed", "dome"]` by the page (smoke-editor) while the CI extract predates questions@5 | — | yes, with a route until the CI extract is built again (its meta says `["fixed"]`); without a capture of its own (checked by smoke-editor) |
| `score-phone-centred` | Punk, on a phone (600 px wide or less, or a coarse pointer 500 px high or less: layout.ts PHONE_QUERY): 8a's column centred (left and right 0, auto margins), its stack and its total centred in it, every ticket with its tilt and the total within 16 px of both edges; each stub's number raised by 22 px of padding under it, clear of the next ticket (on every screen); the cannon, when motion is welcome, drawn at 0.65, its mouth at least 34 px right of « PTS » and up to 10 px from the screen's right edge, its body partly beyond (a four-digit total at 375 px: its pull ring off the screen, 84 % of its body shown) | theme/punk/score.css (the phone query: .score-col, .score-stack, .score-total, .cannon; .score-ticket-pts padding); participate/score.ts placeCannon (PHONE_CLEAR, PHONE_EDGE) | partly IMPROVISED: 8a, its phone frame's column at the left; centred, the author's request of 2026-10-13, map point 2 (« +50 » cut, the stack off the left edge of an iPhone) | who=fay, 375 × 812, dark: a small dome added with its answers, or three changes, « Envoyer », at rest; the points from score-kit.mjs | — (shots-fete.mjs --only centred: centred-375-add-webkit-sombre, centred-375-changes-webkit-sombre, centred-375-add-chromium-sombre) | yes, without a capture of its own: `modify-done`'s and `add-done`'s phone screens (checked by smoke-score at 375 and 390 px) |
| `modify-open` | Nothing changed, nothing assumed: « ← », 16a's sticker whole, « Modifier », the line « Caméra fixe · publique », 4a's position ticket (the street, « Position actuelle · Courbevoie », « Modifier » wavy), « Touchez ce qui est faux ou manquant. », the lines Forme, Direction, Hauteur, Inclinaison (a tube), Exploitant with their values and source tags (« OSM », « supposé », « réponse »), each folded (a button that unfolds its choices), « Envoyer » off; a line the kind does not take (a big ball's direction and height) is no button | modify.ts renderSheet, positionTicket, namePlace, row, unfolded, current; place.ts | 3a, 4a screen 4 | n1879237466, « Modifier » | `modify-open` (punk) | yes |
| `modify-assumed` | 4a-f4: an applied add's public dome whose height is assumed: only « Hauteur » (« supposé », « ~4 m », its m in lower case) shows its choices (Je ne sais pas, pressed: the height is only assumed / ~2 m / ~4 m / 6 m et +), the other lines folded | modify.ts unfolded, row (metric); questions.ts editorAssumed | 4a screen 4 (« Hauteur » open) | cadd000020000, « Modifier » | `modify-assumed` (punk) | yes |
| `modify-row-open` | A tube's « Hauteur » unfolded by a tap: « Je ne sais pas » then its classes under the line, the camera's own class pressed when it has one (« Je ne sais pas » when only assumed or in metres: none pressed); its « Inclinaison » stays folded | modify.ts row, choices | 4a screen 4 (« Hauteur » open) | n1879237466, « Modifier », « Hauteur » | `modify-row-open` (punk) | yes |
| `modify-height-dome` | A camera of unknown type made a dome: the tile pressed in place, its « Hauteur » (assumed) with the classes and « Je ne sais pas », no tilt line | modify.ts choices, pick; questions.ts editorParts | 4a step 2 (the « Hauteur » row) | n9622344410, « Petit dôme » | `modify-height-dome` (punk) | yes |
| `modify-height-metres` | « Hauteur »'s choices in metres (an add, or the line unfolded in « Modifier »): « Je ne sais pas » (pressed while nothing else is), « ~2 m », « ~4 m », « 6 m et + », their m in lower case (the classes ground, first, upper: rules/questions.yaml height, 2, 4 and 7 m, certainty estimated); no « Poteau »; a tile built before migration 017 that says `pole` reads « ~4 m » and presses it | modify.ts choices, heightNow, ownChoice (HEIGHTS, heightClass) | 4a step 2 (the « Hauteur » row, its classes in floors and « Poteau »: §3) | `add-place`'s, « Ici », « Petit dôme », « ~4 m » | — (smoke-editor.mjs --shots: 5-heights-phone, 5-heights-wide) | yes, without a capture of its own: `add-sheet`'s screen |
| `modify-shapes` | An unknown camera: what it assumes unfolded, « Forme »'s 3a tiles with 16a's stickers (Je ne sais pas, pressed, Petit dôme, Tube, Grosse boule, then Multi-boules), « Direction »'s « Je ne sais pas » (pressed: none surveyed) and « Viser sur la carte › » (dashed, a crosshair), « Hauteur », « Exploitant » | modify.ts row, choices, shapeTiles | 3a, 4a step 2 | n9622344410, « Modifier » | `modify-shapes` (punk) | yes |
| `modify-changed` | Changes made in place: their lines tagged « modifié » and stamped « Corrigé », the chosen tickets pink, « Envoyer 2 modifications »; on a wide screen the map draws the field they give | modify.ts row, pick, preview | 3a, 4a screen 4 (« Direction » stamped) | n1879237466, « Hauteur » ~4 m, « Inclinaison » un peu vers le bas | `modify-changed` (punk) | yes |
| `modify-aim` | 3a/4a step 3, from « Viser sur la carte › »: « ← », « Direction », the bearing on its yellow tag (« 68° · est ») in the paper and beside the crosshair on the map, « Posez la cible sur ce que regarde l'objectif. » (a phone: « Faites glisser la carte jusqu'à poser la cible… »), « Je ne vois pas » / « Valider », the crosshair posed by a click (a phone: fixed at the centre, the map slid under it or a tap bringing its point there, the field following as the map moves), the dotted ink line from the camera (from where the send puts it) to it, the field for that bearing (under the streets and their names, `modify-field-under`) | modify.ts enterAim, aimInput, centredInput, drawAim | 3a, 4a step 3 | n9622344410, « Forme » petit dôme, « Direction », a tap 20 m east | `modify-aim` (punk) | yes |
| `modify-field-under` | The editor's field (an add and « Modifier ») where the map draws its own: before the first of `buildings`, `streets`, `portions` the style has (else its first label), so that the buildings, the streets (grey or filmed) and every name are drawn over it; its fill (the halftone pattern) at 0.55 opacity, its outline the map's (3.2 px, dotted, dashed, solid); drawn only once its direction is known (aimed, chosen, or in « Modifier » the camera's own while nothing replaces it), or for a big ball (no direction asked); until then, while the pin is placed, in the sheet before a direction, after « Je ne vois pas », only the possible field (`modify-possible-field`; 2026-10-13) | modify.ts addLayers, aimed, preview | 3a, 4a step 3 (the field over the map's picture: §3) | `add-place`'s, « Ici », « Petit dôme », « Viser sur la carte › », a tap east | — (smoke-editor.mjs --shots, light and dark since the return on Temps 1: 3c-aimed-light-phone, 3c-aimed-dark-phone, 3c-aimed-light-wide, 3c-aimed-dark-wide, 3b-add-streets-light-phone, 3b-add-streets-dark-phone, 3b-add-streets-light-wide, 3b-add-streets-dark-wide) | yes, without a capture of its own: `modify-aim`'s screen |
| `modify-position` | 4a step 1 for an existing camera: « ← », « Position », « Placez l'épingle sous la caméra. », « Annuler » / « Ici », the pin (16a's sticker on its stem, the pink tip the position) at the centre of the free map, the field computed once it stops when the camera's direction is known (otherwise its possible field, dotted: `modify-possible-field`); here inside a footprint (under a roof): kept there, its building no obstacle within 10 m of it and one again beyond (rules/contributions.yaml under_roof) | modify.ts enterPosition, positionMoved | 3a, 4a step 1 | fx.camera, « Modifier », its position ticket, the map slid to fx.inside | `modify-position` (punk) | yes |
| `add-place` | The punk « ＋ Ajouter »: « × », « Nouvelle caméra », « Placez l'épingle sous la caméra. », « Annuler » / « Ici », the pin with the unknown sticker, once it stops its possible field, a dotted outline over a very light fill (no direction yet: `modify-possible-field`); no façade / libre, no « Me localiser » | modify.ts startAdd, enterPosition, aimed, preview | 3a, 4a step 1 | `#18/48.8981364/2.2403746`, « ＋ Ajouter » | `add-place` (punk) | yes |
| `add-sheet` | After « Ici »: « ← », « Nouvelle caméra », « × », the position ticket (the nearest street, « Position posée · » the commune), « Renseignez ce que vous voyez. », the four lines « je ne sais pas », each with its choices under it, « Je ne sais pas » first and pressed, « Envoyer » (sends the add and its four « je ne sais pas ») | modify.ts renderSheet, namePlace, choices; place.ts | 3a, 4a step 2 | `add-place`'s, « Ici » | `add-sheet` (punk) | yes |
| `add-sheet-filled` | Its summary: Petit dôme, the bearing, ~4 m, the operator's name, each choice pressed under its line (once the build's meta lists the small dome in `tilt_kinds`, « Inclinaison » under « Hauteur » too, on « Je ne sais pas », which sends nothing: `modify-dome-tilt`); on a wide screen the field they give | modify.ts current, pick, preview | 3a, 4a step 2 | dome, a tap 15 m east, ~4 m, Public and its first name | `add-sheet-filled` (punk) | yes |

### Participation: « ＋ Ajouter »

« Modifier »'s component (above; the classique's position screen and questions removed on
2026-10-23); `add-sent` and `add-queued` there come after its filled
sheet's « Envoyer » and « Terminer ».

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `add-sent` | Back on the map: the add's pale pictogram and badge | complete.ts:874-881; modify.ts send (punk) | IMPROVISED | who=fay, « Envoyer l'ajout » online; punk: `add-sheet-filled`'s « Envoyer », Escape (8a's tickets put away) (writes) | `add-sent` | yes |
| `add-queued` | Sent offline: the pale pictogram from the queue, « 4 en attente d'envoi » (the add and its three answers; punk: « 5 en attente d'envoi », four answers) | proposals.ts:200 | IMPROVISED | offline before « Envoyer l'ajout » (punk: before « Envoyer ») | `add-queued` | yes |

### « Vos contributions » and the send queue

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `mine-empty` | What is stored, what never is, nothing sent to OSM; « Aucune contribution reçue pour l'instant. » | mine.ts:10 openMine | IMPROVISED | seed empty, a sheet, « Vos contributions » | `mine-empty` | yes |
| `mine-list` | day · kind · answer · status (« en attente », « appliquée (carte 46b74c5f) », « remplacée par une plus récente », « en conflit », « enregistrée (statistiques) »), « Retirer » on pending ones, a « je ne sais pas » included (shown « enregistrée (statistiques) ») | mine.ts:87-106 | IMPROVISED | seed full, who=ana | `mine-list` | yes |
| `mine-operator-proposed` | An operator answer sent with a name not listed, waiting for /revue: « … · Qui filme · public (nom proposé, en relecture) · en attente », never the name (GET /api/me/contributions says `operator_proposed: true`); once accepted, the name as for a listed one | mine.ts answerText | IMPROVISED (the author's request of 2026-10-12, point 6) | `modify-operator-proposed`'s send, « Vos contributions » (smoke-editor answers GET /api/me/contributions itself) | — | yes, without a capture of its own |
| `mine-withdraw-armed` | « Retirer : confirmer » | mine.ts:45-67 | IMPROVISED | once | `mine-withdraw-armed` | yes |
| `mine-withdrawn` | « … · retirée » | mine.ts:53 | IMPROVISED | twice (writes) | `mine-withdrawn` | yes |
| `mine-withdraw-offline` | « … · retrait impossible hors ligne » | mine.ts:55-61 | IMPROVISED | offline after the list, twice | `mine-withdraw-offline` | yes |
| `mine-withdraw-busy` | « … · trop de demandes en une minute, réessayez dans un instant » | mine.ts:59-61 | IMPROVISED | route withdraw → 429 | `mine-withdraw-busy` | yes |
| `mine-offline` | Offline with one waiting: « 1 contribution attend encore sur ce téléphone. », its line « en attente d'envoi sur ce téléphone » with Retirer, « Liste indisponible hors ligne. » | mine.ts:43, 74-82, 106 | IMPROVISED | offline, « introuvable » confirmed, the counter | `mine-offline` | yes |
| `mine-sync` | Punk, the OSM synchronisation on: under each contribution that went or may still go, « OSM : partira après relecture », « OSM : publiée · changeset n° 12345 ↗ » (a link, a new window), « OSM : partira après la prochaine mise à jour de la carte », « OSM : conflit : une caméra est déjà sur OSM à quelques mètres · rien n'a été écrasé »; GET /api/osm/sync asked once | participate/mine.ts osmLine; account/syncline.ts | IMPROVISED | profile-mock SYNC_ON, a sheet's « Vos contributions » | `mine-sync` (punk) | yes |
| `queue-relogin` | Punk: a send answered 401 (the session expired): kept, nothing more sent until a login; the page asks /api/me again (signed out from then on) and the counter reads « Reconnectez-vous pour envoyer 1 contribution », a tap opening « Entrer » (no « ← Retour »), the login sending it | queue.ts:273 run, resume; participate/index.ts:333 renderCounter, the queue's listener | IMPROVISED | route /api/me → 401 once a POST /api/contributions is answered 401, « Toujours là ? », « Elle est là » | `queue-relogin` (punk) | yes |

### Account (lot « comptes »)

Board 25a (wide screen, dark); the camera sheet's frame and its phone bottom sheet. Signed
out by a simulated 401 on `/api/me` (route), the login's answer simulated where a state
needs it.

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `account-form-waiting` | « Entrer » sent and the server's delay running (1 s, 2 s… up to 30 s after refusals): the key held down on its shadow, `aria-disabled`, the form `aria-busy`; nothing else sent | account/index.ts:310 form (submit) | IMPROVISED (25a has no waiting state) | `account-form`, « ana », « mauvais », route POST /api/session unanswered | `account-form-waiting` (punk) | yes |
| `account-form-offline` | Offline: « Connexion impossible hors ligne : réessayez quand le réseau revient. » on the yellow band, said (role alert), both fields marked | account/index.ts:310 form | IMPROVISED | the same, route POST /api/session aborted | `account-form-offline` (punk) | yes |
| `account-form-failed` | Any other answer (500…): « Connexion impossible pour l'instant : réessayez dans un moment. » | account/index.ts:310 form | IMPROVISED | the same, route POST /api/session → 500 | `account-form-failed` (punk) | yes |
| `account-ask-from-action` | « Compte » (28a; 25a's stamp when OSM's sign-in is off) opened by the greyed « Modifier » or « Toujours là ? » (tap or Enter; its key's `then` that camera's address, `?cam=<id>`: back signed in, the camera's sheet), « Je confirme » / « Ce n'est pas ça », « ＋ Ajouter », or the counter's « Reconnectez-vous… »; no « ← Retour » (28a draws none: its × closes) | account/index.ts require; participate/index.ts idle (signIn), loginFirst; account/osm.ts comeBackTo, cameraAddress | partly IMPROVISED: 28a, opened from where 28a does not | `account-sheet-visitor`, « Modifier » | `account-osm-key` | yes, without a capture of its own: `account-osm-key`'s screen |
| `account-sheet-visitor` | Punk signed out: the camera sheet's « Modifier » (no « ? », never filled) and « Toujours là ? » greyed as « ＋ Ajouter » below its zoom (the paper, the muted ink, a dashed ink edge, no shadow), `aria-disabled` (not `disabled`), both `aria-describedby` « Connectez-vous pour participer », a plain line under them; « Corriger sur OpenStreetMap ↗ » among the links before « OpenStreetMap ↗ », no « Vos contributions »; a tap or Enter on a greyed button, « Je confirme » / « Ce n'est pas ça » open « Compte » | participate/index.ts actions (idle); chips.ts punkSheet; main.ts sheetOptions (visitor); theme/punk/buttons.css | IMPROVISED (the contract's « Signed out » list, the author's request of 2026-10-11 point 3; no board draws it) | route /api/me → 401, `?cam=n1879237466` | `account-sheet-visitor` (punk) | yes |
| `account-osm-key` | OSM sign-in on: « Compte » as board 28a: the cut-out « COMPTE », ×; in the middle of the paper « Connexion et inscription passent par OpenStreetMap » (Archivo 900 36 px, « OpenStreetMap » on the light blue paper, pink in dark), « Pas encore de compte OSM ? Vous le créerez en chemin. », the one key « Se connecter avec / OpenStreetMap → » (76 px; ink with light blue words on the pink shadow, light blue with ink words on the cream shadow in dark; a link to `/api/osm/login?then=…`, described by the next line; while sign-in goes through OSM's test server its yellow « serveur de test » label, part of its name), « Rien n'est publié sans votre accord. »; at the bottom under a dashed rule « La carte se lit sans compte. » and « Me contacter » (a link, the mailto), then the four legal pages' links (`legal-account-links`); no password form, no OSM link; on a phone full height; the key tapped (a plain click or tap; not for a new tab or window), the sheet says « Chargement de votre compte » (`loading-account`) until the browser has left, and a page brought back from the history with it shows « Compte » again | account/index.ts askOsm (the key's click), constructor (pageshow); account/osm.ts osmLogin, loginHref; theme/punk/account.css (28a) | 28a frames 1 (light) and 3 (dark) | route /api/me → 401, /api/osm/status → `{login: true}`; the account square | `account-osm-key` (punk) | yes |
| `account-osm-signup` | Back from OpenStreetMap the first time (`?osm=signup`, removed from the address), after « Chargement de votre compte » (`loading-account`), the map loading or not (GET /api/osm/signup asked as the page starts, beside GET /api/me): « Choisissez votre pseudonyme » (cut-out, on two or three lines), « Votre nom sur OSM : Jean Dupont », « Pseudonyme » holding the API's suggestion « Jean_Dupont » (focused), its rule, « En validant, vous acceptez les conditions d'utilisation et de contribution. » (the launch lot: its link opens « Conditions » over the sheet, the pseudonym typed kept; inline in its sentence on a phone; « Valider » described by it), « Valider → » (25a's « Entrer » key), under a dashed rule what is kept, « ← Retour » (to « Compte »); full height on a phone | account/index.ts land, waiting, signup, signupForm; legal/index.ts legalLink, template | IMPROVISED (25a's form and key; no board draws it) | route /api/me → 401, /api/osm/signup → the suggestion; `?osm=signup` | `account-osm-signup` (punk); shots-legal.mjs: phone-light-pseudonyme, phone-dark-pseudonyme, wide-light-pseudonyme, wide-dark-pseudonyme | yes |
| `account-osm-signup-taken` | « Ce pseudonyme est déjà pris : choisissez-en un autre. » on the yellow band (role alert), the field `aria-invalid`, its text selected | account/index.ts signupForm | IMPROVISED | `account-osm-signup`, « pris », POST /api/osm/signup → 409 pseudonym_taken | `account-osm-signup-taken` (punk) | yes |
| `account-osm-signup-invalid` | A pseudonym outside the rule, said before anything is sent (and on the API's 400): « Ce pseudonyme ne va pas : 2 à 32 caractères, lettres sans accent, chiffres, point, tiret ou tiret bas. » | account/index.ts signupForm; account/osm.ts validPseudonym | IMPROVISED | `account-osm-signup`, « é » | `account-osm-signup-invalid` (punk) | yes |
| `account-osm-signup-failed` | Offline: « Envoi impossible hors ligne : réessayez quand le réseau revient. »; any other answer « Envoi impossible pour l'instant : réessayez dans un moment. »; « Valider » held down while it waits | account/index.ts signupForm | IMPROVISED | `account-osm-signup`, POST /api/osm/signup aborted | `account-osm-signup-failed` (punk) | yes |
| `account-osm-signup-expired` | The signup gone (GET or POST /api/osm/signup → 401, 10 min or used): « Compte » again (`account-osm-key`) with « Le délai pour choisir un pseudonyme est passé : entrez à nouveau avec OpenStreetMap. » on the yellow band (role alert) at its top; the same sheet says « Ce compte OpenStreetMap vient d'être relié à un autre compte… » on 409 osm_taken and « Inscription impossible pour l'instant… » when the signup cannot be read | account/index.ts signup, ask | IMPROVISED | route /api/osm/signup → 401 signup_expired; `?osm=signup` | `account-osm-signup-expired` (punk) | yes |
| `account-osm-status` | Back from OpenStreetMap signed out with `?osm=failed` (28a's « retour d'OSM en échec ») or `denied` (or a link's outcome when the session is gone): « Compte » (`account-osm-key`) with a line on the yellow band under its head (role alert, 7 × 10 px, 14 px), « La connexion n'a pas abouti. Réessayez. » or « Refusé sur OpenStreetMap : rien n'a été transmis. »; with `?debug=1` only, under it « raison : <code> » (`?osm_why=`, the server's code) in a monospace face; `osm` and `osm_why` removed from the address | account/index.ts land, ask, noticeLines; account/osm.ts takeReturn, whyLine; account/back.ts parseReturn | 28a frame 2 (`failed`); `denied` and the reason IMPROVISED | route /api/me → 401; `?osm=denied` | `account-osm-status` (punk) | yes |
| `account-osm-signups-closed` | Sign-ups closed by an administrator (/revue's « Réglages »; GET /api/config `signups: false`): « Compte » as `account-osm-key`, its lead « Les inscriptions sont fermées pour l'instant : seuls les comptes qui existent déjà peuvent entrer. » in place of « Pas encore de compte OSM ? Vous le créerez en chemin. » | account/index.ts askOsm; config.ts parseConfig | IMPROVISED (28a's lead replaced) | route /api/config → signups false, signed out | `account-osm-signups-closed` (punk) | yes |
| `account-osm-signup-closed` | Back from OpenStreetMap the first time while sign-ups are closed (GET or POST /api/osm/signup → 403 signups_closed): « Compte » again with « Les inscriptions sont fermées pour l'instant : aucun compte ne peut être créé. Un compte qui existe entre toujours avec OpenStreetMap. » on the yellow band | account/index.ts signup; account/osm.ts readSignup, sendSignup | IMPROVISED | route /api/me → 401, GET /api/osm/signup → 403 signups_closed, `?osm=signup` | `account-osm-signup-closed` (punk) | yes |
| `account-osm-return-closed` | Back from OpenStreetMap the first time while sign-ups are closed, refused by the callback itself (`?osm=signups_closed`, lot 4: no account made, no pseudonym asked): « Compte » with « Les inscriptions sont fermées pour l'instant : aucun compte ne peut être créé. Un compte qui existe entre toujours avec OpenStreetMap. » on the yellow band, under the closed lead | account/back.ts parseReturn; account/index.ts land | IMPROVISED | route /api/me → 401, /api/config signups false, `?osm=signups_closed` | `account-osm-return-closed` (punk) | yes |
| `account-square-signed` | Signed in: the account square shows the pseudonym's first two letters or digits (« ju_93 » → « JU ») in Archivo 900, the square inverted (the ink's paper), named « Votre profil »; a tap opens the account's screen, 26a's leaderboard (`profile/leaderboard.ts openLeaderboard`) | account/index.ts:155 drawSquare, 169 open | 25b (its « JU » square), drawn as 25a's key (25a's frame 3, signed in, holds no drawing) | `#16.5/48.8963/2.2382` (who=ana: « AN ») | `map-z16-street` (punk) | yes, without a capture of its own: every punk map state's ticket |
| `account-square` | Punk signed out: under the ticket's link the sun / moon square and the account's (25a's person), two 44 px keys on their offset shadow, named « Compte : se connecter ou demander un compte » | account/index.ts:155 drawSquare; machine.ts buildTicket; theme/punk/map.css .ticket-square | 25a frames 1 and 2 (the square released; pressed while its sheet is open) | route /api/me → 401, `#16.5/48.8963/2.2382` | `account-square` (punk) | yes |
| `account-ask` | OSM's sign-in off (an older API, offline, GET /api/osm/status failing): « Compte » in the camera sheet's place, the square pressed in pink: the cut-out « COMPTE », ×; the « Inscriptions fermées · pour l'instant » stamp; « La carte se lit sans compte. »; « Me contacter · demander un compte → » (light blue key, a `mailto:` asking for an account), no password form (2026-10-11); under a dashed rule « Les caméras viennent d'OpenStreetMap : contribuez-y directement ↗ », then the four legal pages' links (`legal-account-links`); on a phone half open, the ticket slid away | account/index.ts:234 ask, 192 render; main.ts:910 showAccount; theme/punk/account.css | 25a frame 1 | `account-square`, the account square | `account-ask` (punk) | yes |
| `account-form` | « Entrer », at `?compte=motdepasse` only (nothing links to it; signed out; the parameter removed from the address): the cut-out « ENTRER », ×; « Identifiant » (focused), « Mot de passe », « Entrer → »; under a dashed rule « Mot de passe oublié ? Me contacter » (the same mailto, subject « Mot de passe oublié ») and « Contribuer sur OpenStreetMap ↗ »; « ← Retour » to « Compte »; on a phone full height | account/index.ts land, form | 25a frame 2 | route /api/me → 401, `?compte=motdepasse` | `account-form` (punk) | yes |
| `account-form-error` | Refused (one answer for an unknown pseudonym, a wrong password, a disabled account): « Identifiant ou mot de passe faux. » on the yellow band (role alert), both fields `aria-invalid`, the password emptied and focused | account/index.ts:310 form | 25a frame 2 (its error) | `account-form`, « ana », « mauvais », route POST /api/session → 401 credentials | `account-form-error` (punk) | yes |

### /revue

Lots 1 « Modérer », 2 « Administrer » and 4 « Statistiques » of its redesign (plan-revue): no mockup draws /revue; its boards P1 (« File »), P2 (a camera), P3 (« Fiche utilisateur »), P4 (« Comptes »), P5 (« Retraits » and « Réglages ») and P6 (« Statistiques ») give the direction, not pixels (« Écarts », below). rev is the bench's administrator, rvw its reviewer; both enter by the privileged entry (POST /api/review/session).

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `review-visitor` | Lot 2, no privileged session (signed out, or a session the map opened: OpenStreetMap's or /api/session's): GET /api/review/me → 401 privileged; « Connexion à la revue » (h1), « Réservée aux relecteurs et aux administrateurs : entrez avec votre identifiant et votre mot de passe. », the form (Identifiant, Mot de passe, Entrer: POST /api/review/session; the page loads again once in, at the same address), « Retour à la carte »; the head « Revue » alone | review/main.ts signInView, loginForm; review/auth.ts signIn | IMPROVISED | who=rev, routes /api/review/me → 401 privileged, /api/me → 401, `/revue` | `review-visitor` | yes |
| `review-login-error` | The same, refused (a wrong password, or an account that is neither reviewer nor administrator: one answer): « Identifiant ou mot de passe faux. » on the yellow band (role alert), the password emptied and focused | review/main.ts loginForm | IMPROVISED | `review-visitor`, « ana », « mauvais », route POST /api/review/session → 401 | `review-login-error` | yes |
| `review-contributor` | A contributor signed in on the map: the sign-in, and above the form « Sur la carte, vous êtes connecté en tant que ana, qui n'est ni relecteur ni administrateur. » | review/main.ts signInView | IMPROVISED | who=rev, routes /api/review/me → 401 privileged, /api/me → ana, a contributor, `/revue` | `review-contributor` | yes |
| `review-not-found` | /revue or /revue.html for another account: the site file answers 404 (an empty page) | deploy/preview.caddy (imitated by the script's proxy) | IMPROVISED | who=ana, `/revue` | `review-not-found` | yes |
| `review-session-ended` | The privileged session gone while the page is open (its 8 hours, the API restarted, an administrator's « Couper l'accès »): any call's 401 privileged brings the sign-in back with « Votre session de revue a pris fin : entrez de nouveau. » above it | review/main.ts fail, signInView | IMPROVISED | who=rev, route GET /api/review/queue → 401 privileged, `/revue` | `review-session-ended` | yes |
| `review-api-down` | « API injoignable » (h1), « La revue ne peut pas charger la file (502). » | review/main.ts fail | IMPROVISED | who=rev, route /api/review/** → 502 | `review-api-down` | yes |
| `review-reviewer` | A reviewer (role reviewer): the head « Revue » with « File » and « Registre » (lot R1b), the pseudonym and « Se déconnecter »; in a camera's view no « Retrait » | review/main.ts head; review/camera.ts render | IMPROVISED (board P1) | seed full, who=rvw, `/revue` | `review-reviewer` | yes |
| `review-admin-only` | A reviewer at an administrator's address (`?vue=comptes`, `?compte=`…), or an administrator's call answered 403 admin: « Réservé aux administrateurs. », « Votre compte relit la file ; cette partie de la revue est celle des administrateurs. », under the head with « File » | review/main.ts route, adminOnly | IMPROVISED | who=rvw, `/revue?vue=comptes` | `review-admin-only` | yes |
| `review-empty` | « File » with nothing: « Rien en attente », the filters without counts, « Aucune caméra », « Rien à afficher avec ce filtre. » (the CSV is the administrator's, in « Réglages », lot 2) | review/queue.ts queueView | IMPROVISED (board P1) | seed empty, who=rev | `review-empty` | yes |
| `review-todo` | « File à traiter » (default « À traiter »): the head « Revue », its tabs (an administrator: File · Registre · Comptes · Retraits · Réglages · Statistiques · Journal; a reviewer: `review-reviewer`), the pseudonym and « Se déconnecter »; « N en attente · la plus ancienne : D jours »; the filters À traiter / Conflits / Noms / Tout with their counts (test accounts aside) and the search; one row per camera, a link to its view, the cameras confirmed on site first then the oldest: its label (« Ajout · Dôme · Ville de Paris · Rue …, Commune », « Caméra » for an unknown kind, an add of unknown kind « Ajout · Rue …, Commune », never an id), what waits in one line (« Déplacement de 8 m », « Direction : inconnue → 120° (est-sud-est) », « Introuvable + position », « + direction, hauteur »), its signals (« ✓ sur place », « sur place : non », « confirmée par N comptes », the tags « conflit OSM », « nom à choisir », « test », « masquée »), its age (« 14 j », read « il y a 14 jours »), its author and record (« ana · 4 acceptées · 1 refusée », « aucune contribution décidée ») | review/queue.ts row, queueView; review/rows.ts labelText, waitLine, authorText | IMPROVISED (board P1) | seed full, who=rev, `/revue` | `review-todo` | yes |
| `review-all` | « Tout »: every camera with a live contribution, the latest first; `?file=all` | review/queue.ts | IMPROVISED (board P1) | `/revue?file=all` | `review-all` | yes |
| `review-conflicts` | « Conflits », from the map's link `?status=conflict` (and `&kind=add`), the address rewritten `?file=conflicts` | review/main.ts readQuery | IMPROVISED (board P1) | `/revue?status=conflict` | `review-conflicts` | yes |
| `review-names` | « Noms »: the proposed operator names waiting for their choice (here none: « Rien à afficher avec ce filtre. ») | review/queue.ts | IMPROVISED (board P1) | `/revue?file=names` | `review-names` | yes |
| `review-search` | A search (street, commune, pseudonym or id; 300 ms after the last key), `&q=` in the address | review/queue.ts | IMPROVISED (board P1) | « Arche » | `review-search` | yes |
| `review-search-none` | « Aucune caméra ne correspond à « zzzz ». » | review/queue.ts | IMPROVISED (board P1) | « zzzz » | `review-search-none` | yes |
| `review-camera-move` | A camera's view (`?camera=`, the queue's filter kept): the bar « ‹ File » and its label as h1 (focused); the small map (« rond cerclé : position sur la carte », « rond plein : position proposée » joined by a dotted line, « contour pointillé : champ actuel », « zone pleine : champ proposé », « losange : caméra à moins de 10 m », « carré : position OpenStreetMap actuelle » — the legend names the shapes drawn); the author and record, « reçue le … »; « À décider : Position », the table Info / Sur la carte / Proposé (« position OSM actuelle » → « déplacée de 8 m (libre) »: no certainty beside the position, `geom_certainty` being the drawn field's); « Destination : reste sur Surveillance World »; « Détails » closed, its marker « ▸ » and what it holds beside it « identifiant, version et tags OSM, décisions » (until 17/10 a flex summary without its marker read as an empty title); the bar fixed at the bottom, Rejeter · Valider (pink, its offset shadow) | review/camera.ts render, diffTable, actions; review/map.ts | IMPROVISED (board P2) | `/revue?camera=n1925222793` | `review-camera-move` | yes |
| `review-camera-add` | An add no build has applied: « Ajout · … » as h1, « ✓ sur place », « À décider : Ajout », its position (« libre, dans l'emprise d'un bâtiment »), « Aucune autre caméra à moins de 10 m. »; Valider validates the add and its author's waiting answers in one decision (POST /api/review/decide on the add: its `decided` list, which « Annuler » puts back; lot 2) | review/camera.ts unitsOf, decideUnit, notes | IMPROVISED (board P2) | `?camera=c5eed0a020000` | `review-camera-add` | yes |
| `review-camera-conflict` | A build's conflict: « conflit OSM », « La caméra a changé dans OpenStreetMap : version 2 → 3… », its position and tags now, the tags seen, the history link; the map's square at OpenStreetMap's position; Valider accepts OpenStreetMap's version; no « Annuler » after it (a conflict's decision is not taken from `pending`) | review/rows.ts conflictBox; review/map.ts | IMPROVISED (board P2) | `?camera=n1891366478&file=conflicts` (e1, settled in conflict); phone: scrolled to what to decide | `review-camera-conflict` | yes |
| `review-camera-duplicate` | An add in conflict: « Une caméra OpenStreetMap a été cartographiée à moins de 5 m… », « Caméra OpenStreetMap 1 : historique » (a link, no raw id), the neighbour « À 1,8 m : Fixe, déjà sur la carte — doublon possible. » | review/rows.ts conflictBox; review/camera.ts notes | IMPROVISED (board P2) | `?camera=cadd000030000`; phone: scrolled | `review-camera-duplicate` | yes |
| `review-camera-direction` | A direction answer: « Direction · inconnue (par défaut) · 120° (est-sud-est) », the proposed field filled over the dashed one | review/camera.ts nowCell, proposedCell | IMPROVISED (board P2) | `?camera=n5442645358`; phone: scrolled | `review-camera-direction` | yes |
| `review-camera-no-effect` | A height without tilt: « Sans effet sur le champ : aucune inclinaison connue. » | review/camera.ts notes | IMPROVISED (board P2) | `?camera=n13610509865`; phone: scrolled | `review-camera-no-effect` | yes |
| `review-camera-test` | A test account's contribution: the tag « test » | review/camera.ts render | IMPROVISED (board P2) | `?camera=n1879237460` (tess) | `review-camera-test` | yes |
| `review-camera-others` | Two sends waiting on one camera: the oldest to decide, then « Aussi en attente sur cette caméra », « Elles viennent une à une, après celle du dessus. », each in a line | review/camera.ts render | IMPROVISED | `?camera=n2001233184` (ana's move, bob's « introuvable »); phone: scrolled | `review-camera-others` | yes |
| `review-camera-decided` | Nothing waits: « Rien à décider sur cette caméra. », « Détails » open with the decisions (« Position : déplacée de … · appliquée au build … · rev, … », « remplacée par une plus récente »), each with « Changer la décision »; the bar « Fiche suivante » | review/camera.ts details, decidedLine | IMPROVISED | `?camera=n1923568246` (b1, b2); phone: scrolled to « Détails » | `review-camera-decided` | yes |
| `review-details` | « Détails » opened (« ▾ », the hint gone): « Identifiant : n1925222793 » with « Copier » (« Identifiant copié. » said; refused, the id selected and « Copie impossible… »), « Version OpenStreetMap N · Historique OpenStreetMap », the OpenStreetMap tags, « Décisions » (« Aucune décision encore. »), the withdrawn ones | review/camera.ts details | IMPROVISED (board P2) | `review-camera-move`'s, « Détails » | `review-details` | yes |
| `review-camera-send` | A « Modifier » send (DECISIONS 2026-10-08): « À décider : Modification · 3 changements », one table row per piece in « Modifier »'s order (Position, Type, Hauteur), a piece's status beside it when they differ, one decision for the send (`decide_batch`); the map draws the field its pieces give together | review/camera.ts unitsOf, diffTable; review/map.ts | IMPROVISED (board P2) | seed full, then ana's send on n1879237466 (moved 4 m, a tube, 1er étage; writes); phone: scrolled | `review-camera-send` | yes |
| `review-on-site` | « Valider ce qui est fait sur place (2) » above Rejeter · Valider, shown only when it does more than Valider (two sends made on site, or one that is not the one decided) | review/camera.ts actions | IMPROVISED | seed full, then ana's and bob's « elle est là » on site on n1835838252 (writes) | `review-on-site` | yes |
| `review-decided` | One tap on Valider: the next camera of the queue opens (`replaceState`: back returns to the queue), and above its bar « Validée. » with « Annuler (8 s) », counting down, read aloud, reached by Tab after the bar; its time stops while the pointer or the focus is on it | review/camera.ts decided; review/say.ts toast | IMPROVISED (board P2) | `review-camera-move`'s, Valider (writes) | `review-decided` | yes |
| `review-undone` | « Annuler »: POST /api/review/undo, the decided camera back, « Décision annulée : elle attend de nouveau. » said | review/camera.ts decided; review/say.ts | IMPROVISED | `review-decided`, « Annuler » (writes) | `review-undone` | yes |
| `review-queue-done` | The last camera decided: back to « File », « File vide : rien d'autre n'attend. » at the top (« Fin de la liste. » when cameras remain, under a search, or under a filter other than « À traiter ») | review/main.ts next; review/queue.ts | IMPROVISED | `review-camera-move`'s, route GET /api/review/queue → empty, Valider (writes) | `review-queue-done` | yes |
| `review-decide-error` | A decision refused: the sentence above the bar and read aloud (here « Trop de décisions en une minute : attendez un instant, puis recommencez. »; « Déjà décidée entre-temps… », « Retirée par son auteur… », « L'élément n'existe plus dans OpenStreetMap… », « Hors ligne : rien n'a été envoyé. », « Erreur du serveur (N)… »); the buttons stay active | review/say.ts errorText, fail | IMPROVISED | `review-camera-move`'s, route POST /api/review/decide → 429 | `review-decide-error` | yes |
| `review-change-armed` | « Changer la décision » (under « Détails »), then « Rejeter : confirmer » (two steps, 6 s) | review/camera.ts decidedLine; participate/decide.ts twoStep | IMPROVISED | `?camera=n1925180682` (validated); phone: scrolled | `review-change-armed` | yes |
| `review-camera-hidden` | An administrator's camera view: under « Détails », « Retrait » with « Masquer cette caméra » (two taps, « Masquer : confirmer »; POST /api/review/hidden, no password asked; « Elle quitte la carte au prochain build ; on ne garde que son identifiant et le jour. Entre au journal. »); hidden: the tag « masquée » among the signals and « Masquée le 16/10/2026 · au prochain build. » (or « retirée de la carte (build X) ») with the link « La démasquer : Retraits » | review/camera.ts retreat, fetch; review/hidden.ts onMap | IMPROVISED (board P2: « Masquer la caméra… ») | seed full, who=rev, route GET /api/review/hidden → that camera, `?camera=n1925222793`; phone: scrolled to « Retrait » | `review-camera-hidden` | yes |
| `review-accounts` | « Comptes » (`?vue=comptes`, an administrator's): the head with its six tabs (File · Comptes · Retraits · Réglages · Statistiques · Journal; a phone: a row of their own, scrolling sideways when it must), « Comptes » (h1), « Pseudonyme… » (a search, 300 ms, `&q=` in the address), « Équipe » (a table: Pseudonyme, Rôle, Acceptées, En attente; « vous » beside one's own), « Contributeurs récents » (Pseudonyme, Dernière, Acceptées, En attente, Refusées; the latest to contribute first, 50 at most, then « Les 50 derniers à contribuer : au-delà, cherchez par pseudonyme. »); the tags « test », « désactivé », « jamais activé »; each pseudonym a link to its sheet | review/accounts.ts accountsView | IMPROVISED (board P4) | seed full, who=rev, `/revue?vue=comptes` | `review-accounts` | yes |
| `review-account` | « Fiche utilisateur » (`?compte=<id>`): « ‹ Comptes » and the pseudonym (h1); Rôle, Arrivée (« octobre 2026 »), État (« actif · 1 session », « compte de test »), OSM (« non lié »), Publie sur OSM (« non »; `review-account-sync`); « Contributions » (En attente, Acceptées, Refusées: a send once; Dernière); « Ses N dernières contributions » (closed; each a link to its camera: label · field · status · day); « Publications OSM » (« Aucune : la publication n'est pas offerte. »); « Arrêter un abus » (the danger box: « Désactive le compte, coupe ses sessions, rejette ses 4 envois en attente. Réversible décision par décision (« Changer la décision » sur la fiche de chaque caméra). Entre au journal. », « Suspendre et rejeter ses envois »); « Compte »: Rôle…, Désactiver (Réactiver), Couper l'accès, Réinitialiser le mot de passe, Exporter ses données, Supprimer…, « Chaque action demande votre mot de passe s'il n'a pas été donné depuis 10 minutes, et entre au journal. »; a wide screen: the facts left, the two boxes right. Each action's refusal said under the buttons (« Pas sur votre propre compte… », « C'est le dernier administrateur… », « Ce compte n'a pas de mot de passe… », « Compte jamais activé… », « Compte de test… », « Le pseudonyme tapé ne correspond pas… »); done, the sheet again with its line at the top (« Accès coupé : 1 session fermée. », « Compte suspendu : 4 contributions rejetées. »…). Never an OSM id, a hash, a session's day or points | review/accounts.ts accountView; review/say.ts errorText | IMPROVISED (board P3) | seed full, who=rev, bob's sheet | `review-account` | yes |
| `review-reauth` | A destructive action answered 403 reauth: the modal dialog « Confirmez avec votre mot de passe », « Ensuite, pendant 10 minutes, les actions d'administration ne le redemandent pas. », Mot de passe (focused), Annuler · Confirmer; the page behind inert; a wrong password « Mot de passe faux. » in the dialog (role alert); confirmed (POST /api/review/reauth → 204), « Mot de passe confirmé. » said, the focus back on the action's button and the action tried once more; cancelled (Annuler, Escape), « Mot de passe non confirmé : rien n'a changé. » | review/auth.ts askPassword, withReauth | IMPROVISED | `review-account`'s, route POST /api/review/account/cut → 403 reauth, « Couper l'accès » twice | `review-reauth` | yes |
| `review-account-reset` | « Réinitialiser le mot de passe » in two taps: the sheet again, in « Compte » a box « Nouveau mot de passe · bob », the password in a mono face, « Copier le mot de passe » (« Mot de passe copié. »; refused, the password selected), « Il ne sera plus affiché : copiez-le et transmettez-le maintenant. Ses sessions sont coupées et son lien OpenStreetMap retiré. », focused; gone at the next view (the page never keeps it) | review/accounts.ts resetBox | IMPROVISED | `review-account`'s, route POST /api/review/account/reset → a fictitious password | `review-account-reset` | yes |
| `review-account-suspend-armed` | « Suspendre et rejeter ses envois » tapped once: « Suspendre : confirmer » on the danger's fill (6 s); the second tap suspends (POST /api/review/account/suspend) | review/accounts.ts accountView; participate/decide.ts twoStep | IMPROVISED (board P3) | `review-account`'s, one tap | `review-account-suspend-armed` | yes |
| `review-account-role` | « Rôle… »: under the buttons « Nouveau rôle », the three roles (Contributeur, Relecteur, Administrateur; the current one checked), « Un relecteur ou un administrateur entre dans la revue avec son mot de passe ; ses sessions en cours s'y ferment. », Annuler · Changer le rôle; the same role « C'est déjà son rôle : rien n'a changé. »; done « Rôle changé : Relecteur. » | review/accounts.ts roleForm | IMPROVISED (board P3: « Rôle… ») | `review-account`'s, « Rôle… » (smoke-participate) | — | yes, without a capture of its own |
| `review-account-delete` | « Supprimer… »: « Supprimer ce compte », « Le compte et ses sessions disparaissent ; ses contributions restent, sans auteur. Entre au journal. », « Tapez son pseudonyme, « bob », pour confirmer », Annuler · Supprimer définitivement; another pseudonym « Le pseudonyme tapé ne correspond pas : rien n'a été supprimé. »; done, « Comptes » with « Compte bob supprimé. » | review/accounts.ts deleteForm | IMPROVISED (board P3: « Supprimer… ») | `review-account`'s, « Supprimer… » (smoke-participate) | — | yes, without a capture of its own |
| `review-account-self` | One's own sheet, or the last administrator's: no « Arrêter un abus », no Rôle…, Désactiver, Réinitialiser nor Supprimer; « C'est votre compte : son rôle, son état et sa suppression passent par un autre administrateur. » (« Dernier administrateur : il ne peut être ni rétrogradé, ni désactivé, ni suspendu, ni supprimé. ») | review/accounts.ts accountView | IMPROVISED | who=rev, rev's own sheet (smoke-participate) | — | yes, without a capture of its own |
| `review-hidden` | « Retraits » (`?vue=retraits`): « Caméras masquées » (h1), « Identifiant ou lien ?cam=… » with « Masquer » (pink); what the id is said under it as it is typed (« n1925180682 : Fixe · Avenue de l'Arche, Courbevoie », « Inconnue de la base : vérifiez l'identifiant. »); a table Caméra (the id, its label under it), Depuis, Sur la carte (« au prochain build » tagged, « retirée de la carte (build f5365d14) »), « Démasquer » (the password again); « On ne garde que l'identifiant et le jour. »; masked: « Masquée : n… quitte la carte au prochain build. » (« …, mais n… n'est pas dans la base : vérifiez l'identifiant. », « … était déjà masquée. »); a malformed id « Identifiant non reconnu… »; no field for a reason | review/hidden.ts hiddenView, cameraOf, onMap | IMPROVISED (board P5) | who=rev, route GET /api/review/hidden → two cameras (one left the map), a map link typed, `/revue?vue=retraits` | `review-hidden` | yes |
| `review-settings` | « Réglages » (`?vue=reglages`): « Contributions ouvertes » (« Fermées : la carte se lit, tout moyen de contribuer et toute mention des comptes disparaissent. Rien n'est effacé. ») and « Inscriptions ouvertes » (« Fermées : les comptes existants se connectent et contribuent encore ; personne ne peut en créer. »), each a switch (role switch) with « Oui » / « Non » written on it, at once (POST /api/review/settings, the password again; « Contributions ouvertes : non. » said at the top); read only « Éditeur affiché · fixé au déploiement · (vide) » and « OpenStreetMap · connexion : serveur de test · écriture : non offerte »; « Données »: « Exporter toutes les contributions (CSV) » (GET /api/review/me first, the password asked when not given lately, then the file downloaded) | review/settings.ts settingsView; review/admin.ts download | IMPROVISED (board P5) | who=rev, `/revue?vue=reglages` | `review-settings` | yes |
| `review-settings-osm` | « Réglages » with the OSM synchronisation's two switches after the sign-ups': « Synchronisation OSM » (« Suspendue : aucun envoi vers OSM tant que suspendue, aucun appel à OSM. Les choix des personnes sont gardés ; à la reprise, ce qui a été rejeté entre-temps ne part pas. ») and « Écriture sur le vrai serveur OSM » (« À n'allumer qu'après la page d'activité sur le wiki d'OSM, le message sur le forum et deux semaines d'attente… »), each after the password again; without the live client (`osm.live_client` false) the second dashed and muted, `aria-disabled`, « Impossible de l'allumer : le client du vrai serveur OSM n'est pas configuré au déploiement. » under it and said on a tap (no request); the API's 409 `no_live_client` said the same way; « OpenStreetMap · connexion : serveur de test · écriture : serveur de test / serveur réel / non offerte » | review/settings.ts toggle; review/say.ts | IMPROVISED (board P5 draws two switches) | who=rev, `/revue?vue=reglages` | `review-settings-osm` | yes |
| `review-settings-osm-live` | The same where the live client is configured, the synchronisation suspended and writing live on | review/settings.ts | IMPROVISED | route GET /api/review/settings changed | `review-settings-osm-live` | yes |
| `review-queue-osm` | « OSM » (`?file=osm`): the cameras with a publication to OSM in conflict or uncertain (`pieces[].osm`), « conflit OSM » / « envoi OSM incertain » among their signals, the chip's count `summary.counts.osm` | review/queue.ts row; review/rows.ts FILTERS | IMPROVISED | the real queue's first two, given an OSM conflict and an uncertain send by a route | `review-queue-osm` | yes |
| `review-camera-osm` | A « Modifier » send whose pieces are bound apart: one destination line each, « Position · Destination : OpenStreetMap · partira une fois acceptée et appliquée à la carte (serveur de test) », « Type · Destination : reste sur Surveillance World · modifiée à la relecture, non publiée », « Hauteur · Destination : OpenStreetMap · envoi incertain : à vérifier sur OSM, rien n'est renvoyé (serveur de test) »; also « … · publiée · changeset n° N » (a link), « … · publiée (OSM avait déjà cette valeur) », « … · conflit OSM : <raison> », « … · en cours d'envoi » | review/rows.ts destinationLine; review/camera.ts destinations | IMPROVISED (board P2's reserved line) | `review-camera-send`'s send, route GET /api/review/camera changing its destinations | `review-camera-osm` | yes |
| `review-account-sync` | « Fiche utilisateur »: « OSM · non lié » and « Publie sur OSM · oui depuis octobre 2026 (serveur de test) · dernier refus d'OSM : trop d'envois, nouvel essai plus tard » (« non » when off; the refusal's class in words: autorisation retirée, compte bloqué sur OSM, OSM injoignable…); « Publications OSM »: « 2026-10 · publiée · changeset n° 12345 », « conflit OSM : … », « envoi incertain », « en cours d'envoi » | review/accounts.ts syncText, publicationLine | IMPROVISED (board P3) | route GET /api/review/account changed (bob) | `review-account-sync` | yes |
| `review-journal` | « Journal » (`?vue=journal`), an activity feed (the « go » of 17/10): the type's chips Tout · Contributions · Décisions · Administration (the queue's, one pressed) and Personne (a pseudonym, any case; a contribution's author) with « Filtrer » (`&type=`, `&qui=` in the address), « Les contributions sont lues dans leur table ; les gestes de la revue sont gardés 12 mois. Le jour seulement : jamais d'heure ni d'adresse IP. », « N lignes », one line per entry under the queue's 2 px rule, the newest day first: « 17/10 · ana · a proposé un déplacement de 7 m · Fixe · Avenue de l'Arche, Courbevoie » (the day, who in bold, « compte supprimé » in italics, a test account tagged « test », what in a short sentence, the queue's label in bold) and the camera's id at its end, a link to its view (44 px); a contribution: « a confirmé qu'elle est toujours là », « l'a signalée introuvable », « a proposé la direction : 210° (sud-ouest) », « a dit qui filme : commerce ou entreprise · Monop' », « a répondu « je ne sais pas » (direction) », « est d'accord avec une proposition », a « Modifier » send « a modifié type → petit dôme, direction → 210° (sud-ouest), hauteur → 1er étage », an add « a ajouté une caméra : type → … »; a decision « a validé / rejeté la contribution d'ana (position) », « a changé la décision sur la contribution d'ana : validée → en attente », « a validé sur place la contribution de bob »; an administrator's gesture « a changé le rôle de gil : Contributeur → Relecteur », « a coupé l'accès de cara · 1 session coupée », « a suspendu dan · 4 rejetées », « a changé un réglage : Inscriptions ouvertes → oui », « a démasqué la caméra (inconnue de la base) », « entrée à la revue refusée 3 fois pour rev » (no person); never a contribution's uuid; « Plus » while there is more (the focus on the first line added) | review/journal.ts journalView, line, contributionText, actionText | IMPROVISED (plan-revue §4, the « go » of 17/10: no board) | who=rev, route GET /api/review/log → the bench's feed (states/catalogue.mjs journalMock: five days, every type, filtered by `type` and `actor` as S6), `/revue?vue=journal` | `review-journal` | yes |
| `review-journal-filtered` | « Journal » under « Décisions » (pressed; `&type=decisions` in the address): only the review's decisions, « a validé la contribution d'ana (position) », « a rejeté la contribution de bob (présence) », « a changé la décision sur la contribution d'ana : validée → en attente (position) », « a validé sur place la contribution de bob (présence) », each with its camera; « 4 lignes » | review/journal.ts journalView | IMPROVISED (the « go » of 17/10: no board) | `review-journal`'s, « Décisions » | `review-journal-filtered` | yes |
| `review-stats` | « Statistiques » (`?vue=statistiques`, an administrator's; board P6, the « go » of 17/10), « On compte des visites et des connexions, jamais des personnes. » under the h1, eight blocks, two columns from 800 px: « Les dernières 24 heures » (« **412** chargements de la carte en 24 h »; a bar per hour of the map's loads, on each bar a tick: the same hour's mean over the 7 days before, none where they counted nothing; its legend « chargements de la carte, heure par heure » / « repère : la même heure, moyenne des 7 jours précédents »; « Repère, les mêmes heures des 7 jours précédents : N en moyenne · accueils : N · N connexions »), « Les 30 derniers jours » (« **412** chargements de la carte par jour (moyenne 7 j) », the 7 whole days before today; « Chargements de la carte », a line chart a day; « Contributions et décisions », two lines on one axis, the contributions solid, the decisions dashed, named in a legend; « Par jour (moyenne 7 j) : accueils · connexions · contributions · décisions »), « Les semaines, sur 13 mois » (« **N** chargements de la carte la semaine du 06/10 », the last whole week; the same two charts by week; « La même semaine : accueils · connexions · contributions · décisions »), « Inscriptions par mois » (« **31** inscriptions en octobre », a bar a month over 13 months, « N inscriptions sur 13 mois »), « La file grossit-elle ? », « Qui contribue ? », « Quelle part part sur OSM ? » (not offered: « Publication non ouverte. » in a dashed box) as lot 4, « Retraits » under its threshold (« Pas encore assez de données (n = 0). »); each block « Voir les chiffres » (a disclosure: its tables with `th scope`, newest first, the hour, day or week running « (en cours) »; a table of more than three columns scrolls sideways in a region of its own, never the page); « Les comptes de test n'entrent dans aucun chiffre. Heures et jours de Paris… » under them; nothing told by a colour alone | review/stats.ts statsView, hours, days, weeks, months, plot; review/main.ts | IMPROVISED (board P6) | who=rev, route GET /api/review/stats → the bench's mock in S6's shape (states/catalogue.mjs statsMock: the board's figures, dated from today and this hour), `/revue?vue=statistiques` | `review-stats` | yes: the bench's own loads never count (webdriver, a headless User-Agent) |
| `review-stats-empty` | The same, no block with enough data: each block's h2 and only « Pas encore assez de données (n = 0). »; « Quelle part part sur OSM ? » says « Publication non ouverte. » (not offered comes first) | review/stats.ts block | IMPROVISED (board P6, plan-revue §6 bis: nothing under a threshold) | who=rev, route GET /api/review/stats → statsMock({low: true}) (every block `enough: false`; S6 not integrated), `/revue?vue=statistiques` | `review-stats-empty` | yes |
| `review-stats-figures` | `review-stats`, « Voir les chiffres » of « Les dernières 24 heures » open: a table Heure, Chargements, Repère, Accueils, Repère, Connexions, Repère, the running hour first « 17/10 2 h (en cours) », « — » where the 7 days before counted nothing, « Repère : la moyenne de la même heure sur les 7 jours précédents… » under it | review/stats.ts hours, rows | IMPROVISED (board P6) | `review-stats`'s, « Voir les chiffres » | `review-stats-figures` | yes |
| `review-operator-choice` | A waiting operator answer whose name was typed, not listed (`operator_proposed`), alone or a piece of a « Modifier » send: in the table « Qui filme · … · Commerce ou entreprise · « Boulangerie Dupont » (nom proposé) », the tag « nom à choisir », a box « Nom proposé : « Boulangerie Dupont » », « Pour valider, choisissez : », three radios « le garder tel quel », « le remplacer par un nom de la liste », « aucun nom : garder « commerce ou entreprise » seul »; Valider before a choice says « Choisissez d'abord ce que devient le nom proposé. » and focuses the box (never a greyed button); the choice goes with the decision (POST /api/review/decide `operator`); « Valider ce qui est fait sur place » leaves it out | review/camera.ts chooser, actions; review/rows.ts nameWaits | IMPROVISED | who=rev, `/revue?camera=n5442645359` (the fixture's k1), ana's « Commerce ou entreprise » with « Boulangerie Dupont » proposed, bob's send (a dome, « Commerce ou entreprise » with « Pressing du Parvis »), posted through the API (writes) | — (shots-revue-operator.mjs: revue-operator-phone; revue-operator-wide-send) | yes, without a capture of its own |
| `review-operator-listed` | « le remplacer par un nom de la liste » chosen: a search « Chercher un nom de la liste » and under it the listed names of the answer's class whose folded form holds the text, 8 at most (POST /api/operators without `class`, once per camera; « Aucun nom de la liste ne correspond. »), a name tapped pressed and « Nom choisi : Franprix » | review/camera.ts chooser | IMPROVISED | `review-operator-choice`'s, « le remplacer… », « fran », « Franprix » | — (shots-revue-operator.mjs: revue-operator-phone-listed) | yes, without a capture of its own |
| `review-operator-decided` | Decided, the name's fate on its line under « Détails »: « Nom proposé : « X », accepté tel quel », « …, remplacé par « Franprix » », « …, écarté (aucun nom) », or rejected « …, refusé avec la contribution »; « Changer la décision » towards a validation asks the choice again | review/rows.ts proposedText; review/camera.ts decidedLine | IMPROVISED | `review-operator-listed`'s, Valider; then the other send « le garder tel quel », Valider, or Rejeter (writes) | — (shots-revue-operator.mjs: revue-operator-phone-done, revue-operator-wide-done) | yes, without a capture of its own |
| `review-camera-gone` | « Caméra absente du build servi. » | review/camera.ts notes | IMPROVISED | — | — | no: needs a contribution on a camera a later build dropped (two builds loaded in turn) |
| `review-no-height` | « Validée, sans effet : la caméra n'a pas de hauteur au moins estimée… » | review/camera.ts notes | IMPROVISED | — | — | no: the fixture's tilt l7 has no uuid, no contribution can carry it; needs uuids in `contrib-ci.jsonl` |
| `review-conflict-reasons` | Conflict reasons same_day, osm_deleted, osm_tags, moved, kind, kind_tilt | review/rows.ts conflictBox | IMPROVISED | — | — | no: h1, h2 (same_day) are no uuids, f1's camera n1 is not served (the API refuses it); the other reasons are in no outcome of the fixture |
| `review-destination-osm` | « Destination : OpenStreetMap · publiée · changeset n° N » (a link to the changeset on the live or the test server), « … · conflit OSM : <raison> » (osm_way: « sommet d'une ligne ou d'un bâtiment sur OSM, rien n'a été déplacé »), « … · envoi incertain », « (serveur de test) »; under « À décider » and, once decided, under its line in « Décisions » | review/rows.ts destinationLine | IMPROVISED | — | — | no: publishing to OpenStreetMap is not offered (DECISIONS 2026-10-14); a publication row only from the OSM lot's own benches |
| `review-registre` | « Registre » (`?vue=registre`, lot R1b; a reviewer's and an administrator's): « Erreurs signalées dans le registre » (h1), « N en attente · la plus ancienne : D jours », the lead « Personne ne relit les documents du registre… », one block per reported document, the oldest first (its id, « Voir le contrat » → /registre/contrat/<affaire>, its age), a box per report (what is wrong, its age, the correction as written, « Source : » a link, « Contact : … »), the decision: « Champ corrigé », « Valeur » with its hint, « Raison (gardée avec la correction) », « Accepter » · « Refuser »; under the list, what is kept | review/registre.ts; review/main.ts | IMPROVISED (no board) | who=rvw, reports seeded, `/revue?vue=registre` | — | yes |
| `review-registre-empty` | Nothing waiting: « Rien en attente », « Aucun signalement en attente. » | review/registre.ts | IMPROVISED | GET /api/review/registre → no document | — | yes |
| `review-registre-invalid` | Accepting without a field, with a value that does not fit (« Valeur non reconnue. AAAA-MM-JJ ou JJ/MM/AAAA. ») or without a reason; the API's 422 value, 409 decided, 404 unknown_report: said under the form (role alert), the focus on the field | review/registre.ts; review/registre-value.ts; review/say.ts | IMPROVISED | a date valued « deux cent mille » | — | yes |
| `review-registre-decided` | After a decision: « Correction acceptée : date de <id>, appliquée à la prochaine construction du registre. » or « Signalement refusé : <id> reste tel quel. »; the list again, the h1 focused; the journal « a accepté une correction du registre (date) · <id> » under « Décisions » | review/registre.ts; review/journal.ts | IMPROVISED | accept a date | — | yes |

### Errors

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `error-meta-missing` | tiles/meta.json missing: no map, the page's colour with the panels' empty frames (a bar top left, an empty button bottom right), nothing said (top-level await, no catch) | main.ts:82 | IMPROVISED | route meta.json → 404 | `error-meta-missing` | yes |
| `error-tiles` | Our tiles fail: the basemap alone, nothing said (one retry on a network error) | main.ts:64-76 | IMPROVISED | route detail, streets, admin .pmtiles → 500 | `error-tiles` | yes |
| `error-api-down` | API unreachable: no « ＋ Ajouter », no proposals; the sheet still offers participation (a send would wait in the queue) | participate/index.ts:93-100; proposals.ts:190 | IMPROVISED | route /api/** aborted | `error-api-down` | yes |
| `error-offline-map` | Offline, the map moved where nothing is loaded: missing tiles, nothing said | — | IMPROVISED | offline, z18 elsewhere | `error-offline-map` | yes |
| `error-rate-send` | A send answered 429: « Merci, c'est enregistré. », the item stays in the queue (counter), tried again every 15 s | queue.ts:190 run; participate/index.ts:425 | IMPROVISED | route POST /api/contributions → 429 | `error-rate-send` | yes |
| `error-send-refused-500` | A contribution on a built add whose add the database does not hold (after a reset): the API fails with 500 (TypeError, `pipeline/lacarte/api/app.py:695` `target = add[0]`), the queue keeps it for ever — a defect | queue.ts:190 run | IMPROVISED | seed empty, cadd000010000, « Elle est là » | `error-send-refused-500` | yes |

### Leaderboard

Punk only (lot « comptes »; `src/profile/leaderboard.ts`). Test data, unless the row says
otherwise: punk; route: profile-mock (since the launch lot it answers `GET /api/config` with
publishing offered), the account square « Votre profil » on `#17.6/48.8963/2.2386`.

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `board-signed` | Lot U: under « Apparaître dans le classement des autres », 26a's switch « Afficher mon pseudonyme sur les caméras que j'ai relevées », off by default, and under it what it reveals: « Visible de tous : la fiche de chaque caméra que vous avez relevée dira votre pseudonyme et le mois, de quoi suivre où vous passez. Sinon, elle dit « par un contributeur ». Réversible à tout moment, aussitôt. » (the switch described by it) | profile/leaderboard.ts signedSwitch | IMPROVISED (26a's switch, a second one) | route: GET /api/me says `history_pseudonym` false | `board-signed` (punk) | yes |
| `board-signed-on` | The switch checked (✓ on pink): PUT /api/me/history-pseudonym {on: true}; the cameras' history says the pseudonym from the next opening of a sheet | profile/leaderboard.ts signedSwitch | IMPROVISED | `board-signed`, the switch tapped | `board-signed` (punk) | yes, without a capture of its own: `board-signed`'s screen, the box checked |
| `board-signed-offline` | The switch back as it was, « Réglage impossible hors ligne : rien n'a changé. » | profile/leaderboard.ts signedSwitch | IMPROVISED | PUT /api/me/history-pseudonym fails as offline, the switch tapped | `board-optin-offline` (punk) | yes, without a capture of its own: `board-optin-offline`'s words under the other switch |
| `board-opted-out` | Not in the others' leaderboard: the switch unchecked, « Vous » without a rank, « Visible de vous seul : vous n'apparaissez pas dans le classement des autres. », the list without you | profile/leaderboard.ts:276 drawYou | IMPROVISED (partly: 25b's earlier leaderboard tab says « Visible de vous seul ») | the account not opted in | `board-opted-out` (punk) | yes |
| `board-empty` | Nobody this month: no podium, « Personne n'apparaît encore au classement pour cette période. », « Vous » | profile/leaderboard.ts:211 | IMPROVISED | an empty leaderboard | `board-empty` (punk) | yes |
| `board-offline` | « Classement indisponible hors ligne. », no podium, no « Vous » | profile/leaderboard.ts:211 | IMPROVISED | leaderboard and points fail as offline | `board-offline` (punk) | yes |
| `board-optin-offline` | The switch back as it was, « Réglage impossible hors ligne : rien n'a changé. » | profile/leaderboard.ts:138 | IMPROVISED | PUT /api/me/leaderboard fails as offline, the switch tapped | `board-optin-offline` (punk) | yes |
| `board-scale-offline` | « Barème » with « Barème indisponible hors ligne. » | profile/leaderboard.ts:369 drawScale | IMPROVISED | the leaderboard fails as offline, « Comment on compte ? » tapped | `board-scale-offline` (punk) | yes |
| `board-delete-form` | « Supprimer mon compte » unfolded: what disappears, « Mot de passe » (25a's field), « Supprimer mon compte : confirmer → », « Annuler » | profile/leaderboard.ts:419 deleteLink | IMPROVISED (26a draws the link only) | « Supprimer mon compte » tapped | `board-delete-form` (punk) | yes |
| `board-delete-empty` | « Entrez votre mot de passe. » | profile/leaderboard.ts:455 | IMPROVISED | confirmed with no password | `board-delete-empty` (punk) | yes |
| `board-delete-wrong` | « Mot de passe incorrect : rien n'a été supprimé. » | profile/leaderboard.ts:466 | IMPROVISED | a wrong password (401) | `board-delete-wrong` (punk) | yes |
| `board-delete-failed` | « Suppression impossible pour l'instant (hors ligne ?) : rien n'a été supprimé. » | profile/leaderboard.ts:466 | IMPROVISED | POST /api/me/delete fails as offline | `board-delete-failed` (punk) | yes |
| `board-delete-last-admin` | The last active administrator deleting their own account (409 last_admin): « Vous êtes le dernier administrateur : nommez-en un autre dans /revue avant de supprimer votre compte. Rien n'a été supprimé. » | profile/leaderboard.ts delete | IMPROVISED | POST /api/me/delete → 409 last_admin | — | no: one administrator alone, tested by tests/test_review_accounts.py |
| `board-month` | « Octobre » and « Total » pressed, the podium (2e k.lenoir 660, 1er rat_des_halles 740, 3e pigeon_vif 610) at its scores' height, « Vous · 4e 440 pts », its bar and four sorts, « +90 pts en attente de revue » | profile/leaderboard.ts:64 openLeaderboard, 248 drawPodium, 276 drawYou | 26a | the « classement » ticket | `board-month` (punk) | yes |
| `board-logout-offline` | « Déconnexion impossible hors ligne : réessayez une fois le réseau revenu. » under « Se déconnecter » | profile/dom.ts logoutLink | IMPROVISED | DELETE /api/session failing, « Se déconnecter » tapped | `board-logout-offline` (punk) | yes |
| `board-password-form` | « Changer le mot de passe » unfolded: « Mot de passe actuel », « Nouveau mot de passe (12 caractères au moins) », « Changer → » (25a's blue key), « Annuler » | profile/leaderboard.ts passwordLink | IMPROVISED (25a's field and key; 26a draws no such link) | « Changer le mot de passe » tapped | `board-password-form` (punk) | yes |
| `board-password-wrong` | « Mot de passe actuel incorrect : rien n'a changé. » under the fields | profile/leaderboard.ts passwordLink | IMPROVISED | a wrong current password sent (POST /api/me/password answered 401) | `board-password-wrong` (punk) | yes |
| `board-export` | The launch lot: « Télécharger mes données » in the foot, between « Changer le mot de passe » (or the OSM links) and « Se déconnecter », a link as the others; tapped, off while `GET /api/me/export` is fetched (as bytes), then the browser saves `surveillance-world-mes-donnees.json` (the API's name), the link on again, nothing said | profile/leaderboard.ts exportLink; profile/api.ts exportData, EXPORT_FILE | IMPROVISED (26a draws no such link: §3) | « Télécharger mes données » tapped (profile-mock answers the export) | — | yes, without a capture of its own (checked by smoke-profile: the download, its name, its JSON) |
| `board-export-session` | The export answered 401 (the session gone): « Votre session a pris fin : reconnectez-vous pour télécharger vos données. » under the link (role status), nothing saved, the link on again | profile/leaderboard.ts exportLink | IMPROVISED | profile-mock's `exportStatus` 401, « Télécharger mes données » | — | yes, without a capture of its own (checked by smoke-profile) |
| `board-export-failed` | Offline or any other answer: « Téléchargement impossible pour l'instant (hors ligne ?) : réessayez plus tard. » under the link (role status), nothing saved | profile/leaderboard.ts exportLink | IMPROVISED | GET /api/me/export failing as offline, « Télécharger mes données » | — | yes, without a capture of its own |
| `board-osm-status` | OSM lot 1, back from OpenStreetMap signed in: the account's screen opened at once, a line at the top of its body (role status, the focus on the title): « Vous êtes entré avec OpenStreetMap. » (`signed`), « Votre compte est relié à OpenStreetMap. » (`linked`), « Ce compte OpenStreetMap est déjà relié à un autre compte : rien n'a changé. » (`link_taken`), « Votre compte est déjà relié à un autre compte OpenStreetMap : rien n'a changé. » (`link_other`), refused or failed as in `account-osm-status`; after a signup « Compte créé : bienvenue, <pseudonyme>. »; OSM lot 2: « Publication activée : rien ne part sans vous. » (`write_on`), « L'autorisation de publier sur OpenStreetMap n'a pas abouti : rien n'a changé, réessayez. » (`write_failed`), « Ce compte OSM n'est pas celui relié à votre compte : rien n'a changé. » (`write_other`); with `?debug=1` a failure's reason under it (`account-osm-status`) | account/index.ts land, open; profile/leaderboard.ts openLeaderboard | IMPROVISED | an OSM account; `?osm=signed` | `board-osm-status` (punk) | yes |
| `board-osm-link` | An account not linked, sign-in on: « Relier à OpenStreetMap » first in the foot, a link as the others that unfolds « Votre mot de passe, pour relier » and « Relier → » (the password asked again, POST /api/osm/link; a wrong one said; then OSM's page, coming back to the page); sign-in off, or an older API without `osm`: nothing | profile/leaderboard.ts osmLinks | IMPROVISED (26a's links) | /api/me `osm: false, password: true`, /api/osm/status `login: true`; scrolled to the foot | `board-osm-link` (punk) | yes |
| `board-osm-linked` | Linked, with a password: « ✓ Relié à OpenStreetMap » (an information line, not a target) and « Délier » beside it (described by the line); « Changer le mot de passe » under them | profile/leaderboard.ts osmLinks | IMPROVISED | /api/me `osm: true, password: true` | `board-osm-linked` (punk) | yes |
| `board-osm-only` | An account made with OpenStreetMap (no password): « ✓ Relié à OpenStreetMap » without « Délier » (it would lock the account out), no « Changer le mot de passe »; « Se déconnecter », « Supprimer mon compte » | profile/leaderboard.ts osmLinks, openLeaderboard | IMPROVISED | /api/me `osm: true, password: false` | `board-osm-only` (punk) | yes |
| `board-delete-osm-only` | « Supprimer mon compte » for an account made with OpenStreetMap (no password): « Retapez votre pseudonyme pour confirmer » (a text field), a wrong one said « Ce n'est pas votre pseudonyme exact : rien n'a été supprimé. » | profile/leaderboard.ts deleteLink | IMPROVISED (26a draws the password's form) | an OSM-only account, « Supprimer mon compte », « pas_moi » sent | `board-delete-osm-only` (punk) | yes |
| `board-osm-unlinked` | « Délier » done (POST /api/osm/unlink → 204): « Relier à OpenStreetMap » again (focused) and « Délié d'OpenStreetMap : entrez désormais avec votre mot de passe. » (role status) | profile/leaderboard.ts osmLinks | IMPROVISED | `board-osm-linked`, « Délier » | `board-osm-unlinked` (punk) | yes |
| `board-osm-unlink-failed` | « Délier » not done: « Impossible de délier pour l'instant (hors ligne ?) : rien n'a changé. » (offline, any other answer); on 409 no_password « Impossible de délier un compte sans mot de passe : vous ne pourriez plus entrer. »; « Délier » again | profile/leaderboard.ts osmLinks | IMPROVISED | `board-osm-linked`, POST /api/osm/unlink failing as offline, « Délier » | `board-osm-unlink-failed` (punk) | yes |
| `board-sync-not-offered` | The OSM synchronisation not offered (GET /api/config `sync: false`, or GET /api/osm/sync `offered: false`: production while writing goes to the test server, 2026-10-14; an older API): no « Publier sur OpenStreetMap »; the foot as before | profile/sync.ts syncSection | IMPROVISED | /api/osm/sync not offered | `board-sync-not-offered` (punk) | yes |
| `board-sync-off` | Offered, the choice off: under a dashed rule « PUBLIER SUR OPENSTREETMAP », « Serveur de test d'OSM : ce qui part n'apparaît pas sur la vraie carte. » (dev), the radio group « Rester sur Surveillance World » (✓, pink box) / « Publier aussi sur OpenStreetMap en mon nom », the text (« … sera publiée sur OSM en votre nom après relecture… », « Ce qui part : » and its five lines with their keys, « Ne part jamais… », « Sous votre nom OSM, c'est public et permanent… ») | profile/sync.ts draw | IMPROVISED (no board: §3) | profile-mock SYNC | `board-sync-off` (punk) | yes |
| `board-sync-enable` | « Publier aussi… » chosen: « Votre mot de passe, pour autoriser » (focused; none for an account without one, the key focused), « Autoriser sur OpenStreetMap → », « Annuler »; « Mot de passe incorrect : rien n'a changé. », « Entrez votre mot de passe. », « Un compte de test ne publie pas sur OpenStreetMap. », « Les contributions sont fermées pour l'instant : rien n'a changé. » (403 closed), « Impossible pour l'instant (hors ligne ?)… » under it (role alert); right: POST /api/osm/sync {on: true}, OSM's page | profile/sync.ts enableForm | IMPROVISED | `board-sync-off`, « Publier aussi… », a wrong password | `board-sync-enable` (punk) | yes |
| `board-sync-on` | On: « Publier aussi… » checked, « Activé depuis octobre 2026 » under it, then « Vous pouvez lier la page du projet depuis votre profil OSM (facultatif) : la page Surveillance World sur le wiki d'OSM ↗ » (the wiki page, a new window, « (nouvelle fenêtre) » said; the « go » of 17/10), the text, then the history | profile/sync.ts draw | IMPROVISED | profile-mock SYNC_ON | `board-sync-on` (punk) | yes |
| `board-sync-history` | « VOS CONTRIBUTIONS ET OSM (11) » (the list's heading tile), a row per contribution under the scale's dashed rule: the camera in bold capitals, « Question · mois · état » in the typewriter, each state of 1.7 (waiting ×3, published with its changeset's link, published with no changeset, two conflicts, uncertain, sending, kept_edited, kept_before) | profile/sync.ts history; account/syncline.ts | IMPROVISED | SYNC_ON's HISTORY | `board-sync-history` (punk) | yes |
| `board-sync-stop` | « Rester… » chosen while on: « Ce qui n'est pas encore parti ne partira pas… Ce qui est publié reste sur OSM. », « Rester sur Surveillance World → », « Annuler » (back to on, focused) | profile/sync.ts stopForm | IMPROVISED | `board-sync-on`, « Rester » | `board-sync-stop` (punk) | yes |
| `board-sync-stopped` | Stopped (POST {on: false}): « Rester » checked and focused, no « Activé depuis », « Vous restez sur Surveillance World : plus rien ne part. Ce qui est publié reste sur OSM. » (role status), the history keeping what went (published, conflicts, uncertain, sending); offline « Impossible pour l'instant (hors ligne ?) : la publication reste activée. » | profile/sync.ts draw | IMPROVISED | `board-sync-stop`, its key | `board-sync-stopped` (punk) | yes |
| `board-sync-suspended` | Suspended by the team (/revue): « Envois vers OSM suspendus par l'équipe : rien ne part pour l'instant, votre choix est gardé. » on the yellow, the choice as it is | profile/sync.ts stateLines | IMPROVISED | SYNC_ON `suspended` | `board-sync-suspended` (punk) | yes |
| `board-sync-revoked` | OSM withdrew the authorisation (`last_error: revoked`, the choice off): « OSM a retiré l'autorisation : autorisez à nouveau pour que vos contributions repartent. », « Rester » checked; choosing « Publier aussi… » authorises again | profile/sync.ts stateLines | IMPROVISED | SYNC `last_error: revoked` | `board-sync-revoked` (punk) | yes |
| `board-sync-blocked` | Her OSM account blocked (`last_error: blocked`, the choice on): « OSM refuse vos envois (votre compte y est bloqué) : voyez vos messages sur openstreetmap.org. Rien ne part ; autorisez à nouveau une fois le blocage levé. », « Autoriser à nouveau » (a foot's link) unfolding the authorisation | profile/sync.ts stateLines, draw | IMPROVISED | SYNC_ON `last_error: blocked` | `board-sync-blocked` (punk) | yes |
| `board-sync-retry` | OSM limiting or down (`rate_limited`, `osm_down`): « OSM limite les envois / ne répond pas pour l'instant : nouvel essai plus tard. » | profile/sync.ts stateLines | IMPROVISED | SYNC_ON `last_error: osm_down` | `board-sync-retry` (punk) | yes |
| `board-sync-live` | Writing to OSM's live server: no test-server line; the changesets on www.openstreetmap.org | profile/sync.ts | IMPROVISED | SYNC_ON on `live` | `board-sync-live` (punk) | yes |
| `board-list` | « Total en octobre », 4e to 10e: rank, pseudonym and its bar, points; yours on pink, tilted; the switch checked, « Comment on compte ? ↓ », « Se déconnecter », « Supprimer mon compte » | profile/leaderboard.ts:325 drawList | 26a (the others' bars in one colour: §3) | scrolled to the list | `board-list` (punk) | yes |
| `board-all` | « Depuis le début » pressed: every month's points and places | profile/leaderboard.ts:64 openLeaderboard | 26a | « Depuis le début » tapped | `board-all` (punk) | yes |
| `board-kind` | « Ajouts » pressed: its points, its pink in the bars, « Vous » with « 3 caméras ajoutées » under its points | profile/leaderboard.ts:276 drawYou, 325 drawList | 26a (points, not counts: §3) | « Ajouts » tapped | `board-kind` (punk) | yes |
| `board-scale` | « Ranger le barème ↑ », « Barème »: +50, +10, +10, +20, +10 from the API, « Une caméra ajoutée avec ses 4 infos : 50 + 4 × 10 + 10 de bonus = 100 pts. », the note | profile/leaderboard.ts:369 drawScale | 26a (the verification's line: §3) | « Comment on compte ? » tapped | `board-scale` (punk) | yes |
| `board-me-far` | You after the tenth: « … », then your row on pink; no « en attente de revue » | profile/leaderboard.ts:325 drawList | 26a (drawn by its code, not on the board) | your points low, none pending | `board-me-far` (punk) | yes |

### « Mes caméras » (lot U)

Punk only (`src/profile/cameras.ts`, `collection.ts`), a section of the account's screen
under its switches: « Mes caméras ↓ », 26a's « Comment on compte ? ↓ » key, unfolds 25b's
grid paper. Test data, unless the row says otherwise: punk; route: profile-mock with its
fuller collection (COLLECTION: the board's journal on CI cameras, a dome checked on site and
published on OSM's live server, an unknown kind's shape waiting, an add the review refused),
the account square on `#17.6/48.8963/2.2386`, « Mes caméras » tapped.

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `cameras-open` | Unfolded (« Ranger mes caméras ↑ »): « MES CAMÉRAS », 25b's numbers « 7 caméras  2 communes » (the cameras she contributed to, not counting one whose every contribution was refused), the collection: each kind's sticker (the map's) with « ×5 », « ×1 »… the most first, then the little map: a drawing on the paper, a pink dot per camera over the communes' names (no tiles, no second map: 2026-10-18, measured on the lowend profile) | profile/cameras.ts camerasSection, drawCollection, kinds, miniMap; collection.ts collect, frameOf | IMPROVISED (no board draws a collection by kind nor a little map; 25b's paper and numbers; 25c, not ported, had stickers) | COLLECTION | `cameras-open` (punk) | yes |
| `cameras-list` | Under the little map, 25b's cameras by commune (« COURBEVOIE · 6 CAMÉRAS », the most first; « Pas encore sur la carte » last), each camera its sticker, its kind and who films, its street, « → » (a button: « (ouvrir sa fiche) » said), over its journal: the month (« oct. »), what changed in the history's words, where it stands on 25b's tags: « en attente » (yellow), « acceptée » (pink outline), « sur la carte » (blue), « publiée sur OSM » (the ink tile), « refusée » (dashed, grey); an add the review refused is listed without a button nor « → » | profile/cameras.ts groups, cameraItem | IMPROVISED (partly: 25b's « caméras » ticket draws the groups, the rows and the journal; « sur la carte », « publiée sur OSM », « refusée » and the refused add are not on it) | COLLECTION, the groups in view | `cameras-list` (punk) | yes |
| `cameras-loading` | Unfolded before GET /api/me/contributions answers: the paper and its title alone (`aria-busy`) | profile/cameras.ts camerasSection | IMPROVISED | the contributions slow | — | yes, without a capture: an instant on the CI bench |
| `cameras-empty` | « Aucune caméra pour l'instant : chaque contribution envoyée s'ajoute ici. » | profile/cameras.ts drawCollection | IMPROVISED | no contribution | — | yes |
| `cameras-offline` | « Vos caméras sont indisponibles hors ligne. » | profile/cameras.ts drawCollection | IMPROVISED | GET /api/me/contributions fails as offline | — | yes |
| `cameras-far` | A camera the map cannot show (hidden, or out of the build): the map goes where it stood, then « Sa fiche ne s'ouvre pas : la caméra n'est pas sur la carte en ce moment. » under its row | profile/cameras.ts cameraItem; main.ts openCamera | IMPROVISED | route: a contribution on a camera the tiles do not have | — | yes, route |
| `cameras-back` | A camera tapped: the account's screen gives way to its sheet (the map brought to it at the street level when its tile is not loaded; a pending add's sheet for an add no build has drawn), « ← Mes caméras » a button of the head's top row beside « ↑ » and ×, as high (said « Revenir à Mes caméras »), the sticker and the title under it as on every camera sheet, kept while the sheet is drawn again, back to the account's screen | profile/cameras.ts cameraItem, backLink; theme/punk/sheet.css `.has-return`; main.ts openCamera | 25b (« Toucher une caméra ouvre sa fiche, avec « ← Profil » pour revenir ») | COLLECTION, the dome n998633844 tapped | `cameras-back` (punk) | yes |

### Welcome (28a)

Punk only (1.9). Test data: punk, `#16.5/48.8963/2.2382`, a device that has not seen it
(`lacarte.welcome` absent).

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `welcome-first` | A first visit: the panel over the map, its title, pitch and labels (no question: not shown since 2026-10-14), then (the launch lot) the four legal pages' links (`legal-welcome-links`), « Voir la carte → » at its foot; the two poppers' cones behind its top corners (their confetti gone after about 2 s) | welcome.ts first, build; cannon.ts poppers | 28a | the map opened on a fresh device | `welcome-first` (punk) | yes |
| `welcome-reopened` | The « ? » under the ticket's link tapped after a close: the same panel, no poppers | welcome.ts open | 28a (« sans confettis ») | `welcome-first`'s, ×, « ? » | — | yes, without a capture of its own: `welcome-first`'s screen without the cones |
| `welcome-pulse` | Closed: the focus on the « ? », still as its neighbours (no ring; the pulse removed 2026-10-14) | welcome.ts close | 28a (cpulse, not ported: §3) | `welcome-first`'s, × | — | yes, without a capture of its own (an animation) |

### Loading (2c)

Punk only (lot of 2026-10-12; the author's request, point 1): one component, index.html's
template and inline script, `loading.ts`, `loading.css`; board 2c of `Chargement punk.dc.html`
(maquette v5), its two 390 × 780 frames, light and dark. Captures by
`bench/shots-loading.mjs` at the boards' sizes (phone 390 × 845 in WebKit, wide 960 × 581
in Chromium, scale 2), light and dark, at rest.

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `loading-account` | On a return from OpenStreetMap (`?osm=`) or at `?compte=motdepasse`, at once (no 300 ms wait): before the scripts have run, the first load's page with the line « de votre compte » (`loading-map`'s); then, the map loading or not, the account's sheet (« Compte », a phone's full sheet, a wide screen's side sheet) holding 2c's drawing on its paper (at 0.68 on a wide screen, whole on a phone, 0.5 under 500 px high), « de votre compte », « Chargement de votre compte » said, not focused; never « Compte » signed out meanwhile; then the pseudonym's form, the account's screen or « Compte » with the failure; back to a camera (`?osm=signed&cam=`) no sheet, the first load's page until the map; also after the OSM key's tap until the browser has left (`account-osm-key`) | index.html (its inline script); account/index.ts land, waiting, askOsm; loading.ts loading, endFirstLoad; main.ts showAccount | partly IMPROVISED: 2c's drawing; « de votre compte » and its place in the account's sheet are the author's request of 2026-10-12, point 1 | route /api/me → 401 answered late, /api/osm/signup → the suggestion; `?osm=signup` | — (shots-loading.mjs: account-sheet-phone-light, account-sheet-phone-dark, account-sheet-wide-light, account-sheet-wide-dark) | yes, without a capture of its own |
| `loading-map` | The first load, from 300 ms after the navigation until MapLibre's "load" (the first view drawn; a load under 300 ms shows nothing): over the whole page (under the welcome panel, never catching a pointer) 2c's page (light #dbe7ee, dark #141216, its pink halftone), the cute camera hanging on its articulated arm, « CHARGEMENT » in ransom letters (each cut-out its tilt, face and flat colour), the black line « de la carte » (cream in dark) with its blinking ▌; role status, « Chargement de la carte » said 150 ms after it appears; light or dark from `?mode=`, `lacarte.mode` or the phone; the punk faces once the device has them (`lacarte.fonts`), a first visit on their fallbacks; under 600 px high the drawing at 0.85, under 480 px at 0.62; `?ui=classique` (an old link) shows it as any visit | index.html (its template and inline script, window.__loading); loading.ts endFirstLoad; main.ts (the map's "load"); loading.css | 2c (frames 1 light and 2 sombre) | punk, `#16.5/48.8963/2.2382`, a slow network | — (shots-loading.mjs: first-load-phone-light, first-load-phone-dark, first-load-wide-light, first-load-wide-dark) | yes, without a capture of its own |
| `loading-reduced` | Under reduced motion: the same drawing at rest, the camera on its arm and the letters still, the caret steady | loading.css (every move in the motion query) | 2c (its `still` branch) | `loading-map`'s or `loading-account`'s, reduced motion | — | yes, without a capture of its own |

### Legal pages (launch lot)

Punk only (1.10; `src/legal/`). No board: the welcome panel's ticket, dark or light (§3). Test data,
unless the row says otherwise: punk, the API simulated by `bench/account.mjs` mockApi (a
visitor) with `GET /api/config` open (`contributions: true, publish: false, publisher:
null`), a build made with `VITE_CONTACT_EMAIL=contact@example.org`, `#16/48.8977/2.2377`.
Captures by `bench/shots-legal.mjs` (phone 390 × 845 in WebKit, wide 960 × 581 in
Chromium, scale 2, light and dark, reduced motion), checked by `bench/smoke-launch.mjs`.

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `legal-mentions` | « MENTIONS LÉGALES » (Archivo 900 at 62 %, capitals, the light blue shadow) and ×; the four links under it (« Pages légales »; « Mentions légales » on 28a's yellow, `aria-current`); under dashed rules, each heading a welcome label: « Contact » (« Pour toute demande : » the address, a `mailto:` link), « Hébergeur » (two paragraphs), « Voir aussi » (the three other pages, links); « Voir la carte → » at the foot; the focus on the title, the tab titled « Mentions légales · Surveillance World », the rest of the page inert | legal/index.ts openLegal, fill, paragraph; legal/pages.ts PAGES, shownSections; theme/punk/legal.css | IMPROVISED (no board: §3) | `?page=mentions-legales` | — (shots-legal.mjs: phone-light-page-mentions-legales, phone-dark-page-mentions-legales, wide-light-page-mentions-legales, wide-dark-page-mentions-legales) | yes, without a capture of its own |
| `legal-privacy` | « CONFIDENTIALITÉ ET TRACEURS »: reading the map (the site's counters: hour by hour, the hours kept 7 days then folded into the day, the days 13 months then monthly totals; the « go » of 17/10), what the device keeps (display settings; with an account its session cookie, OSM's sign-in cookies, a contribution until sent), the account and what is kept of it (« la position, les réponses et le mois »; the sign-ins counted, an hourly number, never who), its purposes and their legal basis (the terms accepted at sign-up, RGPD 6.1 b), who sees it (the administrators' feed of the contributions received: who, what, which day; sign-in and, if one publishes, the publications through OpenStreetMap: OSM Foundation, United Kingdom, an adequacy the European Commission recognises; nothing else leaves the European Union), how long, the rights (« Télécharger mes données », the technical secrets — hashes, tokens — only signalled in its file; « Supprimer mon compte »; cnil.fr in a new window), the cameras on the map and their legal basis (a legitimate interest, informing the public about video surveillance, RGPD 6.1 f, the right to object through the contact); the parts on publishing to OSM absent while `publish` is false (`legal-publish`) | legal/pages.ts PAGES (confidentialite), holds; legal/index.ts fill | IMPROVISED (no board: §3) | `?page=confidentialite` | — (shots-legal.mjs: phone-light-page-confidentialite, phone-dark-page-confidentialite, wide-light-page-confidentialite, wide-dark-page-confidentialite) | yes, without a capture of its own |
| `legal-terms` | « CONDITIONS D'UTILISATION ET DE CONTRIBUTION »: the site, the account, contributing, the licence of the contributions, the contact; « Publier sur OpenStreetMap » before the contact only while publishing is offered (`legal-publish`) | legal/pages.ts PAGES (conditions); legal/index.ts fill | IMPROVISED (no board: §3) | `?page=conditions` | — (shots-legal.mjs: phone-light-page-conditions, phone-dark-page-conditions, wide-light-page-conditions, wide-dark-page-conditions) | yes, without a capture of its own |
| `legal-sources` | « SOURCES ET LICENCES »: the cameras (OpenStreetMap, openstreetmap.org/copyright in a new window); the basemap, « construit avec Protomaps » from OpenStreetMap (ODbL) and Natural Earth (public domain), ESA WorldCover's land cover at small scales (CC BY 4.0, its attribution verbatim), the style's CC0, its icons' MIT (Tangram Icons), Noto Sans's SIL OFL 1.1; the communes and départements; our layer; the code (AGPL-3.0 or later; MapLibre GL JS, PMTiles and Protomaps' styles under BSD-3); the fonts (2026-10-13: the basemap's and the code's licences, read from Protomaps' own files) | legal/pages.ts PAGES (sources); legal/index.ts fill | IMPROVISED (no board: §3) | `?page=sources` | — (shots-legal.mjs: phone-light-page-sources, phone-dark-page-sources, wide-light-page-sources, wide-dark-page-sources) | yes, without a capture of its own |
| `legal-publisher` | `GET /api/config` gives `publisher`: the sections that name the publisher come first on « Mentions légales » and « Confidentialité », the identity as plain text; without it they are absent, nothing in their place | legal/pages.ts (`publisher`); legal/index.ts paragraph | IMPROVISED (no board: §3) | `?page=mentions-legales`, /api/config `publisher` set | — | yes, without a capture of its own (checked by smoke-launch) |
| `legal-closed` | Contributions closed: every part that speaks of accounts absent, nothing in its place: on « Confidentialité » the account, its purposes and their legal basis (6.1 b), who sees it, how long and the in-app rights, the cameras' legal basis (6.1 f) kept; the device keeps display settings only (its closed paragraph); on « Conditions » the account, contributing, the licence and « Publier sur OpenStreetMap » (even with `publish` true); « Mentions légales » and « Sources » unchanged | legal/pages.ts (`open`, `closed`), shownSections | IMPROVISED (no board: §3) | `?page=confidentialite`, /api/config `contributions: false` | — | yes, without a capture of its own (checked by smoke-launch) |
| `legal-publish` | `GET /api/config` offers publishing (`publish: true`, contributions open); since the OSM synchronisation (2026-10-16): « Conditions » has « Publier sur OpenStreetMap » (choosing « Publier aussi sur OpenStreetMap en mon nom » authorises Surveillance World to send in her name, under her OSM account, her on-site surveys made after the choice once accepted, as she gave them — a value changed at review is not sent; she stays their author under OSM's Contributor Terms; public for good; Surveillance World may suspend the sends and never deletes anything on OpenStreetMap; back to « Rester » whenever she wants, what has not left no longer leaves); « Confidentialité » the encrypted write authorisation kept until « Rester sur Surveillance World » or the account's deletion, then 14 days at most in the backups, the month of the choice, each contribution's state and changeset number; and what leaves (the shape, the direction, who films, an add and its position, a move, « toujours là » with the day, `check_date`, where the map shows the month; never a household's camera, a height, a tilt nor « introuvable »), when (after the review and the next map update, without another gesture), under her OSM name, at the OSM Foundation in the United Kingdom, public and permanent, deleting the account here not removing it there; with `publish` false, or contributions closed, none of it | legal/pages.ts PAGES (`publish`), holds; legal/index.ts fill | IMPROVISED (no board: §3) | `?page=conditions`, /api/config `publish: true` | — | yes, without a capture of its own (legal.test.ts checks the privacy page's authorisation line against `holds`, which shows the terms' section too) |
| `legal-switch` | A link to another page (the four under the title, « Voir aussi », a page named in a paragraph): the page replaced in the same dialog, its body scrolled to the top, its title focused, `?page=` and the tab's title following | legal/index.ts openLegal, fill | IMPROVISED (no board: §3) | `legal-mentions`'s, « Confidentialité » | — | yes, without a capture of its own: `legal-privacy`'s screen |
| `legal-welcome-links` | The welcome panel, after its labels under a dashed rule, above « Voir la carte »: the four pages' links (« Pages légales »), the typewriter's words wavy-underlined in pink; one opens its page over the panel, closing it gives the focus back to the link | welcome.ts build; legal/index.ts legalLinks, legalLink; theme/punk/legal.css .welcome-legal | IMPROVISED (28a draws no such links: §3) | a device that has not seen the welcome, its body scrolled to the bottom | — (shots-legal.mjs: phone-light-accueil-liens, phone-dark-accueil-liens, wide-light-accueil-liens, wide-dark-accueil-liens) | yes, without a capture of its own |
| `legal-account-links` | The foot of « Compte » (28a's and 25a's stamp) and of the account's screen (after « Supprimer mon compte »): the four pages' links on one wrapped line, the sheet's own links (`account-link`, 44 px under a finger); one opens its page over the sheet | account/index.ts askOsm, ask; profile/leaderboard.ts openLeaderboard; legal/index.ts legalLinks; theme/punk/legal.css .account-legal | IMPROVISED (25a, 26a and 28a draw no such links: §3) | /api/osm/status `login: true`, the account square | — (shots-legal.mjs: phone-light-compte, phone-dark-compte, wide-light-compte, wide-dark-compte) | yes, without a capture of its own |

### Contributions closed (launch lot)

Punk only (1.10). `GET /api/config` says `contributions: false`; offline, failing or slower
than 2.5 s the page reads them open (`config.ts` loadConfig). Test data: as the legal pages
(above), /api/config `contributions: false`. Captures by `bench/shots-legal.mjs`, checked by
`bench/smoke-launch.mjs` (signed out and signed in, and an API that fails).

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `closed-map` | The map as a visitor's, with nothing of the participation nor of the account, absent (not greyed): under the ticket's link the sun / moon and the « ? » squares only; no « ＋ Ajouter », no proposals nor their tape, no send counter; signed in, the same | main.ts (site.contributions: the Account and the Participation not built) | IMPROVISED (no board: the launch lot's contract) | `#16/48.8977/2.2377` | — (shots-legal.mjs: phone-light-ferme-carte, phone-dark-ferme-carte, wide-light-ferme-carte, wide-dark-ferme-carte) | yes, without a capture of its own |
| `closed-sheet` | A camera sheet without « Modifier », « Toujours là ? » nor « Vos contributions », nothing greyed nor said in their place; « Corriger sur OpenStreetMap ↗ » among its links, as for a visitor | main.ts sheetOptions (visitor); chips.ts punkSheet | IMPROVISED (no board: the launch lot's contract) | the first OSM camera of the detail tiles near `#18/48.8977/2.2377`, `?cam=` | — (shots-legal.mjs: phone-light-ferme-fiche, phone-dark-ferme-fiche, wide-light-ferme-fiche, wide-dark-ferme-fiche) | yes, without a capture of its own |
| `closed-welcome` | A first visit: the welcome with its title « The most magical place on Earth », its pitch without « et rejoins l'aventure » (« … redécouvre ton quartier sous un nouveau jour <3 », `welcome.pitch.closed`), without « Participer », without « Contributions vérifiées » among « Garanties » and without the two questions that speak of accounts (no question shown since 2026-10-14), the legal pages' links, « Voir la carte → » | welcome.ts Welcome (contributions), build | partly IMPROVISED: 28a, less what speaks of accounts | a device that has not seen the welcome | — (shots-legal.mjs: phone-light-ferme-accueil, phone-dark-ferme-accueil, wide-light-ferme-accueil, wide-dark-ferme-accueil) | yes, without a capture of its own |
| `closed-landing` | A return from OpenStreetMap (`?osm=`, `?osm_why=`) or the account's own address (`?compte=`): the parameters removed from the address unread; index.html's first load, which runs before the answer is known, says « de votre compte » until the map is drawn (`loading-map`'s screen); then no sheet, no welcome: the map as `closed-map` | main.ts (writeParams before the Account; the map's "load" ends the first load); index.html (its inline script) | IMPROVISED | `?osm=signed` with /api/config `contributions: false` | — | yes, without a capture of its own (checked by smoke-launch) |

### The register (lots R0 and R1a)

`registre.html` (1.12). Mockups: the direction mockups (wide, the product owner's files, not in
the repository): « Registre », « Registre-chiffres », « Commune-grand », « Documents-grand »,
« Autorisations-grand »; the phone has no current board (the wide view in one column; the phone
mockup « Filtres » for the filters' sheet only). Test data: the pilot export built by
`lacarte-registre importer-pilote` then `construire` (Île-de-France, the Rhône and the
Bouches-du-Rhône; not the CI extract), Mions 69283, Lyon 69123, Paris 75056, Saint-Denis 93066,
Ampuis 69007. Captured at 960 × 581 and 390 × 845, scale 2, light and dark, and at 1280 beside the
mockup's render, outside the repository (no bench script yet: « — »).

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `reg-not-found` | A path the register does not answer: « PAGE INTROUVABLE », « Le registre → » | registre/vues/introuvable.ts; registre/routes.ts route | IMPROVISED | `/registre/rien` | — | yes |
| `reg-load-error` | A view's code or file that does not arrive: one sentence, « Rechargez-la, ou revenez au registre » | registre/modale.ts afficher | IMPROVISED | a file of `/data/registre/` missing | — | yes |
| `reg-unread-line` | Under a list that holds decrees: the line on decrees read by a program and « 34 arrêtés n'ont pas pu être lus entièrement → » (to the coverage page) | registre/vues/registre.ts; registre.html | IMPROVISED (DECISIONS 2026-10-28) | `/registre/?t=aut` | — | yes |
| `reg-coverage` | « Ce que couvre le registre »: the last update, the sources' table (documents until, collected on; a source dated by its year says so), each département's state (collected since, not yet, impossible and why, documents asked for) | registre/vues/couverture.ts; registre/collecte.ts | IMPROVISED (no board: DECISIONS 2026-10-28) | `/registre/couverture` | — | yes |
| `reg-coverage-unread` | Its `#non-lus` part: « 34 arrêtés n'ont pas pu être lus entièrement », the counts by reason, the line on decrees read by a program, each decree (date, id, commune, what failed, its source) | registre/vues/couverture.ts | IMPROVISED | `/registre/couverture#non-lus` | — | yes |
| `commune-docs-filtered` | A commune's documents filtered (type, who — la mairie, État, entreprises et commerces, nom non publié —, year), the path keeping them (`?t=aut&qui=n`) | registre/vues/documents.ts | partly IMPROVISED: Documents-grand, « État » added | `/registre/commune/69283/documents?t=aut&qui=n` | — | yes |
| `commune-docs-unread` | A decree not read entirely in the list: « — », what failed and « source » under the figure | registre/vues/documents.ts | IMPROVISED | `/registre/commune/69123/documents?t=aut` | — | yes |
| `commune-docs-empty` | A commune with no document: « Le registre n'a aucun document pour cette commune. » | registre/vues/documents.ts | IMPROVISED | `/registre/commune/69172/documents` | — | yes |
| `commune-aut-shared` | A drone decree that names several communes: « partagé avec N communes », each commune a link, « Sur la carte → » | registre/vues/autorisations.ts | partly IMPROVISED: the 12th pass's rule | `/registre/commune/69283/autorisations` | — | yes |
| `commune-aut-dossier` | A dossier's path: its row selected and shown, the panel on it (a private dossier past the 15th unfolds the list) | registre/vues/autorisations.ts | partly IMPROVISED | `/registre/commune/69123/autorisations/69-20110354` | — | yes |
| `commune-aut-not-collected` | A département whose decrees are not collected: the introduction says so, no figure (a missing figure is not zero), the panel at rest « Arrêtés non collectés » with the coverage page's link | registre/vues/autorisations.ts; registre/collecte.ts | IMPROVISED (DECISIONS 2026-10-28) | `/registre/commune/93066/autorisations` | — | yes |
| `commune-aut-impossible` | Collecting impossible: why (Paris: the préfecture's site blocks reading by a program; Essonne: closed to robots) and that the documents were asked for | registre/vues/autorisations.ts; registre/collecte.ts | IMPROVISED | `/registre/commune/75056/autorisations` | — | yes |
| `commune-aut-unread` | A mairie's decree with an unreadable count: in the dossier's table with « — », out of the frieze, counted in the decrees and not in the cameras, its panel says why | registre/vues/autorisations.ts | IMPROVISED | `/registre/commune/69044/autorisations` | — | yes |
| `commune-aut-one` | One decree: the singular everywhere (« Cet arrêté figure aussi parmi le document d'Ampuis. ») | registre/vues/autorisations.ts | IMPROVISED | `/registre/commune/69007/autorisations` | — | yes |
| `commune-request` | « Demander à la préfecture / à la mairie »: the dialog with the request's text to copy, Escape closes it and gives the focus back | registre/demande.ts | partly IMPROVISED: the prototype's | `/registre/commune/69283/autorisations`, « Demander à la préfecture » | — | yes |
| `commune-ess-no-document` | A commune with no document has no file since lot R3 (a file per commune with a document, DECISIONS 2026-10-30): its four tabs say « Page introuvable », as a buyer or a company the register does not hold; no link leads there (its name has no reference) | registre/commun.ts | IMPROVISED | `/registre/commune/69182` | — | yes |
| `commune-ess-map-not-cut` | A commune whose map is not cut (the build's `carte.decoupee`): « La carte de <commune> », a sentence in the frame, no pause button nor attribution, nothing asked | registre/vues/commune.ts | IMPROVISED | `/registre/commune/95176` | — | yes |
| `commune-ess-no-webgl` | A device without WebGL 2: « La carte de <commune> ne peut pas s'afficher sur cet appareil. » in the frame | registre/vues/commune.ts | IMPROVISED | a browser without WebGL 2 | — | no (not on the bench's browsers) |
| `commune-ess-share` | « Partager l'image »: a 1200 × 630 image of the commune's figures drawn in the browser, downloaded | registre/vues/commune-outils.ts | partly IMPROVISED: the prototype's | `/registre/commune/69283`, « Partager l'image » | — | yes |
| `commune-ess` | A commune's essentials: its head and tabs, the lead (« En juin 2026, la préfecture a autorisé 154 caméras à la mairie de Mions. 125 filment la rue. La carte n'en connaît que 10. »), the four figures, the tilted map (after the content; turning, the pause button; its legend and attribution), « Où sont les 118 autres ? », what the préfecture authorises, the shops, the money (« 415 000 € de contrats depuis 2021 », the envelope's line), the frieze, the territory's table, what happened, the documents not found, the panel | registre/vues/commune.ts; registre/carte3d.ts | Commune-grand | `/registre/commune/69283` | — | yes |
| `commune-docs` | A commune's documents: its head and tabs, the filters, the table (date, document, who, amount or cameras), the panel, the downloads | registre/vues/documents.ts; registre/commun.ts | Documents-grand | `/registre/commune/69283/documents` | — | yes |
| `commune-aut` | A commune's authorisations: the introduction and « Dernier recueil lu », the four figures, the mairie's dossier (its steps, its table, what it allows, before the first published decree), the shops and companies, the drones and other devices, the panel | registre/vues/autorisations.ts | Autorisations-grand | `/registre/commune/69283/autorisations` | — | yes |

### The register (lot R1b)

Mockups: the direction mockups kept in `design/registre/maquettes/` (CarteTemps-grand,
Contrat-grand, Entreprise-grand, Acheteur-grand, Departement-grand, Glossaire), their renders in
`design/registre/captures/` (1 280 px, light and dark). Test data: the CI extract of the pilot
(`tests/fixtures/registre/`, `lacarte-registre importer-pilote` then `construire --sans-corrections`): it has no
period of flight, no duration, no offer and no linked buyer, so the states that need them were
seen on synthetic data in the tests only (« synthetic »). Compared with the captures at 1 280 and
390, light and dark, in a cloud session; the captures beside the boards on the real data are the
owner's machine's to make (« — »).

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `reg-not-found-subject` | A page whose subject the register does not hold (a département code, a SIREN, an affaire): « PAGE INTROUVABLE », « Le registre → » | registre/donnees.ts Absent; registre/modale.ts afficher; registre/vues/introuvable.ts | IMPROVISED | `/registre/entreprise/000000000`, `/registre/departement/00`, `/registre/contrat/nexistepas` | — | yes |
| `reg-carte-no-hours` | A slot whose act states no hours: dashed bar, the lowest volume, « horaires non précisés dans l'arrêté » | registre/vues/carte.ts; registre/carte3d.ts volumeHeight | IMPROVISED (the owner's rule) | web/tests/registre-carte.test.ts | — | yes |
| `reg-carte-not-deduced` | Acts whose zone is not deduced: « N arrêtés sans zone déduite · listés, jamais dessinés », each « zone non déduite de l'arrêté · <ref> », its source in the panel | registre/vues/carte.ts; pipeline drones.py | IMPROVISED (DECISIONS 2026-10-28) | tests/test_registre_drones.py (none in the extract's communes) | — | yes |
| `reg-carte-empty` | No slot: no frieze, « Aucun créneau de vol · 0 », the list says why (« … (2 arrêtés). Voir les autorisations → », the département not collected, or no act) | registre/vues/carte.ts | IMPROVISED | `/registre/commune/69283/carte` | — | yes |
| `reg-contrat` | A contract's record: its path (call for tenders → contract → modifications, more than two in one step → « Fin prévue », dashed, « (calculée) »), the four figures, « Contrat précédent » and « Appel d'offres suivant », « Ce que dit le contrat », the money line, Sources, « Copier la référence », « Signaler une erreur », the panel | registre/vues/contrat.ts, contrat-outils.ts; pipeline parcours.py | Contrat-grand | `/registre/contrat/21690283300013202520240600_32323500` | — | yes |
| `reg-contrat-date` | A contract whose date is to be checked: « ? » beside the date, explained in the panel at rest | registre/vues/contrat.ts | IMPROVISED (DECISIONS 2026-10-28 « Discreet mentions ») | `/registre/contrat/216902833000132020_32323500` | — | yes |
| `reg-contrat-ao-awaited` | A call for tenders whose contract is not yet published (last 18 months): « pas encore publié » | registre/vues/contrat.ts | Contrat-grand (one template, four kinds) | `/registre/contrat/avis-26-71981` | — | yes |
| `reg-contrat-ao-not-found` | A call for tenders with no contract found, with its result: « non retrouvé » | registre/vues/contrat.ts | Contrat-grand | `/registre/contrat/avis-20-142345` | — | yes |
| `reg-contrat-ao-probable` | A call for tenders with a probable contract: the contract step and « Le contrat qui a suivi → », each with its « ? » | registre/vues/contrat.ts | IMPROVISED | web/tests/registre-contrat.test.ts (synthetic) | — | yes |
| `reg-contrat-sub` | A subsidy: the giver, the amount, « nom non publié » with the commune linked on a row of its own, the financed contract when there is one | registre/vues/contrat.ts | Contrat-grand | `/registre/contrat/detr-69-2025-6` | — | yes |
| `reg-contrat-aut` | A decree without a commune: its département, why it was not read entirely, the line on decrees read by a program, « Voir l'arrêté » | registre/vues/contrat.ts | Contrat-grand | `/registre/contrat/75-2025-06-19-00003` | — | yes |
| `reg-contrat-aut-commune` | A decree attached to a commune: the address replaced by its commune's Autorisations at its dossier, the record never drawn | registre/vues/contrat.ts donnees | IMPROVISED (DECISIONS 2026-10-29) | `/registre/contrat/69-20083026` | — | yes |
| `reg-contrat-corrige` | A document corrected in /revue: under « Ce que dit … », « Corrigé le <date> », the field and the value read now, « publié par la source : » and its value struck | registre/corrige.ts; registre/vues/contrat-outils.ts | IMPROVISED (DECISIONS 2026-10-29) | web/tests/registre-corrige.test.ts; a local data/registre/corrections.yaml | — | yes |
| `reg-panel-corrige` | A corrected document's row hovered, focused or touched: the panel's rich line « Corrigé le <date> », the field, the value read now and the source's struck (Autorisations, Documents, the register's list) | registre/vues/socle.html (det.corr); registre/corrige.ts | IMPROVISED (DECISIONS 2026-10-29) | a local data/registre/corrections.yaml (a decree of Mions corrected) | — | yes |
| `reg-row-phone-links` | On a phone, a document's row touched: it unfolds with « Voir l'arrêté (recueil de la préfecture) » or « Source officielle → », and « Signaler une erreur », 44 px targets; folded, the links are not rendered; hidden on a wide screen (the panel has them) | registre/vues/documents.ts, autorisations.ts; registre.css (td.liens-tel) | IMPROVISED (DECISIONS 2026-10-29) | `/registre/commune/69283/documents`, 390 px, a row | — | yes |
| `reg-signaler` | « Signaler une erreur »: the dialog over the page (« Document <id> », the line on reading by a program, nine choices, the correction, the source, the contact, what the site keeps and « Confidentialité », Envoyer · Annuler); Escape or Annuler gives the focus back | registre/signaler.ts | IMPROVISED (no board) | a panel's « Signaler une erreur », or `/registre/contrat/<affaire>?doc=<id>#signaler` | — | yes |
| `reg-signaler-sent` | Sent: « Merci : votre signalement est enregistré. Il sera relu avant d'être appliqué au registre. », Fermer | registre/signaler.ts | IMPROVISED | the API answering 201 | — | yes |
| `reg-signaler-refused` | Not sent, said in the form (role status): nothing chosen or written, too many reports (429), closed (403 closed), a source or a contact refused (422), any other failure | registre/signaler.ts issue | IMPROVISED | web/tests/registre-signaler.test.ts | — | yes |
| `reg-entreprise` | A company: its lead, four figures, the money year by year with the money line, « En cours aujourd'hui : N contrats » and « Ses plus gros contrats », « Ce qui ressort » (facts only), its customers by département and sortable, « Contrats signés à plusieurs », « Ses contrats »; the panel sticky under the tabs | registre/vues/entreprise.ts, entreprise-outils.ts; pipeline entreprise.py | Entreprise-grand (without its scatter) | `/registre/entreprise/431903954` | — | yes |
| `reg-entreprise-detail` | The panel filled by a year, a contract or a customer (hovered, focused or touched) | registre/vues/entreprise-outils.ts | Entreprise-grand | the same, a bar | — | yes |
| `reg-entreprise-ends-unknown` | No duration published: « En cours aujourd'hui : non connu », « N contrats n'ont pas de durée publiée » | registre/vues/entreprise-outils.ts | IMPROVISED | `/registre/entreprise/431903954` (extract) | — | yes |
| `reg-entreprise-sole-trader` | A sole trader: no page (the build serves none, its address is « PAGE INTROUVABLE »); wherever a document names it, « entreprise individuelle, nom non publié », no link, no SIREN (the build's token `ei`), in no ranking, seller list nor export | registre/corpus.ts (entName, entHref); pipeline regles.py masquer_ei | IMPROVISED (DECISIONS 2026-10-29) | tests/test_registre_ei.py (two companies of the extract made sole traders); web/tests/registre-ei.test.ts | — | yes |
| `reg-entreprise-one` | The single cases in words: every contract counted, every contract shared, no modification, one customer | registre/vues/entreprise-outils.ts | IMPROVISED | web/tests/registre-entreprise.test.ts | — | yes |
| `reg-acheteur` | A buyer: its tag, title and lead, four figures and the money line, the frieze with its legend, the sortable contracts, « Qui vend ici », the calls for tenders, « Aussi : <linked buyer> », the panel | registre/vues/acheteur.ts, acheteur-outils.ts | Acheteur-grand | `/registre/acheteur/256900994` | — | yes |
| `reg-acheteur-no-duration` | No published duration: a mark at the signature, not a bar; « La durée de ces contrats n'est pas publiée… » | registre/vues/acheteur.ts | IMPROVISED | `/registre/acheteur/256900994` (extract) | — | yes |
| `reg-acheteur-out-of-total` | Mixed, central or to-check contracts named outside the total (the figure's label, « i », the seller's note) | registre/vues/acheteur-outils.ts total | Acheteur-grand (mixed) / IMPROVISED | `/registre/acheteur/256900994` | — | yes |
| `reg-acheteur-none-counted` | No counted contract: « — », « aucun contrat compté dans les totaux » | registre/vues/acheteur.ts | IMPROVISED | web/tests/registre-acheteur.test.ts | — | yes |
| `reg-acheteur-no-ao` | No call for tenders: no table, « aucun appel d'offres trouvé au BOAMP » | registre/vues/acheteur.html | IMPROVISED | `/registre/acheteur/256900994` (extract) | — | yes |
| `reg-acheteur-commune` | A buyer that is a commune: the address replaced by its commune's page, nothing drawn | registre/vues/acheteur.ts donnees | IMPROVISED (DECISIONS 2026-10-29) | `/registre/acheteur/216900910` → `/registre/commune/69091` | — | yes |
| `reg-departement` | A département: crumbs, name, its line (code, communes, collection), the lead, four figures, intercommunalities (a row unfolds on its communes), every commune with a filter by name (accents ignored), who sells and who buys with the money line, each year; the panel | registre/vues/departement.ts, departement-outils.ts | Departement-grand | `/registre/departement/69` | — | yes |
| `reg-departement-ic` | `?ic=<code>`: that intercommunality unfolded and scrolled to | registre/vues/departement.ts | Departement-grand | `/registre/departement/69?ic=246900575` | — | yes |
| `reg-departement-filter` | The filter: « N communes trouvées », or « Aucune commune du Rhône de ce nom… » | registre/vues/departement.ts | Departement-grand | `/registre/departement/69`, « ecully » | — | yes |
| `reg-departement-out` | A buyer or company none of whose contracts counts: « — » for the amount, « Contrats hors des totaux N » in the panel | registre/vues/departement-outils.ts | IMPROVISED | `/registre/departement/69`, Préfecture de Région | — | yes |
| `reg-departement-not-collected` | Decrees not collected: the lead says so, « — » for authorisations and drones, no bar, the panel at rest with the coverage link | registre/vues/departement.ts; registre/collecte.ts | IMPROVISED (DECISIONS 2026-10-28) | `/registre/departement/93` | — | yes |
| `reg-departement-impossible` | Collection impossible: why and that the documents were asked for; no commune, no contract: one muted line each | registre/vues/departement.ts; registre/collecte.ts | IMPROVISED | `/registre/departement/75` | — | yes |
| `reg-departement-no-file` | A département of the coverage with no document (no file built): the same page, empty, with its collection state | registre/vues/departement.ts donnees | IMPROVISED | `/registre/departement/91` | — | yes |
| `reg-glossaire` | « Les mots du registre »: 56 words in alphabetical order, the sticky index, the filter, each word's definition and « Exemple : … → » | registre/vues/glossaire.ts, glossaire-mots.ts | Glossaire | `/registre/glossaire` | — | yes |
| `reg-glossaire-filter` | A filter typed (word or definition, accents and case ignored): « N mots trouvés », the index and the list narrowed | registre/vues/glossaire.ts | Glossaire | `/registre/glossaire`, « prefecture » | — | yes |
| `reg-glossaire-none` | « Aucun mot ne correspond. Essayez un mot plus court. » | registre/vues/glossaire.html | Glossaire | `/registre/glossaire`, « zzzz » | — | yes |
| `reg-glossaire-anchor` | Opened at or reached by `#g-<mot>`: the word scrolled to, marked, focused; a filter that hid it cleared | registre/vues/glossaire.ts | IMPROVISED | `/registre/glossaire#g-accord-cadre` | — | yes |

### The register v2 (2026-10-30)

Mockups: `design/registre/v2/maquettes/` (V2-Sommaire, V2-Liste, V2-Entreprise, V2-CarteDrones,
V2-Types, V2-Partage, V2-Tel-Sommaire, V2-Tel-Entreprise) and their captures (1 440 × 900, 390 ×
844, light and dark); the content of each fiche is still the R1 boards' (above). Test data: the
pilot's build (Serfim T.I.C. 431903954, Lyon 69123, Mions 69283, the Rhône, Sytral 256900994),
captured at 1 440 × 900, 1 280 × 800 and 390 × 844, light and dark, beside the boards, outside the
repository. The R1 states above hold inside the frame unless replaced here.

| State | Description | Code | Mockup | Test data | Capture | Reachable |
|---|---|---|---|---|---|---|
| `reg2-modal` | A register page over the map on a wide screen: the frame 56 px from the sides and 24 px from the top and bottom, its shadow the open fiche's type's colour; the map inert | registre/modale.ts; cadre.css | V2-Sommaire, V2-Entreprise | `/registre/entreprise/431903954` | — | yes |
| `reg2-sheet` | The same on a phone: the sheet under 44 px of map (64 above the summary), its handle; « ‹ <up one step> », « Partager » on a fiche, the theme, ✕ | registre/modale.ts | V2-Tel-Sommaire, V2-Tel-Entreprise | the same at 390 px | — | yes |
| `reg2-sheet-low` | The handle touched or dragged: the sheet at half the screen, the map above; dragged far down: the register closes | registre/modale.ts | IMPROVISED (the boards draw the handle only) | any page at 390 px | — | yes |
| `reg2-closed` | ✕, Escape, or « ← Carte » with no step before: the map again at its own address (from Drones et algorithmes, where that view left it), the focus where it was; the back button reopens the register | registre/hote.ts; url.ts | IMPROVISED | from the map, a door, then Escape | — | yes |
| `reg2-back` | « ← Retour »: the register's previous step, its filters, section and scroll | registre/modale.ts; hote.ts | IMPROVISED (the boards draw « ← Carte ») | a fiche, then another, then « ← » | — | yes |
| `reg2-one-modal` | The register opened while the welcome, a legal page or the account is open: they close, the register alone with the focus; « Signaler une erreur » from it: the dialog above, the register inert | registre/modale.ts; registre.css | IMPROVISED | `web/bench/smoke-registre.mjs` | — | yes |
| `reg2-row-chosen` | A row chosen: its ground, its type's bar at its left, `aria-selected`; the panel in view, its outline flashed once | vue.ts; cadre.css | IMPROVISED | a decree of Mions | — | yes |
| `reg2-doors` | « Le registre → » on the row of « Filtres et légende » in the ticket; « Voir dans le registre » in a commune's or a département's sheet when the register holds its page | registre/hote.ts; areapunk.ts; main.ts | IMPROVISED (the boards draw no door) | `/?insee=69283` | — | yes |
| `reg2-summary` | The summary: the cut-out title, the coverage and update line, the search, the four families with their counts (each a list), « Comment lire le registre », the update and the decrees not read | registre/vues/sommaire.ts | V2-Sommaire, V2-Tel-Sommaire | `/registre/` | — | yes |
| `reg2-search` | Typed: the results grouped by type, each a typed link, « Les N → » to the list filtered by the same words | registre/vues/sommaire.ts; listes.ts | V2-Sommaire | `/registre/?q=mions` | — | yes |
| `reg2-search-off` | The search API does not answer: the names found (listes.json) if any, then « recherche indisponible » and the départements' list | registre/vues/sommaire.ts | IMPROVISED | the API stopped | — | yes |
| `reg2-list` | A list: the rail, its title, « classer par » with the rank, the filters with their counts, the rows (the pictogram alone), « Afficher plus », the CSV; the detail panel on the right, a document's « Voir l'arrêté » (or its source) and « Signaler une erreur » in it | registre/vues/liste.ts; listes.ts | V2-Liste | `/registre/entreprises`, `/registre/arretes?dep=69` | — | yes |
| `reg2-list-docs-loading` | A list of documents while its page is asked: « Chargement de la liste… » under the heads, no row | registre/vues/liste.ts | IMPROVISED | `/registre/contrats`, a slow API | — | yes |
| `reg2-list-docs-off` | The search API does not answer a list of documents: « La liste n'a pas pu être chargée. Réessayez. », no « Afficher plus » | registre/vues/liste.ts | IMPROVISED | `/registre/contrats`, the API stopped | — | yes |
| `reg2-fiche` | A fiche: its type's sticker, its name cut out, its identity; the band stuck at the top with its sections (the one read marked) and « Partager »; the sections in order, numbered; the panel on the right | vues/socle.html; vue.ts | V2-Entreprise | Serfim T.I.C., Lyon, Mions, Sytral, the Rhône | — | yes |
| `reg2-detail-drawer` | On a phone, something touched: the detail rises as a drawer with its ✕; at rest no panel | vues/socle.html; registre.css | V2-Tel-Entreprise (08b) | a year of Serfim at 390 px | — | yes |
| `reg2-share` | « Partager »: on a wide screen a window (« Copier le lien », « Copier le texte » when the build wrote one, the image when the build made it); on a phone a drawer (« Partager… » when the device has a share sheet, « Copier le lien »); the link keeps the section; « Lien copié » | registre/partage.ts | V2-Entreprise (share), V2-Tel-Entreprise | Serfim's band | — | yes |
| `reg2-carte` | Drones et algorithmes: the register a panel on the right, the map live and tilted, its outline and drone volumes, « 3D », ↺, ↻, N, the legend, « Heures de vol autorisées, par semaine »; the map's own panels put away | registre/vues/carte.ts; drones.ts | V2-CarteDrones | `/registre/commune/69123/carte` | — | yes |
| `reg2-carte-chosen` | A volume pointed at: a thin ink outline; chosen: full, a thick ink outline, its label, the others aside, its week full of ink on the chart, the decree's detail in the panel (places, slots, service, purpose, devices, the zone's status, act, page) | registre/vues/carte.ts; drones.ts | V2-CarteDrones | a Lyon slot | — | yes |
| `reg2-carte-week` | A week or a month clicked (or chosen with the arrows and Enter): the map, the tickets and the list filtered to it; « Toute la période » | registre/vues/carte.ts | V2-CarteDrones | Lyon, a week of October | — | yes |

### The register (lot R3)

No new screen: the v2 draws the share button, its window and the links' colours; R3 gives
them the build's text, image and references. Test data: the CI extract of the pilot, and the
Rhône's real DECP rows (`tests/fixtures/registre/national/`).

| State | What it shows | Where | Mockup | How to see it | Capture | Checked |
|---|---|---|---|---|---|---|
| `reg-entry-page` | A record's address served with its entry page: its share tags (Open Graph, Twitter, canonical, noindex) and, without JavaScript, its name, line, three figures, text and neighbours' links; the app draws the page otherwise | lacarte_registre/partage.py, pages.py; deploy/preview.caddy | V2-Partage's text (the share's) | `/registre/entreprise/431903954`, JavaScript off | — | tests only |
| `reg-preview-image` | The record's preview image, 1200 × 630: the dark map, the logo, « Le registre », the type's label, the name in two lines at most, its line, three figures | lacarte_registre/apercu.py | V2-Partage (capture 06) | `/data/registre/apercu/entreprise/431903954.png` | the build's own | yes, against capture 06 (an entreprise, a long buyer's name) |

## 3. Deviations from the mockup (« Écarts à la maquette »)

The punk interface ports the mockup (`Carte punk.dc.html`, export of 2026-10-06, the product
owner's file, not in the repository) as it is drawn; every place where the code differs has a
row here with its reason — a DECISIONS line, an accessibility criterion that cannot be met
otherwise, or real data that does not fit (DECISIONS 2026-10-07, « Fidelity to the mockup
comes first… »). A deviation without a row is a bug. One table per screen, filled by the
screen's lot; the first table holds what every screen shares.

### All screens

| Mockup | Code | Reason |
|---|---|---|
| Fields as blurred or halftone discs (1a, 17a) | the exact viewshed, cut by buildings, its levels each an opaque halftone (two, four, eight dots per 8 px, 20a's fine dot) with its outline (dotted, dashed, solid): the highest level reached shows at each point | DECISIONS 2026-09-27 « Exact viewshed… » (accuracy is a first-rank criterion); 2026-10-08 « One palette… » (the levels by shape, the highest level, never a sum) |
| The basemap seen through the fields (17a: the buildings under its halftone) | the fields opaque; the buildings drawn above them at the basemap's own opacity (2026-10-08, « The more vivid… »), the roads under them: inside a field the streets (grey or filmed), the buildings, the names and the stickers show | DECISIONS 2026-10-08 « One palette… » (the highest level at each point, never a sum, without a pipeline change: MapLibre blends each polygon of a translucent fill, so two fields of one level would darken where they overlap; opaque, they draw the same pixels) |
| Unknown direction drawn with dots | no trace on the map: its field a full circle drawn like every other (same inks, same texture); the sheet says it (« Direction : non relevée » in the « Supposé » box) | DECISIONS 2026-10-08 « Unknown direction leaves no trace on the punk map… » (supersedes for punk the hatching of 2026-10-06 « Hatching keeps one meaning… ») |
| Text pink #ff48b0, street levels #ffb3dc / #ff7cc6 / #ff48b0 on the light map | text pink #b8005f; levels #ff71c1 / #ee329c / #c9006e, one stroke without a casing (« reconnaître » and « identifier » 3:1 on every road above ground, « détecter » 2.1 – 2.5:1); communes #ffeef6 → #c9006e with a #7fd4ff border | WCAG 1.4.3 and 1.4.11 (4.5:1; 3:1 where the stroke alone can hold it); DECISIONS 2026-10-08 « The more vivid… » (one style for the filmed streets, no casing) |
| Dark ramps brighter where more is filmed (16a, 18a, 20a, 24a) | the same: from a dull wine (#36202d) to 17a's pink (#fe48b0), the outline #ff7cc6, the areas' border #80d4ff (one step off 17a's sky, which is the dark map's own position colour) | DECISIONS 2026-10-08 « One palette… » (supersedes for punk « the darker, the more filmed » of 2026-10-06) — no deviation left |
| 18a's and 20a's light blue halftone in dark | 17a's pink halftone in both modes | DECISIONS 2026-10-08 « One palette… » (anchored on 17a's electric pink in light and dark) |
| 20a's light blue dot screen over the whole map (0.22 light, 0.12 dark); roads without an edge, street names in the regular weight | the map's dot screen about 2.5 times paler (--map-paper-dots 0.08 / 0.05; the machine's paper unchanged); roads and paths edged in grey, street names in Noto Sans Medium, 12–15 px | streets' legibility: the roads stood at 1.02–1.38:1 (WCAG 1.4.11 asks 3:1), now 4.53:1 light and 3.98:1 dark on the earth; DECISIONS 2026-10-19 (« A2 + B ») |
| Quarter names in pink | every name in the ink on a 2 px halo | DECISIONS 2026-10-06 « Punk map names in one colour… » |
| In focus, the other fields hidden | in one opaque dimmed colour | DECISIONS 2026-10-06 « No answer is preselected… » (doc audit c5) |
| The pig sticker beside an operator | none | DECISIONS 2026-10-05 « Neutrality… » |
| The motorised camera as a dome with arrows (2a; the type buttons of 18a, 20a) | a ball at the end of a pipe (16a) | DECISIONS 2026-10-05 « The big motorised ball's sticker… » |
| Answers preselected (« Je ne sais pas », « Public ») | none preselected; punk's add / « Modifier » sheet: « Je ne sais pas » checked when nothing else is, never « Public » | DECISIONS 2026-10-06 « No answer is preselected… »; 2026-10-09 « « Je ne sais pas » comes first… » |
| The filters machine opening in about 1.7 s, « BOUM ! » 1.1 s, 23a looping | at most 400 ms before a content is usable; longer decorations only under the four conditions | DECISIONS 2026-10-06 « Animations: at most 400 ms… » |
| Dates written to the day, « sur place » unconditional | the month; « sur place » only when it was on site | DECISIONS 2026-09-30 « Dates of contributions on the map are months… », 2026-10-01 « "Sur place" is said only when it is true… » |
| The streets nobody films drawn as 20a's white roads with an ink border | from z14 solid grey lines (« Non filmé » in the legend) | DECISIONS 2026-09-30 « Streets z12-14 colour only what is filmed… » (unfilmed segments are grey lines from z14); 2026-10-06 « Punk dark street levels… » (what yields is the unfilmed grey, 3:1 on the earth) |
| Fonts loaded from a font service | self-hosted Latin subsets of Archivo and Special Elite | CLAUDE.md (no third-party runtime service); DECISIONS 2026-10-05 « Punk fonts, self-hosted latin subsets… » |

### Map, filters and legend (lot 3.1)

| Mockup | Code | Reason |
|---|---|---|
| 20a's closed ticket: one link, « Filtres et légende ↓ » (18a alike; 17a adds « Liste des caméras → ») | 17a's « Filtres et légende → » alone, on both screens: « Liste des caméras » hidden until further notice, its code kept | DECISIONS 2026-10-08, « Punk, until further notice… » (supersedes the list's link of 2026-10-07 « Lots after 3.0… »); the arrow 17a's |
| The ticket's links 28 px high (17a, 20a, 18a) | 28 px with a mouse, 44 px wherever the pointer is coarse (a phone, a tablet) | DECISIONS 2026-10-07, « Fidelity to the mockup comes first… » (44 px for what is touched); WCAG 2.5.8 (24 px) with a mouse |
| The machine rising in about 1.7 s | 300 ms, its keys usable from the first frame | DECISIONS 2026-10-06, « Animations: at most 400 ms… » (also in « All screens ») |
| « Qui filme »: four keys at every zoom | below the street level two keys, « Toutes » and « Publiques seules », counts « ≈ » | real data: the communes and départements hold two sets only (DECISIONS 2026-09-27, 2026-09-29: « Qui filme » switches between the two precomputed sets) |
| « Type de caméra »: 20a's and 18a's type keys, no multi-dome | a « Multi-boules » key after « Dôme », its own sticker, shown as every key when such a camera is in view; the map's cameras and fields of that kind drawn as any other | the user's decision of 2026-10-23 (DECISIONS 2026-10-23: a new category; a kind the page does not list is filtered off the map, tests/kinds.test.ts) |
| « Type de caméra » and « État de la fiche » at every zoom | from the street level; below, « Types et état de la fiche : au zoom de la rue. » | real data: no camera is loaded below z15 (DECISIONS 2026-09-27, « Advanced filters in a drawer… apply to cameras at street zoom only ») |
| « Plus de filtres » open (its dashed top edge the rule above 18a's tray, the drawer running on below the paper's fold) | closed until asked for, open by itself while one of its filters is on; its edge, the same dashed rule, comes with it | DECISIONS 2026-09-27, « Advanced filters in a drawer, collapsed by default… » |
| « Vérifiée sur place il y a… » | « Vérifiée il y a… » | DECISIONS 2026-10-01, « "Sur place" is said only when it is true… » (freshness is the latest check or survey date, on site or not) |
| « Elle peut… »: four chips | a fifth, « identifier au-delà de N m », when cameras in view can | the filter of DECISIONS 2026-09-27 (the advanced filters) kept: the punk interface loses none |
| The legend's levels: 20a's flat swatch and a reach under each (« ~6 m ») | below the street level the swatch in the street colour; from z15 exactly the three fields' samples (halftone and outline as the map draws them), named; no reach | DECISIONS 2026-10-08, « One palette… » (the legend shows exactly these three samples); real data: the legend is the map's, a reach belongs to one camera |
| The legend: five items | two more, « disparue (vérifiée) » and « position proposée » | real data: states the map draws (lot 3.0's gone sticker, DECISIONS 2026-10-07; the proposals' ghost, 2026-09-29) |
| « Peut-être disparue »: a dashed ring hatched inside, its « ? » yellow on ink | the dashed ring without hatching; in dark the « ? » ink on a cream disc | DECISIONS 2026-10-06, « Hatching keeps one meaning… »; WCAG 1.4.11 (20a's yellow on cream is 1.2:1) |
| The basemap's water under the fields' halftone (16a, 17a) | from z15, the water again over the fields, see through, with a shore line; the fields' outlines stay under it (the owner asked them above: each camera's outline would then show inside the field) | the owner's request of 2026-10-15 (the halftone hid the Seine and the canals) |
| The basemap's roads under the fields' halftone (16a, 17a) | from z15 (its paths from z16), above the fields and the buildings, in their own neutral style, under the filmed streets and the labels | the owner's request of 2026-10-15 (point 4: paths, quays and ramps lost under the fields, in « Prudent » most; to find one's way) |
| The tape on proposed cameras only | on a proposal's ghost too | DECISIONS 2026-10-07, « The stickers as delivered are accepted… » (a ghost and a dimmed camera must not look alike in dark) |
| « ＋ Ajouter » yellow at every zoom | below z15 (where no sticker shows) paper, its text muted and its edge dashed; between z15 and z17 a tap zooms to z17 first | DECISIONS 2026-10-02, « "＋ Ajouter" replaces… below z17 greyed (aria-disabled) », for punk 2026-10-09 « Punk map after the iPhone test » (active as soon as the stickers show) |
| Dark: the ticket's and the machine's offset shadows light blue (20a, 18a) | pink under the surfaces | DECISIONS 2026-10-07, « Second accent after 17a » (in dark the pink goes under the surfaces) |
| Dark: « Me localiser », the zoom buttons, the machine's × and « Plus de filtres » cream with ink text, the ticket's links underlined in pink (20a, 18a) | the light blue with ink text, the links underlined in light blue | DECISIONS 2026-10-07, « Second accent after 17a » (in dark the light blue is the primary fill and the links' underline) |
| The legend printed on a ticket of fixed height, its last lines under the machine (20a) | the ticket as tall as its legend, the machine under it | no line of the legend hidden (WCAG 1.4.10, no loss of content); real data: two more lines than 20a's |
| 18a: the open machine covers the attribution | the machine's feet and the camera list's torn edge stop 8 px above the attribution (18a's inset at the bottom left; on a wide screen under 760 px, above its band at the bottom right) | the ODbL attribution is always readable (CLAUDE.md, publishable data; DECISIONS 2026-09-28, « Phone sheet reaches the bottom edge… the ODbL attribution rides above it while open ») |
| 20a: the machine open, the ticket 272 px from 30 px, wider than the slot it comes out of | centred over the slot (the case's handle, 262 px) and 250 px wide; printing the legend, 272 px again | the product owner's brief for chantier A (2026-10-08: « the ticket is centred and fits within the slot's width »); no DECISIONS line yet |
| No control of the mode (the boards before 25a are drawn in one mode each) | one 44 px sun / moon square under the ticket's link, 25a's first key, named for the other mode; the phone's mode followed until it is used | DECISIONS 2026-10-09, « Punk map after the iPhone test » (replaces the Clair / Sombre / Auto keys of chantier A) |
| The ticket held by a yellow scotch (20a) | no scotch: on the map the yellow tape means « correction en attente » alone | DECISIONS 2026-10-09, « Punk map after the iPhone test » (every decorative tape removed) |
| No word of the filters out of the machine | « N filtres actifs en vue rue · Tout réafficher » in the machine at every zoom; a short ticket under the header one when the filters hide every camera or filmed street of the view | DECISIONS 2026-10-09 (the iPhone test: a type filter stayed on, unseen, after zooming out) |
| 24a: the open commune outlined (light blue in the product owner's brief) on its class | 3 px light blue on a 5 px near-black edge; the borders between areas 0.75 px | DECISIONS 2026-10-09 (the outline vanished on the vivid classes on an iPhone) |
| 18a: the ticket and the floating buttons stay over the map with a sheet open | on a phone, they slide away (ticket left, buttons right, 300 ms, none under reduced motion) and come back when it closes | DECISIONS 2026-10-09, « Punk sheets on a phone… » |
| 18a's attribution in 9.5 px type, two lines, unfolded | folded to a compact « ⓘ » (44 px), always shown; a tap unfolds it at 11 px, three lines (more at the communes' zooms, IGN's credit added) | DECISIONS 2026-10-08, « Punk, until further notice… » (11 px at least), 2026-10-09 « Punk sheets on a phone… » (the compact « ⓘ ») |
| 18a (390 px wide): « Me localiser » beside the attribution | at every width beside its folded « ⓘ », 34 px from the bottom; narrower than 390 px, the floating buttons above the attribution while it is unfolded only (until 2026-10-17 at every moment, 74 px from the bottom at 360 px) | at 360 px « Me localiser » (159 px) would sit on the unfolded credit's 182 px (ODbL: the attribution stays readable; WCAG 2.4.11 for the button); folded (44 px, DECISIONS 2026-10-09) it leaves 18a's place: the user's report of 2026-10-17 (lot M, an Android phone 360 px wide: « a gap remains below them ») |
| 18a (390 px wide): the ticket 200 px, Standard and Prudent on one line at its right | narrower than 375 px, the two pastilles stacked at the top right (Standard above, Prudent under it), the ticket unchanged | the user's request of 2026-10-17 (lot M: on a 360 px Android phone the ticket covered « Standard », read « TANDARD »; « le cartouche peut se réduire… »): at 360 px 18a's line needs 14 px more than the screen, at 320 px 48; stacked, they hold beside the 200 px ticket down to 320 px, its title, link and three 44 px squares untouched |
| 18a: the credit unfolded at the bottom left, never reaching the ticket (a phone upright) | on a phone held sideways 320 px high, the unfolded credit reaches the ticket's foot: it is drawn on top of it until folded | the ODbL attribution and its « ⓘ » stay readable and reachable (before lot M the ticket covered both, the credit could no longer be folded); the landscape phone is not drawn by the mockup || The filmed streets one width at every street zoom (the boards stop at z17) | past z17 they widen with the map (6 px at z18, 10 at z19, 16 at z20), the same colour, no edge; since rules 3.1 every street, filmed or not, is at least as wide as the basemap's road of its class (a boulevard 13 px at z18, a motorway 15 px), the unfilmed ones no longer thinner | DECISIONS 2026-10-14, « Punk streets keep their style… » (at z19 in dark, a portion on its own level's field: 1.01 – 1.61:1 against the halftone, at 4.5 px barely wider than the identify halftone's 2.8 px pitch; the ink edges first tried are removed, the author preferring the style at z15 – z17); 2026-10-16, « Punk streets, filmed or not, as wide as the basemap's road… » (1 to 2 px of the basemap's white on each side of a filmed boulevard) |

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
| The fields' text 15 px | 15 px, 16 px on a phone | a phone's browser zooms the page on a field under 16 px (hypothesis: iOS Safari's behaviour, not checked on a device in this lot) |
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
| V2-Sommaire: « Île-de-France, Rhône, Bouches-du-Rhône · mis à jour le … » | what each family of documents covers, in one sentence (« Contrats : toute la France. Avis et subventions : Île-de-France, Rhône, Bouches-du-Rhône. Arrêtés : Rhône. »), from couverture.json `resume`, each département a link | Ju's instruction (lot R3): the contracts now cover all of France, the decrees one département |
