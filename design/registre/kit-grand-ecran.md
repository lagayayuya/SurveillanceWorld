# Kit commun des maquettes grand écran (v11)

Toutes les pages grand écran : largeur 1280, colonne de contenu 1180 centrée, `data-props` theme enum clair/sombre défaut "sombre",
plus un bouton de thème dans l'en-tête (état `dark`, initialisé depuis la prop).

## 1. `<helmet>` (copier tel quel, ajouter seulement des règles propres à la page en dessous)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&amp;family=Special+Elite&amp;display=swap">
<style>
body{margin:0}
.th{--page:#e6eef0;--bg:#f2efe6;--card:#ffffff;--fg:#111111;--muted:#5a5650;--rule:#c9c4b6;--soft:#e9e5da;--link:#0060a0;--accent:#0060a0;--hover:#ff48b0;--ao:#b38f00;--ao-ink:#111;--aut:#0060a0;--aut-ink:#fff;--sub:#2e7d4f;--sub-ink:#fff;--warn:#fff6bf;--drone:#0089c7;background:var(--page);color:var(--fg)}
.th.dark{--page:#050505;--bg:#121212;--card:#1b1b1b;--fg:#f2efe6;--muted:#b0ab9f;--rule:#34322e;--soft:#232323;--link:#7fd4ff;--accent:#7fd4ff;--hover:#ff48b0;--ao:#e0b400;--ao-ink:#111;--aut:#7fd4ff;--aut-ink:#111;--sub:#7fd18f;--sub-ink:#111;--warn:#3d3600;--drone:#7fd4ff}
.th a{color:var(--link)}
.tw{font-family:"Special Elite","Courier New",monospace}
.h1{margin:0;font-weight:900;font-stretch:62%;font-size:72px;line-height:.9;text-transform:uppercase}
.h2{margin:0;font-weight:900;font-stretch:66%;font-size:30px;line-height:1;text-transform:uppercase}
.h3{margin:0;font-weight:900;font-stretch:75%;font-size:20px;line-height:1.1;text-transform:uppercase}
.lead{margin:0;max-width:860px;font-size:22px;line-height:1.35;font-weight:500}
.nav{color:#f2efe6 !important;font-weight:700;text-decoration:none;min-height:44px;display:inline-flex;align-items:center}
.nav[aria-current="page"]{font-weight:900;text-decoration:underline;text-underline-offset:6px}
.hdr{width:44px;height:44px;border:0;background:none;color:#f2efe6;cursor:pointer;display:flex;align-items:center;justify-content:center}
.crumbs{font-size:14px}
.crumbs a{text-decoration:none}
.tag{display:inline-block;padding:2px 8px;color:#111;font-weight:800;font-stretch:80%;font-size:13px;text-transform:uppercase;letter-spacing:.06em}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:2px solid var(--fg);border-bottom:2px solid var(--fg)}
.kpis>div{padding:14px 0 14px 20px;border-left:1px solid var(--rule)}
.kpis>div:first-child{padding-left:0;border-left:0}
.kv{font-weight:900;font-stretch:64%;font-size:48px;line-height:1}
.tabs{display:flex;border-bottom:2px solid var(--fg)}
.tabs a{display:inline-flex;align-items:center;min-height:52px;padding:0 18px;font-weight:800;font-stretch:80%;text-transform:uppercase;text-decoration:none;color:var(--fg)}
.tabs a[aria-current="page"]{box-shadow:inset 0 -4px 0 var(--fg)}
.ibtn{width:44px;height:44px;border:0;background:none;color:var(--fg);cursor:pointer;display:flex;align-items:center;justify-content:center}
.ibtn span{width:22px;height:22px;border:2px solid currentColor;border-radius:50%;display:flex;align-items:center;justify-content:center;font:900 13px Archivo,sans-serif}
.note{margin:0;padding:12px;border:1px solid var(--rule);color:var(--muted);font-size:14px}
table.t{width:100%;border-collapse:collapse;font-size:15px}
table.t th{text-align:left;font-weight:800;font-stretch:80%;font-size:13px;text-transform:uppercase;letter-spacing:.03em;padding:0;border-bottom:2px solid var(--fg)}
table.t th button{all:unset;cursor:pointer;display:flex;align-items:center;gap:4px;min-height:44px;padding:0 8px;box-sizing:border-box;width:100%}
table.t th.num button{justify-content:flex-end}
table.t td{padding:9px 8px;border-bottom:1px solid var(--rule);vertical-align:top}
table.t td.num{text-align:right;white-space:nowrap}
table.t tr.r{cursor:pointer}
table.t tr.r:hover td,table.t tr.r.on td{background:var(--soft)}
.rowlink{color:var(--fg) !important;font-weight:700;text-decoration:none}
.rowlink:hover{text-decoration:underline}
.panel{position:sticky;top:20px;border:2px solid var(--fg);background:var(--card);padding:16px;display:flex;flex-direction:column;gap:8px;min-height:260px;box-sizing:border-box}
.prow{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--rule)}
.prow span{color:var(--muted)}
.b{display:inline-block;padding:1px 6px;font-weight:800;font-stretch:80%;font-size:12px;text-transform:uppercase;letter-spacing:.04em;border:1.5px solid var(--fg);white-space:nowrap}
.seg{min-height:44px;padding:0 14px;border:2px solid var(--fg);font:700 15px Archivo,sans-serif;cursor:pointer;margin-left:-2px}
.more{align-self:flex-start;min-height:44px;padding:0 16px;border:2px solid var(--fg);background:var(--card);color:var(--fg);font:800 14px Archivo,sans-serif;text-transform:uppercase;cursor:pointer}
.ghost{display:inline-flex;align-items:center;min-height:44px;font-weight:700}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
</style>
```

## 2. En-tête (premier enfant du conteneur `.th`)

```html
<header style="display: flex; align-items: center; gap: 24px; height: 60px; padding: 0 20px 0 28px; background: #000; color: #f2efe6; border-bottom: 2px solid var(--fg)">
  <a href="Registre.dc.html" style="color: #f2efe6; text-decoration: none; font-weight: 900; font-stretch: 70%; font-size: 22px; text-transform: uppercase; letter-spacing: .02em; margin-right: auto">Surveillance World</a>
  <a class="nav" href="CarteTemps-grand.dc.html">Carte</a>
  <a class="nav" href="Registre.dc.html" aria-current="{{nav.reg}}">Registre</a>
  <a class="nav" href="Glossaire.dc.html" aria-current="{{nav.glo}}">Glossaire</a>
  <a class="hdr" href="Registre.dc.html" aria-label="Rechercher dans le registre"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg></a>
  <button class="hdr" onClick="{{toggleTheme}}" aria-label="{{themeLabel}}">
    <sc-if value="{{isDark}}" hint-placeholder-val="{{true}}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4.5"></circle><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"></path></svg></sc-if>
    <sc-if value="{{isLight}}" hint-placeholder-val="{{false}}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"></path></svg></sc-if>
  </button>
</header>
```
`nav.reg` / `nav.glo` valent "page" ou "false".

## 3. Logique commune (dans `renderVals`)

```js
constructor(props) { super(props); this.state = { dark: (props.theme ?? 'sombre') === 'sombre', /* … */ }; }
// renderVals :
const dark = this.state.dark;
const fr = (n) => Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' ');
const eur = (n) => n == null ? 'non publié' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' M€' : fr(n) + ' €';
const MOIS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
const fd = (d) => { const [y, m, j] = d.split('-').map(Number); return (j ? j + ' ' : '') + MOIS[m - 1] + ' ' + y; };
// retour :
th: dark ? 'th dark' : 'th', isDark: dark, isLight: !dark,
themeLabel: dark ? 'Passer en thème clair' : 'Passer en thème sombre',
toggleTheme: () => this.setState({ dark: !this.state.dark }),
nav: { reg: 'page' | 'false', glo: 'false' }
```

## 4. Ossature d'une page « fiche » (commune, entreprise, acheteur, département, historique)

1. Fil d'Ariane `.crumbs` (Registre › Rhône › Mions), police normale.
2. Étiquette `.tag` colorée, puis `h1.h1`, puis une ligne `tw` muette (identifiant, département, population).
3. Une seule phrase de lecture `.lead` (pas plus).
4. `.kpis` : 4 chiffres, `.kv` + libellé.
5. `nav.tabs` (ancres de section), soulignement de l'onglet courant.
6. Grille `minmax(0,1fr) 320px`, gap 40 : sections à gauche, panneau fixe `.panel` à droite (aria-live="polite").
   Le panneau montre l'élément survolé ou touché (ligne de tableau, barre, point) ; par défaut, un résumé de la page.
   Il ne bouge jamais la mise en page : aucune modale sur la carte ou la page.
7. Méthode et précautions : sous un bouton `.ibtn` « i » à côté du titre de section, contenu `p.note.tw`. Au plus une phrase de lecture visible.
8. Pas de bouton répété par ligne. Les noms sont des liens (`.rowlink`), la ligne entière alimente le panneau au survol.

Couleurs des étiquettes : Commune `#ffe800` · Entreprise `#c9b8ff` · Acheteur `#9be7c4` · Département `#ffb36b` · Document `#a8d8ff`.

Pastilles de type de document `.b` (style en ligne selon le type) :
- Contrat : `background: var(--fg); color: var(--bg)`
- Modification : `background: transparent; color: var(--fg)`
- Appel d'offres / résultat : `background: var(--ao); color: var(--ao-ink); border-color: var(--ao)`
- Autorisation (préfecture) : `background: var(--aut); color: var(--aut-ink); border-color: var(--aut)`
- Subvention : `background: var(--sub); color: var(--sub-ink); border-color: var(--sub)`

Dates et références : `.tw` (Special Elite). Tout le reste : Archivo. Corps 16 px, tableaux 15 px, jamais moins de 13 px.
Survol : `var(--hover)` (#ff48b0). Liens : `var(--link)`.

## 4 ter. Le registre : deux vues

Documents · 6 759 (Registre.dc.html : chiffres-filtres, recherche, facettes, résultats, panneau) et Chiffres et classements (Registre-chiffres.dc.html : qui vend, qui achète, communes, années, dispositifs, drones).

## 4 bis. Pages d'une commune : quatre onglets, toujours les mêmes

L'essentiel (Commune-grand) · Documents · N (Documents-grand) · Autorisations · N (Autorisations-grand) · Carte et drones (CarteTemps-grand).
En-tête compact sur les onglets autres que L'essentiel : fil d'Ariane, étiquette Commune, H1 60 px, ligne .tw, puis les onglets.
La carte 3D de L'essentiel ne se manipule pas : elle tourne lentement (bouton pause seul, exigence d'accessibilité), montre toutes les couches
à la fois avec une légende complète, et un bouton « Explorer la carte et les drones → » mène à l'onglet Carte et drones.

Rose (#ff48b0) : survol et sélection, et éléments filmés sur la carte. Jamais comme simple pastille décorative (écarts, modifications : couleur du texte).

## 5. Liens entre maquettes (href)

Registre.dc.html · Registre-chiffres.dc.html · Commune-grand.dc.html (Mions) · Documents-grand.dc.html (Mions) · CarteTemps-grand.dc.html (Lyon, drones) ·
Autorisations-grand.dc.html (onglet Autorisations de Mions) · Contrat-grand.dc.html (fiche d'un contrat : Mions 2025) · Entreprise-grand.dc.html (Serfim) · Acheteur-grand.dc.html (Sytral) ·
Departement-grand.dc.html (Rhône) · Glossaire.dc.html

## 6. Règles de contenu

Données réelles uniquement (registre du prototype v10, fichier d.json du bloc-notes, ou valeurs déjà présentes dans les maquettes téléphone).
Si une valeur manque : `[à lire]` ou `[chiffres de …]`, jamais un chiffre inventé. Aucun nom de personne physique, aucune étiquette politique,
aucun croisement avec la délinquance. « Analyse algorithmique », jamais « automatique ». Montants = maximums prévus aux contrats (le dire sous « i »).
