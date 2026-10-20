// The four legal pages of the punk interface (the launch lot, the author's point 6) as data:
// each page its sections, each section its paragraphs, every text a key of fr.json
// (`legal.<page>.<section>.h`, `legal.<page>.<section>.<n>`). A section or a paragraph may
// be shown only when contributions are open (`open`: every part that speaks of accounts),
// only when they are closed (`closed`), only when the API gives the publisher's identity
// (`publisher`) or offers publishing to OpenStreetMap (`publish`). Pure data: the tests read
// it without a page (web/tests/legal.test.ts).

export const SLUGS = ["mentions-legales", "confidentialite", "conditions", "sources"] as const;
export type Slug = (typeof SLUGS)[number];

export type When = "open" | "closed" | "publisher" | "publish";
export type Paragraph = { key: string; when?: When };
export type Section = { key: string; when?: When; paragraphs: Paragraph[] };
export type Page = { slug: Slug; key: string; sections: Section[] };

/** `n` paragraphs `<section>.1` … `<section>.n`, or as listed with their conditions. */
const section = (
  page: string,
  name: string,
  paragraphs: number | (When | null)[],
  when?: When,
): Section => {
  const list = typeof paragraphs === "number" ? Array(paragraphs).fill(null) : paragraphs;
  return {
    key: `legal.${page}.${name}`,
    when,
    paragraphs: list.map((w, i) => ({
      key: `legal.${page}.${name}.${i + 1}`,
      ...(w ? { when: w } : {}),
    })),
  };
};

export const PAGES: Page[] = [
  {
    slug: "mentions-legales",
    key: "legal.mentions",
    sections: [
      section("mentions", "publisher", 1, "publisher"),
      section("mentions", "contact", 1),
      section("mentions", "host", 2),
      section("mentions", "more", 1),
    ],
  },
  {
    slug: "confidentialite",
    key: "legal.privacy",
    sections: [
      section("privacy", "controller", 1, "publisher"),
      section("privacy", "reading", 2),
      section("privacy", "device", [null, "open", "open", "closed"]),
      section("privacy", "account", [null, null, null, "publish", null, null], "open"),
      section("privacy", "purpose", 2, "open"),
      section("privacy", "recipients", [null, null, null, "publish", null], "open"),
      section("privacy", "duration", 3, "open"),
      section("privacy", "rights", ["open", null, null]),
      section("privacy", "cameras", 2),
    ],
  },
  {
    slug: "conditions",
    key: "legal.terms",
    sections: [
      section("terms", "site", [null, null, "open"]),
      section("terms", "account", 2, "open"),
      section("terms", "contribute", 3, "open"),
      section("terms", "licence", 1, "open"),
      section("terms", "publish", 2, "publish"),
      section("terms", "contact", 1),
    ],
  },
  {
    slug: "sources",
    key: "legal.sources",
    sections: [
      section("sources", "cameras", 1),
      section("sources", "basemap", 3),
      section("sources", "areas", 1),
      section("sources", "layer", 1),
      section("sources", "code", 3),
      section("sources", "fonts", 1),
    ],
  },
];

export const isSlug = (s: string | null): s is Slug =>
  s !== null && (SLUGS as readonly string[]).includes(s);

export const page = (slug: Slug): Page => PAGES.find((p) => p.slug === slug) as Page;

/** What the site is now: whether each condition holds. */
export type Shown = { open: boolean; publisher: boolean; publish: boolean };

export function holds(when: When | undefined, s: Shown): boolean {
  if (when === undefined) return true;
  if (when === "closed") return !s.open;
  // Publishing is offered only while contributions are open (GET /api/config).
  if (when === "publish") return s.open && s.publish;
  return s[when];
}

/** The page's sections and paragraphs shown in that state (a section left empty goes). */
export function shownSections(p: Page, s: Shown): Section[] {
  return p.sections
    .filter((sec) => holds(sec.when, s))
    .map((sec) => ({ ...sec, paragraphs: sec.paragraphs.filter((x) => holds(x.when, s)) }))
    .filter((sec) => sec.paragraphs.length > 0);
}
