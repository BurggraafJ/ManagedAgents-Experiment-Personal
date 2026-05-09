import { useState, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import { showToast } from '../../../Toast'
import { modalBackdropStyle, modalCardStyle, modalLabelStyle, modalInputStyle, modalBtn } from './modalStyles'

const SPELCHECK_DEFAULT_INSTRUCTION =
  'Corrigeer alleen harde spel- en typefouten in de Nederlandse tekst. Behoud toon, structuur, opmaak en woordkeuze. Verander geen werkwoordstijden, alinea-indeling of stijl. Geef enkel de gecorrigeerde tekst terug, zonder commentaar.'

// Popover voor "✨ Spelcheck" — roept Edge Function `auto-draft-spelcheck` aan
// die OpenAI hardcoded met de default-instructie + optionele extra voorkeur
// uit de textarea aanroept. De default-instructie is bewerkbaar (read-only
// tonen, klik op "Bewerk default" → wordt editable + opgeslagen in agent_config).
export default function SpelcheckPopover({ draftBody, onClose, onApply }) {
  const [extra, setExtra] = useState('')
  const [defaultInstr, setDefaultInstr] = useState(SPELCHECK_DEFAULT_INSTRUCTION)
  const [editingDefault, setEditingDefault] = useState(false)
  const [defaultLoaded, setDefaultLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // Lees evt. opgeslagen default-instructie uit agent_config bij mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase
          .from('agent_config')
          .select('config_value')
          .eq('agent_name', 'auto-draft')
          .eq('config_key', 'spelcheck_default_instruction')
          .maybeSingle()
        if (cancelled) return
        const stored = data?.config_value?.text
        if (stored && typeof stored === 'string' && stored.trim()) {
          setDefaultInstr(stored)
        }
      } catch { /* fallback op de hardcoded default */ }
      if (!cancelled) setDefaultLoaded(true)
    })()
    return () => { cancelled = true }
  }, [])

  async function saveDefault() {
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.rpc('upsert_agent_config', {
        p_agent_name: 'auto-draft',
        p_config_key: 'spelcheck_default_instruction',
        p_config_value: { text: defaultInstr },
        p_updated_by: 'dashboard',
      })
      if (error) throw new Error(error.message)
      showToast({ message: 'Default-instructie opgeslagen' })
      setEditingDefault(false)
    } catch (e) {
      setErr(e.message)
    }
    setBusy(false)
  }

  async function apply() {
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.functions.invoke('auto-draft-spelcheck', {
        body: {
          draft_body: draftBody,
          default_instruction: defaultInstr,
          extra_instruction: extra.trim() || null,
        },
      })
      if (error) throw new Error(error.message)
      if (!data || !data.ok) throw new Error(data?.reason || 'spelcheck mislukt')
      onApply(data.corrected_body)
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={modalBackdropStyle}>
      <div onClick={e => e.stopPropagation()} style={{ ...modalCardStyle, maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }} aria-hidden>✨</span>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Spelcheck met AI</h3>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          ChatGPT loopt je draft door op spel- en typefouten. Default-instructie houdt
          toon en structuur intact. Optioneel kun je een extra voorkeur meegeven voor
          deze ene check (alleen voor nu, niet opgeslagen).
        </p>

        {/* Default-instructie — read-only met "Bewerk default" link */}
        <div style={{
          padding: 10, borderRadius: 6,
          background: 'var(--surface-1, #f8fafc)',
          border: '1px solid var(--border)',
          fontSize: 12, lineHeight: 1.5, color: 'var(--text)',
          marginBottom: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Default-instructie
            </span>
            {!editingDefault && defaultLoaded && (
              <button type="button" onClick={() => setEditingDefault(true)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--accent)', fontSize: 11, fontFamily: 'inherit', padding: 0,
                  textDecoration: 'underline',
                }}>
                Bewerk default
              </button>
            )}
          </div>
          {editingDefault ? (
            <>
              <textarea value={defaultInstr} onChange={e => setDefaultInstr(e.target.value)}
                rows={4} style={{ ...modalInputStyle, fontFamily: 'inherit', resize: 'vertical', fontSize: 12 }} />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button type="button" onClick={saveDefault} disabled={busy}
                  style={{ ...modalBtn, padding: '4px 10px', fontSize: 11, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' }}>
                  {busy ? 'Opslaan…' : 'Opslaan default'}
                </button>
                <button type="button"
                  onClick={() => { setDefaultInstr(SPELCHECK_DEFAULT_INSTRUCTION); setEditingDefault(false) }}
                  disabled={busy}
                  style={{ ...modalBtn, padding: '4px 10px', fontSize: 11, background: 'var(--bg)', color: 'var(--text)' }}>
                  Annuleer
                </button>
              </div>
            </>
          ) : (
            <div style={{ whiteSpace: 'pre-wrap' }}>{defaultInstr}</div>
          )}
        </div>

        <label style={modalLabelStyle}>Extra voorkeur voor deze keer (optioneel)</label>
        <textarea value={extra} onChange={e => setExtra(e.target.value)}
          rows={3} autoFocus
          placeholder={`bv. "Maak ook contracties weg ('t worden het)" of "Britse spelling".`}
          style={{ ...modalInputStyle, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }} />

        {err && <div style={{ color: 'var(--error, #b91c1c)', fontSize: 12, marginTop: 8 }}>⚠ {err}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ ...modalBtn, background: 'var(--bg)', color: 'var(--text)' }}>
            Annuleer
          </button>
          <button type="button" onClick={apply} disabled={busy || editingDefault}
            style={{ ...modalBtn, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Spelcheck draait…' : 'Toepassen'}
          </button>
        </div>
      </div>
    </div>
  )
}
