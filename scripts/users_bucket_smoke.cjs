#!/usr/bin/env node
/**
 * users_bucket_smoke — classificeert het Gebruikers-scherm zoals de app het doet.
 *
 * Waarom een smoke en geen testrunner: er staat er geen in dit project, en de
 * vraag is klein en scherp — valt elke gebruiker in precies één van de drie
 * bakken, en blijft "uit dienst" gescheiden van de twee dingen waar het op
 * lijkt (30 dagen niets gedaan, en geblokkeerd)?
 *
 * Deterministisch en zonder token, dus het mag ook in CI. Hij test de échte
 * functies uit src/lib/users.js — gebundeld met esbuild, met alleen de
 * Supabase-client eruit gestubd. Een kopie van de logica in dit bestand zou
 * precies de fout niet vangen waar het om gaat: dat de app iets anders doet.
 *
 *   node scripts/users_bucket_smoke.cjs     → exit 0 = goed, exit 1 = fout
 */
const path = require('path')
const esbuild = require('esbuild')

// --- de echte module inladen ------------------------------------------------
// De Supabase-client blijft buiten de bundel (`external`) en wordt bij het
// uitvoeren opgevangen door een require-shim. Plugins kunnen niet: de
// synchrone esbuild-API weigert ze.
const bundled = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'lib', 'users.js')],
  bundle: true, write: false, format: 'cjs', platform: 'node',
  external: ['./supabase'],
}).outputFiles[0].text

const shimRequire = (id) => (
  /supabase$/.test(id) ? { supabase: {}, SUPABASE_URL: '' } : require(id)
)

const mod = { exports: {} }
// eslint-disable-next-line no-new-func
new Function('module', 'exports', 'require', bundled)(mod, mod.exports, shimRequire)
const {
  statusFor, canInvite, bucketFor, bucketCounts, userStats, isGedeactiveerd, USER_TABS,
} = mod.exports

// --- fixtures ---------------------------------------------------------------
const NU = Date.now()
const isoGeleden = (dagen) => new Date(NU - dagen * 86400000).toISOString()

// De vijf van 2026-09-16 hadden alle vijf nooit écht ingelogd: account
// aangemaakt, nooit gebruikt, en nu uit dienst. Dat is precies het geval waarin
// de Uitnodigen-knop vóór v1.222 nog aanstond.
const uitDienst = (naam) => ({
  user_id: `u-${naam}`, email: `${naam}@example.test`, display_name: naam,
  app_role: 'member', last_active_at: null, invite_sent_at: null,
  deactivated_at: isoGeleden(0), created_at: isoGeleden(400),
})

const USERS = [
  { naam: 'owner-actief', user_id: 'u1', app_role: 'owner', last_active_at: isoGeleden(0),
    email_confirmed_at: isoGeleden(300), deactivated_at: null,
    verwacht: { bucket: 'actief', kind: 'active', canInvite: false } },

  { naam: 'member-aangemaakt', user_id: 'u2', app_role: 'member', last_active_at: null,
    invite_sent_at: null, deactivated_at: null,
    verwacht: { bucket: 'uitnodiging', kind: 'created', canInvite: true } },

  { naam: 'member-uitgenodigd', user_id: 'u3', app_role: 'member', last_active_at: null,
    invite_sent_at: isoGeleden(3), deactivated_at: null,
    verwacht: { bucket: 'uitnodiging', kind: 'pending', canInvite: true } },

  { naam: 'member-uitgesteld', user_id: 'u4', app_role: 'member', last_active_at: null,
    invite_sent_at: null, invite_deferred: true, deactivated_at: null,
    verwacht: { bucket: 'uitnodiging', kind: 'created', canInvite: true } },

  // 30 dagen niets gedaan is NIET hetzelfde als uit dienst. Deze hoort gewoon
  // bij Actief te staan: hij kan morgen inloggen en dan is het over.
  { naam: 'member-30d-stil', user_id: 'u5', app_role: 'member', last_active_at: isoGeleden(45),
    email_confirmed_at: isoGeleden(200), deactivated_at: null,
    verwacht: { bucket: 'actief', kind: 'inactive', canInvite: false } },

  // Geblokkeerd maar wél in dienst → de rode pil blijft.
  { naam: 'member-geblokkeerd', user_id: 'u6', app_role: 'member', last_active_at: isoGeleden(2),
    email_confirmed_at: isoGeleden(200), banned_until: new Date(NU + 86400000).toISOString(),
    deactivated_at: null,
    verwacht: { bucket: 'actief', kind: 'banned', canInvite: false } },

  // Uit dienst én geblokkeerd → "Uit dienst" wint, de blokkade staat in de tooltip.
  { naam: 'uitdienst-geblokkeerd', user_id: 'u7', app_role: 'member', last_active_at: isoGeleden(30),
    banned_until: new Date(NU + 86400000).toISOString(), deactivated_at: isoGeleden(1),
    verwacht: { bucket: 'gedeactiveerd', kind: 'deactivated', canInvite: false, ookGeblokkeerd: true } },

  // Uit dienst maar wél altijd actief geweest → nog steeds gedeactiveerd.
  { naam: 'uitdienst-was-actief', user_id: 'u8', app_role: 'member', last_active_at: isoGeleden(0),
    email_confirmed_at: isoGeleden(300), deactivated_at: isoGeleden(1),
    verwacht: { bucket: 'gedeactiveerd', kind: 'deactivated', canInvite: false } },

  ...['tarik', 'sander', 'dewerd', 'finance', 'marketing'].map(n => ({
    ...uitDienst(n), naam: `vijf-${n}`,
    verwacht: { bucket: 'gedeactiveerd', kind: 'deactivated', canInvite: false },
  })),
]

// --- asserties --------------------------------------------------------------
let fouten = 0
const eis = (ok, regel) => {
  if (!ok) { fouten += 1; console.log(`  ✗ ${regel}`) }
  else console.log(`  ✓ ${regel}`)
}

console.log('users_bucket_smoke · classificatie van het Gebruikers-scherm\n')

console.log('B1 · elke gebruiker in de juiste bak, met de juiste pil')
for (const u of USERS) {
  const s = statusFor(u)
  const b = bucketFor(u)
  const ci = canInvite(u)
  const v = u.verwacht
  eis(
    b === v.bucket && s.kind === v.kind && ci === v.canInvite,
    `${u.naam}: bucket=${b} (verwacht ${v.bucket}) · kind=${s.kind} (verwacht ${v.kind}) · canInvite=${ci} (verwacht ${v.canInvite})`,
  )
  if (v.ookGeblokkeerd) {
    eis(s.ookGeblokkeerd === true, `${u.naam}: de blokkade blijft leesbaar naast "uit dienst"`)
  }
}

console.log('\nB2 · "Uit dienst" is het label, en het is niet de 30-dagen-status')
const vijf = USERS.filter(u => u.naam.startsWith('vijf-'))
eis(vijf.length === 5, `de vijf van 2026-09-16 zitten in de fixture (${vijf.length})`)
eis(vijf.every(u => statusFor(u).label === 'Uit dienst'), 'alle vijf tonen het label "Uit dienst"')
eis(vijf.every(u => isGedeactiveerd(u)), 'alle vijf zijn isGedeactiveerd()')
eis(vijf.every(u => canInvite(u) === false), 'bij geen van de vijf staat de Uitnodigen-knop aan')
const stil = USERS.find(u => u.naam === 'member-30d-stil')
eis(statusFor(stil).kind === 'inactive' && !isGedeactiveerd(stil),
  '45 dagen stil blijft "inactive" en wordt niet verward met uit dienst')

console.log('\nB3 · de drie bakken zijn een partitie (niemand dubbel, niemand kwijt)')
const counts = bucketCounts(USERS)
const som = USER_TABS.reduce((n, t) => n + counts[t.id], 0)
eis(som === USERS.length, `tellers tellen op tot het totaal (${som} van ${USERS.length})`)
eis(USERS.every(u => USER_TABS.filter(t => t.id === bucketFor(u)).length === 1),
  'elke gebruiker valt in precies één tab')
eis(counts.gedeactiveerd === 7, `gedeactiveerd = 7 (de vijf + twee randgevallen), gemeten ${counts.gedeactiveerd}`)

console.log('\nB4 · de tellers in de kop vragen niets van de owner voor wie weg is')
const stats = userStats(USERS)
eis(stats.deactivated === 7, `stats.deactivated = 7, gemeten ${stats.deactivated}`)
eis(stats.notInvited === 2, `"nog niet uitgenodigd" telt alleen wie nog in dienst is (2), gemeten ${stats.notInvited}`)
eis(stats.invitedNotLoggedIn === 1, `"wacht op activatie" idem (1), gemeten ${stats.invitedNotLoggedIn}`)
eis(stats.total === USERS.length, `stats.total blijft iedereen (${stats.total})`)

console.log(fouten === 0
  ? '\n✅ users_bucket_smoke: alles groen'
  : `\n❌ users_bucket_smoke: ${fouten} fout(en)`)
process.exit(fouten === 0 ? 0 : 1)
