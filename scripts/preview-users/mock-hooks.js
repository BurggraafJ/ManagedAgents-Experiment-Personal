// Mock-data voor de preview-harness. Zeven mensen die samen elke staat laten
// zien die de lijst kan tonen: live owner, twee accounts waarvoor wél een
// sessie bestaat maar die nooit door een mens zijn gebruikt, één uitgenodigd
// maar nooit binnen, en drie klaargezet zonder mail.
//
// v1.192 — `last_seen_at` heet `last_active_at` en telt alleen ECHTE activiteit
// (migratie 20260914161000). Twee fixtures dragen nu het geval waar de fix over
// gaat: Julia en Jay hebben wél een `last_sign_in_at` van vandaag maar geen
// activiteit — dat zijn de sessies die onze eigen meetscripts minten. Ze horen
// als "Aangemaakt" op het scherm te staan, niet als "Vandaag actief".
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString()
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString()

export const PREVIEW_USERS = [
  {
    user_id: 'owner-1', email: 'burggraaf@legal-mind.nl', app_role: 'owner',
    display_name: 'Jelle Burggraaf', last_sign_in_at: hoursAgo(2), created_at: '2026-04-24T15:17:18Z',
    email_confirmed_at: '2026-04-24T15:20:00Z', banned_until: null, active_sessions_count: 1,
    last_active_at: hoursAgo(1), tool_sessions_count: 11, invite_sent_at: null, invite_deferred: false, trusted_device_count: 2,
  },
  {
    user_id: 'jay-1', email: 'alberts@legal-mind.nl', app_role: 'member',
    display_name: 'Jay Alberts', last_sign_in_at: hoursAgo(4), created_at: '2026-09-06T00:14:15Z',
    email_confirmed_at: '2026-09-06T00:14:15Z', banned_until: null, active_sessions_count: 0,
    // Dertien geminte sessies, nul echte. Stond tot v1.191 op "Vandaag actief".
    last_active_at: null, tool_sessions_count: 13, invite_sent_at: null, invite_deferred: false, trusted_device_count: 0,
  },
  {
    user_id: 'iris-1', email: 'iris@legal-mind.nl', app_role: 'member',
    display_name: 'Iris de Wit', last_sign_in_at: null, created_at: daysAgo(11),
    email_confirmed_at: null, banned_until: null, active_sessions_count: 0,
    last_active_at: null, tool_sessions_count: 0, invite_sent_at: hoursAgo(5), invite_deferred: false, trusted_device_count: 0,
  },
  {
    user_id: 'jacqueline-1', email: 'bloemer@legal-mind.nl', app_role: 'member',
    display_name: 'Jacqueline Bloemer', last_sign_in_at: null, created_at: '2026-09-12T17:28:21Z',
    email_confirmed_at: '2026-09-12T17:28:21Z', banned_until: null, active_sessions_count: 0,
    last_active_at: null, tool_sessions_count: 0, invite_sent_at: null, invite_deferred: true, trusted_device_count: 0,
  },
  {
    user_id: 'niels-1', email: 'niels@legal-mind.nl', app_role: 'member',
    display_name: 'Niels Oosterholt', last_sign_in_at: null, created_at: '2026-09-12T17:28:23Z',
    email_confirmed_at: '2026-09-12T17:28:23Z', banned_until: null, active_sessions_count: 0,
    last_active_at: null, tool_sessions_count: 0, invite_sent_at: null, invite_deferred: true, trusted_device_count: 0,
  },
  {
    user_id: 'julia-1', email: 'julia@legal-mind.nl', app_role: 'member',
    display_name: 'Julia de Poorter', last_sign_in_at: hoursAgo(3), created_at: '2026-09-12T17:28:25Z',
    email_confirmed_at: '2026-09-12T17:28:25Z', banned_until: null, active_sessions_count: 0,
    // Het gemelde geval: één geminte sessie van vanmiddag, verder niets.
    last_active_at: null, tool_sessions_count: 1, invite_sent_at: null, invite_deferred: true, trusted_device_count: 0,
  },
  {
    user_id: 'victor-1', email: 'victor@legal-mind.nl', app_role: 'member',
    display_name: 'Victor van Rooijen', last_sign_in_at: null, created_at: '2026-09-12T17:28:27Z',
    email_confirmed_at: '2026-09-12T17:28:27Z', banned_until: null, active_sessions_count: 0,
    last_active_at: null, tool_sessions_count: 0, invite_sent_at: null, invite_deferred: true, trusted_device_count: 0,
  },
]

export function useUsers() {
  return { users: PREVIEW_USERS, loading: false, error: null, refresh: () => {} }
}

export function useHubspotOwnerMap() {
  const byUser = { 'owner-1': 'hs-1', 'jay-1': 'hs-2' }
  const labels = { 'hs-1': 'Jelle Burggraaf', 'hs-2': 'Jay Alberts' }
  return {
    owners: [
      { hubspot_owner_id: 'hs-1', email: 'burggraaf@legal-mind.nl', active: true },
      { hubspot_owner_id: 'hs-2', email: 'alberts@legal-mind.nl', active: true },
    ],
    map: {}, byUser, ownerById: {}, takenBy: {}, loading: false, error: null,
    refresh: () => {}, setOwnerFor: async () => ({ ok: true }),
    ownerLabel: (id) => labels[id] || id,
  }
}
