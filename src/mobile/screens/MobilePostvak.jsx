import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAutoDraft } from '../../hooks/useAutoDraft'
import { useMailBody } from '../../hooks/useMailBody'
import { sanitizeHtml, inferPseudoAudience } from '../../lib/autodraft'
import {
  fromNameOf, subjectOf as contractSubjectOf, bodyPreviewOf, receivedAtOf,
  normalizeListRow, buildInboxRows,
} from '../../lib/postvakContract'
import { keyboardInset } from '../../lib/keyboardInset'
import MIcon from '../MIcon'

// MobilePostvak — mobiele inbox (v1.121, design opt-a "switch TOP").
// Overzicht: iOS-segmented Inbox | Verzonden.
//
// F2 (productlock 2026-09-12): de Inbox is een **kopie van Outlook** — elke
// niet-verwijderde mail in de Inbox-root, in ontvangstvolgorde, via dezelfde
// `buildInboxRows` als desktop. Tot v1.196 stond hier `autodraft_mails` met
// `audience === 'for_you'`: dat toonde 4 van de 16 mails, met de nieuwste van
// vijf dagen oud, omdat de AutoDraft-skill sinds 2026-09-10 stilstond. Een
// lijst die van een skill afhangt, veroudert met die skill mee.
// Verzonden = mail_messages is_from_me. Hergebruikt useAutoDraft().
const LIST_CAP = 80
const SEGMENTS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'sent', label: 'Verzonden' },
]

const fromName = (m) => fromNameOf(m)
const subjectOf = (m) => contractSubjectOf(m)
const snippetOf = (m) => bodyPreviewOf(m)
const receivedOf = (m) => receivedAtOf(m)
const initials = (n) => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
const hasDraftOf = (m) => (Array.isArray(m.draft_variants) && m.draft_variants.length > 0) || !!m.draft_body

// Eerste ontvanger uit mail_messages.to_recipients — array van strings of
// objects met name/email/address (zelfde vormen als desktop pv2lib).
function firstRecipient(toRecip) {
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

// Outlook-bodies bevatten inline (cid:) afbeeldingen. Desktop haalt die
// on-demand op via de outlook-live EF; mobiel doet dat niet, dus strippen we ze
// na sanitize — anders staan er kapotte-plaatjes-icoontjes in de mail. Zelfde
// regel als Pv2Detail gebruikt voor niet-opgehaalde cid-imgs.
function mailHtml(html) {
  return sanitizeHtml(html).replace(/<img[^>]+src="cid:[^"]*"[^>]*>/gi, '')
}

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
  const now = new Date()
  const syncDate = new Date(iso)
  const diffMs = now - syncDate
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'nu'
  if (diffMin < 60) return `${diffMin} min geleden`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}u geleden`
  return syncDate.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

export default function MobilePostvak() {
  const { mails, mailMessages, categories, mailSyncState, refresh, loading } = useAutoDraft()
  const lastMailSync = useMemo(() => {
    const rows = mailSyncState || []
    return rows.reduce((acc, r) => {
      if (!r.last_delta_at) return acc
      return !acc || r.last_delta_at > acc ? r.last_delta_at : acc
    }, null)
  }, [mailSyncState])
  const [seg, setSeg] = useState('inbox')
  const [openId, setOpenId] = useState(null)
  const [syncing, setSyncing] = useState(false)

  const catLabel = useMemo(() => {
    const m = new Map()
    for (const c of (categories || [])) m.set(c.key || c.category_key, c.label || c.name)
    return m
  }, [categories])

  // Inbox = Outlook-mapdeelname. Eén implementatie, gedeeld met desktop:
  // lib/postvakContract.buildInboxRows. `audience` decoreert hooguit; hij
  // filtert nooit.
  const inboxList = useMemo(
    () => buildInboxRows(mailMessages, mails, { inferAudience: inferPseudoAudience }).slice(0, LIST_CAP),
    [mailMessages, mails])

  // Verzonden = door mij verstuurde mails uit de al-gefetchte mail_messages.
  const sentList = useMemo(() => {
    const rows = (mailMessages || [])
      .filter(m => m.is_from_me === true)
      .map(m => normalizeListRow({ ...m, mail_id: m.id }))
    return rows.sort((a, b) => new Date(receivedOf(b)) - new Date(receivedOf(a))).slice(0, LIST_CAP)
  }, [mailMessages])

  const list = seg === 'sent' ? sentList : inboxList
  // Openen uit de getoonde lijst, niet uit `mails`: anders is alleen een mail
  // met AutoDraft-rij te openen en blijft de rest een dode rij.
  const openMail = inboxList.find(m => m.mail_id === openId) || null

  const onForceSync = async () => {
    setSyncing(true)
    try {
      const { data, error } = await supabase.rpc('request_mail_sync_now')
      if (error || (data && data.ok === false)) throw new Error(error?.message || data?.reason || 'Sync mislukt')
      // De Edge-ETL is binnen enkele seconden klaar; ná die tijd pas ophalen,
      // anders ververs je precies de stand van vóór de sync.
      setTimeout(() => refresh(), 4000)
    } catch (e) {
      console.error('Sync error:', e)
    } finally {
      setTimeout(() => setSyncing(false), 4000)
    }
  }

  return (
    <div className="m-dash">
      <header className="m-pv__head">
        <div className="m-tk__head-top">
          <div className="m-tk__eyebrow">WERKRUIMTE<span>Postvak</span></div>
          <button type="button" onClick={onForceSync} disabled={syncing} className="m-sync-btn">
            {syncing ? '...' : formatSyncTime(lastMailSync)}
          </button>
        </div>
        <div className="m-pvseg" role="tablist">
          {SEGMENTS.map(s => (
            <button key={s.key} type="button" role="tab" aria-selected={seg === s.key}
              className={`m-pvseg__btn ${seg === s.key ? 'is-active' : ''}`} onClick={() => setSeg(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </header>

      <div className="m-pv__body">
        {list.length === 0 && loading ? (
          <div className="m-skel-list">{[0, 1, 2, 3, 4].map(i => <div key={i} className="m-skel m-skel--thread" />)}</div>
        ) : list.length === 0 ? (
          // Mapleeg, niet "geen voorstellen": de lijst is de Outlook-map.
          <div className="m-tl__empty">{seg === 'sent' ? 'Nog geen verzonden mails.' : 'Postvak IN is leeg — net als in Outlook.'}</div>
        ) : seg === 'sent' ? (
          sentList.map(m => {
            const to = firstRecipient(m.to_recipients) || '—'
            return (
              <div key={m.id} className="m-pvrow m-pvrow--static">
                <div className="m-pvrow__av">{initials(to)}</div>
                <div className="m-pvrow__main">
                  <div className="m-pvrow__top">
                    <span className="m-pvrow__name">Aan {to}</span>
                    <span className="m-pvrow__time">{timeAgo(receivedOf(m))}</span>
                  </div>
                  <div className="m-pvrow__subj">{subjectOf(m)}</div>
                  {snippetOf(m) && <div className="m-pvrow__snip">{snippetOf(m)}</div>}
                </div>
              </div>
            )
          })
        ) : (
          inboxList.map(m => {
            const cat = catLabel.get(m.category_key) || m.category_key || null
            return (
              <button key={m.mail_id} type="button" className="m-pvrow" onClick={() => setOpenId(m.mail_id)}>
                <div className="m-pvrow__av">{initials(fromName(m))}</div>
                <div className="m-pvrow__main">
                  <div className="m-pvrow__top">
                    <span className="m-pvrow__name">{fromName(m)}</span>
                    <span className="m-pvrow__time">{timeAgo(receivedOf(m))}</span>
                  </div>
                  <div className="m-pvrow__subj">{subjectOf(m)}</div>
                  {snippetOf(m) && <div className="m-pvrow__snip">{snippetOf(m)}</div>}
                  {(cat || hasDraftOf(m) || m.has_attachments) && (
                    <div className="m-pvrow__chips">
                      {cat && <span className="m-catpill">{cat}</span>}
                      {hasDraftOf(m) && <span className="m-catpill">Concept klaar</span>}
                      {m.has_attachments && <span className="m-catpill m-catpill--reassessed">Bijlage</span>}
                    </div>
                  )}
                </div>
                {/* Ongelezen = Outlook's is_read, niet "heeft een voorstel". */}
                {m.is_read === false && <span className="m-pvrow__dot" />}
              </button>
            )
          })
        )}
      </div>

      {openMail && <MailDetail mail={openMail} catLabel={catLabel} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function MailDetail({ mail, catLabel, onClose }) {
  const variants = Array.isArray(mail.draft_variants) ? mail.draft_variants : []
  const initialIdx = Math.max(0, Math.min(mail.selected_variant_index || 0, Math.max(0, variants.length - 1)))
  const initialBody = (variants[initialIdx]?.body) || mail.draft_body || ''
  const initialSubject = (variants[initialIdx]?.subject) || mail.draft_subject || subjectOf(mail)

  const [variantIdx, setVariantIdx] = useState(initialIdx)
  const [draftBody, setDraftBody] = useState(initialBody)
  const [draftSubject, setDraftSubject] = useState(initialSubject)
  // Concept start ingeklapt: Jelle leest eerst de mail, tikt daarna de header
  // open om het voorstel-antwoord te zien/bewerken.
  const [draftOpen, setDraftOpen] = useState(false)
  const cat = catLabel.get(mail.category_key) || mail.category_key

  // iOS-toetsenbord: til de sheet via visualViewport + verberg de tab bar + lock
  // achtergrond. Zelfde mechaniek als de Nieuwe-taak sheet.
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('m-modal-open')
    const vv = window.visualViewport
    const apply = () => {
      if (!vv) return
      root.style.setProperty('--m-kb', `${keyboardInset(vv)}px`)
    }
    apply()
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    return () => {
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      root.style.setProperty('--m-kb', '0px')
      root.classList.remove('m-modal-open')
    }
  }, [])

  // Variant-wissel: zet body/subject vanuit gekozen variant + best-effort persist.
  const pickVariant = (idx) => {
    if (idx < 0 || idx >= variants.length) return
    const v = variants[idx]
    setVariantIdx(idx)
    if (typeof v?.subject === 'string') setDraftSubject(v.subject)
    if (typeof v?.body === 'string') setDraftBody(v.body)
    supabase.rpc('set_autodraft_variant', { p_mail_id: mail.mail_id, p_variant_index: idx }).then(null, () => { /* silent */ })
  }

  const draft = draftBody

  // Volledige body komt uit mail_messages (truth-of-source), niet uit de
  // autodraft-lijstrow: die heeft alleen de op ~255 tekens afgekapte
  // body_preview. Zonder deze fetch toonde het sheet de preview alsóf het de
  // hele mail was — zichtbaar aan de afsluitende "…" en dan meteen het
  // Concept-kaartje. Zolang de fetch loopt tonen we de preview (geen lege
  // flash), daarna vervangt de echte body hem.
  const { full, loading: bodyLoading } = useMailBody(mail.mail_id)
  const bodyHtml = full?.body_html || mail.body_html || ''
  const fullText = full?.body_text || mail.body_text || ''
  const previewOnly = !bodyHtml && !fullText
  const bodyText = fullText || mail.body_preview || ''

  return (
    <>
      <div className="m-scrim" onClick={onClose} />
      <div className="m-mailsheet" role="dialog" aria-modal="true">
        <div className="m-mailsheet__head">
          <button type="button" className="m-iconbtn" onClick={onClose} aria-label="Terug"><MIcon name="chevron" size={18} /></button>
          <span className="m-mailsheet__crumb">{fromName(mail)}</span>
          <span style={{ width: 36 }} />
        </div>
        <div className="m-mailsheet__body">
          <div className="m-thread__chips" style={{ marginBottom: 6 }}>
            {cat && <span className="m-catpill">{cat}</span>}
          </div>
          <h1 className="m-mailsheet__subject">{subjectOf(mail)}</h1>
          <div className="m-mailsheet__from">
            <div className="m-thread__avatar">{initials(fromName(mail))}</div>
            <div className="m-mailsheet__fromtxt">
              <div className="m-mailsheet__fromname">{fromName(mail)}</div>
              <div className="m-mailsheet__frommail">{mail.from_email || ''}</div>
            </div>
          </div>

          <div className="m-mailsheet__mail">
            {bodyHtml ? (
              <div dangerouslySetInnerHTML={{ __html: mailHtml(bodyHtml) }} />
            ) : (
              bodyText.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)
            )}
            {previewOnly && bodyLoading && (
              <div className="m-mailsheet__bodynote">Volledige mail laden…</div>
            )}
            {previewOnly && !bodyLoading && (
              <div className="m-mailsheet__bodynote">Alleen het voorbeeld is beschikbaar — open de mail in Outlook.</div>
            )}
            {full?.body_truncated && (
              <div className="m-mailsheet__bodynote">Zeer lange mail — bij het synchroniseren afgekapt. Open in Outlook voor de rest.</div>
            )}
          </div>

          {draft || variants.length > 0 ? (
            <div className={`m-draft ${draftOpen ? '' : 'is-collapsed'}`}>
              <button type="button" className="m-draft__head m-draft__head--btn" onClick={() => setDraftOpen(o => !o)} aria-expanded={draftOpen}>
                <span className="m-draft__dot" />Concept van Maestro
                <span className="m-draft__hint">{draftOpen ? (variants.length > 1 ? `${variants.length} varianten · bewerk gerust` : 'bewerk gerust') : 'tik om te openen'}</span>
                <span className={`m-draft__chev ${draftOpen ? 'is-open' : ''}`}><MIcon name="chevron" size={13} /></span>
              </button>
              {draftOpen && (
                <>
                  {variants.length > 1 && (
                    <div className="m-variants">
                      {variants.map((v, i) => (
                        <button key={i} type="button" className={`m-variant ${variantIdx === i ? 'is-active' : ''}`} onClick={() => pickVariant(i)}>
                          {v.label || v.tone || `Variant ${i + 1}`}
                        </button>
                      ))}
                    </div>
                  )}
                  {draftSubject && <div className="m-draft__subj">{draftSubject}</div>}
                  <textarea
                    className="m-draft__textarea"
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    placeholder="Typ hier je antwoord…"
                    rows={10}
                  />
                </>
              )}
            </div>
          ) : (
            // Drie verschillende dingen, drie verschillende zinnen. Sinds de
            // lijst de hele Outlook-map is, is "geen concept" meestal gewoon
            // "hier is niets over voorgesteld" — geen negeer-advies.
            <div className="m-tl__empty" style={{ marginTop: 12 }}>
              {mail.__no_draft_yet
                ? 'Nog geen voorstel van Maestro voor deze mail.'
                : mail.suggested_action === 'skip'
                  ? 'Geen concept — Maestro stelt voor te verplaatsen.'
                  : 'Geen concept bij deze mail.'}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
