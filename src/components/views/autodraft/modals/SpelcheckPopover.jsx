import { useState, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import { showToast } from '../../../Toast'
import Modal from '../../../ui/Modal'
import styles from '../autodraft.module.css'

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
    <Modal open onClose={onClose} title="✨ Spelcheck met AI" size="md">
      <p className={styles.modalIntro}>
        ChatGPT loopt je draft door op spel- en typefouten. Default-instructie houdt
        toon en structuur intact. Optioneel kun je een extra voorkeur meegeven voor
        deze ene check (alleen voor nu, niet opgeslagen).
      </p>

      {/* Default-instructie — read-only met "Bewerk default" link */}
      <div className={styles.defaultInstrBox}>
        <div className={styles.defaultInstrHead}>
          <span className={styles.modalLabel} style={{ marginBottom: 0 }}>
            Default-instructie
          </span>
          {!editingDefault && defaultLoaded && (
            <button
              type="button"
              onClick={() => setEditingDefault(true)}
              className={styles.editDefaultLink}
            >
              Bewerk default
            </button>
          )}
        </div>
        {editingDefault ? (
          <>
            <textarea
              value={defaultInstr}
              onChange={e => setDefaultInstr(e.target.value)}
              rows={4}
              className={styles.modalTextarea}
              style={{ fontSize: 12 }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button
                type="button"
                onClick={saveDefault}
                disabled={busy}
                className={styles.modalBtnPrimary}
                style={{ padding: '4px 10px', fontSize: 11 }}
              >
                {busy ? 'Opslaan…' : 'Opslaan default'}
              </button>
              <button
                type="button"
                onClick={() => { setDefaultInstr(SPELCHECK_DEFAULT_INSTRUCTION); setEditingDefault(false) }}
                disabled={busy}
                className={styles.modalBtn}
                style={{ padding: '4px 10px', fontSize: 11 }}
              >
                Annuleer
              </button>
            </div>
          </>
        ) : (
          <div className={styles.defaultInstrText}>{defaultInstr}</div>
        )}
      </div>

      <label className={styles.modalLabel}>Extra voorkeur voor deze keer (optioneel)</label>
      <textarea
        value={extra}
        onChange={e => setExtra(e.target.value)}
        rows={3}
        autoFocus
        placeholder={`bv. "Maak ook contracties weg ('t worden het)" of "Britse spelling".`}
        className={styles.modalTextarea}
      />

      {err && <div className={styles.modalErr}>⚠ {err}</div>}

      <Modal.Footer>
        <button type="button" onClick={onClose} disabled={busy} className={styles.modalBtn}>
          Annuleer
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={busy || editingDefault}
          className={styles.modalBtnPrimary}
          style={{ opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Spelcheck draait…' : 'Toepassen'}
        </button>
      </Modal.Footer>
    </Modal>
  )
}
