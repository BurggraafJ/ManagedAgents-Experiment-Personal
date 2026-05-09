import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { showToast } from '../../../Toast'
import { modalBackdropStyle, modalCardStyle, modalLabelStyle, modalInputStyle, modalBtn } from './modalStyles'

// Modal-overlay voor "💡 Voorkeur toevoegen" — laat Jelle een korte tekstuele
// voorkeur opslaan voor: deze mail-categorie / een specifieke draft-tone / globaal.
// Doet NIETS met de huidige mail; auto-draft pikt de voorkeur op bij de volgende
// scan-run en injecteert hem in de prompt voor mails van dezelfde scope.
export default function PreferenceQuickModal({ mail, categories, onClose }) {
  const initialCat = mail?.category_key || ''
  const variants = Array.isArray(mail?.draft_variants) ? mail.draft_variants : []
  const initialTone = (variants[mail?.selected_variant_index || 0]?.tone) || (variants[0]?.tone) || 'warm'

  const [scopeType, setScopeType] = useState(initialCat ? 'mail_category' : 'global')
  const [scopeValue, setScopeValue] = useState(scopeType === 'mail_category' ? initialCat : initialTone)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  function changeScope(t) {
    setScopeType(t)
    if (t === 'mail_category') setScopeValue(initialCat || (categories?.[0]?.category_key || 'onbekend'))
    else if (t === 'draft_tone') setScopeValue(initialTone)
    else setScopeValue('')
  }

  async function save() {
    if (!text.trim()) { setErr('Geef een voorkeur op.'); return }
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('add_category_preference', {
        p_scope_type: scopeType,
        p_scope_value: scopeType === 'global' ? null : scopeValue,
        p_preference_text: text.trim(),
        p_source: 'manual_quick',
        p_origin_mail_id: mail?.mail_id || null,
      })
      if (error) throw new Error(error.message)
      if (data && data.ok === false) throw new Error(data.reason || 'mislukt')
      const scopeLabel = scopeType === 'mail_category'
        ? (categories?.find(c => c.category_key === scopeValue)?.label || scopeValue)
        : scopeType === 'draft_tone' ? `tone "${scopeValue}"` : 'globaal'
      showToast({
        message: 'Voorkeur opgeslagen',
        detail: `Auto-draft past 'm vanaf de volgende scan toe op ${scopeLabel}.`,
      })
      onClose()
    } catch (e) {
      setErr(e.message)
    }
    setBusy(false)
  }

  // Toon alleen de tones die deze mail werkelijk heeft, anders de standaardset.
  const toneOptions = variants.length > 0
    ? variants.map(v => ({ value: v.tone || v.label, label: v.label || v.tone })).filter(o => o.value)
    : [{ value: 'concise', label: 'Kort & direct' }, { value: 'warm', label: 'Warm & uitgebreid' }, { value: 'done', label: 'Afgerond' }]

  return (
    <div onClick={onClose} style={modalBackdropStyle}>
      <div onClick={e => e.stopPropagation()} style={modalCardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }} aria-hidden>💡</span>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Voorkeur toevoegen</h3>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Geen actie op deze mail. Je voorkeur wordt opgeslagen en bij elke volgende scan
          door auto-draft meegenomen voor de gekozen scope.
        </p>

        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[
            { id: 'mail_category', label: 'Mail-categorie' },
            { id: 'draft_tone',    label: 'Draft-tone' },
            { id: 'global',        label: 'Globaal' },
          ].map(opt => {
            const on = scopeType === opt.id
            return (
              <button key={opt.id} type="button" onClick={() => changeScope(opt.id)}
                style={{
                  padding: '6px 12px', borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: on ? 'var(--accent-soft)' : 'var(--bg)',
                  color: on ? 'var(--accent)' : 'var(--text)',
                  fontFamily: 'inherit', fontSize: 12, fontWeight: on ? 600 : 400,
                  cursor: 'pointer',
                }}>{opt.label}</button>
            )
          })}
        </div>

        {scopeType === 'mail_category' && (
          <div style={{ marginBottom: 10 }}>
            <label style={modalLabelStyle}>Voor welke categorie</label>
            <select value={scopeValue} onChange={e => setScopeValue(e.target.value)}
              style={modalInputStyle}>
              {(categories || []).map(c => (
                <option key={c.category_key} value={c.category_key}>{c.label}</option>
              ))}
            </select>
          </div>
        )}
        {scopeType === 'draft_tone' && (
          <div style={{ marginBottom: 10 }}>
            <label style={modalLabelStyle}>Voor welke tone</label>
            <select value={scopeValue} onChange={e => setScopeValue(e.target.value)}
              style={modalInputStyle}>
              {toneOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        <label style={modalLabelStyle}>Je voorkeur</label>
        <textarea value={text} onChange={e => setText(e.target.value)}
          rows={4} autoFocus
          placeholder='bv. "Bij deze categorie altijd een concrete vervolgvraag stellen", of "Toon mag wat directer".'
          style={{ ...modalInputStyle, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }} />

        {err && <div style={{ color: 'var(--error, #b91c1c)', fontSize: 12, marginTop: 8 }}>⚠ {err}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ ...modalBtn, background: 'var(--bg)', color: 'var(--text)' }}>
            Annuleer
          </button>
          <button type="button" onClick={save} disabled={busy || !text.trim()}
            style={{ ...modalBtn, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', opacity: (busy || !text.trim()) ? 0.6 : 1 }}>
            {busy ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
      </div>
    </div>
  )
}
