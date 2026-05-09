import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { showToast } from '../../../Toast'
import Modal from '../../../ui/Modal'
import styles from '../autodraft.module.css'

// Knop + modal-paar. Gebruikt in de Postvak-toolbar voor ad-hoc
// herschrijven/taalcheck van een geplakte mail.
export function MailImproverButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Plak een mail die je wil herschrijven of taalchecken; AI verbetert in jouw eigen stijl."
        className={styles.improverBtn}
      >
        <span aria-hidden className={styles.improverBtnIcon}>✉</span>
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
  const [mode, setMode] = useState(null)
  const [validation, setValidation] = useState(null)
  const [busy, setBusy] = useState(null)
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
    <Modal open onClose={onClose} title="✉ Verstuur mail" size="lg">
      <div className={styles.modalGap}>
        <p className={`${styles.modalIntro} ${styles.modalIntroFlush}`}>
          Plak hieronder de mail die je wil herschrijven. AI vindt de 5 meest
          vergelijkbare mails die je eerder verstuurde en herschrijft in jouw stijl.
          Optioneel: geef een extra voorkeur (bv. "korter", "informeler", "geen ja-vragen").
        </p>

        <div>
          <label className={styles.modalLabel}>Originele mail</label>
          <textarea
            value={original}
            onChange={e => setOriginal(e.target.value)}
            rows={8}
            autoFocus
            disabled={busy}
            placeholder="Plak hier de mail die je wil verbeteren…"
            className={styles.modalTextareaLg}
          />
        </div>

        <div>
          <label className={styles.modalLabel}>Extra voorkeur (optioneel)</label>
          <textarea
            value={extra}
            onChange={e => setExtra(e.target.value)}
            rows={2}
            disabled={busy}
            placeholder='bv. "Korter en directer", "Voeg een concrete vervolgvraag toe", "Geen Engelse leenwoorden"…'
            className={styles.modalTextarea}
          />
        </div>

        {err && <div className={styles.modalErr}>⚠ {err}</div>}

        {improved && (
          <div className={styles.improverResultBox}>
            <div className={styles.improverResultHead}>
              <strong className={styles.improverResultTitle}>
                {mode === 'taalcheck' ? 'Taalcheck-resultaat' : 'Verbeterde versie'}
              </strong>
              {mode === 'verbeter' && (
                <span className={styles.improverResultMeta}>
                  — {examples} {examples === 1 ? 'voorbeeld' : 'voorbeelden'} uit je verzonden mails
                </span>
              )}
              {mode === 'taalcheck' && validation && (
                <span className={styles.improverResultMeta}>
                  — lengte {Math.round(validation.length_ratio * 100)}%, woord-overlap {Math.round(validation.word_overlap * 100)}% (validatie ok)
                </span>
              )}
              <div className={styles.improverResultActions}>
                {mode === 'verbeter' && (
                  <button
                    type="button"
                    onClick={tooMuchChanged}
                    disabled={!!busy}
                    title="AI heeft te veel veranderd — herschrijf veel conservatiever"
                    className={styles.improverSecondaryBtn}
                    style={{ opacity: busy ? 0.6 : 1 }}
                  >
                    {busy === 'less' ? 'Bezig…' : '🔄 Te veel aangepast'}
                  </button>
                )}
                <button type="button" onClick={copyImproved} className={styles.improverCopyBtn}>
                  📋 Kopieer
                </button>
              </div>
            </div>
            <div className={styles.improverResultBody}>{improved}</div>
            {mode === 'verbeter' && exampleSubjects.length > 0 && (
              <details className={styles.improverDetails}>
                <summary className={styles.improverSummary}>Welke mails als voorbeeld?</summary>
                <ul className={styles.improverExamplesList}>
                  {exampleSubjects.map((s, i) => <li key={i}>{s || '(zonder onderwerp)'}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      <Modal.Footer>
        <button type="button" onClick={onClose} disabled={!!busy} className={styles.modalBtn}>
          Sluit
        </button>
        <button
          type="button"
          onClick={runTaalcheck}
          disabled={!!busy || !original.trim()}
          title="Pure taalcheck — alleen spel- en grammatica-fouten, geen herschrijving. Output wordt server-side gevalideerd."
          className={`${styles.modalBtn} ${styles.improverTaalcheckBg}`}
          style={{ opacity: (busy || !original.trim()) ? 0.6 : 1 }}
        >
          {busy === 'taalcheck' ? 'Taalcheck draait…' : '📝 Taalcheck'}
        </button>
        <button
          type="button"
          onClick={() => runVerbeter()}
          disabled={!!busy || !original.trim()}
          title="Herschrijf in jouw stijl op basis van 5 vergelijkbare verzonden mails."
          className={`${styles.modalBtnPrimary} ${styles.improverVerbeterBtn}`}
          style={{ opacity: (busy || !original.trim()) ? 0.6 : 1 }}
        >
          {busy === 'verbeter'
            ? 'Verbeteren…'
            : (mode === 'verbeter' ? 'Opnieuw verbeteren' : '✨ Verbeter')}
        </button>
      </Modal.Footer>
    </Modal>
  )
}
