# Shared: one interface and its bricks

The punk interface as a whole and what every screen shares.

## In force

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

## Deviations from the mockup (« Écarts à la maquette »)

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
