// The register's data: the files `lacarte registre construire` writes (pipeline/lacarte/registre/),
// served under /data/registre/ and asked again at each visit (no-cache: a 304 while unchanged). The
// pilot's own field names are kept; the build adds what its rules decided (counted, a copy, the
// commune's own, a shared act, a reviewed date, an act that could not be read): the views read these
// flags and never recompute a rule.

export type Evenement = {
  id: string;
  t: string;
  sous_type?: string;
  date?: string | null;
  date_annee?: boolean;
  insee?: string | null;
  dep?: string | null;
  affaire: string;
  objet?: string | null;
  montant?: number | null;
  entreprises?: string[];
  acheteur?: string | null;
  acheteur_siren?: string | null;
  beneficiaire?: string | null;
  beneficiaire_siren?: string | null;
  type_beneficiaire?: string | null;
  cameras?: number | null;
  cameras_vp?: number | null;
  cameras_int?: number | null;
  cameras_ext?: number | null;
  duree?: string | null;
  videoverbalisation?: boolean;
  deport_forces?: boolean;
  dispositif?: string | null;
  ref?: string | null;
  url?: string | null;
  page?: number | null;
  hors_totaux?: string | null;
  national?: boolean;
  publie_par?: string | null;
  // the build's flags
  compte?: boolean;
  copie?: boolean;
  communal?: boolean;
  date_lue?: string;
  partage?: string[];
  insee0?: string;
  non_lu?: string[];
  nom_publie?: boolean;
  [field: string]: unknown;
};

export type Affaire = {
  events: string[];
  acheteur_siren?: string | null;
  acheteur_communal?: boolean;
  titre?: string | null;
  insee?: string | null;
  kind?: string;
  debut?: string;
  echeance?: string | null;
  echeance_source?: string | null;
  cameras?: { n: number | null; groupe?: boolean; date?: string }[];
  [field: string]: unknown;
};

export type Entreprise = { nom?: string | null; entrepreneur_individuel?: boolean };
export type Acheteur = {
  nom?: string;
  nom_court?: string;
  categorie?: string;
  insee_siege?: string | null;
};
export type Commune = { nom: string; dep: string; pop?: number; epci?: string };
export type Dico = {
  entreprises: Record<string, Entreprise>;
  acheteurs: Record<string, Acheteur>;
  communes: Record<string, Commune>;
};

export type Stats = {
  docs: number;
  con: number;
  cam: number;
  dr: number;
  arr: number;
  montant: number;
  carte?: number | null;
};

export type Couverture = {
  maj: string;
  sources: { id: string; jusqu_au: string | null; collecte_le: string | null }[];
  departements: Record<
    string,
    {
      etat: "collecte" | "non_collecte" | "impossible";
      raison?: string;
      depuis?: string;
      dernier_recueil?: string;
    }
  >;
  non_lus: Record<string, number>;
};

export type NonLu = {
  id: string;
  t: string;
  date?: string | null;
  dep?: string | null;
  insee?: string | null;
  /** its commune's name, when the build knows it */
  commune?: string;
  ref?: string | null;
  url?: string | null;
  page?: number | null;
  raisons: string[];
};

/** The JSON of a file under /data/registre/, asked once per page (kept while the page lives). */
const cache = new Map<string, Promise<unknown>>();
export function load<T>(file: string): Promise<T> {
  let p = cache.get(file);
  if (!p) {
    p = fetch(`/data/registre/${file}`).then((r) => {
      if (!r.ok) throw new Error(`${file}: ${r.status}`);
      return r.json();
    });
    cache.set(file, p);
    // a failed file is asked again next time
    p.catch(() => cache.delete(file));
  }
  return p as Promise<T>;
}
