import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { showToast } from '../../../Toast'

// Knop + modal-paar. Gebruikt in de Postvak-toolbar voor ad-hoc
// herschrijven/taalcheck van een geplakte mail.
export function MailImproverButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button"
        onClick={() => setOpen(true)}
        title="Plak een mail die je wil herschrijven of taalchecken; AI verbetert in jouw eigen stijl."
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 14px',
          borderRadius: 8,
          border: '1px solid #1d4ed8',
          background: '#2563eb',
          color: '#ffffff',
          fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 1px 2px rgba(37, 99, 235, 0.25)',
        }}>
        <span aria-hidden style={{ fontSize: 14 }}>✉</span>
        <span>Verstuur mail</span>
      </button>
      {open && <MailImproverModal onClose={() => setOpen(false)} />}
    </>
  )
}

export default function MailImproverModal({ onClose }) {
  const [original, setOriginal] = useState('')
  const [extra, setExtra] = useState('')
  const [improved, setImproved] = useState('')
  const [examples, setExamples] = useState(0)
  const [exampleSubjects, setExampleSubjects] = useState([])
  // Welke mode produceerde de huidige output? Bepaalt of '🔄 Minder aanpassen'
  // verschijnt (alleen bij 'verbeter' — taalcheck heeft al strikte validatie).
  // 'verbeter' = stijl-rewrite met RAG-voorbeelden
  // 'taalcheck' = pure spelfix-validatie zonder herschrijving
  const [mode, setMode] = useState(null)
  const [validation, setValidation] = useState(null)
  const [busy, setBusy] = useState(null)  // null | 'verbeter' | 'taalcheck' | 'less'
  const [err, setErr] = useState(null)

  async function runVerbeter(extraOverride = null) {
    if (!original.trim()) { setErr('Plak eerst een mail om te verbeteren.'); return }
    const tag = extraOverride !== null ? 'less' : 'verbeter'
    setBusy(tag); setErr(null)
    try {
      const finalExtra = extraOverride !== null
        ? extraOverride
        : (extra.trim() || null)
      const { data, error } = await supabase.functions.invoke('mail-verbeteraar', {
        body: { original_mail: original, extra_prompt: finalExtra },
      })
      if (error) throw new Error(error.message)
      if (!data || !data.ok) throw new Error(data?.reason || 'mislukt')
      setImproved(data.improved_mail || '')
      setExamples(data.examples_used || 0)
      setExampleSubjects(Array.isArray(data.example_subjects) ? data.example_subjects : [])
      setMode('verbeter')
      setValidation(null)
    } catch (e) {
      setErr(e.message)
    }
    setBusy(null)
  }

  async function runTaalcheck() {
    if (!original.trim()) { setErr('Plak eerst een mail om te checken.'); return }
    setBusy('taalcheck'); setErr(null)
    try {
      const { data, error } = await supabase.functions.invoke('mail-taalcheck', {
        body: { original_mail: original },
      })
      if (error) throw new Error(error.message)
      if (!data || !data.ok) {
        // Server-side validatie kan failen ('te veel afgeweken') — toon dat eerlijk
        const detail = data?.detail ? ` (${data.detail})` : ''
        throw new Error(`AI-output week te veel af van origineel${detail}. Doe handmatig een check.`)
      }
      setImproved(data.corrected_body || '')
      setExamples(0)
      setExampleSubjects([])
      setMode('taalcheck')
      setValidation(data.validation || null)
      if (data.changed === false) {
        showToast({ kind: 'info', message: 'Geen taalfouten gevonden', detail: 'Tekst is woord-voor-woord gelijk gebleven.' })
      }
    } catch (e) {
      setErr(e.message)
    }
    setBusy(null)
  }

  function copyImproved() {
    if (!improved) return
    navigator.clipboard.writeText(improved).then(
      () => showToast({ message: 'Bijgewerkte mail gekopieerd' }),
      () => showToast({ kind: 'error', message: 'Kopieren mislukt' })
    )
  }

  function tooMuchChanged() {
    // Forceer een veel conservatievere herschrijving — neem evt. user's extra mee
    const userExtra = extra.trim()
    const lessPrompt = [
      'KRITIEKE INSTRUCTIE: vorige versie week te veel af van origineel.',
      'Blijf nu ULTRA dicht bij de input. Verander alleen wat strikt onduidelijk of ongrammaticaal is.',
      'Behoud zinsbouw, woordkeuze, lengte, alinea-indeling, toon. Maak hoogstens micro-aanpassingen.',
      userExtra ? `\nOverige voorkeur: ${userExtra}` : '',
    ].filter(Boolean).join('\n')
    runVerbeter(lessPrompt)
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(15, 23, 42, 0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg)', color: 'var(--text)',
        border: '1px solid var(--border)', borderRadius: 10,
        width: '100%', maxWidth: 760, maxHeight: '88vh',
        padding: 22, boxShadow: '0 24px 48px rgba(0,0,0,0.18)',
        fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: 12,
        overflow: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }} aria-hidden>✉</span>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Verstuur mail</h3>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
            Verbeter of taalcheck — RAG over 5 vergelijkbare verzonden mails
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Plak hieronder de mail die je wil herschrijven. AI vindt de 5 meest
          vergelijkbare mails die je eerder verstuurde en herschrijft in jouw stijl.
          Optioneel: geef een extra voorkeur (bv. "korter", "informeler", "geen ja-vragen").
        </p>

        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
            Originele mail
          </label>
          <textarea value={original} onChange={e => setOriginal(e.target.value)}
            rows={8} autoFocus disabled={busy}
            placeholder="Plak hier de mail die je wil verbeteren…"
            style={{
              width: '100%', padding: '10px 12px',
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg)', color: 'var(--text)',
              fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5, resize: 'vertical',
            }} />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
            Extra voorkeur (optioneel)
          </label>
          <textarea value={extra} onChange={e => setExtra(e.target.value)}
            rows={2} disabled={busy}
            placeholder='bv. "Korter en directer", "Voeg een concrete vervolgvraag toe", "Geen Engelse leenwoorden"…'
            style={{
              width: '100%', padding: '8px 10px',
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg)', color: 'var(--text)',
              fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5, resize: 'vertical',
            }} />
        </div>

        {err && <div style={{ color: 'var(--error, #b91c1c)', fontSize: 12.5 }}>⚠ {err}</div>}

        {improved && (
          <div style={{
            border: '1px solid var(--accent)',
            borderRadius: 8,
            background: 'color-mix(in srgb, var(--accent) 4%, var(--bg))',
            padding: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 12.5, color: 'var(--accent)' }}>
                {mode === 'taalcheck' ? 'Taalcheck-resultaat' : 'Verbeterde versie'}
              </strong>
              {mode === 'verbeter' && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  — {examples} {examples === 1 ? 'voorbeeld' : 'voorbeelden'} uit je verzonden mails
                </span>
              )}
              {mode === 'taalcheck' && validation && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  — lengte {Math.round(validation.length_ratio * 100)}%, woord-overlap {Math.round(validation.word_overlap * 100)}% (validatie ok)
                </span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {mode === 'verbeter' && (
                  <button type="button" onClick={tooMuchChanged} disabled={!!busy}
                    title="AI heeft te veel veranderd — herschrijf veel conservatiever"
                    style={{
                      padding: '4px 10px', borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg)', color: 'var(--text)',
                      fontFamily: 'inherit', fontSize: 11.5, fontWeight: 500,
                      cursor: busy ? 'not-allowed' : 'pointer',
                      opacity: busy ? 0.6 : 1,
                    }}>
                    {busy === 'less' ? 'Bezig…' : '🔄 Te veel aangepast'}
                  </button>
                )}
                <button type="button" onClick={copyImproved}
                  style={{
                    padding: '4px 10px', borderRadius: 6,
                    border: '1px solid var(--accent)',
                    background: 'var(--accent)', color: '#fff',
                    fontFamily: 'inherit', fontSize: 11.5, fontWeight: 500, cursor: 'pointer',
                  }}>📋 Kopieer</button>
              </div>
            </div>
            <div style={{
              whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.6,
              color: 'var(--text)',
              padding: 8, background: 'var(--bg)',
              borderRadius: 6, border: '1px solid var(--border)',
            }}>{improved}</div>
            {mode === 'verbeter' && exampleSubjects.length > 0 && (
              <details style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                <summary style={{ cursor: 'pointer' }}>Welke mails als voorbeeld?</summary>
                <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                  {exampleSubjects.map((s, i) => <li key={i}>{s || '(zonder onderwerp)'}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" onClick={onClose} disabled={!!busy}
            style={{
              padding: '8px 16px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg)',
              color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
            }}>Sluit</button>
          <button type="button" onClick={runTaalcheck} disabled={!!busy || !original.trim()}
            title="Pure taalcheck — alleen spel- en grammatica-fouten, geen herschrijving. Output wordt server-side gevalideerd."
            style={{
              padding: '8px 16px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--surface-1)',
              color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', opacity: (busy || !original.trim()) ? 0.6 : 1,
            }}>
            {busy === 'taalcheck' ? 'Taalcheck draait…' : '📝 Taalcheck'}
          </button>
          <button type="button" onClick={() => runVerbeter()} disabled={!!busy || !original.trim()}
            title="Herschrijf in jouw stijl op basis van 5 vergelijkbare verzonden mails."
            style={{
              padding: '8px 18px', borderRadius: 6,
              border: '1px solid var(--accent)', background: 'var(--accent)',
              color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', opacity: (busy || !original.trim()) ? 0.6 : 1,
            }}>
            {busy === 'verbeter'
              ? 'Verbeteren…'
              : (mode === 'verbeter' ? 'Opnieuw verbeteren' : '✨ Verbeter')}
          </button>
        </div>
      </div>
    </div>
  )
}
