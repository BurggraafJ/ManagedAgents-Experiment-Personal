// Pure helpers + constants voor de Agents-instructiepagina's (desktop
// AgentsPage + mobiel MobileSettingsAgents).

export const PLACEHOLDERS = {
  'daily-admin':
    'Bijv.:\n- Maak alleen tasks voor deals in de Sales Pipeline (niet Customer Base).\n- Bij Customer Base: schrijf een note, geen task — tenzij er een expliciete actie in de mail staat.\n- Recruitment-kaarten altijd met assignee = huidige eigenaar in de kanban.\n- Bij partner-items: Jira-ticket op board Partnerships.',
  'auto-draft':
    'Bijv.:\n- Geen drafts voor nieuwsbrieven of noreply-afzenders.\n- Bij Nederlandse mails altijd tutoyeren.\n- Drafts max 5 zinnen tenzij de input-mail lang is.',
  'sales-todos':
    'Bijv.:\n- Offerte-reminders: 3 dagen na verzenden, daarna elke 5 dagen.\n- Trial eindigt binnen 7 dagen → altijd een draft-mail voorbereiden.',
}

export function friendlyName(s) {
  return s.display_name || s.agent_name
}

// Interne/meta-agents die geen eigen instructies krijgen.
const HIDDEN_AGENTS = new Set(['orchestrator', 'agent-manager', 'dashboard-refresh'])

/** Schedules → instelbare agents, Daily Admin bovenaan, rest alfabetisch. */
export function instructableAgents(schedules) {
  return (schedules || [])
    .filter(s => !HIDDEN_AGENTS.has(s.agent_name))
    .slice()
    .sort((a, b) => {
      if (a.agent_name === 'daily-admin') return -1
      if (b.agent_name === 'daily-admin') return 1
      return friendlyName(a).localeCompare(friendlyName(b))
    })
}

/** Tekst van de opgeslagen instructies (of ''). */
export function instructionText(row) {
  return (row?.config_value?.text || '').trim()
}

/** Aantal regels (niet-lege regels) — "4 regels". */
export function ruleCount(text) {
  return (text || '').split('\n').map(l => l.trim()).filter(Boolean).length
}

/** Menselijke omschrijving van wanneer een agent draait. */
export function scheduleLabel(s) {
  if (!s) return ''
  if (s.interval_minutes) {
    const m = Number(s.interval_minutes)
    if (m >= 60 && m % 60 === 0) return m === 60 ? 'elk uur' : `elke ${m / 60} uur`
    return `elke ${m} min`
  }
  const cron = (s.cron_expression || '').trim().split(/\s+/)
  if (cron.length >= 2 && /^\d+$/.test(cron[0]) && /^[\d,]+$/.test(cron[1])) {
    const mm = cron[0].padStart(2, '0')
    return cron[1].split(',').map(h => `${h.padStart(2, '0')}:${mm}`).join(' & ')
  }
  return s.description || ''
}

/** "bewerkt vandaag" / "bewerkt gisteren" / "bewerkt 28 aug". */
export function editedLabel(updatedAt) {
  if (!updatedAt) return null
  const d = new Date(updatedAt)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const diff = Math.round((today - day) / 86400000)
  if (diff === 0) return 'bewerkt vandaag'
  if (diff === 1) return 'bewerkt gisteren'
  const opts = { day: 'numeric', month: 'short' }
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric'
  return `bewerkt ${d.toLocaleDateString('nl-NL', opts)}`
}
