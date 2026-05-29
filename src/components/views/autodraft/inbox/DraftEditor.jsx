import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../../lib/supabase'
import ContactInput from './ContactInput'
import ArrowBtn from './ArrowBtn'
import styles from '../autodraft.module.css'
import { useMaestroEnabled } from '../maestro/MaestroContext'
import AIPromptBar from '../maestro/AIPromptBar'
import { useMentionAutocomplete } from '../maestro/MentionAutocomplete'

// DraftEditor — inline compose-blok, geen eigen border. Wordt wrapped in
// `.md-thread` zodat draft + chain als één doorlopend leesblok voelen.
// className-prefix `mc-` om CSS-cache-stickyness van oude selectoren te vermijden.
export default function DraftEditor({
  mail, draftTo, setDraftTo, draftCc, setDraftCc,
  draftSubject, setDraftSubject, draftBody, setDraftBody,
  busy, activeLessons,
  variantIndex, setVariantIndex,
  hideVariantSwitcher = false,
}) {
  const variants = Array.isArray(mail.draft_variants) ? mail.draft_variants : []
  // AutoDraft v2 — variant-switcher (cards + arrows) verbergen wanneer
  // ActionProposals-tabs hierboven dezelfde keuze al biedt. Dubbel weg.
  const hasVariants = variants.length > 1 && !hideVariantSwitcher
  const [ccOpen, setCcOpen] = useState(() => !!(draftCc && draftCc.trim()))
  // V8.9 (2026-05-13): @-mention autocomplete in body-textarea. Hook
  // luistert op cursor + key events, opent dropdown bij '@', filtert op
  // mail_messages senders (last 6 maanden), inserts "@Naam ".
  const bodyRef = useRef(null)
  const mention = useMentionAutocomplete({
    textareaRef: bodyRef,
    value: draftBody,
    setValue: setDraftBody,
  })

  useEffect(() => {
    setCcOpen(!!(draftCc && draftCc.trim()))
  }, [mail.mail_id])

  async function switchVariant(newIndex) {
    if (newIndex === variantIndex) return
    if (newIndex < 0 || newIndex >= variants.length) return
    const v = variants[newIndex]
    setVariantIndex(newIndex)
    setDraftSubject(v?.subject || '')
    setDraftBody(v?.body || '')
    try {
      await supabase.rpc('set_autodraft_variant', {
        p_mail_id: mail.mail_id,
        p_variant_index: newIndex,
      })
    } catch (e) { /* best-effort, UI is al bijgewerkt */ }
  }

  const activeVariant = variants[variantIndex]
  const isMaestro = useMaestroEnabled()

  return (
    <div className="mc-compose">
      {hasVariants && (
        <>
          {/* V5 (2026-05-10): horizontale variant-cards bovenop bestaande
              variants-bar (pijltjes-flow blijft als compacte tweede regel).
              Mockup-conform: 3 click-to-switch cards met preview-tekst.
              Container .mc-variant-cards is een GRID van n variants (max 3 zichtbaar). */}
          <div className="mc-variant-cards">
            {variants.map((v, i) => {
              const previewLines = (v?.body || '').split('\n').slice(0, 2).join(' ')
              const preview = previewLines.length > 80
                ? previewLines.slice(0, 80).trim() + '…'
                : previewLines
              const active = i === variantIndex
              return (
                <button
                  key={i}
                  type="button"
                  className={`mc-variant-card ${active ? 'mc-variant-card--active' : ''}`}
                  onClick={() => switchVariant(i)}
                  title={v?.label || `Variant ${i + 1}`}
                >
                  <div className="mc-variant-card__top">
                    <span className="mc-variant-card__num">v{i + 1}</span>
                    <span className="mc-variant-card__title">
                      {v?.label || `Variant ${i + 1}`}
                    </span>
                    {active && (
                      <span className="mc-variant-card__pill">
                        <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
                        </svg>
                        actief
                      </span>
                    )}
                  </div>
                  <div className="mc-variant-card__preview">{preview || '(leeg)'}</div>
                </button>
              )
            })}
          </div>
          <div className={`mc-variants ${styles.variantsBar}`}>
            {/* F.5.a — vaste breedte op label-pill zodat pijltjes niet meer
                verschuiven bij wisselen tussen varianten met verschillende
                labellengtes ("Kort & direct" vs "Afgerond initiatief nemen"). */}
            <ArrowBtn dir="left" disabled={variantIndex <= 0} onClick={() => switchVariant(variantIndex - 1)} />
            <span
              className={styles.variantPill}
              title={activeVariant?.label || `Variant ${variantIndex + 1}`}>
              {activeVariant?.label || `Variant ${variantIndex + 1}`}
              {' '}<span className={styles.variantPillMuted}>· {variantIndex + 1}/{variants.length}</span>
            </span>
            <ArrowBtn dir="right" disabled={variantIndex >= variants.length - 1} onClick={() => switchVariant(variantIndex + 1)} />
            {activeLessons.length > 0 && (
              <span className={styles.variantLessons}>
                {activeLessons.length} {activeLessons.length === 1 ? 'regel' : 'regels'} toegepast
              </span>
            )}
          </div>
        </>
      )}

      {/* V1.54 — Aan + Cc op één rij (Outlook-stijl). Bij dichte Cc: alleen
       * Aan met +Cc-knop rechts. Bij open Cc: twee gelijke kolommen naast
       * elkaar in dezelfde fieldRow. */}
      <div className={`${styles.fieldRow} ${ccOpen ? styles.fieldRowSplit : ''}`}>
        <div className={styles.fieldCol}>
          <span className={styles.fieldLabel}>Aan</span>
          <ContactInput value={draftTo} onChange={setDraftTo}
            disabled={!!busy} placeholder={mail.from_email || 'ontvanger@…'} />
          {!ccOpen && (
            <button type="button" onClick={() => setCcOpen(true)} className={styles.fieldCcBtn}>
              + Cc
            </button>
          )}
        </div>
        {ccOpen && (
          <div className={styles.fieldCol}>
            <span className={styles.fieldLabel}>Cc</span>
            <ContactInput value={draftCc} onChange={setDraftCc}
              disabled={!!busy} placeholder="cc@…" />
            <button type="button" onClick={() => { setDraftCc(''); setCcOpen(false) }} className={styles.fieldCcBtn}>
              ×
            </button>
          </div>
        )}
      </div>

      <div className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Onderwerp</span>
        <input type="text" value={draftSubject} onChange={e => setDraftSubject(e.target.value)}
          disabled={!!busy} placeholder="Onderwerp"
          className={styles.fieldInput}
          style={{ fontWeight: 600 }} />
      </div>

      <textarea
        ref={bodyRef}
        value={draftBody}
        onChange={e => setDraftBody(e.target.value)}
        onKeyDown={mention.onKeyDown}
        onKeyUp={mention.onKeyUp}
        onClick={mention.onClick}
        disabled={!!busy}
        rows={Math.max(10, Math.min(24, (draftBody.split('\n').length || 1) + 2))}
        placeholder="Skill heeft nog geen draft gemaakt — typ zelf je antwoord. Tip: typ @ om iemand te taggen."
        className={styles.draftTextarea} />
      {mention.dropdown}

      {/* MCM-V6 (2026-05-10): inline AI-prompt-bar onder textarea, alleen
          getoond in maestro-mode. Submit triggert MaestroContext.actions.submitAmend
          die hetzelfde RPC-pad gebruikt als de bestaande "Aanpassen"-flow. */}
      {isMaestro && <AIPromptBar />}
    </div>
  )
}
