// send-flow.ts — de verstuur-actie, met de drie poorten ervoor.
//
// Beleid (Jelle 2026-09-15 00:44 CEST, HARD): alleen `@legal-mind.nl`, extern of
// gemengd wordt een concept, en 7 sends per uur per gebruiker. Zie
// `_shared/mail-policy.ts` voor waarom de controle op meer dan één plek staat.
//
// Volgorde van de poorten is niet vrij:
//   1. **domein** eerst — een externe mail hoort geen uurslot te kosten;
//   2. **teller** daarna, atomair in de database (`claim_mail_send_slot`);
//   3. pas dan Graph.
//
// En het slot gaat terug zodra we zéker weten dat er niets vertrok. Bij twijfel
// niet: een onbekende fout kan een geslaagde send met een kapotte verbinding
// zijn, en dan is een verbruikt slot de veilige kant.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { checkRecipients, SEND_RATE_PER_HOUR } from '../_shared/mail-policy.ts';
import { classifySendFailure, sendMailAsUser } from '../_shared/outlook-send.ts';
import { type Ctx } from './ctx.ts';

export interface SendOutcome {
  status: number;
  body: Record<string, unknown>;
}

export async function handleSendMail(
  supabase: SupabaseClient,
  ctx: Ctx,
  caller: string,
  p: { subject?: string; body_text?: string; to: string[]; cc: string[]; bcc: string[] },
): Promise<SendOutcome> {
  // ── Poort 1: het domein ───────────────────────────────────────────────────
  const check = checkRecipients([p.to, p.cc, p.bcc]);
  if (check.verdict === 'empty') {
    return { status: 400, body: { ok: false, reason: 'send_recipients_missing' } };
  }
  if (check.verdict === 'external') {
    // Geen 4xx: dit is geen fout van de aanroeper maar een beleidskeuze met een
    // alternatief. De frontend zet er een concept van en zegt waarom.
    return {
      status: 200,
      body: { ok: false, reason: 'send_external_recipients', external: check.external },
    };
  }

  // ── Poort 2: de teller ────────────────────────────────────────────────────
  const { data: claim, error: claimErr } = await supabase.rpc('claim_mail_send_slot', {
    p_user_id: caller, p_limit: SEND_RATE_PER_HOUR, p_recipient_count: check.total,
  });
  if (claimErr || !claim) {
    // Geen teller = niet versturen. Fail-closed: de migratie
    // 20260915020000_postvak_mail_send_rate_limit.sql hoort vóór deze deploy te
    // draaien, en zolang dat niet zo is mag er niets vertrekken.
    console.error('[outlook-live] verstuur-teller onbereikbaar:', claimErr?.message ?? 'leeg antwoord');
    return { status: 200, body: { ok: false, reason: 'send_rate_unavailable' } };
  }
  const claimed = claim as Record<string, unknown>;
  if (claimed.ok !== true) {
    return {
      status: 200,
      body: {
        ok: false, reason: String(claimed.reason ?? 'send_rate_limited'),
        used: claimed.used ?? null, limit: claimed.limit ?? SEND_RATE_PER_HOUR,
        retry_after: claimed.retry_after ?? null,
      },
    };
  }
  const slotId = claimed.slot_id as string | undefined;

  // ── Poort 3: Graph. `sendMailAsUser` doet het domein nog eens. ────────────
  try {
    const r = await sendMailAsUser(ctx, {
      subject: p.subject ?? null, body_text: p.body_text ?? null,
      to: p.to, cc: p.cc, bcc: p.bcc,
    });
    if (slotId) await supabase.rpc('confirm_mail_send_slot', { p_slot_id: slotId }).then(null, () => {});
    return { status: 200, body: { ok: true, ...r, used: claimed.used, limit: claimed.limit } };
  } catch (sendErr) {
    const m = sendErr instanceof Error ? sendErr.message : String(sendErr);
    const release = async () => {
      if (slotId) await supabase.rpc('release_mail_send_slot', { p_slot_id: slotId }).then(null, () => {});
    };
    if (m === 'send_body_empty' || m === 'send_recipients_missing') {
      await release();
      return { status: 400, body: { ok: false, reason: m } };
    }
    if (m.startsWith('send_external_recipients')) {
      await release();
      return { status: 200, body: { ok: false, reason: 'send_external_recipients', external: check.external } };
    }
    const reason = classifySendFailure(m);
    if (!reason) {
      // Onbekend. Slot blijft staan (zie kop) en de router maakt er een 502 van.
      throw sendErr;
    }
    // Een bekende weigering betekent dat Graph niets heeft gedaan.
    await release();
    console.error('[outlook-live] send_mail geweigerd:', reason, m.slice(0, 300));
    return { status: 200, body: { ok: false, reason, detail: m.slice(0, 200) } };
  }
}
