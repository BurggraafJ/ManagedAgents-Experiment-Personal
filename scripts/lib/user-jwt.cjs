// =============================================================================
// user-jwt.cjs — een ECHTE user-JWT ophalen zonder in te loggen
// =============================================================================
// `verify_jwt: true` accepteert de legacy service_role-sleutel, maar die draagt
// geen `sub`: `callerSub()` geeft dan null en de aanroeper is niemand. Voor
// alles wat aan een persoon hangt — de Confluence-space-ACL, de eigen mailbox,
// een artefact met een eigenaar — meet je met zo'n sleutel dus iets anders dan
// wat een gebruiker ziet. Onbetrouwbaar-groen leest als "het werkt".
//
// Het werkende pad (geheugen `rag-chat-authenticated-call-without-login`):
//   1. admin `generate_link` (type magiclink) → geeft een `hashed_token`
//   2. `/auth/v1/verify` met **`token_hash`**, NIET `token` → access_token
// De `token`-variant vraagt om de e-mail erbij en faalt stil met "otp_expired";
// `token_hash` werkt in één call.
//
// 2FA (sinds 2026-09-02) zit hier niet in de weg: de JWT is geldig, maar
// `session_mfa_ok()` is false, dus RLS-paden die MFA eisen blijven dicht. Voor
// het meten van de space-ACL en de eigenaar van een artefact is dat precies
// genoeg — en het is eerlijk: dit is wat een sessie zonder tweede factor ziet.
//
// ── Opruimen hoort erbij (v1.192) ───────────────────────────────────────────
// `verify` maakt een ECHTE sessie: een rij in auth.sessions én een nieuwe
// `auth.users.last_sign_in_at`. De Gebruikers-lijst las dat als een login, en
// Julia stond op "Vandaag actief" terwijl haar enige sessie hier vandaan kwam
// (13 stuks voor Jay). De lijst kijkt sinds migratie 20260914161000 naar echte
// activiteit en trapt daar niet meer in — maar een meting hoort geen sporen
// achter te laten die op gebruik lijken. Vandaar `revokeMintedSession` in een
// `finally`, zelfde reflex als de MFA-testrij in multi_user_acl_eval.cjs.
//
// ⚠ scope=**local**, nooit global. Global gooit álle sessies van die gebruiker
// weg — bij de owner dus ook het browsertabblad waarin Jelle zit te werken.
//
// Gebruik:
//   const { mintUserJwt, revokeMintedSessions } = require('./lib/user-jwt.cjs');
//   const { jwt } = await mintUserJwt({ ref, serviceKey, email });
//   …
//   await revokeMintedSessions();   // één regel aan het eind van het script
//
// `mintUserJwt` onthoudt elke sessie die hij maakt, zodat opruimen één aanroep
// is in plaats van boekhouding per aanroeper. Een script dat die regel vergeet
// laat sessies staan — hinderlijk, niet gevaarlijk: de Gebruikers-lijst telt ze
// sinds v1.192 niet meer als activiteit.
//
// ⚠ De sleutel en het token NOOIT printen of wegschrijven.
// =============================================================================

// Wat deze procesrun heeft aangemaakt.
const gemint = [];

async function mintUserJwt({ ref, serviceKey, email, userAgent = 'legal-mind-dashboard-claude/1.0' }) {
  const base = `https://${ref}.supabase.co`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'User-Agent': userAgent,
  };

  const genRes = await fetch(`${base}/auth/v1/admin/generate_link`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const genTxt = await genRes.text();
  if (!genRes.ok) throw new Error(`generate_link ${genRes.status}: ${genTxt.slice(0, 200)}`);
  const gen = JSON.parse(genTxt);
  const hashed = gen.hashed_token || gen.properties?.hashed_token;
  if (!hashed) throw new Error('generate_link gaf geen hashed_token');

  const verRes = await fetch(`${base}/auth/v1/verify`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
  });
  const verTxt = await verRes.text();
  if (!verRes.ok) throw new Error(`verify ${verRes.status}: ${verTxt.slice(0, 200)}`);
  const ver = JSON.parse(verTxt);
  if (!ver.access_token) throw new Error('verify gaf geen access_token');
  gemint.push({ ref, serviceKey, jwt: ver.access_token, userAgent });
  return { jwt: ver.access_token, userId: ver.user?.id ?? null };
}

// De geminte sessie weer weghalen. Faalt stil: het meten is al gebeurd, en een
// opruimfout mag een groene poort niet rood maken. Geeft true terug als het
// lukte, zodat een aanroeper er desgewenst iets over kan zeggen.
async function revokeMintedSession({ ref, serviceKey, jwt, userAgent = 'legal-mind-dashboard-claude/1.0' }) {
  if (!jwt) return false;
  try {
    const r = await fetch(`https://${ref}.supabase.co/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
      },
    });
    return r.ok || r.status === 204;
  } catch {
    return false;
  }
}

// Alles wat deze procesrun heeft gemint weer intrekken. Geeft [ingetrokken,
// totaal] terug zodat een script het kan melden.
async function revokeMintedSessions() {
  const totaal = gemint.length;
  let terug = 0;
  while (gemint.length) {
    if (await revokeMintedSession(gemint.pop())) terug++;
  }
  return [terug, totaal];
}

module.exports = { mintUserJwt, revokeMintedSession, revokeMintedSessions };
