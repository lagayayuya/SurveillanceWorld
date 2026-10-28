// « Signaler une erreur »: no one reviews the register, so a reader's report is its correction (DECISIONS
// 2026-10-28). Until lot R1b brings its form (to /revue), a message to the site's contact address with the
// document's id in its subject; the address is the build's (legal/contact.ts), never in the repository,
// and without it there is no link.
import { CONTACT } from "../legal/contact.ts";
import { t } from "./i18n.ts";

export function signaler(id: string): { href: string; l: string } | null {
  if (!CONTACT) return null;
  const subject = encodeURIComponent(t("signaler.objet", { id }));
  return { href: `mailto:${CONTACT}?subject=${subject}`, l: t("signaler.lien") };
}
