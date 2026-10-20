# Fonts of the punk theme

Self-hosted, loaded only by the punk interface (`../fonts.ts`; the families are named in `../punk/tokens.css`). Both files are **modified**
versions of the upstream fonts: cut by `web/scripts/fonts.sh` (fontTools 4.66.1) to the
Latin set (`U+0000-00FF`, French punctuation, `U+2000-206F`, `€`…) and, for Archivo, to the
axes the theme uses.

| File | Font | Upstream (pinned commit) | Licence | Change |
|---|---|---|---|---|
| `archivo-800-900-62-100.woff2` | Archivo, © 2020 The Archivo Project Authors | github.com/Omnibus-Type/Archivo @ b5d63988 `fonts/variable/Archivo[wdth,wght].ttf` | SIL Open Font License 1.1 (`OFL-Archivo.txt`) | variable axes limited to weight 800–900 and width 62–100 % (`fontTools.varLib.instancer`), Latin subset, woff2 |
| `special-elite.woff2` | Special Elite, © 2010 Brian J. Bonislawsky DBA Astigmatic (AOETI) | github.com/google/fonts @ 0c423079 `apache/specialelite/SpecialElite-Regular.ttf` | Apache License 2.0 (`LICENSE-SpecialElite.txt`) | Latin subset, woff2 (`pyftsubset`) |

Notice (Apache License 2.0, section 4 b): `special-elite.woff2` was changed by the la-carte
project on 2026-10-05: glyphs outside the Latin set above were removed and the font was
converted to woff2. "Special Elite" is a trademark of Astigmatic (AOETI); "Archivo" is a
trademark of Omnibus-Type. No Reserved Font Name is declared by Archivo's licence.
