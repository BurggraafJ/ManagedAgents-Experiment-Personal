import { useEffect, useMemo, useState, useRef } from 'react'
import { supabase } from '../../../../lib/supabase'
import {
  StyleToggle, FilterChips, NotesToggle, ExpandAllButton, GroupSection, Legend,
  EmptyGraphic, LoadingGraphic, ErrorGraphic,
} from './TimelineParts'
import styles from './SenderTimeline.module.css'

/**
 * SenderTimeline — cross-conversation history voor één afzender (mail).
 *
 * Thin wrapper rond TimelineParts (V9.9 refactor). Eigen data-fetching
 * via get_sender_history + get_sender_events + get_contact_notes_full
 * (V9.9: notes verbreed met company-notes). UI komt uit de gedeelde
 * subcomponenten.
 *
 * Props:
 *   - mail: { from_email, from_name, conversation_id }
 *   - hubspotContactId: optioneel; alleen dan kunnen we notes ophalen
 *     (RPC heeft de HubSpot contact-id nodig om via company te joinen).
 */
export default function SenderTimeline({ mail, hubspotContactId = null }) {
  const [mode, setMode] = useState('cards')
  const [filter, setFilter] = useState('all')
  const [showNotes, setShowNotes] = useState(false) // default UIT op contact-niveau
  const [openIds, setOpenIds] = useState(() => new Set())
  const [bodies, setBodies] = useState({})

  const [threads, setThreads] = useState([])
  const [events, setEvents] = useState([])
  const [notes, setNotes] = useState([])
  const [loadingMails, setLoadingMails] = useState(false)
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [error, setError] = useState(null)

  const [expandedMonths, setExpandedMonths] = useState(() => new Set())
  const initRef = useRef(false)

  // V9.11: auto-lookup van hubspot_contact_id obv from_email als parent
  // er geen explicit doorgeeft (Postvak-modal context). Zo werkt de
  // Notes-toggle daar ook voor bekende afzenders.
  const [autoContactId, setAutoContactId] = useState(null)
  useEffect(() => {
    if (hubspotContactId || !mail.from_email) { setAutoContactId(null); return }
    let cancelled = false
    supabase.from('contactpersonen')
      .select('hubspot_contact_id')
      .eq('email', mail.from_email.toLowerCase())
      .eq('is_deleted', false)
      .not('hubspot_contact_id', 'is', null)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setAutoContactId(data?.hubspot_contact_id || null)
      })
    return () => { cancelled = true }
  }, [mail.from_email, hubspotContactId])
  const effectiveContactId = hubspotContactId || autoContactId

  // V9.12: gekoppelde company-info ophalen zodra effectiveContactId bekend is.
  // Banner verschijnt in elke context (Postvak + Zoekpagina). Klik werkt
  // alleen als parent een onJumpToCompany callback meegeeft (Zoekpagina);
  // in Postvak is de banner info-only.
  const [companyInfo, setCompanyInfo] = useState(null)
  useEffect(() => {
    if (!effectiveContactId) { setCompanyInfo(null); return }
    let cancelled = false
    supabase.rpc('get_contact_company', { p_hubspot_contact_id: effectiveContactId })
      .then(({ data }) => {
        if (!cancelled) setCompanyInfo(data?.[0] || null)
      })
    return () => { cancelled = true }
  }, [effectiveContactId])

  // Fetch mails
  useEffect(() => {
    if (!mail.from_email) { setThreads([]); return }
    let cancelled = false
    setLoadingMails(true)
    initRef.current = false
    supabase
      .rpc('get_sender_history', {
        p_from_email: mail.from_email,
        p_exclude_conversation_id: mail.conversation_id || null,
      })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(prev => prev || (e.message || 'RPC mails failed'))
        else setThreads(Array.isArray(data) ? data : [])
        setLoadingMails(false)
      })
    return () => { cancelled = true }
  }, [mail.from_email, mail.conversation_id])

  // Fetch events
  useEffect(() => {
    if (!mail.from_email) { setEvents([]); return }
    let cancelled = false
    setLoadingEvents(true)
    supabase
      .rpc('get_sender_events', { p_from_email: mail.from_email, p_lookback_days: 730 })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(prev => prev || (e.message || 'RPC events failed'))
        else setEvents(Array.isArray(data) ? data : [])
        setLoadingEvents(false)
      })
    return () => { cancelled = true }
  }, [mail.from_email])

  // Fetch notes — V9.9 verbreed met company-notes. V9.11 gebruikt effective
  // contact-id (explicit prop of auto-lookup uit contactpersonen).
  useEffect(() => {
    if (!showNotes || !effectiveContactId) { setNotes([]); return }
    let cancelled = false
    setLoadingNotes(true)
    supabase
      .rpc('get_contact_notes_full', {
        p_hubspot_contact_id: effectiveContactId,
        p_lookback_days: 730,
      })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(prev => prev || (e.message || 'RPC notes failed'))
        else setNotes(Array.isArray(data) ? data : [])
        setLoadingNotes(false)
      })
    return () => { cancelled = true }
  }, [showNotes, effectiveContactId])

  const loading = loadingMails || loadingEvents || loadingNotes

  // Filter mail-invites uit
  const visibleThreads = useMemo(
    () => threads.filter(t => !t.latest_is_calendar_invite),
    [threads]
  )

  const items = useMemo(() => {
    const showMails = filter === 'all' || filter === 'mails'
    const showEventsF = filter === 'all' || filter === 'events'
    const showNoteItems = (filter === 'all' || filter === 'notes') && showNotes
    const mailItems = showMails ? visibleThreads.map(t => ({
      kind: 'mail', sort_date: t.latest_received_at, _key: 'm-' + t.conversation_id, ...t,
    })) : []
    const eventItems = showEventsF ? events.map(e => ({
      kind: 'event', sort_date: e.start_time, _key: 'e-' + e.event_id, ...e,
    })) : []
    const noteItems = showNoteItems ? notes.map(n => ({
      kind: 'note', sort_date: n.hs_timestamp, _key: 'n-' + n.engagement_id, ...n,
    })) : []
    return [...mailItems, ...eventItems, ...noteItems]
      .filter(x => x.sort_date)
      .sort((a, b) => new Date(b.sort_date) - new Date(a.sort_date))
  }, [visibleThreads, events, notes, filter, showNotes])

  const grouped = useMemo(() => {
    const now = new Date()
    const upcoming = []
    const monthMap = new Map()
    for (const item of items) {
      const d = new Date(item.sort_date)
      if (item.kind === 'event' && d > now) {
        upcoming.push(item)
        continue
      }
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!monthMap.has(key)) {
        const label = d.toLocaleString('nl-NL', { month: 'long', year: 'numeric' })
        monthMap.set(key, {
          key, label: label.charAt(0).toUpperCase() + label.slice(1),
          items: [], mailCount: 0, eventCount: 0, noteCount: 0, isUpcoming: false,
        })
      }
      const g = monthMap.get(key)
      g.items.push(item)
      if (item.kind === 'event') g.eventCount++
      else if (item.kind === 'note') g.noteCount++
      else g.mailCount++
    }
    const months = Array.from(monthMap.values())
    if (upcoming.length === 0) return months
    return [{
      key: '__upcoming__', label: 'Komende meetings',
      items: upcoming.sort((a, b) => new Date(a.sort_date) - new Date(b.sort_date)),
      mailCount: 0, eventCount: upcoming.length, noteCount: 0, isUpcoming: true,
    }, ...months]
  }, [items])

  useEffect(() => {
    if (initRef.current || grouped.length === 0) return
    const now = new Date()
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const months = grouped.filter(g => !g.isUpcoming)
    const next = new Set()
    if (months.some(g => g.key === currentKey)) next.add(currentKey)
    else if (months[0]) next.add(months[0].key)
    setExpandedMonths(next)
    initRef.current = true
  }, [grouped])

  function toggleMonth(key) {
    setExpandedMonths(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  function toggleOpen(id) {
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Lazy body-fetch alleen voor mails (events/notes hebben body al uit RPC)
  useEffect(() => {
    const toFetch = Array.from(openIds).filter(id => !bodies[id] && !id.startsWith('e-') && !id.startsWith('n-'))
    if (toFetch.length === 0) return
    let cancelled = false
    async function run() {
      for (const id of toFetch) {
        try {
          const { data } = await supabase.from('mail_messages')
            .select('body_html, body_text, body_preview, body_truncated')
            .eq('id', id).maybeSingle()
          if (cancelled) return
          setBodies(prev => ({ ...prev, [id]: data || { _empty: true } }))
        } catch {
          if (!cancelled) setBodies(prev => ({ ...prev, [id]: { _error: true } }))
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [openIds, bodies])

  const totalThreads = visibleThreads.length
  const totalEvents = events.length
  const totalNotes = notes.length
  const totalMailMessages = useMemo(
    () => visibleThreads.reduce((sum, t) => sum + (t.thread_count || 1), 0), [visibleThreads]
  )

  if (loading && threads.length === 0 && events.length === 0) {
    return (
      <div className={styles.empty}>
        <LoadingGraphic />
        <div className={styles.emptyTitle}>Tijdlijn ophalen…</div>
        <div className={styles.emptySub}>Mails én meetings voor deze afzender.</div>
      </div>
    )
  }
  if (error && threads.length === 0 && events.length === 0) {
    return (
      <div className={styles.empty}>
        <ErrorGraphic />
        <div className={styles.emptyTitle}>Kon de tijdlijn niet ophalen</div>
        <code className={styles.emptyError}>{error}</code>
      </div>
    )
  }
  if (totalThreads === 0 && totalEvents === 0) {
    return (
      <div className={styles.empty}>
        <EmptyGraphic />
        <div className={styles.emptyTitle}>Nog geen eerdere contact-historie</div>
        <div className={styles.emptySub}>
          Met <strong>{mail.from_name || mail.from_email}</strong> is dit (buiten de
          huidige conversatie) de eerste keer dat we contact zien — geen mails én
          geen meetings.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div className={styles.headInfo}>
          <span className={styles.headName}>{mail.from_name || mail.from_email}</span>
          {mail.from_name && mail.from_email && (
            <span className={styles.headEmail}>{mail.from_email}</span>
          )}
          <span className={styles.headStats}>
            {totalThreads} {totalThreads === 1 ? 'conversatie' : 'conversaties'} · {totalMailMessages} mails
            {totalEvents > 0 && <> · {totalEvents} {totalEvents === 1 ? 'meeting' : 'meetings'}</>}
            {' · huidige thread niet meegerekend'}
          </span>
        </div>
        <StyleToggle mode={mode} setMode={setMode} />
      </div>

      {/* V9.14: rijke company-banner (V9.12-look) maar als <a target=_blank>
          — opent altijd in nieuwe tab via URL-params, zonder callback/JS-magic.
          Verschijnt zodra effectiveContactId een gekoppelde company heeft. */}
      {companyInfo && <CompanyReferBanner company={companyInfo} />}

      <div className={styles.filterChipRow}>
        <FilterChips
          filter={filter} setFilter={setFilter}
          mailCount={totalThreads} eventCount={totalEvents}
          noteCount={totalNotes} notesEnabled={showNotes}
        />
        <ExpandAllButton grouped={grouped} expandedMonths={expandedMonths} setExpandedMonths={setExpandedMonths} />
      </div>

      <NotesToggle
        enabled={showNotes} setEnabled={setShowNotes}
        count={totalNotes} loading={loadingNotes}
        disabled={!effectiveContactId}
      />

      {grouped.map(group => (
        <GroupSection
          key={group.key} group={group} mode={mode}
          expanded={expandedMonths.has(group.key)}
          onToggle={() => toggleMonth(group.key)}
          openIds={openIds} bodies={bodies} toggleOpen={toggleOpen}
        />
      ))}

      <Legend />
    </div>
  )
}

// V9.14: Company-refer banner als <a target=_blank>. Rijke layout (V9.12)
// met counts + meta, maar opent ALTIJD in nieuwe tab via URL-params.
// Geen callback dependency = werkt universeel (Postvak + Zoekpagina).
function CompanyReferBanner({ company }) {
  const url = `/zoeken?mode=company&company_id=${encodeURIComponent(company.company_id)}`
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={styles.companyReferBanner}
      title={`Open Company-tijdlijn voor ${company.name || '—'} in nieuwe tab`}
      aria-label={`Open company-tijdlijn voor ${company.name}`}
    >
      <div className={styles.companyReferBannerIcon}>🏢</div>
      <div className={styles.companyReferBannerBody}>
        <div className={styles.companyReferBannerTop}>
          <span className={styles.companyReferBannerLabel}>Onderdeel van</span>
          <strong className={styles.companyReferBannerName}>{company.name || '—'}</strong>
          {company.lifecyclestage && (
            <span className={styles.companyReferBannerStage}>{company.lifecyclestage}</span>
          )}
        </div>
        <div className={styles.companyReferBannerMeta}>
          {company.domain && <span>{company.domain}</span>}
          {company.industry && <span> · {company.industry}</span>}
          {company.city && <span> · {company.city}{company.country ? `, ${company.country}` : ''}</span>}
          {company.num_employees && <span> · {company.num_employees} medewerkers</span>}
        </div>
        <div className={styles.companyReferBannerCounts}>
          {company.other_contacts > 0 && (
            <span>👥 {company.other_contacts} andere {company.other_contacts === 1 ? 'contactpersoon' : 'contactpersonen'}</span>
          )}
          {company.notes_on_company > 0 && (
            <span>📝 {company.notes_on_company} {company.notes_on_company === 1 ? 'note' : 'notes'} op company-niveau</span>
          )}
        </div>
      </div>
      <div className={styles.companyReferBannerCta}>
        Open in nieuwe tab ↗
      </div>
    </a>
  )
}
