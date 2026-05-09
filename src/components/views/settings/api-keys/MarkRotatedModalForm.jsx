import { useState } from 'react'
import styles from './api-keys.module.css'

export default function MarkRotatedModalForm({ row, busy, onSubmit }) {
  const [last4, setLast4] = useState('')
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="api-keys__modal-cannot" style={{ marginBottom: 14 }}>
        <strong>Edge Function secret</strong> — de waarde plak je in het Supabase dashboard
        onder <em>Project Settings → Edge Functions → Secrets</em>. Daarna vul je hieronder
        de laatste 4 tekens in zodat het overzicht deze rotatie als 🟢 Veilig markeert.
      </div>
      {row.rotation_url && (
        <div style={{ marginBottom: 12 }}>
          <a
            href={row.rotation_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`btn btn--ghost ${styles.btnSmall}`}
          >
            ↗ Open vendor-dashboard om nieuwe key te genereren
          </a>
        </div>
      )}
      <label className={styles.formLabel}>
        <div className={`kpi__label ${styles.labelMargin}`}>Laatste 4 tekens van de nieuwe waarde</div>
        <input
          type="text"
          value={last4}
          onChange={e => setLast4(e.target.value.slice(-4))}
          maxLength={4}
          placeholder="abcd"
          autoFocus
          disabled={busy}
          className={`settings-input ${styles.inputMonoSm}`}
        />
      </label>
      <button
        className="btn btn--accent"
        onClick={() => onSubmit(last4)}
        disabled={busy || last4.length === 0}
      >
        {busy ? 'Markeren…' : 'Markeer geroteerd'}
      </button>
    </div>
  )
}
