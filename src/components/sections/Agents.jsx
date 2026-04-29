import { useState } from 'react'
import AgentCard from '../AgentCard'

// Edge-functions die op de Agents-pagina als "Functies" worden getoond. Geen
// werk-agents (eigen agent-card), maar wel relevant voor wat de werk-agents
// onder water gebruiken — embeddings, RAG-prefill, mail-backfill, etc.
// Voor volledig overzicht (incl. utility/deploy): zie /Functies-pagina.
const AGENT_PAGE_FUNCTIONS = [
  { agent: 'mail-embed',               label: 'Mail embed',            desc: 'Vectoriseert mails + engagements voor RAG' },
  { agent: 'autodraft-rag-prefill',    label: 'AutoDraft RAG prefill', desc: 'Vult per nieuwe mail rag_context met relevante eerdere context' },
  { agent: 'mail-backfill',            label: 'Mail backfill',         desc: '12 mnd historische mail ophalen, batched' },
  { agent: 'hubspot-engagements-sync', label: 'HubSpot engagements',   desc: 'Calls / mails / notes / tasks / meetings' },
  { agent: 'rag-search',               label: 'RAG search',            desc: 'On-demand vector-search over alle bronnen', noTracking: true },
]

function relTime(iso) {
  if (!iso) return 'nooit'
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'zojuist'
  if (min < 60) return `${min}m geleden`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}u geleden`
  return `${Math.floor(h / 24)}d geleden`
}

function FunctionTile({ fn, latestRun }) {
  const status = fn.noTracking ? 'idle' : (latestRun?.status || 'idle')
  const statusLabel = fn.noTracking ? 'on-demand'
                    : status === 'success' ? 'ok'
                    : status === 'error'   ? 'fout'
                    : status === 'warning' ? 'let op'
                    : status === 'running' ? 'draait'
                    : 'geen logs'
  const tone = fn.noTracking ? 's-idle'
             : status === 'success' ? 's-success'
             : status === 'error'   ? 's-error'
             : status === 'warning' ? 's-warning'
             : status === 'running' ? 's-running'
             : 's-idle'

  return (
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{fn.label}</div>
          <div className="mono muted" style={{ fontSize: 10, marginTop: 2 }}>{fn.agent}</div>
        </div>
        <span className={`status-pill ${tone}`} style={{ fontSize: 10, flexShrink: 0 }}>
          {statusLabel}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 11, lineHeight: 1.4 }}>{fn.desc}</div>
      {!fn.noTracking && (
        <div className="muted" style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>
          laatste run {relTime(latestRun?.started_at)}
        </div>
      )}
    </div>
  )
}

// Tier-based grouping (zie agent_schedules.tier):
//   primary   = hoofdagent — altijd zichtbaar.
//   secondary = ondersteunend (auto-draft-execute, task-organizer) —
//               default ingeklapt onder "Helper-agents (N)".
//   source    = truth-of-source sync (mail-sync/hubspot-sync/jira-sync) — verborgen,
//               eigen plek in TruthOfSourcesView.
//   infra     = orchestrator/dashboard-refresh/agent-manager — helemaal verborgen.
//
// NEVER_SHOW dekt:
// - infra-agents die wel een schedule-rij hebben.
// - edge-functions met eigen pg_cron (mail-embed, mail-backfill,
//   hubspot-engagements-sync) die in agent_runs verschijnen maar geen agent zijn —
//   die staan in FunctionsView en TruthOfSourcesView.
const NEVER_SHOW = new Set([
  'orchestrator', 'dashboard-refresh', 'agent-manager',
  'mail-embed', 'mail-backfill', 'hubspot-engagements-sync', 'autodraft-rag-prefill',
])

export default function Agents({ schedules, latestRuns, history, questions, salesEvents, salesTodos }) {
  const [showSecondary, setShowSecondary] = useState(false)

  const questionsByAgent = {}
  questions.filter(q => q.status === 'open').forEach(q => {
    if (!questionsByAgent[q.agent_name]) questionsByAgent[q.agent_name] = []
    questionsByAgent[q.agent_name].push(q)
  })

  // Bouw lijsten gegroepeerd per tier — fallback naar 'primary' voor agents
  // zonder tier-veld (DB-defaults op 'primary' maar oudere rijen kunnen NULL zijn).
  const tierOf = (agentName) => {
    const s = schedules.find(x => x.agent_name === agentName)
    if (!s) return 'primary' // alleen runs, geen schedule — toon 'm bij primary
    if (NEVER_SHOW.has(agentName)) return 'infra'
    return s.tier || 'primary'
  }

  const visibleAgents = schedules
    .filter(s => !NEVER_SHOW.has(s.agent_name))
    .map(s => s.agent_name)

  // Extras: agents met runs maar zonder schedule-rij
  const extras = Object.keys(latestRuns).filter(
    a => !visibleAgents.includes(a) && !NEVER_SHOW.has(a)
  )
  const allAgents = [...visibleAgents, ...extras]

  const primary   = allAgents.filter(a => tierOf(a) === 'primary')
  const secondary = allAgents.filter(a => tierOf(a) === 'secondary')

  if (primary.length === 0 && secondary.length === 0) {
    return (
      <section id="agents">
        <div className="section__head">
          <h2 className="section__title">Agents</h2>
        </div>
        <div className="empty">Geen agents geregistreerd in agent_schedules.</div>
      </section>
    )
  }

  const renderCard = (name) => (
    <AgentCard
      key={name}
      agent={name}
      schedule={schedules.find(s => s.agent_name === name)}
      latestRun={latestRuns[name]}
      history={history[name] || []}
      openQuestions={questionsByAgent[name] || []}
      extras={
        name === 'sales-on-road' ? { salesEvents } :
        name === 'sales-todos'   ? { salesTodos } :
        {}
      }
    />
  )

  return (
    <>
      <section id="agents">
        <div className="section__head">
          <h2 className="section__title">
            Hoofd-agents <span className="section__count">{primary.length}</span>
          </h2>
          <span className="section__hint">de werk-agents waar je actief mee bezig bent</span>
        </div>

        <div className="grid grid--agents">
          {primary.map(renderCard)}
        </div>
      </section>

      {/* Helper-agents als duidelijk eigen sectie ERONDER, niet als toggle in
          de header — dan is het ook visueel helder dat het een aparte rang is.
          Standaard ingeklapt; klikken opent ze. */}
      {secondary.length > 0 && (
        <section id="agents-helpers" style={{ opacity: showSecondary ? 1 : 0.85 }}>
          <button
            type="button"
            onClick={() => setShowSecondary(v => !v)}
            className="card"
            style={{
              width: '100%',
              padding: 'var(--s-4) var(--s-5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              cursor: 'pointer',
              background: 'var(--bg-2)',
              border: '1px dashed var(--border)',
              textAlign: 'left',
            }}
          >
            <div>
              <div className="kpi__label" style={{ margin: 0 }}>
                <span aria-hidden style={{ marginRight: 6 }}>{showSecondary ? '▾' : '▸'}</span>
                Helper-agents <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>({secondary.length})</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>
                Stille hulpjes die op de achtergrond werken — autodraft-verzending en task-organizer.
                Belangrijk dat ze draaien, je hoeft er niet dagelijks naar te kijken.
              </div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {showSecondary ? 'klik om in te klappen' : 'klik om uit te klappen'}
            </span>
          </button>

          {showSecondary && (
            <div className="grid grid--agents" style={{ marginTop: 'var(--s-3)' }}>
              {secondary.map(renderCard)}
            </div>
          )}
        </section>
      )}

      {/* Functies — edge-functions die de werk-agents onder water gebruiken.
          Default uitgeklapt zodat Jelle in één blik ziet of de plumbing
          gezond is. Volledig overzicht (incl. utility/deploy) staat op
          de Functies-pagina. */}
      <section id="agents-functions">
        <div className="section__head">
          <h2 className="section__title">
            Functies <span className="section__count">{AGENT_PAGE_FUNCTIONS.length}</span>
          </h2>
          <span className="section__hint">edge-functions die de agents onder water aanroepen — full overview op /Functies</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--s-3)' }}>
          {AGENT_PAGE_FUNCTIONS.map(fn => (
            <FunctionTile key={fn.agent} fn={fn} latestRun={latestRuns[fn.agent]} />
          ))}
        </div>
      </section>
    </>
  )
}
