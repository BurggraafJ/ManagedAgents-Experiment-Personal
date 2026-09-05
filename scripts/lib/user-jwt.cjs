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
// Gebruik:
//   const { mintUserJwt } = require('./lib/user-jwt.cjs');
//   const jwt = await mintUserJwt({ ref, serviceKey, email });
//
// ⚠ De sleutel en het token NOOIT printen of wegschrijven.
// =============================================================================

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
  return { jwt: ver.access_token, userId: ver.user?.id ?? null };
}

module.exports = { mintUserJwt };
