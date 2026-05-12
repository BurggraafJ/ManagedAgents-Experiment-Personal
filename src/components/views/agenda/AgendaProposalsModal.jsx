import { supabase } from '../../../lib/supabase'
import {
  DOW_NL,
  MONTH_NL_SHORT,
  formatTimeRange,
} from '../../../lib/agenda'

/* AgendaProposalsModal — lijst van verstuurde datum-voorstellen
 * (status='sent') in Maestro-stijl. Functioneel = AgendaProposalsModal. */
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
    <div className="ag-modal__backdrop" onClick={onClose}>
      <div className="ag-modal ag-modal--proposals" onClick={e => e.stopPropagation()}>
        <button type="button" className="ag-modal__close" onClick={onClose} aria-label="Sluiten">×</button>
        <div className="ag-modal__head">
          <h2 className="ag-modal__title">Verstuurde datumvoorstellen</h2>
          <div className="ag-modal__when">{sent.length} actief</div>
        </div>
        {sent.length === 0 ? (
          <p className="ag-modal__hint">
            Geen actieve voorstellen. Wanneer de agenda-skill een voorstel maakt op een mail
            (categorie "in te plannen afspraak"), verschijnt het hier.
          </p>
        ) : (
          <div className="ag-proposals-list">
            {sent.map(p => {
              const slots = Array.isArray(p.proposed_slots) ? p.proposed_slots : []
              return (
                <div key={p.id} className="ag-proposals-list__item">
                  <div className="ag-proposals-list__head">
                    <strong>{p.recipient_name || p.recipient_email || '(onbekend)'}</strong>
                    <span className="ag-proposals-list__meta">
                      {p.is_online ? 'Teams' : (p.physical_location || 'fysiek')}
                      {p.urgency_level === 'hoog' && ' · urgent'}
                    </span>
                  </div>
                  {p.subject_context && (
                    <div className="ag-proposals-list__subject">{p.subject_context}</div>
                  )}
                  <ul className="ag-proposals-list__slots">
                    {slots.map((s, i) => {
                      const start = new Date(s.start)
                      const end   = new Date(s.end)
                      const dow = DOW_NL[(start.getDay() + 6) % 7]
                      return (
                        <li key={i}>
                          {dow} {start.getDate()} {MONTH_NL_SHORT[start.getMonth()]} ·{' '}
                          {formatTimeRange(start, end)}
                          {s.label && <em className="ag-proposals-list__label"> — {s.label}</em>}
                        </li>
                      )
                    })}
                  </ul>
                  <div className="ag-proposals-list__footer">
                    <span>verstuurd {p.sent_at ? new Date(p.sent_at).toLocaleDateString('nl-NL') : '—'}</span>
                    <button type="button" className="ag-btn ag-btn--ghost ag-btn--xs" onClick={() => cancelProposal(p.id)}>
                      Intrekken
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <p className="ag-modal__autosync">
          <strong>Auto-sync:</strong> wanneer je in Outlook een afspraak inplant die overlapt met een
          voorgesteld slot, wordt het voorstel automatisch op "geaccepteerd" gezet en verdwijnen
          de blokken uit de agenda-overlay.
        </p>
      </div>
    </div>
  )
}
