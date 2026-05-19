import { useEffect, useMemo, useState, useRef } from 'react'
import { supabase } from '../../../../lib/supabase'
import {
  StyleToggle, FilterChips, NotesToggle, ExpandAllButton, GroupSection, Legend,
  EmptyGraphic, LoadingGraphic, ErrorGraphic,
} from './TimelineParts'
import styles from './SenderTimeline.module.css'

/**
 * CompanyTimeline — thin wrapper voor company-aggregatie (V9.9 refactor).
 *
 * Eigen data via get_company_mails + get_company_events + get_company_notes.
 * Items in deze view bevatten attribution_emails + latest_via_email — de
 * gedeelde Card/RailItem in TimelineParts pakt die automatisch op via
 * AttributionBadge zonder dat we hier iets specials hoeven te doen.
 *
 * Notes default AAN — 94% van notes leeft op company-niveau, dus dit is
 * de hoofdbron voor context. Hint-tekst is daarop aangepast.
 */
export default function CompanyTimeline({ company }) {
  const companyId = company?.company_id || company?.hubspot_company_id
  const companyName = company?.name || '—'

  const [mode, setMode] = useState('cards')
  const [filter, setFilter] = useState('all')
  const [showNotes, setShowNotes] = useState(true) // default AAN op company-niveau
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

  useEffect(() => {
    if (!companyId) { setThreads([]); return }
    let cancelled = false
    setLoadingMails(true)
    initRef.current = false
    supabase
      .rpc('get_company_mails', { p_hubspot_company_id: companyId, p_exclude_conversation_id: null })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(prev => prev || (e.message || 'RPC company-mails failed'))
        else setThreads(Array.isArray(data) ? data : [])
        setLoadingMails(false)
      })
    return () => { cancelled = true }
  }, [companyId])

  useEffect(() => {
    if (!companyId) { setEvents([]); return }
    let cancelled = false
    setLoadingEvents(true)
    supabase
      .rpc('get_company_events', { p_hubspot_company_id: companyId, p_lookback_days: 730 })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(prev => prev || (e.message || 'RPC company-events failed'))
        else setEvents(Array.isArray(data) ? data : [])
        setLoadingEvents(false)
      })
    return () => { cancelled = true }
  }, [companyId])

  useEffect(() => {
    if (!companyId || !showNotes) { setNotes([]); return }
    let cancelled = false
    setLoadingNotes(true)
    supabase
      .rpc('get_company_notes', { p_hubspot_company_id: companyId, p_lookback_days: 730 })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(prev => prev || (e.message || 'RPC company-notes failed'))
        else setNotes(Array.isArray(data) ? data : [])
        setLoadingNotes(false)
      })
    return () => { cancelled = true }
  }, [companyId, showNotes])

  const loading = loadingMails || loadingEvents || loadingNotes

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

  if (loading && threads.length === 0 && events.length === 0 && notes.length === 0) {
    return (
      <div className={styles.empty}>
        <LoadingGraphic />
        <div className={styles.emptyTitle}>Company-tijdlijn ophalen…</div>
        <div className={styles.emptySub}>Mails + meetings + notes voor alle contactpersonen van {companyName}.</div>
      </div>
    )
  }
  if (error && threads.length === 0 && events.length === 0 && notes.length === 0) {
    return (
      <div className={styles.empty}>
        <ErrorGraphic />
        <div className={styles.emptyTitle}>Kon de tijdlijn niet ophalen</div>
        <code className={styles.emptyError}>{error}</code>
      </div>
    )
  }
  if (totalThreads === 0 && totalEvents === 0 && totalNotes === 0) {
    return (
      <div className={styles.empty}>
        <EmptyGraphic />
        <div className={styles.emptyTitle}>Nog geen contact-historie met {companyName}</div>
        <div className={styles.emptySub}>
          Geen mails, meetings of HubSpot-notes gevonden voor de contactpersonen
          van deze company. Mogelijk zijn er nog geen contacten gekoppeld in HubSpot.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div className={styles.headInfo}>
          <span className={styles.headName}>🏢 {companyName}</span>
          {company?.domain && (
            <span className={styles.headEmail}>{company.domain}</span>
          )}
          <span className={styles.headStats}>
            {totalThreads} {totalThreads === 1 ? 'conversatie' : 'conversaties'} · {totalMailMessages} mails
            {totalEvents > 0 && <> · {totalEvents} {totalEvents === 1 ? 'meeting' : 'meetings'}</>}
            {totalNotes > 0 && <> · {totalNotes} {totalNotes === 1 ? 'note' : 'notes'}</>}
          </span>
        </div>
        <StyleToggle mode={mode} setMode={setMode} />
      </div>

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
        hint="Op company-niveau is dit de hoofdbron voor context — staat default aan."
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
