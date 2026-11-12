# The map

The map by zoom, filters and legend, focus and the zoom-out marker.

## In force

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

## Deviations from the mockup (« Écarts à la maquette »)

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
