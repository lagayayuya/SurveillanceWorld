# Fonts of the punk theme

Self-hosted, loaded only by the punk interface and the register (`../fonts.ts`; the families are named in `../punk/tokens.css`). The three files are **modified**
versions of the upstream fonts: cut by `web/scripts/fonts.sh` (fontTools 4.66.1) to the
Latin set (`U+0000-00FF`, French punctuation, `U+2000-206F`, `€`…) and, for Archivo, to the
axes the theme uses.

| File | Font | Upstream (pinned commit) | Licence | Change |
|---|---|---|---|---|
| `archivo-800-900-62-100.woff2` | Archivo, © 2020 The Archivo Project Authors | github.com/Omnibus-Type/Archivo @ b5d63988 `fonts/variable/Archivo[wdth,wght].ttf` | SIL Open Font License 1.1 (`OFL-Archivo.txt`) | variable axes limited to weight 800–900 and width 62–100 % (`fontTools.varLib.instancer`), Latin subset, woff2 |
| `archivo-400-900-62-100.woff2` | Archivo, the same upstream file (SHA-256 `664bbeb10522dac35c174a3860aaecad7b1ad3a0fc8b0d26888e26c824ec556d`) | the same | SIL Open Font License 1.1 (`OFL-Archivo.txt`) | variable axes limited to weight 400–900 and width 62–100 % (the register's text, `registre.html`), Latin and Latin Extended subset, woff2: 100 948 bytes |
| `special-elite.woff2` | Special Elite, © 2010 Brian J. Bonislawsky DBA Astigmatic (AOETI) | github.com/google/fonts @ 0c423079 `apache/specialelite/SpecialElite-Regular.ttf` | Apache License 2.0 (`LICENSE-SpecialElite.txt`) | Latin subset, woff2 (`pyftsubset`) |

Notice (Apache License 2.0, section 4 b): `special-elite.woff2` was changed by the la-carte
project on 2026-10-05: glyphs outside the Latin set above were removed and the font was
converted to woff2. "Special Elite" is a trademark of Astigmatic (AOETI); "Archivo" is a
trademark of Omnibus-Type. No Reserved Font Name is declared by Archivo's licence.
