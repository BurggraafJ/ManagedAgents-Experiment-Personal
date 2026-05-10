import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { truncate } from '../../../lib/now'
import Icon from './Icon'

// 4 focus-tiles in 2-cols layout. Postvak count uit autodraft_mails
// (decision IS NULL), Volgende meeting uit calendar_events vandaag.
export default function FocusGrid({ badges = {}, goto }) {
  const adminPending = badges.adminPending || 0
  const taskNeedsReview = (badges.tasks || []).filter(t => t.is_newly_found).length

  const postvakCount = usePostvakCount()
  const nextMeeting = useNextMeeting()

  const postvakDisplay = postvakCount === null ? '—' : postvakCount
  const nextLabel = nextMeeting
    ? new Date(nextMeeting.start_time).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    : 'geen'
  const nextSub = nextMeeting
    ? truncate(nextMeeting.subject || '(geen titel)', 48)
    : 'geen meeting vandaag'

  return (
    <div className="now-focus-grid">
      <button type="button" className="now-focus now-focus--accent" onClick={() => goto('/administratie')}>
        <div className="now-focus__head">
          <div className="now-focus__icon">
            <Icon><path d="M9 12l2 2 4-4"/><rect x="3" y="3" width="18" height="18" rx="3"/></Icon>
          </div>
          Open voorstellen
        </div>
        <div className="now-focus__num">{adminPending}</div>
        <div className="now-focus__sub">
          {adminPending === 0 ? 'geen openstaande voorstellen' : 'in administratie wachten op review'}
        </div>
        <span className="now-focus__cta">Open admin →</span>
      </button>

      <button type="button" className="now-focus" onClick={() => goto('/agenda')}>
        <div className="now-focus__head">
          <div className="now-focus__icon">
            <Icon><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Icon>
          </div>
          Volgende meeting
        </div>
        <div className="now-focus__num now-focus__num--sm">{nextLabel}</div>
        <div className="now-focus__sub">{nextSub}</div>
        <span className="now-focus__cta">Open agenda →</span>
      </button>

      <button type="button" className="now-focus" onClick={() => goto('/postvak')}>
        <div className="now-focus__head">
          <div className="now-focus__icon">
            <Icon><path d="M3 7h18v12H3z"/><path d="M3 7l9 7 9-7"/></Icon>
          </div>
          Postvak
        </div>
        <div className="now-focus__num">{postvakDisplay}</div>
        <div className="now-focus__sub">
          {postvakCount === 0 ? 'geen open mails' : 'mails wachten op beslissing'}
        </div>
        <span className="now-focus__cta">Open postvak →</span>
      </button>

      <button type="button" className="now-focus" onClick={() => goto('/taken')}>
        <div className="now-focus__head">
          <div className="now-focus__icon">
            <Icon><rect x="4" y="4" width="16" height="18" rx="2"/><path d="M9 2h6v4H9z"/><path d="m9 14 2 2 4-4"/></Icon>
          </div>
          Taken
        </div>
        <div className="now-focus__num now-focus__num--sm">{taskNeedsReview}</div>
        <div className="now-focus__sub">
          {taskNeedsReview === 0 ? 'geen nieuwe action items' : 'nieuwe items uit Fireflies/Jira'}
        </div>
        <span className="now-focus__cta">Open taken →</span>
      </button>
    </div>
  )
}

function usePostvakCount() {
  const [count, setCount] = useState(null)
  useEffect(() => {
    let cancelled = false
    supabase
      .from('autodraft_mails')
      .select('id', { count: 'exact', head: true })
      .is('decision', null)
      .then(({ count }) => { if (!cancelled) setCount(count ?? 0) })
      .catch(() => { if (!cancelled) setCount(0) })
    return () => { cancelled = true }
  }, [])
  return count
}

function useNextMeeting() {
  const [meeting, setMeeting] = useState(null)
  useEffect(() => {
    let cancelled = false
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(); end.setHours(23, 59, 59, 999)
    supabase
      .from('calendar_events')
      .select('id, subject, start_time')
      .eq('is_cancelled', false)
      .gte('start_time', start.toISOString())
      .lte('start_time', end.toISOString())
      .order('start_time', { ascending: true })
      .limit(5)
      .then(({ data }) => {
        if (cancelled) return
        const nowMs = Date.now()
        const upcoming = (data || []).find(e => new Date(e.start_time).getTime() >= nowMs - 5 * 60000)
        setMeeting(upcoming || (data || [])[0] || null)
      })
    return () => { cancelled = true }
  }, [])
  return meeting
}
