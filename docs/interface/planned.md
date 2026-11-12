# Decided, not yet built

What a decision asks for and the code does not do yet.

## In force

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
