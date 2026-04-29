import { useState } from 'react'
import { AgentCardC as AgentCard } from '../AgentCardVariants'

// Edge-functions die op de Agents-pagina als "Functies" worden getoond. Geen
// werk-agents (eigen agent-card), maar wel relevant voor wat de werk-agents
// + dashboard onder water gebruiken. Per fn een korte uitleg + 'usedBy' om te
// snappen waar in het ecosysteem hij past.
//
// Truth-of-source syncs (mail-sync / hubspot-sync / jira-sync) staan hier NIET
// in — die hebben hun eigen tab. Volledig technisch overzicht: /Functies.
const AGENT_PAGE_FUNCTIONS = [
  {
    agent: 'mail-embed',
    label: 'Mail embed',
    desc: 'Vectoriseert mails + engagements (text-embedding-3-small) zodat ze doorzoekbaar zijn voor RAG.',
    usedBy: 'auto-draft (RAG-context), Search-tab, autodraft-rag-prefill',
  },
  {
    agent: 'autodraft-rag-prefill',
    label: 'AutoDraft RAG prefill',
    desc: 'Pakt per nieuwe inkomende mail relevante eerdere context (mails, deals, contacten, Jira-issues) en zet die in autodraft_mails.rag_context.',
    usedBy: 'auto-draft (leest context ipv zelf RAG te doen)',
  },
  {
    agent: 'mail-backfill',
    label: 'Mail backfill',
    desc: '12 maanden historische Outlook-mail ophalen in batches. Eenmalige job per folder; daarna idle.',
    usedBy: 'mail-sync (initiële vulling), RAG-historie',
  },
  {
    agent: 'hubspot-engagements-sync',
    label: 'HubSpot engagements',
    desc: 'Sync van calls, mails, notes, tasks en meetings — alle interactie-historie van deals/contacten.',
    usedBy: 'daily-admin, sales-on-road, sales-followups',
  },
  {
    agent: 'rag-search',
    label: 'RAG search',
    desc: 'On-demand vector-search over alle bronnen via match_all_sources RPC.',
    usedBy: 'Search-tab in dashboard, ad-hoc context-queries',
    noTracking: true,
  },
  {
    agent: 'transcribe',
    label: 'Transcribe (Whisper)',
    desc: 'Spraak-naar-tekst via OpenAI Whisper.',
    usedBy: 'Dashboard mic-knop (quick-capture sales notes, taken, ritten)',
    noTracking: true,
  },
  {
    agent: 'km-distance-lookup',
    label: 'Km distance lookup',
    desc: 'Google Maps reisafstand-API voor het berekenen van km-afstand tussen twee adressen.',
    usedBy: 'kilometerregistratie (rit-input via dashboard)',
    noTracking: true,
  },
  {
    agent: 'km-excel-generate',
    label: 'Km Excel generate',
    desc: 'Genereert het maandelijkse Excel-bestand met ritten + parkeerkosten in Burggraaf-huisstijl.',
    usedBy: 'kilometerregistratie (output op de 2e van de maand)',
  },
  {
    agent: 'vercel-control',
    label: 'Vercel control',
    desc: 'Lijst/promote/cancel/redeploy van het dashboard via de Vercel API.',
    usedBy: 'Functies-pagina deploy-knoppen, dashboard-refresh skill',
  },
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
      <div style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--text)' }}>{fn.desc}</div>
      <div className="muted" style={{ fontSize: 10, lineHeight: 1.4 }}>
        <strong style={{ color: 'var(--text-muted)' }}>Door:</strong> {fn.usedBy}
      </div>
      {!fn.noTracking && (
        <div className="muted" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', borderTop: '1px solid var(--border)', paddingTop: 4 }}>
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
  const [showFunctions, setShowFunctions] = useState(false)
  const Card = AgentCard

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
    <Card
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

  // Voorstel C (Activity Feed) is de gekozen layout. Grid van 360px-cards,
  // auto-fit zodat het op grote schermen 2-3 kolommen wordt.
  const primaryGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 'var(--s-4)' }

  return (
    <>
      <section id="agents">
        <div className="section__head">
          <h2 className="section__title">
            Hoofd-agents <span className="section__count">{primary.length}</span>
          </h2>
          <span className="section__hint">de werk-agents waar je actief mee bezig bent</span>
        </div>
        <div style={primaryGridStyle}>
          {primary.map(renderCard)}
        </div>
      </section>

      {/* Helper-agents (links) + Functies (rechts) op brede schermen naast
          elkaar. Geen van beide heeft de volle breedte nodig en zo schaal
          je verticaal beter. Op smal scherm stack via auto-fit grid. */}
      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 'var(--s-5)', alignItems: 'start' }}
      >
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
              <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}>
                {secondary.map(renderCard)}
              </div>
            )}
          </section>
        )}

        {/* Functies — edge-functions die agents/dashboard onder water gebruiken.
            Default ingeklapt; klik op de header opent ze. */}
        <section id="agents-functions" style={{ opacity: showFunctions ? 1 : 0.85 }}>
          <button
            type="button"
            onClick={() => setShowFunctions(v => !v)}
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
                <span aria-hidden style={{ marginRight: 6 }}>{showFunctions ? '▾' : '▸'}</span>
                Functies <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>({AGENT_PAGE_FUNCTIONS.length})</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>
                Edge-functions die agents + dashboard onder water aanroepen —
                embeddings, RAG-prefill, Whisper, deploy, enz. Technisch overzicht op /Functies.
              </div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {showFunctions ? 'klik om in te klappen' : 'klik om uit te klappen'}
            </span>
          </button>

          {showFunctions && (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}>
              {AGENT_PAGE_FUNCTIONS.map(fn => (
                <FunctionTile key={fn.agent} fn={fn} latestRun={latestRuns[fn.agent]} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
