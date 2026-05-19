import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import styles from './zoeken.module.css'
import RagChatView from './RagChatView'

// V9.9 (2026-05-18): code-splitting via React.lazy. Chat-mode is default
// (eager), de overige 3 modes worden alleen geladen als je ze opent —
// scheelt ~500KB van de initial bundle bij eerste page-load.
const ManualSearchView   = lazy(() => import('./ManualSearchView'))
const ContactTimelineView = lazy(() => import('./ContactTimelineView'))
const CompanyTimelineView = lazy(() => import('./CompanyTimelineView'))

// Wrapper met tab-toggle tussen Chat, handmatig zoeken, contact-tijdlijn
// (V9.6) en company-tijdlijn (V9.8 — alle mails+meetings+notes van alle
// contactpersonen van een company in één view, met attribution "via wie").
const MODE_KEY = 'rag-view-mode'

export default function RagSearchView() {
  const [searchParams, setSearchParams] = useSearchParams()
  // V9.13: URL-params voor deep-link uit Postvak/Tijdlijn.
  // Voorbeeld: /zoeken?mode=company&company_id=280214749389
  // RagSearchView leest de mode + company_id, switch mode, fetcht company
  // via search_companies (de full row) en geeft door als initialCompany.
  const urlMode = searchParams.get('mode')
  const urlCompanyId = searchParams.get('company_id')

  const [mode, setMode] = useState(() => {
    if (urlMode && ['chat', 'manual', 'contact', 'company'].includes(urlMode)) return urlMode
    try { return localStorage.getItem(MODE_KEY) || 'chat' } catch { return 'chat' }
  })
  const setModeAndPersist = useCallback((m) => {
    setMode(m)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* ignore */ }
  }, [])

  // V9.14: company-banner opent altijd in nieuwe tab via URL-params
  // (zie SenderTimeline CompanyReferBanner). initialCompany wordt enkel
  // via deep-link gevuld bij mount — geen callback-flow meer.
  const [initialCompany, setInitialCompany] = useState(null)

  // V9.13: bij deep-link met company_id, fetch de company-row en seed
  // initialCompany. Eénmalig bij mount (urlCompanyId aanwezig).
  useEffect(() => {
    if (!urlCompanyId) return
    let cancelled = false
    supabase.from('hubspot_companies')
      .select('company_id, name, domain, industry, lifecyclestage, city, country')
      .eq('company_id', urlCompanyId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setInitialCompany(data)
      })
    // Clean URL na verwerking zodat refresh niet steeds initialCompany reset
    const next = new URLSearchParams(searchParams)
    next.delete('company_id')
    next.delete('mode')
    setSearchParams(next, { replace: true })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div className={styles.modeBar}>
        <ModeButton active={mode === 'chat'}    onClick={() => setModeAndPersist('chat')}    icon="💬" label="Chat"              sub="Vraag stellen, AI antwoordt met bronnen" />
        <ModeButton active={mode === 'manual'}  onClick={() => setModeAndPersist('manual')}  icon="🔍" label="Handmatig zoeken"  sub="Filter zelf op source, datum, entity" />
        <ModeButton active={mode === 'contact'} onClick={() => setModeAndPersist('contact')} icon="👤" label="Contact-tijdlijn" sub="Mails + meetings van één persoon" />
        <ModeButton active={mode === 'company'} onClick={() => setModeAndPersist('company')} icon="🏢" label="Company-tijdlijn" sub="Alle contacten + notes per bedrijf" />
        <span style={{ flex: 1 }} />
        <Link to="/instellingen/chat" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Chat-instructies →
        </Link>
      </div>
      {mode === 'chat' && <RagChatView />}
      {mode !== 'chat' && (
        <Suspense fallback={<div style={{ padding: 'var(--s-6)', textAlign: 'center', color: 'var(--text-muted)' }}>View laden…</div>}>
          {mode === 'manual'  && <ManualSearchView />}
          {mode === 'contact' && <ContactTimelineView />}
          {mode === 'company' && <CompanyTimelineView initialCompany={initialCompany} />}
        </Suspense>
      )}
    </div>
  )
}

function ModeButton({ active, onClick, icon, label, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.modeBtn} ${active ? styles.modeBtnActive : ''}`}
    >
      <span className={styles.modeBtnIcon}>{icon}</span>
      <span className={styles.modeBtnLabel}>
        <span className={styles.modeBtnName} style={{ color: active ? 'var(--text)' : 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</span>
      </span>
    </button>
  )
}
