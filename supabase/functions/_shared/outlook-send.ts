// outlook-send.ts — de enige plek waar Maestro een mail écht VERSTUURT.
//
// Eén caller: `outlook-live` → action `send_mail`. Dat is het browser-endpoint:
// `verify_jwt: true`, capability-poort `postvak`, mailbox van de ingelogde
// caller, en aan de andere kant een mens die op Verstuur heeft getikt.
//
// Bewust een eigen bestand met een eigen allowlist van één slug. Het alternatief
// — de send-slug bij de mail- en agenda-slugs van `outlook-exec.ts` zetten en er
// een vlag bij verzinnen — leest hetzelfde en betekent iets anders: dan kan een
// agent-pad de slug alsnog meegeven. `auto-draft-execute-now` importeert dít
// bestand niet, en kan dus niet versturen, ook niet per ongeluk.
//
// Het **transport** is wél gedeeld (`execAllowlisted` uit `outlook-exec.ts`),
// inclusief het pinnen van `user_id` op `'me'`: twee kopieën van dezelfde fetch
// lopen uit elkaar, en dat is precies de fout die `outlook-exec.ts` kwam
// oplossen. Gedeeld transport, aparte lijst.
//
// ── Stand van de Entra-grant ────────────────────────────────────────────────
// De app-registratie mist `Mail.Send` (parkeerpunt Jasper). Zolang dat zo is
// faalt elke call hier bij Graph met een toestemmingsfout. Dat is geen bug om
// weg te vangen: `classifySendFailure` vertaalt hem naar één herkenbare reden,
// zodat de UI "Mail.Send ontbreekt — Entra, bij Jasper" kan tonen in plaats van
// "er ging iets mis", en de tekst van de gebruiker als concept kan wegzetten.
//
// ── Het argument-schema: gemeten, niet gespiegeld (2026-09-15) ──────────────
// De vorige versie van dit bestand nam aan dat SEND_EMAIL eruitziet als
// CREATE_DRAFT (`to_recipients` als lijst). **Dat klopt niet.** Live opgehaald
// met `GET /api/v3/tools/OUTLOOK_OUTLOOK_SEND_EMAIL`:
//
//     required: subject, body, to_email
//     to_email            string   — ÉÉN primaire ontvanger, geen lijst
//     to_name             string   — weergavenaam van die ene
//     cc_emails           string[]
//     bcc_emails          string[]
//     is_html             boolean  (default false)
//     save_to_sent_items  boolean  (default true)
//     attachment          object   (niet gebruikt)
//
// Met `to_recipients` zou élke send zijn gestrand op een validatiefout, en die
// had niemand gezien zolang de grant ontbreekt — de scope-fout komt eerder.
//
// **Meer dan één To-adres kan deze tool niet.** Ze weggooien is geen optie en
// stilzwijgend samenvoegen ook niet, dus de extra adressen gaan naar Cc en dat
// staat in het antwoord (`cc_promoted_from_to`) zodat de UI het kan zeggen.
// Iedereen krijgt de mail; alleen de kop ziet er anders uit dan je intikte.

import { execAllowlisted, type OutlookCtx } from "./outlook-exec.ts";
import { assertInternalOnly } from "./mail-policy.ts";

/** Slugs die écht versturen. Staan bewust NIET in `outlook-write.ts`. */
export const OUTLOOK_USER_SEND = {
  SEND_MAIL: "OUTLOOK_OUTLOOK_SEND_EMAIL",
} as const;

const ALLOWED_USER_SEND: ReadonlySet<string> = new Set(Object.values(OUTLOOK_USER_SEND));

export interface SendMailInput {
  subject?: string | null;
  body_text?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
}

export interface SendMailResult {
  sent: true;
  to: string[];
  cc: string[];
  bcc: string[];
  /** To-adressen die naar Cc moesten omdat de tool er één aankan. */
  cc_promoted_from_to: string[];
}

/**
 * Eén mail versturen namens de ingelogde gebruiker. Gooit bij elke fout; de
 * caller vertaalt die met `classifySendFailure` naar iets wat de UI kan tonen.
 */
export async function sendMailAsUser(ctx: OutlookCtx, p: SendMailInput): Promise<SendMailResult> {
  const to = cleanAddresses(p.to);
  const ccIn = cleanAddresses(p.cc);
  const bcc = cleanAddresses(p.bcc);
  if (to.length === 0) throw new Error("send_recipients_missing");
  const body = String(p.body_text ?? "").trim();
  if (!body) throw new Error("send_body_empty");

  // Laag 2 van het domeinbeleid — hier, op de exacte strings die naar Graph
  // gaan, niet op wat de frontend zei te sturen. Zie _shared/mail-policy.ts.
  assertInternalOnly([to, ccIn, bcc]);

  const promoted = to.slice(1);
  const cc = dedupe([...ccIn, ...promoted]);

  await execAllowlisted(ctx, OUTLOOK_USER_SEND.SEND_MAIL, {
    // `user_id` wordt door het transport alsnog op 'me' gepind (slot 2); hier
    // staat hij zodat de aanroep leesbaar blijft zonder dat bestand erbij.
    user_id: "me",
    subject: String(p.subject ?? "").trim().slice(0, 255) || "(geen onderwerp)",
    body,
    is_html: false,
    to_email: to[0],
    ...(cc.length ? { cc_emails: cc } : {}),
    ...(bcc.length ? { bcc_emails: bcc } : {}),
    save_to_sent_items: true,
  }, ALLOWED_USER_SEND);

  return { sent: true, to: [to[0]], cc, bcc, cc_promoted_from_to: promoted };
}

function cleanAddresses(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    const addr = String(raw ?? "").trim();
    if (/\S+@\S+\.\S+/.test(addr) && !out.some((a) => a.toLowerCase() === addr.toLowerCase())) {
      out.push(addr);
    }
  }
  return out.slice(0, 20);
}

function dedupe(list: string[]): string[] {
  const out: string[] = [];
  for (const a of list) if (!out.some((b) => b.toLowerCase() === a.toLowerCase())) out.push(a);
  return out;
}

/**
 * Faalreden → één woord dat de UI kent. Leeg = onbekend, en dan hoort de caller
 * de fout gewoon door te laten als 502; een onbekende fout als "Mail.Send
 * ontbreekt" tonen zou de gebruiker naar Jasper sturen voor een storing die
 * daar niet zit.
 */
export function classifySendFailure(message: string): string {
  const m = message.toLowerCase();
  // De slug bestaat niet (meer) in de toolkit — een hernoeming zoals §5b.
  if (m.includes("toolnotfound") || m.includes("composio_http_404")) return "mail_send_tool_missing";
  // Toestemming. Graph zegt ErrorAccessDenied / "Access is denied"; Composio kan
  // er een 401/403 van maken, of over de scope klagen.
  if (m.includes("accessdenied") || m.includes("access is denied")
    || m.includes("insufficient") || m.includes("scope") || m.includes("mail.send")
    || m.includes("composio_http_401") || m.includes("composio_http_403")) {
    return "mail_send_scope_missing";
  }
  // Ons argument-schema klopt niet met dat van de tool (zie kop).
  if (m.includes("composio_http_400") || m.includes("validation")) return "mail_send_bad_request";
  return "";
}
