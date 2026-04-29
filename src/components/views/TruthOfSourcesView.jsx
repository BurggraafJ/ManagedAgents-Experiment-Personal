import { useState, useEffect, useCallback, Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import { useMediaQuery } from '../../hooks/useMediaQuery'

// Welke edge-functions horen bij welke source — gebruikt door de popup
// om "Gekoppelde functies" + filter voor logboek te bouwen.
const SOURCE_FUNCTIONS = {
  mail: [
    { agent: 'mail-sync',     label: 'Mail sync',       desc: 'Outlook delta elke 15 min' },
    { agent: 'mail-backfill', label: 'Mail backfill',   desc: '12 mnd historische mail, in batches' },
    { agent: 'mail-embed',    label: 'Mail embed',      desc: 'Vectorisatie voor RAG' },
  ],
  hubspot: [
    { agent: 'hubspot-sync',             label: 'HubSpot sync',         desc: 'Deals / companies / contacts / owners / pipelines' },
    { agent: 'hubspot-engagements-sync', label: 'HubSpot engagements',  desc: 'Calls / mails / notes / tasks / meetings' },
  ],
  jira: [
    { agent: 'jira-sync', label: 'Jira sync', desc: '4 boards — full 24u + delta elk uur' },
  ],
  fireflies: [],
  jellemind: [],
  agenda:    [],
}

const SOURCE_INTRO = {
  mail:      'Outlook is de bron van alle e-mailcontext. Drie functies houden de mail-DB live, vullen historie aan en maken alles doorzoekbaar voor RAG.',
  hubspot:   'HubSpot is de bron voor sales-pijplijn en klant-engagements. Twee functies syncen CRM-objecten en alle interacties (calls/mails/notes).',
  jira:      'Jira is de bron voor Sales/Management/Recruitment/Partnerships boards. Eén functie haalt issues + comments op.',
  fireflies: 'Fireflies is de bron voor meeting-transcripts en action-items. Geen DB-mirror — agents lezen direct via de Fireflies MCP.',
  jellemind: 'JelleMind is jouw persoonlijke brein-context. Gedachten, ideeën en patronen waar de agents uit lezen — wordt nog gebouwd.',
  agenda:    'Outlook-agenda met afspraken en meetings. Geen DB-mirror — agents lezen rechtstreeks via Outlook (MS Graph).',
}

// Truth of Sources — Outlook, HubSpot, Jira als drie pijlers waarop de agents
// draaien. Compacte kaartjes (laatste run + status), klik "Details →" voor de
// volledige breakdown in een popup. Auto-refresh per 30s.

const REFRESH_MS = 30_000

function relTime(iso) {
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
function tsMax(a, b) {
  if (!a) return b || null
  if (!b) return a
  return new Date(a) > new Date(b) ? a : b
}

function healthFor(lastSyncIso, lastError, expectedFreshnessMin) {
  if (lastError) return { tag: 's-error', label: 'error' }
  if (!lastSyncIso) return { tag: 's-warning', label: 'nooit' }
  const ageMin = (Date.now() - new Date(lastSyncIso).getTime()) / 60_000
  if (ageMin < expectedFreshnessMin) return { tag: 's-success', label: 'live' }
  if (ageMin < expectedFreshnessMin * 5) return { tag: 's-warning', label: 'verlaat' }
  return { tag: 's-error', label: 'stale' }
}

function fmtNum(n) {
  if (n === null || n === undefined) return '–'
  if (typeof n === 'string') return n
  return n.toLocaleString('nl-NL')
}

function pct(part, total) {
  if (!total) return null
  return Math.round((part / total) * 1000) / 10
}

function VectorBar({ embedded, total }) {
  const p = pct(embedded, total)
  if (p === null) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>–</div>
  const tone = p >= 99 ? 's-success' : p >= 80 ? 's-warning' : 's-error'
  const color = p >= 99 ? 'var(--success, #16a34a)' : p >= 80 ? 'var(--warning, #d97706)' : 'var(--error, #d9534f)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ color: 'var(--text-muted)' }}>{fmtNum(embedded)} / {fmtNum(total)}</span>
        <span className={`status-pill ${tone}`} style={{ padding: '1px 8px', fontSize: 11 }}>{p}%</span>
      </div>
      <div style={{ height: 4, background: 'var(--bg-2)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function StatRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)' }}>{value}</span>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div className="kpi__label" style={{ fontSize: 11, marginTop: 'var(--s-3)', marginBottom: 4, paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
      {children}
    </div>
  )
}

// ============================================================
// SVG-iconen per source — Outlook / HubSpot / Jira
// ============================================================
const SOURCE_ICONS = {
  mail: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  ),
  hubspot: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/>
    </svg>
  ),
  jira: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/>
      <rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  fireflies: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3"/>
      <path d="M5 11a7 7 0 0 0 14 0"/>
      <path d="M12 18v3"/>
      <path d="M9 21h6"/>
    </svg>
  ),
  jellemind: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a4 4 0 0 0-4 4v1a4 4 0 0 0-2 7.5V17a3 3 0 0 0 3 3h.5"/>
      <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1 2 7.5V17a3 3 0 0 1-3 3h-.5"/>
      <path d="M12 6v14"/>
    </svg>
  ),
  agenda: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <path d="M16 2v4M8 2v4M3 10h18"/>
    </svg>
  ),
}

const SOURCE_KICKER = {
  mail:      'Inkomende mail — alle communicatie loopt hier doorheen',
  hubspot:   'CRM-pijplijn + alle klant-engagements (calls, mails, notes)',
  jira:      'Sales / Management / Recruitment / Partnerships boards',
  fireflies: 'Meeting-transcripts en action-items',
  jellemind: 'Jelle\'s brein als context (in opbouw)',
  agenda:    'Outlook-agenda met afspraken en meetings',
}

// ============================================================
// Bron-kaart — meer karakter (icoon, accent-kleur, grote getallen)
// ============================================================
function SourceCard({ source, title, total, totalLabel, health, lastSyncIso, runAgent, runStatus, errorMsg, onOpen }) {
  return (
    <div
      className={`tos-card tos-card--${source}`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      role="button"
      tabIndex={0}
      aria-label={`Open details voor ${title}`}
    >
      {/* Top: icoon + naam, health rechts */}
      <div className="tos-card__top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div className="tos-card__icon">{SOURCE_ICONS[source]}</div>
          <div style={{ minWidth: 0 }}>
            <div className="tos-card__title">{title}</div>
            <div className="tos-card__subtitle">{SOURCE_KICKER[source]}</div>
          </div>
        </div>
        {health && (
          <span className={`tos-card__health status-pill ${health.tag}`} title={health.title}>
            {health.label}
          </span>
        )}
      </div>

      {/* Grote getal */}
      <div className="tos-card__metric">
        <span className="tos-card__metric-num">{fmtNum(total)}</span>
        <span className="tos-card__metric-label">{totalLabel}</span>
      </div>

      {/* Inline error indien aanwezig */}
      {errorMsg && (
        <div className="tos-card__error">
          {errorMsg.length > 100 ? errorMsg.slice(0, 100) + '…' : errorMsg}
        </div>
      )}

      {/* Footer-meta */}
      <div className="tos-card__meta">
        <div className="tos-card__meta-row">
          <span>Laatste sync</span>
          <span style={{ color: 'var(--text)' }}>{relTime(lastSyncIso)}</span>
        </div>
        {runAgent && (
          <div className="tos-card__meta-row">
            <span>Via</span>
            <span className="mono">
              {runAgent}
              {runStatus && (
                <span style={{ marginLeft: 6, color: runStatus === 'error' ? 'var(--error)' : runStatus === 'warning' ? 'var(--warning)' : 'var(--success)' }}>
                  · {runStatus}
                </span>
              )}
            </span>
          </div>
        )}
      </div>

      <button type="button" className="tos-card__cta" onClick={(e) => { e.stopPropagation(); onOpen() }}>
        Open details →
      </button>
    </div>
  )
}

// ============================================================
// Body voor externe bronnen (Fireflies, Agenda, JelleMind)
// ============================================================
function ExternalSourceBody({ intro, access, usedBy, comingSoon }) {
  return (
    <>
      <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 'var(--s-3)' }}>{intro}</div>

      {comingSoon && (
        <div
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 11, fontWeight: 600,
            padding: '4px 10px', borderRadius: 999,
            background: 'color-mix(in srgb, #8b5cf6 14%, var(--bg-2))',
            color: '#8b5cf6',
            border: '1px dashed color-mix(in srgb, #8b5cf6 50%, transparent)',
            marginBottom: 'var(--s-3)',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#8b5cf6' }} />
          wordt nog gebouwd
        </div>
      )}

      <SectionLabel>Toegang</SectionLabel>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' }}>{access}</div>

      <SectionLabel>Gebruikt door</SectionLabel>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' }}>{usedBy}</div>
    </>
  )
}

// ============================================================
// Helpers voor de popup-rechterkolom
// ============================================================
function statusTone(status) {
  if (status === 'success') return 's-success'
  if (status === 'error')   return 's-error'
  if (status === 'warning') return 's-warning'
  if (status === 'running') return 's-running'
  return 's-idle'
}

const RUN_STATUS_LABEL = {
  success: 'ok', warning: 'let op', error: 'fout', running: 'draait', empty: 'leeg',
}

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function fmtDuration(startIso, endIso) {
  if (!startIso) return '—'
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const sec = Math.max(0, Math.round((end - start) / 1000))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}u ${m % 60}m`
}

function LinkedFunctions({ functions, latestByAgent }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {functions.map(fn => {
        const r = latestByAgent[fn.agent]
        const tone = r?.status ? statusTone(r.status) : 's-idle'
        const label = r?.status ? (RUN_STATUS_LABEL[r.status] || r.status) : 'geen logs'
        return (
          <div
            key={fn.agent}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{fn.label}</div>
                <div className="mono muted" style={{ fontSize: 10 }}>{fn.agent}</div>
              </div>
              <span className={`status-pill ${tone}`} style={{ fontSize: 10, flexShrink: 0 }}>{label}</span>
            </div>
            <div className="muted" style={{ fontSize: 11, lineHeight: 1.4 }}>{fn.desc}</div>
            {r && (
              <div className="muted" style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                {relTime(r.started_at)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function RunsLogPanel({ runs }) {
  if (!runs || runs.length === 0) {
    return <div className="muted" style={{ fontSize: 12 }}>nog geen runs gelogd voor deze functies.</div>
  }
  const dayKey = (iso) => new Date(iso).toLocaleDateString('nl-NL')
  const dayLabel = (iso) => {
    const d = new Date(iso)
    const today = new Date(); today.setHours(0,0,0,0)
    const start = new Date(d); start.setHours(0,0,0,0)
    const diff = Math.round((today.getTime() - start.getTime()) / 86400000)
    if (diff === 0) return 'vandaag'
    if (diff === 1) return 'gisteren'
    return d.toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })
  }
  let prevDay = null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1, minHeight: 0 }}>
      {runs.map((r, i) => {
        const k = dayKey(r.started_at)
        const showDay = k !== prevDay
        prevDay = k
        return (
          <Fragment key={`${r.agent_name}-${r.started_at}-${i}`}>
            {showDay && (
              <div className="agent-runs-log__day">
                <span>{dayLabel(r.started_at)}</span>
              </div>
            )}
            <div
              className="card"
              style={{
                padding: '8px 10px',
                background: 'var(--bg-2)',
                border: '1px solid var(--border)',
                fontSize: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span className={statusTone(r.status)} style={{ fontSize: 11, fontWeight: 600 }}>
                  ● {RUN_STATUS_LABEL[r.status] || r.status}
                </span>
                <span className="mono muted" style={{ fontSize: 10 }}>{r.agent_name}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                <span className="mono muted">{fmtTime(r.started_at)}</span>
                <span className="mono muted">{fmtDuration(r.started_at, r.completed_at)}</span>
              </div>
              {r.summary && (
                <div style={{ color: 'var(--text)', lineHeight: 1.35, wordBreak: 'break-word' }}>
                  {r.summary.length > 200 ? r.summary.slice(0, 200) + '…' : r.summary}
                </div>
              )}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

// ============================================================
// Popup — alle detail-info per bron
// ============================================================
function SourceDetailPopup({ source, data, onClose }) {
  const isNarrow = useMediaQuery('(max-width: 820px)')

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const d = data
  const fns = SOURCE_FUNCTIONS[source] || []
  const fnAgents = new Set(fns.map(f => f.agent))
  const sourceRuns = (d.recentRuns || []).filter(r => fnAgents.has(r.agent_name)).slice(0, 30)

  let body = null
  let headerTitle = ''
  let headerSubtitle = ''

  if (source === 'mail') {
    headerTitle = 'Outlook'
    headerSubtitle = SOURCE_INTRO.mail
    body = (
      <>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 28, fontWeight: 600 }}>{fmtNum(d.mail.total)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>messages</div>
        </div>

        <SectionLabel>Sync</SectionLabel>
        <StatRow label="Laatste delta" value={relTime(d.mail.lastDelta)} />
        <StatRow label="Folders tracked" value={fmtNum(d.mail.foldersTracked)} />
        <StatRow label="Backfill voortgang" value={`${d.mail.backfill.percent}% (${fmtNum(d.mail.backfill.completedBuckets)}/${fmtNum(d.mail.backfill.totalBuckets)} buckets)`} />
        {d.mail.backfill.byStatus.in_progress > 0 && (
          <StatRow label="Backfill nu actief" value={fmtNum(d.mail.backfill.byStatus.in_progress)} />
        )}
        {d.mail.backfill.byStatus.error > 0 && (
          <StatRow label="Backfill errors" value={fmtNum(d.mail.backfill.byStatus.error)} />
        )}

        <SectionLabel>Vectorisatie</SectionLabel>
        <VectorBar embedded={d.mail.embedded} total={d.mail.total} />
        <StatRow label="Model" value={d.embed.model} />
        <StatRow label="Laatste embed-run" value={d.embed.lastRun ? relTime(d.embed.lastRun.started_at) : 'nooit'} />
        <StatRow label="Embed-runs (7d)" value={fmtNum(d.embed.runs7d)} />
        <StatRow label="Tokens (7d)" value={`${fmtNum(d.embed.tokens7d)} (≈ $${(d.embed.tokens7d / 1_000_000 * 0.02).toFixed(4)})`} />
      </>
    )
  } else if (source === 'hubspot') {
    headerTitle = 'HubSpot'
    headerSubtitle = SOURCE_INTRO.hubspot
    body = (
      <>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 28, fontWeight: 600 }}>
            {fmtNum((d.hubspot.deals || 0) + (d.hubspot.companies || 0) + (d.hubspot.contacts || 0) + (d.hubspot.engagements.total || 0))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>records totaal</div>
        </div>

        <SectionLabel>CRM-objecten</SectionLabel>
        <StatRow label="Deals" value={fmtNum(d.hubspot.deals)} />
        <StatRow label="Companies" value={fmtNum(d.hubspot.companies)} />
        <StatRow label="Contacts" value={fmtNum(d.hubspot.contacts)} />
        <StatRow label="Owners" value={fmtNum(d.hubspot.state?.total_owners)} />
        <StatRow label="Pipelines" value={fmtNum(d.hubspot.state?.total_pipelines)} />
        <StatRow label="Laatste delta sync" value={d.hubspot.state?.last_delta_sync ? relTime(d.hubspot.state.last_delta_sync) : '–'} />
        <StatRow label="Laatste full sync" value={d.hubspot.state?.last_full_sync ? relTime(d.hubspot.state.last_full_sync) : '–'} />

        <SectionLabel>Engagements</SectionLabel>
        <StatRow label="Totaal" value={fmtNum(d.hubspot.engagements.total)} />
        <StatRow label="Calls" value={fmtNum(d.hubspot.engagements.byType.call || 0)} />
        <StatRow label="Emails" value={fmtNum(d.hubspot.engagements.byType.email || 0)} />
        <StatRow label="Meetings" value={fmtNum(d.hubspot.engagements.byType.meeting || 0)} />
        <StatRow label="Notes" value={fmtNum(d.hubspot.engagements.byType.note || 0)} />
        <StatRow label="Tasks" value={fmtNum(d.hubspot.engagements.byType.task || 0)} />
        <StatRow label="Laatste eng-sync" value={relTime(d.hubspot.engagements.lastSync)} />

        <SectionLabel>Vectorisatie — engagements</SectionLabel>
        <VectorBar embedded={d.hubspot.engagements.embedded} total={d.hubspot.engagements.total} />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
          Deals/companies/contacts nog niet geïndexeerd — wel op roadmap.
        </div>
      </>
    )
  } else if (source === 'fireflies') {
    headerTitle = 'Fireflies'
    headerSubtitle = SOURCE_INTRO.fireflies
    body = (
      <ExternalSourceBody
        intro="Meeting-transcripts en action-items uit alle gesprekken die Fireflies opneemt."
        access="Direct via Fireflies MCP — geen mirror in Supabase."
        usedBy="task-organizer (Fireflies-scan voor action-items), daily-admin (kruis-link met agenda)"
      />
    )
  } else if (source === 'jellemind') {
    headerTitle = 'JelleMind'
    headerSubtitle = SOURCE_INTRO.jellemind
    body = (
      <ExternalSourceBody
        intro="Persoonlijke brein-context — gedachten, ideeën, patronen waar de agents uit kunnen lezen."
        access="Wordt nog gebouwd. Concrete invulling volgt later."
        usedBy="(toekomstig) auto-draft, daily-admin, task-organizer voor persoonlijke context"
        comingSoon
      />
    )
  } else if (source === 'agenda') {
    headerTitle = 'Agenda'
    headerSubtitle = SOURCE_INTRO.agenda
    body = (
      <ExternalSourceBody
        intro="Outlook-agenda met al je afspraken en meetings."
        access="Direct via Outlook (MS Graph) — geen mirror in Supabase."
        usedBy="daily-admin (kruis-link met Fireflies-meetings), sales-on-road, kilometerregistratie"
      />
    )
  } else if (source === 'jira') {
    headerTitle = 'Jira'
    headerSubtitle = SOURCE_INTRO.jira
    body = (
      <>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 28, fontWeight: 600 }}>{fmtNum(d.jira.issues)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>issues over {fmtNum(d.jira.projects)} projecten</div>
        </div>

        <SectionLabel>Sync</SectionLabel>
        <StatRow label="Laatste delta sync" value={d.jira.state?.last_delta_sync ? relTime(d.jira.state.last_delta_sync) : '–'} />
        <StatRow label="Laatste full sync" value={d.jira.state?.last_full_sync ? relTime(d.jira.state.last_full_sync) : '–'} />

        <SectionLabel>Vectorisatie</SectionLabel>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0' }}>
          <span className="status-pill s-idle" style={{ padding: '1px 8px', fontSize: 11 }}>nog niet</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Issues/comments krijgen straks ook embeddings — staat op roadmap.
          </span>
        </div>
      </>
    )
  }

  return (
    <div
      className="agent-settings-popup__overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, zIndex: 1000,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 960, padding: 0, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        <header style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div className="kpi__label" style={{ marginBottom: 2 }}>Truth of source</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{headerTitle}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>{headerSubtitle}</div>
          </div>
          <button className="btn btn--ghost" onClick={onClose} aria-label="Sluiten" style={{ fontSize: 18 }}>×</button>
        </header>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isNarrow ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)',
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
          }}
        >
          {/* Linker kolom: stats over de bron zelf */}
          <div
            style={{
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--s-2)',
              borderRight: isNarrow ? 'none' : '1px solid var(--border)',
              borderBottom: isNarrow ? '1px solid var(--border)' : 'none',
              overflow: 'auto',
            }}
          >
            <SectionLabel>Bron-statistieken</SectionLabel>
            {body}
          </div>

          {/* Rechter kolom: gekoppelde functies + logboek */}
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 'var(--s-3)', minHeight: 0 }}>
            <div>
              <SectionLabel>Gekoppelde functies <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {fns.length}</span></SectionLabel>
              <LinkedFunctions functions={fns} latestByAgent={d.latestByAgent} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <SectionLabel>Logboek <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· laatste {sourceRuns.length}</span></SectionLabel>
              <RunsLogPanel runs={sourceRuns} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Hoofdcomponent
// ============================================================
export default function TruthOfSourcesView() {
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const [openPopup, setOpenPopup] = useState(null) // 'mail' | 'hubspot' | 'jira' | null

  const fetchAll = useCallback(async () => {
    try {
      const [
        mailMessages, mailMessagesEmbedded, mailSyncState, mailBackfillState,
        hsState, hsEngagementsState,
        hsDeals, hsCompanies, hsContacts, hsEngagements, hsEngagementsEmbedded, hsEngagementsByType,
        jiraState, jiraIssues, jiraProjects,
        recentRuns, mailEmbedRun,
      ] = await Promise.all([
        supabase.from('mail_messages').select('*', { count: 'exact', head: true }),
        supabase.from('mail_messages').select('*', { count: 'exact', head: true }).not('embedding', 'is', null),
        supabase.from('mail_sync_state').select('folder_id,last_delta_at,last_full_scan_at,last_error,total_messages_synced'),
        supabase.from('mail_backfill_state').select('status,messages_fetched,last_run_at,last_error'),
        supabase.from('hubspot_sync_state').select('*').eq('id', 1).maybeSingle(),
        supabase.from('hubspot_engagements_sync_state').select('*'),
        supabase.from('hubspot_deals').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_companies').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_contacts').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_engagements').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_engagements').select('*', { count: 'exact', head: true }).not('embedding', 'is', null),
        supabase.from('hubspot_engagements').select('engagement_type'),
        supabase.from('jira_sync_state').select('*').eq('id', 1).maybeSingle(),
        supabase.from('jira_issues').select('*', { count: 'exact', head: true }),
        supabase.from('jira_projects').select('*', { count: 'exact', head: true }),
        supabase.from('agent_runs')
          .select('agent_name,status,summary,started_at,completed_at,errors,stats')
          .in('agent_name', ['mail-sync', 'mail-backfill', 'hubspot-sync', 'hubspot-engagements-sync', 'jira-sync', 'mail-embed'])
          .order('started_at', { ascending: false })
          .limit(80),
        supabase.from('agent_runs')
          .select('started_at,status,summary,stats')
          .eq('agent_name', 'mail-embed')
          .gte('started_at', new Date(Date.now() - 7 * 86400_000).toISOString())
          .order('started_at', { ascending: false }),
      ])

      const engagementsByType = {}
      for (const row of (hsEngagementsByType.data || [])) {
        engagementsByType[row.engagement_type] = (engagementsByType[row.engagement_type] || 0) + 1
      }

      const backfillByStatus = { pending: 0, in_progress: 0, done: 0, empty: 0, error: 0 }
      const backfillRows = mailBackfillState.data || []
      for (const r of backfillRows) backfillByStatus[r.status] = (backfillByStatus[r.status] || 0) + 1
      const totalBuckets = backfillRows.length
      const completedBuckets = backfillByStatus.done + backfillByStatus.empty

      const latestByAgent = {}
      for (const r of (recentRuns.data || [])) {
        if (!latestByAgent[r.agent_name]) latestByAgent[r.agent_name] = r
      }
      const allRecentRuns = recentRuns.data || []

      const mailEmbedRuns = mailEmbedRun.data || []
      const embedTokens7d = mailEmbedRuns.reduce((sum, r) => sum + (Number(r.stats?.total_tokens) || 0), 0)
      const embedRuns7d = mailEmbedRuns.length
      const lastEmbed = mailEmbedRuns[0]

      const mailSyncRows = mailSyncState.data || []
      const newestDelta = mailSyncRows.reduce((acc, r) => {
        if (!r.last_delta_at) return acc
        return !acc || r.last_delta_at > acc ? r.last_delta_at : acc
      }, null)
      const mailSyncErrors = mailSyncRows.filter((r) => r.last_error).map((r) => r.last_error)

      const engStateRows = hsEngagementsState.data || []
      const newestEngSync = engStateRows.reduce((acc, r) => {
        const t = r.last_full_sync || r.last_delta_sync
        if (!t) return acc
        return !acc || t > acc ? t : acc
      }, null)
      const engErrors = engStateRows.filter((r) => r.last_error).map((r) => r.last_error)

      setState({
        loading: false, error: null,
        data: {
          mail: {
            total: mailMessages.count, embedded: mailMessagesEmbedded.count,
            lastDelta: newestDelta,
            errors: mailSyncErrors,
            foldersTracked: mailSyncRows.length,
            backfill: {
              byStatus: backfillByStatus, totalBuckets, completedBuckets,
              percent: totalBuckets > 0 ? Math.round((completedBuckets / totalBuckets) * 100) : 0,
            },
          },
          hubspot: {
            state: hsState.data,
            deals: hsDeals.count, companies: hsCompanies.count, contacts: hsContacts.count,
            engagements: { total: hsEngagements.count, embedded: hsEngagementsEmbedded.count, byType: engagementsByType, lastSync: newestEngSync, errors: engErrors },
          },
          jira: {
            state: jiraState.data, issues: jiraIssues.count, projects: jiraProjects.count,
          },
          embed: {
            tokens7d: embedTokens7d, runs7d: embedRuns7d, lastRun: lastEmbed,
            model: lastEmbed?.stats?.model || 'text-embedding-3-small',
          },
          latestByAgent,
          recentRuns: allRecentRuns,
          fetchedAt: new Date(),
        },
      })
    } catch (err) {
      setState({ loading: false, error: err.message, data: null })
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  if (state.loading && !state.data) return <div className="skeleton" style={{ height: 200 }} />
  if (state.error) return <div className="card">Fout bij laden: {state.error}</div>

  const d = state.data

  // Mail health: gebruikt mail_sync_state.last_delta_at (5min cadence)
  const mailHealth = healthFor(d.mail.lastDelta, d.mail.errors[0], 10)
  mailHealth.title = `Last delta: ${relTime(d.mail.lastDelta)}`
  const mailRun = d.latestByAgent['mail-sync']

  // HubSpot health: bug-fix — gebruik de meest recente van delta+full
  // (delta draait elke 30 min, full elke 24u). Eerder pakte de code full eerst,
  // wat altijd ~1 dag oud is en daardoor 'stale' toonde.
  const hsCoreLastSync = tsMax(d.hubspot.state?.last_delta_sync, d.hubspot.state?.last_full_sync)
  const hsHealth = healthFor(hsCoreLastSync, d.hubspot.state?.last_error, 45)
  hsHealth.title = `Last sync: ${relTime(hsCoreLastSync)}`
  const hsRun = d.latestByAgent['hubspot-sync']

  // Jira: zelfde fix — delta is recenter dan full
  const jiraLastSync = tsMax(d.jira.state?.last_delta_sync, d.jira.state?.last_full_sync)
  const jiraHealth = healthFor(jiraLastSync, d.jira.state?.last_error, 75)
  jiraHealth.title = `Last sync: ${relTime(jiraLastSync)}`
  const jiraRun = d.latestByAgent['jira-sync']

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <section>
        <div className="section__head">
          <h2 className="section__title">Database</h2>
          <span className="section__hint">
            Auto-refresh per 30s · Laatst: {d.fetchedAt.toLocaleTimeString('nl-NL')}
          </span>
        </div>

        <div className="tos-grid">
          <SourceCard
            source="mail"
            title="Outlook"
            total={d.mail.total}
            totalLabel="berichten"
            health={mailHealth}
            lastSyncIso={d.mail.lastDelta}
            runAgent={mailRun?.agent_name || 'mail-sync'}
            runStatus={mailRun?.status}
            errorMsg={d.mail.errors[0]}
            onOpen={() => setOpenPopup('mail')}
          />

          <SourceCard
            source="hubspot"
            title="HubSpot"
            total={(d.hubspot.deals || 0) + (d.hubspot.companies || 0) + (d.hubspot.contacts || 0) + (d.hubspot.engagements.total || 0)}
            totalLabel="records"
            health={hsHealth}
            lastSyncIso={hsCoreLastSync}
            runAgent={hsRun?.agent_name || 'hubspot-sync'}
            runStatus={hsRun?.status}
            errorMsg={d.hubspot.state?.last_error || d.hubspot.engagements.errors[0]}
            onOpen={() => setOpenPopup('hubspot')}
          />

          <SourceCard
            source="jira"
            title="Jira"
            total={d.jira.issues}
            totalLabel={`issues · ${fmtNum(d.jira.projects)} projecten`}
            health={jiraHealth}
            lastSyncIso={jiraLastSync}
            runAgent={jiraRun?.agent_name || 'jira-sync'}
            runStatus={jiraRun?.status}
            errorMsg={d.jira.state?.last_error}
            onOpen={() => setOpenPopup('jira')}
          />

          {/* Externe bronnen — geen mirror, alleen kort geïntroduceerd.
              Health-pill = 'MCP' om aan te geven dat er geen Supabase-
              mirror is, label 'binnenkort in DB' onder het getal voor
              de roadmap-status. */}
          <SourceCard
            source="fireflies"
            title="Fireflies"
            total="—"
            totalLabel="binnenkort in DB"
            health={{ tag: 's-warning', label: 'MCP', title: 'Direct via Fireflies MCP — Supabase-mirror staat op de roadmap' }}
            lastSyncIso={null}
            runAgent="MCP"
            onOpen={() => setOpenPopup('fireflies')}
          />

          <SourceCard
            source="jellemind"
            title="JelleMind"
            total="—"
            totalLabel="in opbouw"
            health={{ tag: 's-warning', label: 'wordt gebouwd', title: 'Komt eraan' }}
            lastSyncIso={null}
            runAgent="—"
            onOpen={() => setOpenPopup('jellemind')}
          />

          <SourceCard
            source="agenda"
            title="Agenda"
            total="—"
            totalLabel="binnenkort in DB"
            health={{ tag: 's-warning', label: 'MCP', title: 'Direct via Outlook (MS Graph) — Supabase-mirror staat op de roadmap' }}
            lastSyncIso={null}
            runAgent="MCP"
            onOpen={() => setOpenPopup('agenda')}
          />
        </div>
      </section>

      {openPopup && (
        <SourceDetailPopup source={openPopup} data={d} onClose={() => setOpenPopup(null)} />
      )}
    </div>
  )
}
