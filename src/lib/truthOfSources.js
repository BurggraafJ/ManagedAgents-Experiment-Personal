// Pure helpers + constants voor TruthOfSourcesView (NowView · Database-sectie).
// Refactor 27 (2026-05-09): geëxtraheerd uit de monoliete TruthOfSourcesView.jsx
// zodat de view-files puur UI zijn.
//
// Geen JSX, geen React-imports, geen Supabase-calls — alleen transformaties +
// statische lookup-tabellen die de view nodig heeft om kaarten + popup te
// renderen.

// Auto-refresh-cadence voor de Database-sectie (NowView).
export const REFRESH_MS = 30_000

// ============================================================
// Per-source metadata — welke edge-functions horen bij welke source.
// Wordt door de popup gebruikt om "Gekoppelde functies" + filter voor het
// logboek te bouwen.
// ============================================================
export const SOURCE_FUNCTIONS = {
  mail: [
    { agent: 'mail-sync',     label: 'Mail sync',       desc: 'Outlook delta elke 5 min' },
    { agent: 'mail-backfill', label: 'Mail backfill',   desc: '12 mnd historische mail, in batches' },
    { agent: 'chunker',       label: 'Chunker',         desc: 'Chunkt + embedt naar chunks-tabel (alle 9 source-types)' },
  ],
  hubspot: [
    { agent: 'hubspot-sync',             label: 'HubSpot sync',         desc: 'Deals / companies / contacts / owners / pipelines — */15' },
    { agent: 'hubspot-engagements-sync', label: 'HubSpot engagements',  desc: 'Calls / mails / notes / tasks / meetings — */15' },
  ],
  jira: [
    { agent: 'jira-sync', label: 'Jira sync', desc: '4 boards — full 24u + delta */15' },
  ],
  fireflies: [
    { agent: 'fireflies-sync', label: 'Fireflies sync', desc: 'Rolling 24u via MCP — orchestrator */15 (08:00–23:59)' },
  ],
  jellemind: [],
  agenda: [
    { agent: 'outlook-calendar-sync', label: 'Calendar sync', desc: 'Outlook events via Composio, delta */15' },
  ],
  contacten: [
    { agent: 'contactpersonen-sync', label: 'Contactpersonen sync', desc: 'Nightly 03:30 — seed + firm-matching + enrich; idempotent' },
  ],
}

export const SOURCE_INTRO = {
  mail:      'Outlook is de bron van alle e-mailcontext. Drie functies houden de mail-DB live, vullen historie aan en maken alles doorzoekbaar voor RAG.',
  hubspot:   'HubSpot is de bron voor sales-pijplijn en klant-engagements. Twee functies syncen CRM-objecten en alle interacties (calls/mails/notes).',
  jira:      'Jira is de bron voor Sales/Management/Recruitment/Partnerships boards. Eén functie haalt issues + comments op.',
  fireflies: 'Fireflies is de bron voor meeting-transcripts en action-items. Skill mirrort de laatste 24u naar Supabase — historie pre-april 2026 is geschrapt (Engelse opname-fout).',
  jellemind: 'JelleMind is jouw persoonlijke brein-context. Gedachten, ideeën en patronen waar de agents uit lezen — wordt nog gebouwd.',
  agenda:    'Outlook-agenda met afspraken en meetings. Edge Function mirrort 12 mnd terug + 6 mnd vooruit; cross-link met Fireflies via datum-overlap.',
  contacten: 'Source-of-truth van alle personen waarmee je ooit contact hebt gehad — gevuld vanuit HubSpot-contacts mirror + Outlook mail_messages. Nightly 03:30 verrijkt met firm-matching, type-tagging en SaaS/advocatenkantoor-overrides.',
}

export const SOURCE_KICKER = {
  mail:      'Inkomende mail — alle communicatie loopt hier doorheen',
  hubspot:   'CRM-pijplijn + alle klant-engagements (calls, mails, notes)',
  jira:      'Sales / Management / Recruitment / Partnerships boards',
  fireflies: 'Meeting-transcripts en action-items — 24u rolling',
  jellemind: 'Jelle\'s brein als context (in opbouw)',
  agenda:    'Outlook-agenda — 12 mnd terug + 6 mnd vooruit',
  contacten: 'Personen-database — HubSpot-contacts + Outlook-senders, met firm-koppeling',
}

// ============================================================
// Run-status weergave
// ============================================================
export const RUN_STATUS_LABEL = {
  success: 'ok', warning: 'let op', error: 'fout', running: 'draait', empty: 'leeg',
}

export function statusTone(status) {
  if (status === 'success') return 's-success'
  if (status === 'error')   return 's-error'
  if (status === 'warning') return 's-warning'
  if (status === 'running') return 's-running'
  return 's-idle'
}

// ============================================================
// Tijd-helpers
// ============================================================
export function relTime(iso) {
  if (!iso) return 'nooit'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min geleden`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}u geleden`
  const day = Math.floor(hr / 24)
  return `${day}d geleden`
}

// Pak de meest recente van twee timestamps (delta wint typisch van full).
export function tsMax(a, b) {
  if (!a) return b || null
  if (!b) return a
  return new Date(a) > new Date(b) ? a : b
}

export function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function fmtDuration(startIso, endIso) {
  if (!startIso) return '—'
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const sec = Math.max(0, Math.round((end - start) / 1000))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}u ${m % 60}m`
}

// ============================================================
// Health & numerics
// ============================================================
export function healthFor(lastSyncIso, lastError, expectedFreshnessMin) {
  if (lastError) return { tag: 's-error', label: 'error' }
  if (!lastSyncIso) return { tag: 's-warning', label: 'nooit' }
  const ageMin = (Date.now() - new Date(lastSyncIso).getTime()) / 60_000
  if (ageMin < expectedFreshnessMin) return { tag: 's-success', label: 'live' }
  if (ageMin < expectedFreshnessMin * 5) return { tag: 's-warning', label: 'verlaat' }
  return { tag: 's-error', label: 'stale' }
}

export function fmtNum(n) {
  if (n === null || n === undefined) return '–'
  if (typeof n === 'string') return n
  return n.toLocaleString('nl-NL')
}

export function pct(part, total) {
  if (!total) return null
  return Math.round((part / total) * 1000) / 10
}

// ============================================================
// Logboek-helpers — groepering per dag (vandaag / gisteren / weekday-date)
// ============================================================
export function dayKey(iso) {
  return new Date(iso).toLocaleDateString('nl-NL')
}

export function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const start = new Date(d); start.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - start.getTime()) / 86400000)
  if (diff === 0) return 'vandaag'
  if (diff === 1) return 'gisteren'
  return d.toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })
}
