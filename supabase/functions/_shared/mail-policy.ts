// mail-policy.ts — wie Maestro mag mailen, en hoe vaak.
//
// Beleid van Jelle (2026-09-15 00:44 CEST), HARD:
//   • versturen mag **alleen** naar `@legal-mind.nl` — élk adres in To, Cc én Bcc
//   • extern of gemengd → géén send, wél een concept
//   • **7 sends per uur per gebruiker**, hard, niet in de UI
//   • meerdere lagen; de UI alléén is niet genoeg
//
// De UI-laag zit in `src/lib/mailPolicy.js` en deelt dit domein. Die laag is er
// om te *vertellen* (de knop heet "Concept" in plaats van "Verstuur" zodra er
// een extern adres in staat) — niet om te *beveiligen*. Beveiligen gebeurt hier
// en in `outlook-live`, want een frontend-check kost één devtools-tab.
//
// Drie lagen, met opzet niet dezelfde code:
//   1. `outlook-live` weigert de actie vóór er iets gebeurt (HTTP-antwoord met
//      een reden die de UI kan tonen) en claimt de uurslot in de database.
//   2. `assertInternalOnly()` hieronder draait binnen `sendMailAsUser()`, ná de
//      opschoning van de adressen: het laatste punt waar de exacte strings
//      bekend zijn die naar Graph gaan. Een toekomstige tweede caller die laag 1
//      vergeet, loopt nog steeds hier tegenaan.
//   3. De browser toont het en stuurt de verstuur-actie niet eens.
//
// Laag 2 gooit en vangt niet: deze functie is er niet om iets te repareren maar
// om te stoppen.

/** Het enige domein waar Maestro naartoe mag versturen. */
export const SEND_DOMAIN = "legal-mind.nl";

/** Hoeveel verstuurde mails per uur per gebruiker. */
export const SEND_RATE_PER_HOUR = 7;

export type RecipientVerdict = "internal" | "external" | "empty";

export interface RecipientCheck {
  verdict: RecipientVerdict;
  /** Alle adressen die niet op het toegestane domein zitten (max 10, voor de melding). */
  external: string[];
  /** Totaal aantal geadresseerden over To + Cc + Bcc. */
  total: number;
}

export function isInternalAddress(addr: unknown): boolean {
  const a = String(addr ?? "").trim().toLowerCase();
  // Eén `@`, en het stuk erachter is exact het domein. Niet `endsWith`: dat
  // laat `legal-mind.nl.evil.com` én `notlegal-mind.nl` door.
  const at = a.lastIndexOf("@");
  if (at <= 0) return false;
  return a.slice(at + 1) === SEND_DOMAIN;
}

/** Beoordeelt To + Cc + Bcc in één keer. Leeg is geen "intern". */
export function checkRecipients(groups: Array<readonly string[] | undefined>): RecipientCheck {
  const all: string[] = [];
  for (const g of groups) for (const a of (g ?? [])) if (String(a ?? "").trim()) all.push(String(a).trim());
  if (all.length === 0) return { verdict: "empty", external: [], total: 0 };
  const external = all.filter((a) => !isInternalAddress(a));
  return {
    verdict: external.length > 0 ? "external" : "internal",
    external: external.slice(0, 10),
    total: all.length,
  };
}

/**
 * Laag 2. Gooit `send_external_recipients:<adres,adres>` zodra er één adres
 * buiten het domein staat — de caller vertaalt dat naar een concept.
 */
export function assertInternalOnly(groups: Array<readonly string[] | undefined>): void {
  const check = checkRecipients(groups);
  if (check.verdict === "empty") throw new Error("send_recipients_missing");
  if (check.verdict === "external") {
    throw new Error(`send_external_recipients:${check.external.join(",")}`.slice(0, 300));
  }
}
