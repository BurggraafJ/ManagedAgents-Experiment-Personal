import { supabase } from '../../../lib/supabase'
import {
  DOW_NL,
  MONTH_NL_SHORT,
  formatTimeRange,
} from '../../../lib/agenda'
import styles from './AgendaView.module.css'

/**
 * AgendaProposalsModal — lijst van verstuurde datum-voorstellen
 * (status='sent') met een Intrekken-knop. Auto-sync met Outlook
 * gebeurt elders in AgendaView (useEffect op events × proposals).
 */
export default function AgendaProposalsModal({ proposals, onClose }) {
  const sent = (proposals || [])
    .filter(p => p.status === 'sent')
    .sort((a, b) => new Date(b.sent_at || b.created_at) - new Date(a.sent_at || a.created_at))

  const cancelProposal = async (id) => {
    if (!window.confirm('Voorstel intrekken (status → cancelled)?')) return
    await supabase.from('agenda_appointment_proposals')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id)
  }

  return (
    <div className="agenda-modal__backdrop" onClick={onClose}>
      <div className="agenda-modal agenda-modal--proposals" onClick={e => e.stopPropagation()}>
        <button type="button" className="agenda-modal__close" onClick={onClose} aria-label="Sluiten">×</button>
        <div className="agenda-modal__head">
          <h2 className="agenda-modal__title">Verstuurde datumvoorstellen</h2>
          <div className="agenda-modal__when">{sent.length} actief</div>
        </div>
        {sent.length === 0 ? (
          <p className={styles.proposalsEmptyHint}>
            Geen actieve voorstellen. Wanneer de agenda-skill een voorstel maakt op een mail
            (categorie "in te plannen afspraak"), verschijnt het hier.
          </p>
        ) : (
          <div className="agenda-proposals-list">
            {sent.map(p => {
              const slots = Array.isArray(p.proposed_slots) ? p.proposed_slots : []
              return (
                <div key={p.id} className="agenda-proposals-list__item">
                  <div className="agenda-proposals-list__head">
                    <strong>{p.recipient_name || p.recipient_email || '(onbekend)'}</strong>
                    <span className="agenda-proposals-list__meta">
                      {p.is_online ? 'Teams' : (p.physical_location || 'fysiek')}
                      {p.urgency_level === 'hoog' && ' · urgent'}
                    </span>
                  </div>
                  {p.subject_context && (
                    <div className="agenda-proposals-list__subject">{p.subject_context}</div>
                  )}
                  <ul className="agenda-proposals-list__slots">
                    {slots.map((s, i) => {
                      const start = new Date(s.start)
                      const end   = new Date(s.end)
                      const dow = DOW_NL[(start.getDay() + 6) % 7]
                      return (
                        <li key={i}>
                          {dow} {start.getDate()} {MONTH_NL_SHORT[start.getMonth()]} ·{' '}
                          {formatTimeRange(start, end)}
                          {s.label && <em className={styles.proposalSlotLabel}> — {s.label}</em>}
                        </li>
                      )
                    })}
                  </ul>
                  <div className="agenda-proposals-list__footer">
                    <span>verstuurd {p.sent_at ? new Date(p.sent_at).toLocaleDateString('nl-NL') : '—'}</span>
                    <button type="button" className="btn btn--ghost btn--xs" onClick={() => cancelProposal(p.id)}>
                      Intrekken
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <p className={`agenda-modal__body ${styles.autosyncNote}`}>
          <strong>Auto-sync:</strong> wanneer je in Outlook een afspraak inplant die overlapt met een
          voorgesteld slot, wordt het voorstel automatisch op "geaccepteerd" gezet en verdwijnen
          de blokken uit de agenda-overlay.
        </p>
      </div>
    </div>
  )
}
