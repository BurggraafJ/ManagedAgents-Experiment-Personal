import { useNavigate } from 'react-router-dom'
import './beheer.css'

// Beheer — portaal-pagina voor admin-only functies.
// Vervangt de verspreide admin-items in de hoofdsidebar; jij ziet één
// item "Beheer" en klikt door naar deze hub. Cards navigeren naar de
// bestaande URLs (geen redirect-chain, bookmarks blijven werken).
//
// Project — Multi-user Access (Confluence 454819841).

const ICONS = {
  health: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  security: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  intelligence: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v6M12 17v6M4.2 4.2l4.3 4.3M15.5 15.5l4.3 4.3M1 12h6M17 12h6M4.2 19.8l4.3-4.3M15.5 8.5l4.3-4.3" />
    </svg>
  ),
  quality: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  observability: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </svg>
  ),
  jellemind: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11V8a3 3 0 0 1 6 0v3" />
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M12 15v2" />
    </svg>
  ),
  legalai: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6l2-2h14l2 2v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M3 10h18M8 14h8M8 18h5" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
}

const SECTIONS = [
  {
    id: 'monitoring',
    label: 'Monitoring',
    hint: 'Wat doen de agents en hoe gezond is het systeem',
    cards: [
      { icon: ICONS.health,    path: '/health',   label: 'Health & Issues', desc: 'Run-success per 7d, fouten, stille agents. Bron: agent_runs_health_7d.' },
      { icon: ICONS.security,  path: '/security', label: 'Security Monitor', desc: 'Open bevindingen van dagelijkse security-scan. Kritieke issues bovenaan.' },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    hint: 'RAG-laag, kosten, model-performance',
    cards: [
      { icon: ICONS.intelligence,   path: '/intelligence',                  label: 'Intelligence Hub',    desc: 'Pipeline-overzicht: chunks, embeddings, retrieval, context-build.' },
      { icon: ICONS.quality,        path: '/intelligence/quality',          label: 'Quality',             desc: 'Acceptance-rate per skill, retrieval-strategie en chunk-source.' },
      { icon: ICONS.observability,  path: '/intelligence/observability',    label: 'Observability',       desc: 'Claude-call telemetrie — model, tokens, cost, latency per skill.' },
    ],
  },
  {
    id: 'agentlaag',
    label: 'Agent-laag',
    hint: 'Persoonlijke voorkeur, thought-leadership, debug',
    cards: [
      { icon: ICONS.jellemind, path: '/jellemind', label: 'JelleMind',  desc: 'Drie laden: persoonlijke voorkeur, organisatie-waarheid, procesinstructies.' },
      { icon: ICONS.legalai,   path: '/legal-ai',  label: 'Legal AI',   desc: 'Dagelijks dossier over Legal AI-markt — research, dagartikel, LinkedIn-drafts.' },
      { icon: ICONS.chat,      path: '/chat',      label: 'Chat',       desc: 'Direct met je agents praten — debug-tool.' },
    ],
  },
  {
    id: 'config',
    label: 'Configuratie',
    hint: 'Toegang, infrastructuur, sleutels',
    cards: [
      { icon: ICONS.users,    path: '/instellingen/gebruikers',    label: 'Gebruikers',    desc: 'Wie heeft toegang en met welke rol — owner of member.' },
      { icon: ICONS.settings, path: '/instellingen',               label: 'Instellingen',  desc: 'Agents-instructies, API keys, Edge Functions, deployments, templates.' },
    ],
  },
]

export default function BeheerView() {
  const navigate = useNavigate()

  return (
    <div className="beheer-app">
      <header className="beheer-app__head">
        <h1 className="beheer-app__title">Beheer</h1>
        <p className="beheer-app__intro">
          Alle backend-functies van Legal Mind op één plek. Monitoring, agent-configuratie,
          intelligence-telemetrie en toegangsbeheer. Alleen zichtbaar voor owners — members
          zien deze sectie niet.
        </p>
      </header>

      {SECTIONS.map(section => (
        <section key={section.id} className="beheer-section">
          <div className="beheer-section__head">
            <h2 className="beheer-section__title">{section.label}</h2>
            <span className="beheer-section__hint">{section.hint}</span>
          </div>
          <div className="beheer-grid">
            {section.cards.map(card => (
              <button
                key={card.path}
                type="button"
                className="beheer-card"
                onClick={() => navigate(card.path)}
              >
                <span className="beheer-card__icon">{card.icon}</span>
                <h3 className="beheer-card__label">{card.label}</h3>
                <p className="beheer-card__desc">{card.desc}</p>
                <span className="beheer-card__cta">Open <span aria-hidden>→</span></span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
