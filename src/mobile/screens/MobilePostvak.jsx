import { useState, useCallback, useMemo } from 'react'
import { useAutoDraft } from '../../hooks/useAutoDraft'
import { usePv2Snoozes } from '../../hooks/usePv2Snoozes'
import { usePv2BucketOverrides } from '../../hooks/usePv2Outlook'
import usePostvakMobileActions from '../../hooks/usePostvakMobileActions'
import { inferPseudoAudience } from '../../lib/autodraft'
import {
  buildInboxRows, buildSentRows, splitBuckets, bucketOf, matchesQuery,
  subjectOf, bodyPreviewOf, receivedAtOf,
} from '../../lib/postvakContract'
import MIcon from '../MIcon'
import MobilePostvakRow from './MobilePostvakRow'
import MobilePostvakMenu from './MobilePostvakMenu'
import MobilePostvakCompose from './MobilePostvakCompose'
import MobilePostvakFolders from './MobilePostvakFolders'
import MobileMailSheet from './MobileMailSheet'
import '../mobile-postvak-outlook.css'

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
// v1.203 (spoor 10, brief compose-fab):
//  • **Zwarte plus-FAB** zoals Taken → `MobilePostvakCompose`: nieuwe mail
//    opstellen, laten schrijven, taalchecken en versturen.
//  • De ⋯ is een **hamburger** geworden. Drie streepjes zeggen "hier zit een
//    menu", drie puntjes zeggen "hier zit nog iets".
//  • **De sync-tijd is uit de kop.** Hij stond daar permanent te vertellen hoe
//    laat iets gebeurde wat je pas wilt weten als je het je afvraagt — en de
//    kop is het duurste vastgoed van het scherm. Nu staat hij bovenaan het
//    menu, mét de knop om nú te synchroniseren.
//
// v1.205 (spoor 10, brief mobile-read-move-pin):
//  • De FAB vraagt eerst **Concept of Mail**. Versturen is sinds dit vel geen
//    theoretische knop meer, dus de keuze hoort vooraf en niet in de kop van
//    een scherm waar je al aan het typen bent.
//  • **Openen markeert gelezen in Outlook**, niet alleen hier. Tot nu bleef een
//    mail die je op de bank had gelezen vetgedrukt op je laptop staan.
//  • **Veeg → Verplaats** opent je echte Outlook-mappen (58 stuks) in plaats
//    van Uitstellen, dat alleen in Maestro bestond.
//
// Drie lokale overlays (`actioned`, `readIds`, `pinned`) houden de lijst bij de
// werkelijkheid vóórdat de mail-sync (±15 min) hem inhaalt. Ze zijn bewust
// **optimistisch met terugdraaien**: mislukt de Outlook-call, dan gaat de rij
// terug zoals hij was. Wat er niet gebeurt is een lijst die iets anders toont
// dan de mailbox en dat volhoudt.
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
  const { mails, mailMessages, categories, folders, mailSyncState, refresh, loading } = useAutoDraft()
  const { snoozedIds } = usePv2Snoozes()
  const { bucketOverrides, setBucket } = usePv2BucketOverrides()
  // Alle mutaties + de drie optimistische overlays zitten in de hook; dit
  // scherm gaat over wát je ziet, niet over wat er in Outlook gebeurt.
  const act = usePostvakMobileActions({ bucketOverrides, setBucket, refresh })

  const [bucket, setBucketTab] = useState('prio')   // primaire schakelaar
  const [mode, setMode] = useState('inbox')         // 'inbox' | 'sent' (overloop)
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)     // Concept | Mail
  const [compose, setCompose] = useState(null)      // null | 'draft' | 'send'
  const [openId, setOpenId] = useState(null)        // mail-sheet
  const [swipeId, setSwipeId] = useState(null)      // welke rij staat open
  const [folderFor, setFolderFor] = useState(null)  // mail die verplaatst wordt

  const lastMailSync = useMemo(() => (mailSyncState || []).reduce((acc, r) => (
    !r.last_delta_at ? acc : (!acc || r.last_delta_at > acc ? r.last_delta_at : acc)
  ), null), [mailSyncState])

  const catLabel = useMemo(() => {
    const m = new Map()
    for (const c of (categories || [])) m.set(c.key || c.category_key, c.label || c.name)
    return m
  }, [categories])

  // De overlays gaan er meteen overheen, vóór het splitsen en sorteren: anders
  // zou een mail die je net vastmaakte pas na de volgende sync bovenaan komen.
  const inboxRows = useMemo(
    () => act.applyOverlays(buildInboxRows(mailMessages, mails, { inferAudience: inferPseudoAudience })),
    [mailMessages, mails, act])

  // `snoozedIds` staat er nog in voor wie vóór v1.205 iets heeft uitgesteld:
  // die mails horen niet ineens terug te komen omdat de knop verdween. Er komt
  // niets meer bij — Uitstellen is vervangen door Verplaats.
  const hidden = useMemo(() => {
    const s = new Set(act.actioned)
    for (const id of snoozedIds) s.add(id)
    return s
  }, [act.actioned, snoozedIds])

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

  // Openen doet twee dingen: het vel tonen, en de mail in Outlook als gelezen
  // markeren. Dat tweede is nieuw in v1.205 — tot dan bleef een mail die je op
  // de bank had gelezen vetgedrukt op je laptop staan.
  const openMailRow = useCallback((mailId) => {
    setOpenId(mailId)
    act.openAndRead(inboxRows.find(m => m.mail_id === mailId))
  }, [act, inboxRows])

  // Geeft terug óf het lukte: de mapkiezer telt alleen gelukte verplaatsingen
  // mee voor zijn "meest gebruikt"-knoppen (v1.217).
  const pickFolder = useCallback(async (target) => {
    const ok = await act.moveMail(folderFor, target)
    if (ok) setFolderFor(null)
    return ok
  }, [act, folderFor])

  const BUCKETS = [
    { key: 'prio', label: 'Prioriteit', count: counts.prio },
    { key: 'overig', label: 'Overige', count: counts.overig },
  ]

  return (
    <div className="m-dash">
      <header className="m-pv__head">
        <div className="m-tk__head-top">
          <div className="m-pv__headacts">
            <button type="button" className="m-iconbtn m-pv__more" aria-label="Menu"
                    onClick={() => setMenuOpen(true)}>
              <MIcon name="menu" size={18} />
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
              unread={m.is_read === false}
              open={swipeId === m.mail_id}
              onSwipe={setSwipeId}
              onOpen={openMailRow}
              onDelete={act.remove} onMoveBucket={act.swapBucket} onMoveFolder={setFolderFor}
            />
          ))
        )}
      </div>

      {/* De FAB vraagt wát je maakt. Versturen en een concept wegzetten zijn
          sinds v1.205 twee echte uitkomsten; die keuze hoort vooraf, niet in de
          kop van een scherm waar je al aan het typen bent. */}
      {fabOpen && <div className="m-scrim m-scrim--soft" onClick={() => setFabOpen(false)} aria-hidden />}
      {fabOpen && (
        <div className="m-fabmenu" role="menu" aria-label="Nieuwe mail">
          <button type="button" className="m-fabmenu__item" role="menuitem"
                  onClick={() => { setFabOpen(false); setCompose('draft') }}>
            <MIcon name="pen" size={16} /><span>Concept</span>
            <em>Alleen in Outlook zetten</em>
          </button>
          <button type="button" className="m-fabmenu__item" role="menuitem"
                  onClick={() => { setFabOpen(false); setCompose('send') }}>
            <MIcon name="send" size={16} /><span>Mail</span>
            <em>Versturen · alleen @legal-mind.nl</em>
          </button>
        </div>
      )}
      <button type="button" className={`m-fab ${fabOpen ? 'is-open' : ''}`}
              aria-label={fabOpen ? 'Sluiten' : 'Nieuwe mail'} aria-expanded={fabOpen}
              onClick={() => setFabOpen(o => !o)}>
        <MIcon name={fabOpen ? 'close' : 'plus'} size={24} color="#fff" stroke={2.2} />
      </button>

      <MobilePostvakMenu
        open={menuOpen} mode={mode} query={query} sentCount={sentRows.length}
        syncLabel={act.syncing ? 'Bezig…' : formatSyncTime(lastMailSync)} syncing={act.syncing}
        onSync={act.forceSync}
        onQuery={setQuery} onMode={setMode} onClose={() => setMenuOpen(false)}
      />
      <MobilePostvakCompose open={!!compose} mode={compose || 'send'}
                            onClose={() => setCompose(null)} onSent={refresh} />
      <MobilePostvakFolders
        open={!!folderFor} folders={folders} mail={folderFor} busy={act.moving}
        onPick={pickFolder} onClose={() => { if (!act.moving) setFolderFor(null) }}
      />
      {openMail && (
        <MobileMailSheet mail={openMail} catLabel={catLabel}
                         pinned={act.isPinned(openMail)}
                         onTogglePin={() => act.togglePin(openMail)}
                         onMove={() => { setOpenId(null); setFolderFor(openMail) }}
                         onClose={() => setOpenId(null)} />
      )}
    </div>
  )
}
