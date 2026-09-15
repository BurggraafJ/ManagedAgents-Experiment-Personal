#!/usr/bin/env node
// =============================================================================
// model_usage_smoke.cjs — doet de edge-poort het ook echt?            (v1.219)
// =============================================================================
// SECURITY PR-C / S8. `model_usage_log` staat sinds 2026-09-14 in productie en
// bevat **nul rijen**. De bundels noemen hem acht tot tien keer per functie, dus
// op papier klopt alles — maar een grootboek dat nog nooit een regel heeft
// gezien is niet bewezen, het is gedeployd. Hetzelfde geldt voor de poort
// eromheen: `requirePaidUse()` staat in zes functies, en tot vandaag heeft
// niemand gemeten dat hij ook wéígert.
//
// Dit script meet beide, als echte gebruiker, tegen productie:
//
//   DEEL A (gratis) — de poort bijt.
//     Per functie: ontneem de member het recht (`user_capabilities`, effect
//     'revoke'), roep de functie aan, en eis **403 met `error:'forbidden'` en de
//     capability-key erin**. Een kale 200-check zou hier groen zijn geweest op
//     precies de bundels die op 2026-09-15 de poort misten — daarom de inhoud
//     van het antwoord en niet de statuscode alleen.
//
//   DEEL B (betaald, centen) — het grootboek vult zich.
//     Met het recht terug: één echte, minimale call per betaalde functie, en
//     daarna de eis dat er een verse rij in `model_usage_log` staat met
//     `user_id` = deze persoon, `edge_function` = deze functie en `ok = true`.
//
// ⚠ `ok = true`, niet "een rij". Een mislukte OpenAI-call schrijft óók een
// regel (`logModelUsage({... ok:false})`). Tellen op het bestáán van een rij zou
// tijdens een credit-storing groen worden — precies het vals groen uit geheugen
// `openai-credits-outage-looks-like-empty-chat`. Ziet dit script alleen
// ok=false-rijen, dan noemt hij dat een storing, slaat de rest van deel B over
// en eindigt **rood met reden** — nooit stil groen.
//
// ⚠ Deel A schrijft kort naar productie: één `user_capabilities`-rij met
// effect 'revoke', die in de `finally` weer weg gaat. De persona is daarom bij
// voorkeur een member die nog nooit heeft ingelogd — een venster van een
// paar seconden hoort niemands scherm te raken. Zonder die schrijfactie meet je
// de negatieve helft niet, en dan is het geen poorttest.
//
//   SBT=<management_token> node scripts/model_usage_smoke.cjs
//   (zonder SBT wordt ~/.claude/supabase-mcp.json gelezen)
//
//   --gate-only   alleen deel A (gratis, geen model-call, geen credits nodig)
//
// Exit 0 = alles groen. Exit 1 = minstens één test rood of deel B overgeslagen
// door een storing. Exit 2 = het script kwam niet aan meten toe.
//
// ⚠ PUBLIEKE REPO. Geen e-mailadressen, geen namen, geen mailinhoud: de persona
// komt op runtime uit `user_roles` en er worden alleen slugs en aantallen
// geprint.
// =============================================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { mintUserJwt, revokeMintedSessions } = require(path.join(__dirname, 'lib', 'user-jwt.cjs'));

const REF = process.env.SUPABASE_REF || 'ezxihctobrqoklufawim';
const SBT = process.env.SBT || (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/supabase-mcp.json', 'utf8'))
      .mcpServers.supabase.headers.Authorization.split(' ')[1];
  } catch { return null; }
})();
if (!SBT) { console.error('geen management-token: zet SBT= of leg ~/.claude/supabase-mcp.json neer'); process.exit(2); }

const GATE_ONLY = process.argv.includes('--gate-only');
const UA = { 'User-Agent': 'legal-mind-dashboard-claude/1.0' };
const MGMT = `https://api.supabase.com/v1/projects/${REF}`;
const FN = `https://${REF}.supabase.co/functions/v1`;
const TESTMERK = 'model-usage smoke PR-C';

// Eén korte, onschuldige Nederlandse zin met twee echte typefouten erin: elke
// van de vier tekstfuncties heeft hier genoeg aan, en hij kost een paar tientallen
// tokens. Geen klantnaam, geen bedrag, geen mailinhoud (repo is publiek).
const PROEF = 'Beste lezer, dit is een korte testzin met een tikfuot en een dubbele spatie.';

async function mgmt(p, init = {}) {
  const r = await fetch(`${MGMT}${p}`, {
    ...init, headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', ...UA, ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`mgmt ${p} ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
const sql   = (q) => mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query: q, read_only: true }) });
const sqlRw = (q) => mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query: q }) });

const uitslagen = [];
function assert(id, wat, ok, gemeten, verwacht) {
  uitslagen.push({ id, ok });
  console.log(`${ok ? ' OK ' : 'ROOD'}  ${id.padEnd(26)} ${wat.padEnd(34)} ${String(gemeten).padEnd(38)} ${verwacht}`);
}
function overslaan(id, wat, reden) {
  uitslagen.push({ id, ok: true, overgeslagen: true });
  console.log(`OVER  ${id.padEnd(26)} ${wat.padEnd(34)} ${reden}`);
}

/** Eén aanroep van een edge function als een persona. */
async function roep(jwt, anonKey, slug, body) {
  try {
    const init = {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${jwt}`, ...UA },
      signal: AbortSignal.timeout(90_000),
    };
    if (body instanceof FormData) init.body = body;
    else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body ?? {}); }
    const r = await fetch(`${FN}/${slug}`, init);
    const tekst = await r.text();
    let j = null; try { j = JSON.parse(tekst); } catch { /* geen json */ }
    return { status: r.status, json: j, tekst: tekst.slice(0, 200) };
  } catch (e) {
    return { status: 0, json: null, tekst: String(e && e.message || e).slice(0, 80) };
  }
}

// ── De doelen ───────────────────────────────────────────────────────────────
//
// `poort` = de capability-key die de bundel afdwingt. Dat is exact de lijst die
// M12b in `multi_user_acl_eval.cjs` uit de gedeployde eszips afleidt — als die
// twee ooit uit elkaar lopen is M12b rood en weet je het.
const DOELEN = [
  // De twee connector-functies: op 2026-09-15 draaide productie hier bundels van
  // vóór de M2-poort (M3b vond ze). Ze staan hier zodat de redeploy niet alleen
  // op een regex in de bundel rust maar op gedrag.
  { slug: 'connectors-confluence', poort: 'instellingen.eigen', body: {}, betaald: false },
  { slug: 'connectors-hubspot',    poort: 'instellingen.eigen', body: {}, betaald: false },

  // De zes betaalde functies (`requirePaidUse`).
  { slug: 'auto-draft-spelcheck', poort: 'modellen.gebruiken', betaald: true, body: { draft_body: PROEF } },
  { slug: 'mail-taalcheck',       poort: 'modellen.gebruiken', betaald: true, body: { original_mail: PROEF } },
  { slug: 'taalcheck-v2',         poort: 'modellen.gebruiken', betaald: true, body: { text: PROEF, level: 1 } },
  { slug: 'mail-verbeteraar',     poort: 'modellen.gebruiken', betaald: true, body: { original_mail: PROEF } },
  { slug: 'transcribe',           poort: 'modellen.gebruiken', betaald: true, vorm: 'audio' },
  // kb-compose raakt de poort net zo goed (deel A), maar zijn betaalde helft is
  // een volledige artikel-compositie op een duurder model. Eén call is geen
  // centen meer en het grootboek wordt al door vijf andere functies bewezen.
  // Bewust overgeslagen in deel B, mét reden — niet stilzwijgend weggelaten.
  { slug: 'kb-compose', poort: 'modellen.gebruiken', betaald: true, body: { dry_run: true },
    geenBetaaldeArm: 'volledige compositie op een duur model; deel A dekt de poort' },
];

/** 0,4 s stilte als ogg/opus — genoeg om whisper een echte call te laten doen. */
function stilteOgg() {
  const uit = path.join(require('os').tmpdir(), `lm-smoke-stilte-${process.pid}.ogg`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '0.4', '-c:a', 'libopus', uit],
    { stdio: 'pipe' });
  const buf = fs.readFileSync(uit);
  try { fs.unlinkSync(uit); } catch { /* opruimen is comfort */ }
  return buf;
}

(async () => {
  console.log(`\nmodel_usage_smoke — ${REF} — ${new Date().toISOString()}${GATE_ONLY ? '  (alleen deel A)' : ''}\n`);

  const keys = await mgmt('/api-keys?reveal=true');
  const serviceKey = keys.find(k => k.name === 'service_role')?.api_key;
  const anonKey = keys.find(k => k.name === 'anon')?.api_key;
  if (!serviceKey || !anonKey) { console.error('geen service_role/anon key'); process.exit(2); }

  // Liefst een member die nog nooit heeft ingelogd: deel A ontneemt hem een paar
  // seconden lang een recht, en dat hoort geen enkel openstaand scherm te raken.
  const leden = await sql(`select r.user_id::text as user_id, u.email,
                                  u.last_sign_in_at::text as laatst
                             from public.user_roles r join auth.users u on u.id = r.user_id
                            where r.app_role = 'member' and u.email_confirmed_at is not null
                            order by u.last_sign_in_at asc nulls first, u.id
                            limit 1`);
  if (!leden.length) { console.error('geen bevestigde member-persona in user_roles'); process.exit(2); }
  const member = leden[0];
  console.log(`persona: member die ${member.laatst ? 'het langst niet' : 'nog nooit'} heeft ingelogd\n`);

  const m = await mintUserJwt({ ref: REF, serviceKey, email: member.email });

  // ⚠ Minten IS inloggen (geheugen `minted-jwt-counts-as-a-login`): `/auth/v1/verify`
  // schuift `last_sign_in_at` naar nu, en dan staat er "Vandaag actief" bij iemand
  // die niets heeft gedaan. `revokeMintedSessions()` haalt de sessie weg maar zet
  // die datum niet terug. Hier wél, in de `finally`: anders liegt de
  // Gebruikers-lijst ná elke meting, en verschuift bovendien de personakeuze
  // hierboven bij elke run naar de volgende member — dan raakt de meting op den
  // duur alle zeven in plaats van steeds dezelfde stille.
  const laatstTerug = () => sqlRw(
    `update auth.users set last_sign_in_at = ${member.laatst ? `'${member.laatst}'::timestamptz` : 'null'}
      where id = '${m.userId}'::uuid;`);
  // ⚠ `effect` kent twee waarden: 'grant' en 'revoke' (CHECK-constraint op
  // user_capabilities). Niet 'deny' — die schrijft de constraint terug in je
  // gezicht, en een override die niet landt zou de functie gewoon laten slagen
  // en deze test vals rood maken op de verkeerde grond.
  const ontneem = (key) => sqlRw(`insert into public.user_capabilities (user_id, capability, effect, note)
                               values ('${m.userId}'::uuid, '${key}', 'revoke', '${TESTMERK}')
                               on conflict (user_id, capability) do update set effect = 'revoke', note = '${TESTMERK}';`);
  const schoon = () => sqlRw(`delete from public.user_capabilities where note = '${TESTMERK}';`);

  try {
    // ── DEEL A · de poort weigert, met de key erin ──────────────────────────
    console.log('deel A — de poort bijt (gratis)\n');
    for (const d of DOELEN) {
      await ontneem(d.poort);
      const r = await roep(m.jwt, anonKey, d.slug, d.vorm === 'audio' ? {} : d.body);
      await schoon();
      const goed = r.status === 403 && r.json?.error === 'forbidden' && r.json?.capability === d.poort;
      assert(`A/${d.slug}`, `weigert zonder ${d.poort}`, goed,
        `HTTP ${r.status} error=${r.json?.error ?? '-'} cap=${r.json?.capability ?? '-'}`,
        `403 forbidden ${d.poort}`);
    }

    if (GATE_ONLY) {
      for (const d of DOELEN.filter(x => x.betaald)) overslaan(`B/${d.slug}`, 'schrijft in model_usage_log', '--gate-only');
      return await klaar();
    }

    // ── DEEL B · het grootboek vult zich ────────────────────────────────────
    console.log('\ndeel B — het grootboek vult zich (echte model-calls, centen)\n');
    const t0 = (await sql(`select now()::text as nu`))[0].nu;
    let storing = null;

    for (const d of DOELEN.filter(x => x.betaald)) {
      if (d.geenBetaaldeArm) { overslaan(`B/${d.slug}`, 'schrijft in model_usage_log', d.geenBetaaldeArm); continue; }
      if (storing) { overslaan(`B/${d.slug}`, 'schrijft in model_usage_log', `niet gedraaid — ${storing}`); continue; }

      let body = d.body;
      if (d.vorm === 'audio') {
        try {
          const blob = new Blob([stilteOgg()], { type: 'audio/ogg' });
          body = new FormData();
          body.append('audio', blob, 'stilte.ogg');
        } catch (e) {
          overslaan(`B/${d.slug}`, 'schrijft in model_usage_log', `geen ffmpeg: ${String(e.message).slice(0, 40)}`);
          continue;
        }
      }

      const r = await roep(m.jwt, anonKey, d.slug, body);
      const rijen = await sql(`select ok, coalesce(model,'-') as model, est_cost_usd
                                 from public.model_usage_log
                                where user_id = '${m.userId}'::uuid and edge_function = '${d.slug}'
                                  and created_at > '${t0}'::timestamptz
                                order by created_at desc`);
      const geslaagd = rijen.filter(x => x.ok);
      if (!geslaagd.length && rijen.some(x => !x.ok)) {
        // Een ok=false-rij betekent: de poort liet door, het grootboek schreef,
        // en de provider weigerde. Dat is de handtekening van een credit-storing.
        storing = `${d.slug} gaf ok=false (provider weigerde — credits?)`;
      }
      assert(`B/${d.slug}`, 'schrijft in model_usage_log', geslaagd.length > 0,
        `HTTP ${r.status} · rijen=${rijen.length} ok=${geslaagd.length}`
          + (geslaagd.length ? ` ${geslaagd[0].model} $${Number(geslaagd[0].est_cost_usd).toFixed(5)}` : ` ${r.json?.reason ?? r.tekst.slice(0, 40)}`),
        '≥ 1 rij met ok=true');
    }

    if (storing) {
      console.log(`\n⚠ deel B afgebroken: ${storing}`);
      console.log('  Geheugen `openai-credits-outage-looks-like-empty-chat`: dit is een storing,');
      console.log('  geen ACL-bevinding. Vul de credits aan en draai deel B opnieuw — niet groen rekenen.');
      uitslagen.push({ id: 'B/storing', ok: false });
    }
  } finally {
    await schoon();
    await laatstTerug();
    const rest = await sql(`select count(*)::int as n from public.user_capabilities where note = '${TESTMERK}'`);
    if (rest[0].n !== 0) console.log(`\n⚠ ${rest[0].n} revoke-testrijen niet opgeruimd — verwijder ze handmatig.`);
  }
  await klaar();
})().catch(e => { console.error('\nFOUT:', e.message); process.exit(2); });

async function klaar() {
  // Minten is inloggen (geheugen `minted-jwt-counts-as-a-login`): eerst de sessie
  // terug, dan pas de uitslag.
  const [terug, totaal] = await revokeMintedSessions();
  if (totaal) console.log(`\n${terug}/${totaal} geminte sessies ingetrokken`);

  const rood = uitslagen.filter(u => !u.ok);
  const over = uitslagen.filter(u => u.overgeslagen).length;
  console.log(`\n${rood.length ? `ROOD: ${rood.map(r => r.id).join(', ')}` : 'alles groen'}`
    + ` — ${uitslagen.length} tests${over ? `, waarvan ${over} overgeslagen mét reden` : ''}\n`);
  process.exit(rood.length ? 1 : 0);
}
