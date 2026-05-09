import { useState, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import styles from './api-keys.module.css'
import ConfirmDeleteModal from './ConfirmDeleteModal'

export default function ProtectionAndDeleteRow({ row, applyOverride }) {
  const [protectedFlag, setProtectedFlag] = useState(row.delete_protection !== false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [confirming, setConfirming] = useState(false)

  // Sync wanneer parent row update krijgt via realtime
  useEffect(() => { setProtectedFlag(row.delete_protection !== false) }, [row.delete_protection])

  async function onToggleProtection(next) {
    // Optimistic — UI flipt direct
    setProtectedFlag(next)
    applyOverride?.(row.key_name, { delete_protection: next })
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('set_skill_secret_protection', {
        p_skill_name: row.skill_name,
        p_secret_name: row.secret_name,
        p_protected: next,
      })
      if (error) {
        setErr(error.message)
        setProtectedFlag(!next)
        applyOverride?.(row.key_name, { delete_protection: !next })
      } else if (data && data.ok === false) {
        setErr(data.reason || 'wijzigen mislukt')
        setProtectedFlag(!next)
        applyOverride?.(row.key_name, { delete_protection: !next })
      }
    } catch (e) {
      setErr(e.message)
      setProtectedFlag(!next)
      applyOverride?.(row.key_name, { delete_protection: !next })
    }
    setBusy(false)
  }

  return (
    <div className="api-keys__protection">
      <div className="api-keys__detail-label">Verwijder-bescherming</div>
      <div className={styles.protectionRow}>
        <label className={styles.protectionLabel}>
          <input
            type="checkbox"
            checked={protectedFlag}
            disabled={busy}
            onChange={e => onToggleProtection(e.target.checked)}
          />
          {protectedFlag ? '🔒 Vergrendeld — alleen jij kunt unsetten' : '🔓 Ontgrendeld — verwijderen mogelijk'}
        </label>
        {!protectedFlag && (
          <button
            type="button"
            className={`btn ${styles.protectionDeleteBtn}`}
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            Verwijder definitief
          </button>
        )}
        {err && <span className={styles.errorInline}>{err}</span>}
      </div>
      <div className={`muted ${styles.smallNoteSpaced}`}>
        Vergrendelde keys kunnen niet worden verwijderd door skills, Edge Functions, of Claude Code —
        alleen door jou via dit dashboard nadat je het slotje openzet. Edits/rotaties werken altijd.
      </div>

      {confirming && (
        <ConfirmDeleteModal
          row={row}
          onCancel={() => setConfirming(false)}
          onDone={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
