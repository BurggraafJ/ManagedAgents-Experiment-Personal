import { useState, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import ContactInput from './ContactInput'
import ArrowBtn from './ArrowBtn'
import styles from '../autodraft.module.css'

// DraftEditor — inline compose-blok, geen eigen border. Wordt wrapped in
// `.md-thread` zodat draft + chain als één doorlopend leesblok voelen.
// className-prefix `mc-` om CSS-cache-stickyness van oude selectoren te vermijden.
export default function DraftEditor({
  mail, draftTo, setDraftTo, draftCc, setDraftCc,
  draftSubject, setDraftSubject, draftBody, setDraftBody,
  busy, activeLessons,
  variantIndex, setVariantIndex,
}) {
  const variants = Array.isArray(mail.draft_variants) ? mail.draft_variants : []
  const hasVariants = variants.length > 1
  const [ccOpen, setCcOpen] = useState(() => !!(draftCc && draftCc.trim()))

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

  return (
    <div className="mc-compose">
      {hasVariants && (
        <div className={`mc-variants ${styles.variantsBar}`}>
          {/* F.5.a — vaste breedte op label-pill zodat pijltjes niet meer
              verschuiven bij wisselen tussen varianten met verschillende
              labellengtes ("Kort & direct" vs "Afgerond initiatief nemen"). */}
          <ArrowBtn dir="left" disabled={variantIndex <= 0} onClick={() => switchVariant(variantIndex - 1)} />
          <span
            className={styles.variantPill}
            title={activeVariant?.label || `Variant ${variantIndex + 1}`}>
            {activeVariant?.label || `Variant ${variantIndex + 1}`}
            {' '}<span style={{ color: 'var(--text-muted)' }}>· {variantIndex + 1}/{variants.length}</span>
          </span>
          <ArrowBtn dir="right" disabled={variantIndex >= variants.length - 1} onClick={() => switchVariant(variantIndex + 1)} />
          {activeLessons.length > 0 && (
            <span className={styles.variantLessons}>
              {activeLessons.length} {activeLessons.length === 1 ? 'regel' : 'regels'} toegepast
            </span>
          )}
        </div>
      )}

      <div className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Aan</span>
        <ContactInput value={draftTo} onChange={setDraftTo}
          disabled={!!busy} placeholder={mail.from_email || 'ontvanger@…'}
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, padding: 0 }} />
        {!ccOpen && (
          <button type="button" onClick={() => setCcOpen(true)} className={styles.fieldCcBtn}>
            + Cc
          </button>
        )}
      </div>

      {ccOpen && (
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>Cc</span>
          <ContactInput value={draftCc} onChange={setDraftCc}
            disabled={!!busy} placeholder="cc@…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, padding: 0 }} />
          <button type="button" onClick={() => { setDraftCc(''); setCcOpen(false) }} className={styles.fieldCcBtn}>
            ×
          </button>
        </div>
      )}

      <div className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Onderwerp</span>
        <input type="text" value={draftSubject} onChange={e => setDraftSubject(e.target.value)}
          disabled={!!busy} placeholder="Onderwerp"
          className={styles.fieldInput}
          style={{ fontWeight: 600 }} />
      </div>

      <textarea value={draftBody} onChange={e => setDraftBody(e.target.value)} disabled={!!busy}
        rows={Math.max(10, Math.min(24, (draftBody.split('\n').length || 1) + 2))}
        placeholder="Skill heeft nog geen draft gemaakt — typ zelf je antwoord."
        className={styles.draftTextarea} />
    </div>
  )
}
