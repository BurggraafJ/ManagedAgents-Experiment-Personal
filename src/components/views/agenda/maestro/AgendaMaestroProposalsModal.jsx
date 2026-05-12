import { supabase } from '../../../../lib/supabase'
import {
  DOW_NL,
  MONTH_NL_SHORT,
  formatTimeRange,
} from '../../../../lib/agenda'

/* AgendaMaestroProposalsModal — lijst van verstuurde datum-voorstellen
 * (status='sent') in Maestro-stijl. Functioneel = AgendaProposalsModal. */
export default function AgendaMaestroProposalsModal({ proposals, onClose }) {
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
    <div className="agm-modal__backdrop" onClick={onClose}>
      <div className="agm-modal agm-modal--proposals" onClick={e => e.stopPropagation()}>
        <button type="button" className="agm-modal__close" onClick={onClose} aria-label="Sluiten">×</button>
        <div className="agm-modal__head">
          <h2 className="agm-modal__title">Verstuurde datumvoorstellen</h2>
          <div className="agm-modal__when">{sent.length} actief</div>
        </div>
        {sent.length === 0 ? (
          <p className="agm-modal__hint">
            Geen actieve voorstellen. Wanneer de agenda-skill een voorstel maakt op een mail
            (categorie "in te plannen afspraak"), verschijnt het hier.
          </p>
        ) : (
          <div className="agm-proposals-list">
            {sent.map(p => {
              const slots = Array.isArray(p.proposed_slots) ? p.proposed_slots : []
              return (
                <div key={p.id} className="agm-proposals-list__item">
                  <div className="agm-proposals-list__head">
                    <strong>{p.recipient_name || p.recipient_email || '(onbekend)'}</strong>
                    <span className="agm-proposals-list__meta">
                      {p.is_online ? 'Teams' : (p.physical_location || 'fysiek')}
                      {p.urgency_level === 'hoog' && ' · urgent'}
                    </span>
                  </div>
                  {p.subject_context && (
                    <div className="agm-proposals-list__subject">{p.subject_context}</div>
                  )}
                  <ul className="agm-proposals-list__slots">
                    {slots.map((s, i) => {
                      const start = new Date(s.start)
                      const end   = new Date(s.end)
                      const dow = DOW_NL[(start.getDay() + 6) % 7]
                      return (
                        <li key={i}>
                          {dow} {start.getDate()} {MONTH_NL_SHORT[start.getMonth()]} ·{' '}
                          {formatTimeRange(start, end)}
                          {s.label && <em className="agm-proposals-list__label"> — {s.label}</em>}
                        </li>
                      )
                    })}
                  </ul>
                  <div className="agm-proposals-list__footer">
                    <span>verstuurd {p.sent_at ? new Date(p.sent_at).toLocaleDateString('nl-NL') : '—'}</span>
                    <button type="button" className="agm-btn agm-btn--ghost agm-btn--xs" onClick={() => cancelProposal(p.id)}>
                      Intrekken
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <p className="agm-modal__autosync">
          <strong>Auto-sync:</strong> wanneer je in Outlook een afspraak inplant die overlapt met een
          voorgesteld slot, wordt het voorstel automatisch op "geaccepteerd" gezet en verdwijnen
          de blokken uit de agenda-overlay.
        </p>
      </div>
    </div>
  )
}
