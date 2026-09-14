import { useState, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { showToast } from '../../components/Toast'
import { useAutoDraft } from '../../hooks/useAutoDraft'
import { usePv2Snoozes, tomorrowNine } from '../../hooks/usePv2Snoozes'
import { usePv2BucketOverrides } from '../../hooks/usePv2Outlook'
import { inferPseudoAudience } from '../../lib/autodraft'
import {
  buildInboxRows, buildSentRows, splitBuckets, bucketOf, matchesQuery,
  subjectOf, bodyPreviewOf, receivedAtOf,
} from '../../lib/postvakContract'
import MIcon from '../MIcon'
import MobilePostvakRow from './MobilePostvakRow'
import MobilePostvakMenu from './MobilePostvakMenu'
import MobileMailSheet from './MobileMailSheet'

// =============================================================================
// MobilePostvak — de mobiele inbox
// =============================================================================
// F2 (productlock 2026-09-12): de Inbox is een **kopie van Outlook** — elke
// niet-verwijderde mail in de Inbox-root, via dezelfde `buildInboxRows` als
// desktop. `audience` decoreert; het filtert nooit.
//
// v1.202 (spoor 10, brief prio-overige-swipe):
//  • De primaire schakelaar is **Prioriteit | Overige** met tellers, niet meer
//    Inbox | Verzonden. Dat onderscheid bestond alleen op desktop; op de
//    telefoon stond alles door elkaar, en dat is precies waar de nieuwsbrieven
//    de echte mail onder schoven.
//  • **Verzonden en zoeken** zitten in het overloopmenu (⋯). Verzonden is geen
//    gelijke van je postvak.
//  • Veeg naar links op een rij → Uitstellen · Verplaats · Verwijderen.
//
// De bak-indeling komt uit `lib/postvakContract.bucketOf`, dezelfde functie die
// desktop gebruikt. Er is dus één regel, niet twee die uit elkaar groeien.
// =============================================================================

const LIST_CAP = 80

const firstRecipient = (toRecip) => {
  if (!toRecip) return ''
  const arr = Array.isArray(toRecip) ? toRecip : [toRecip]
  for (const x of arr) {
    if (typeof x === 'string') return x
    if (x?.name) return x.name
    if (x?.email) return x.email
    if (x?.address) return x.address
  }
  return ''
}

const initials = (n) => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()

function timeAgo(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 3600000
  if (diff < 1) return `${Math.max(1, Math.round(diff * 60))}m`
  if (diff < 24) return `${Math.round(diff)}u`
  if (diff < 48) return 'gist'
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

function formatSyncTime(iso) {
  if (!iso) return 'geen sync'
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 1) return 'nu'
  if (diffMin < 60) return `${diffMin} min geleden`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}u geleden`
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

export default function MobilePostvak() {
  const { mails, mailMessages, categories, mailSyncState, refresh, loading } = useAutoDraft()
  const { snoozedIds, snooze } = usePv2Snoozes()
  const { bucketOverrides, setBucket } = usePv2BucketOverrides()

  const [bucket, setBucketTab] = useState('prio')   // primaire schakelaar
  const [mode, setMode] = useState('inbox')         // 'inbox' | 'sent' (overloop)
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [openId, setOpenId] = useState(null)        // mail-sheet
  const [swipeId, setSwipeId] = useState(null)      // welke rij staat open
  const [syncing, setSyncing] = useState(false)
  // Net-beslist: meteen uit de lijst, net als desktop (useInboxOptimistic).
  // Outlook volgt binnen ~15 min; tot die tijd zou de mail anders terugploppen.
  const [actioned, setActioned] = useState(() => new Set())

  const lastMailSync = useMemo(() => (mailSyncState || []).reduce((acc, r) => (
    !r.last_delta_at ? acc : (!acc || r.last_delta_at > acc ? r.last_delta_at : acc)
  ), null), [mailSyncState])

  const catLabel = useMemo(() => {
    const m = new Map()
    for (const c of (categories || [])) m.set(c.key || c.category_key, c.label || c.name)
    return m
  }, [categories])

  const inboxRows = useMemo(
    () => buildInboxRows(mailMessages, mails, { inferAudience: inferPseudoAudience }),
    [mailMessages, mails])

  const hidden = useMemo(() => {
    const s = new Set(actioned)
    for (const id of snoozedIds) s.add(id)
    return s
  }, [actioned, snoozedIds])

  const { prio, overig, counts } = useMemo(
    () => splitBuckets(inboxRows, { bucketOverrides, hidden }),
    [inboxRows, bucketOverrides, hidden])

  const sentRows = useMemo(() => buildSentRows(mailMessages, { limit: LIST_CAP }), [mailMessages])

  // Zoeken gaat over het héle postvak, niet over de open bak: je zoekt een
  // mail, niet een bak. De chip in de kop zegt dat ook.
  const list = useMemo(() => {
    if (query) {
      const pool = mode === 'sent' ? sentRows : inboxRows.filter(m => !hidden.has(m.mail_id))
      return pool.filter(m => matchesQuery(m, query)).slice(0, LIST_CAP)
    }
    if (mode === 'sent') return sentRows
    return (bucket === 'overig' ? overig : prio).slice(0, LIST_CAP)
  }, [query, mode, sentRows, inboxRows, hidden, bucket, overig, prio])

  const openMail = useMemo(
    () => inboxRows.find(m => m.mail_id === openId) || null, [inboxRows, openId])

  const onForceSync = async () => {
    setSyncing(true)
    try {
      const { data, error } = await supabase.rpc('request_mail_sync_now')
      if (error || (data && data.ok === false)) throw new Error(error?.message || data?.reason || 'Sync mislukt')
      setTimeout(() => refresh(), 4000)
    } catch (e) {
      showToast({ kind: 'error', message: 'Sync mislukt', detail: e.message })
    } finally {
      setTimeout(() => setSyncing(false), 4000)
    }
  }

  // ── De drie veegacties. Dezelfde RPC's die desktop al gebruikt. ───────────
  const doDelete = useCallback(async (m) => {
    setActioned(prev => new Set(prev).add(m.mail_id))
    try {
      const { data, error } = await supabase.rpc('submit_autodraft_decision', {
        p_mail_id: m.mail_id, p_action: 'ignore',
        p_target_folder: 'Verwijderde items', p_decision_kind: 'delete',
      })
      if (error || (data && data.ok === false)) throw new Error(error?.message || data?.reason || 'geweigerd')
      showToast({ kind: 'info', message: 'Mail verwijderd', detail: 'Naar Verwijderde items.' })
    } catch (e) {
      setActioned(prev => { const n = new Set(prev); n.delete(m.mail_id); return n })
      showToast({ kind: 'error', message: 'Verwijderen mislukt', detail: e.message })
    }
  }, [])

  const doMoveBucket = useCallback((m) => {
    const now = bucketOf(m, { bucketOverrides })
    setBucket(m.mail_id, now === 'overig' ? 'prio' : 'overig')
  }, [bucketOverrides, setBucket])

  const doSnooze = useCallback((m) => snooze(m.mail_id, tomorrowNine(), 'morgen 09:00'), [snooze])

  const BUCKETS = [
    { key: 'prio', label: 'Prioriteit', count: counts.prio },
    { key: 'overig', label: 'Overige', count: counts.overig },
  ]

  return (
    <div className="m-dash">
      <header className="m-pv__head">
        <div className="m-tk__head-top">
          <div className="m-tk__eyebrow">WERKRUIMTE<span>Postvak</span></div>
          <div className="m-pv__headacts">
            <button type="button" onClick={onForceSync} disabled={syncing} className="m-sync-btn">
              {syncing ? '...' : formatSyncTime(lastMailSync)}
            </button>
            <button type="button" className="m-iconbtn m-pv__more" aria-label="Meer"
                    onClick={() => setMenuOpen(true)}>
              <MIcon name="more" size={18} />
            </button>
          </div>
        </div>

        {mode === 'inbox' ? (
          <div className="m-pvseg m-tk__seg" role="tablist">
            {BUCKETS.map(b => (
              <button key={b.key} type="button" role="tab" aria-selected={bucket === b.key}
                      className={`m-pvseg__btn ${bucket === b.key ? 'is-active' : ''}`}
                      onClick={() => { setBucketTab(b.key); setSwipeId(null); setQuery('') }}>
                {b.label}<span className="m-tk__segcnt">{b.count}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="m-pv__sub">
            <button type="button" className="m-pv__back" onClick={() => setMode('inbox')}>
              <MIcon name="chevron" size={14} />Postvak IN
            </button>
            <span className="m-pv__subtitle">Verzonden</span>
          </div>
        )}

        {query && (
          <div className="m-pv__qchip">
            <MIcon name="search" size={13} />
            <span>“{query}” · {list.length} {list.length === 1 ? 'resultaat' : 'resultaten'}</span>
            <button type="button" aria-label="Zoeken wissen" onClick={() => setQuery('')}>
              <MIcon name="close" size={13} />
            </button>
          </div>
        )}
      </header>

      <div className="m-pv__body">
        {list.length === 0 && loading ? (
          <div className="m-skel-list">{[0, 1, 2, 3, 4].map(i => <div key={i} className="m-skel m-skel--thread" />)}</div>
        ) : list.length === 0 ? (
          <div className="m-tl__empty">
            {query ? 'Geen mail gevonden.'
              : mode === 'sent' ? 'Nog geen verzonden mails.'
                : bucket === 'overig' ? 'Niets in Overige — nieuwsbrieven en notificaties komen hier.'
                  : 'Postvak IN is leeg — net als in Outlook.'}
          </div>
        ) : mode === 'sent' ? (
          list.map(m => {
            const to = firstRecipient(m.to_recipients) || '—'
            return (
              <div key={m.mail_id} className="m-pvrow m-pvrow--static">
                <div className="m-pvrow__av">{initials(to)}</div>
                <div className="m-pvrow__main">
                  <div className="m-pvrow__top">
                    <span className="m-pvrow__name">Aan {to}</span>
                    <span className="m-pvrow__time">{timeAgo(receivedAtOf(m))}</span>
                  </div>
                  <div className="m-pvrow__subj">{subjectOf(m)}</div>
                  {bodyPreviewOf(m) && <div className="m-pvrow__snip">{bodyPreviewOf(m)}</div>}
                </div>
              </div>
            )
          })
        ) : (
          list.map(m => (
            <MobilePostvakRow
              key={m.mail_id} mail={m}
              bucket={bucketOf(m, { bucketOverrides })}
              cat={catLabel.get(m.category_key) || m.category_key || null}
              open={swipeId === m.mail_id}
              onSwipe={setSwipeId}
              onOpen={setOpenId}
              onDelete={doDelete} onMoveBucket={doMoveBucket} onSnooze={doSnooze}
            />
          ))
        )}
      </div>

      <MobilePostvakMenu
        open={menuOpen} mode={mode} query={query} sentCount={sentRows.length}
        onQuery={setQuery} onMode={setMode} onClose={() => setMenuOpen(false)}
      />
      {openMail && <MobileMailSheet mail={openMail} catLabel={catLabel} onClose={() => setOpenId(null)} />}
    </div>
  )
}
