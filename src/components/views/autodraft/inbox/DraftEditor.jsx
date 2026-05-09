import { useState, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import ContactInput from './ContactInput'
import ArrowBtn from './ArrowBtn'

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
  const fieldRow = {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    borderBottom: '1px solid var(--border)', padding: '6px 16px',
    minHeight: 30,
  }
  const labelStyle = {
    width: 64, color: 'var(--text-muted)', fontSize: 11.5, flexShrink: 0,
    fontWeight: 500,
  }
  const inputStyle = {
    flex: 1, border: 'none', outline: 'none', background: 'transparent',
    color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, padding: 0,
  }

  return (
    <div className="mc-compose">
      {hasVariants && (
        <div className="mc-variants" style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 16px', borderBottom: '1px solid var(--border)',
          background: 'color-mix(in srgb, var(--accent) 4%, var(--bg))',
          fontSize: 11, color: 'var(--text-muted)',
        }}>
          {/* F.5.a — vaste breedte op label-pill zodat pijltjes niet meer
              verschuiven bij wisselen tussen varianten met verschillende
              labellengtes ("Kort & direct" vs "Afgerond initiatief nemen"). */}
          <ArrowBtn dir="left" disabled={variantIndex <= 0} onClick={() => switchVariant(variantIndex - 1)} />
          <span style={{
            fontSize: 11, color: 'var(--text)',
            padding: '2px 10px', borderRadius: 999,
            background: 'var(--accent-soft)',
            fontWeight: 500, textAlign: 'center',
            width: 240, flexShrink: 0,
            display: 'inline-block',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          title={activeVariant?.label || `Variant ${variantIndex + 1}`}>
            {activeVariant?.label || `Variant ${variantIndex + 1}`}
            {' '}<span style={{ color: 'var(--text-muted)' }}>· {variantIndex + 1}/{variants.length}</span>
          </span>
          <ArrowBtn dir="right" disabled={variantIndex >= variants.length - 1} onClick={() => switchVariant(variantIndex + 1)} />
          {activeLessons.length > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: 11 }}>
              {activeLessons.length} {activeLessons.length === 1 ? 'regel' : 'regels'} toegepast
            </span>
          )}
        </div>
      )}

      <div style={fieldRow}>
        <span style={labelStyle}>Aan</span>
        <ContactInput value={draftTo} onChange={setDraftTo}
          disabled={!!busy} placeholder={mail.from_email || 'ontvanger@…'}
          style={inputStyle} />
        {!ccOpen && (
          <button type="button" onClick={() => setCcOpen(true)}
            style={{
              border: 'none', background: 'transparent',
              color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
              padding: '2px 6px', fontFamily: 'inherit',
            }}>+ Cc</button>
        )}
      </div>

      {ccOpen && (
        <div style={fieldRow}>
          <span style={labelStyle}>Cc</span>
          <ContactInput value={draftCc} onChange={setDraftCc}
            disabled={!!busy} placeholder="cc@…"
            style={inputStyle} />
          <button type="button" onClick={() => { setDraftCc(''); setCcOpen(false) }}
            style={{
              border: 'none', background: 'transparent',
              color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
              padding: '2px 6px', fontFamily: 'inherit',
            }}>×</button>
        </div>
      )}

      <div style={fieldRow}>
        <span style={labelStyle}>Onderwerp</span>
        <input type="text" value={draftSubject} onChange={e => setDraftSubject(e.target.value)}
          disabled={!!busy} placeholder="Onderwerp"
          style={{ ...inputStyle, fontWeight: 600 }} />
      </div>

      <textarea value={draftBody} onChange={e => setDraftBody(e.target.value)} disabled={!!busy}
        rows={Math.max(10, Math.min(24, (draftBody.split('\n').length || 1) + 2))}
        placeholder="Skill heeft nog geen draft gemaakt — typ zelf je antwoord."
        style={{
          width: '100%', padding: '14px 16px',
          border: 'none', outline: 'none',
          background: 'transparent', color: 'var(--text)',
          fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.6,
          resize: 'vertical', minHeight: 200,
          display: 'block',
        }} />
    </div>
  )
}
