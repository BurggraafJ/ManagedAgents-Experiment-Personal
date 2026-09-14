import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useMailBody } from '../../hooks/useMailBody'
import { sanitizeHtml } from '../../lib/autodraft'
import { fromNameOf, subjectOf } from '../../lib/postvakContract'
import { keyboardInset } from '../../lib/keyboardInset'
import MIcon from '../MIcon'

// MobileMailSheet — de mail zelf, met het concept van Maestro eronder.
// Tot v1.201 stond dit als tweede component in MobilePostvak.jsx; door de
// veegacties en het overloopmenu liep dat bestand tegen de 400-regel-cap, dus
// het sheet staat nu apart. Gedrag ongewijzigd.

const initials = (n) => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()

// Outlook-bodies bevatten inline (cid:) afbeeldingen. Desktop haalt die
// on-demand op via de outlook-live EF; mobiel doet dat niet, dus strippen we ze
// na sanitize — anders staan er kapotte-plaatjes-icoontjes in de mail.
function mailHtml(html) {
  return sanitizeHtml(html).replace(/<img[^>]+src="cid:[^"]*"[^>]*>/gi, '')
}

export default function MobileMailSheet({ mail, catLabel, onClose }) {
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
  // body_preview. Zolang de fetch loopt tonen we de preview (geen lege flash),
  // daarna vervangt de echte body hem.
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
          <span className="m-mailsheet__crumb">{fromNameOf(mail)}</span>
          <span style={{ width: 36 }} />
        </div>
        <div className="m-mailsheet__body">
          <div className="m-thread__chips" style={{ marginBottom: 6 }}>
            {cat && <span className="m-catpill">{cat}</span>}
          </div>
          <h1 className="m-mailsheet__subject">{subjectOf(mail)}</h1>
          <div className="m-mailsheet__from">
            <div className="m-thread__avatar">{initials(fromNameOf(mail))}</div>
            <div className="m-mailsheet__fromtxt">
              <div className="m-mailsheet__fromname">{fromNameOf(mail)}</div>
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
