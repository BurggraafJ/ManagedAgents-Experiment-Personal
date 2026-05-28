import { useNavigate } from 'react-router-dom'
import { useInboxBriefing } from '../../../../hooks/useInboxBriefing'

/**
 * InboxBriefingCard — Maestro home dagstand voor AutoDraft v3.
 *
 * Toont:
 *   - tier-counts: autopilot uitgevoerd / one-click wachtend / reasoned wachtend
 *   - hot signals: top mails met churn / negotiation / negative / urgent label
 *
 * Klik op een hot signal → /postvak met die conversation_id open.
 *
 * Render niets als er geen autopilot-activiteit en geen hot signals zijn —
 * voorkomt dat de card permanent zichtbaar is met "0/0/0" voor wie v3 nog niet
 * gebruikt.
 */
const SIGNAL_LABELS = {
  declared_churn:      { label: 'Churn-signaal',       tone: 'red' },
  usage_drop:          { label: 'Gebruik daalt',       tone: 'amber' },
  customer_negative:   { label: 'Negatief sentiment',  tone: 'red' },
  urgent_request:      { label: 'Urgente vraag',       tone: 'amber' },
  negotiation_active:  { label: 'In onderhandeling',   tone: 'blue' },
}

const PARTY_NL = {
  customer: 'klant',
  partner: 'partner',
  pilot: 'pilot',
  sales_opvolging: 'sales-opvolging',
  sales_lead: 'sales-lead',
  vendor: 'leverancier',
  recruitment: 'recruitment',
  intern: 'intern',
  onbekend: 'onbekend',
}

function HotSignalRow({ sig, onClick }) {
  const meta = SIGNAL_LABELS[sig.signal_label] || { label: sig.signal_label, tone: 'neutral' }
  const partyNL = PARTY_NL[sig.party_type] || sig.party_type
  return (
    <button
      type="button"
      className={`ibc-signal ibc-signal-${meta.tone}`}
      onClick={() => onClick(sig)}
    >
      <span className="ibc-signal-label">{meta.label}</span>
      <div className="ibc-signal-body">
        <strong>{sig.from_name || sig.from_email}</strong>
        <span className="ibc-signal-sub">
          {partyNL} · {sig.subject}
        </span>
        {sig.summary && <span className="ibc-signal-summary">{sig.summary}</span>}
      </div>
    </button>
  )
}

export default function InboxBriefingCard() {
  const { data, loading, error } = useInboxBriefing({ lookbackHours: 24 })
  const navigate = useNavigate()

  if (loading || error || !data) return null

  const tc = data.tier_counts || {}
  const hot = Array.isArray(data.hot_signals) ? data.hot_signals : []
  const anyActivity = (tc.autopilot_done || 0) + (tc.oneclick_waiting || 0) +
                      (tc.reasoned_waiting || 0) + (tc.user_acted || 0) + hot.length

  if (!anyActivity) return null

  const handleSignalClick = (sig) => {
    const url = sig.conversation_id
      ? `/postvak?conversation=${encodeURIComponent(sig.conversation_id)}`
      : '/postvak'
    navigate(url)
  }

  return (
    <section className="ibc-card">
      <header className="ibc-head">
        <h3>Inbox vandaag</h3>
        <span className="ibc-sub">laatste 24u · AutoDraft v3</span>
      </header>

      <div className="ibc-tiers">
        {(tc.autopilot_done > 0) && (
          <div className="ibc-tier ibc-tier-autopilot">
            <strong>{tc.autopilot_done}</strong>
            <span>afgehandeld zonder klik</span>
          </div>
        )}
        {(tc.oneclick_waiting > 0) && (
          <button
            type="button"
            className="ibc-tier ibc-tier-oneclick"
            onClick={() => navigate('/postvak')}
            title="Open Postvak"
          >
            <strong>{tc.oneclick_waiting}</strong>
            <span>één-klik wachten</span>
          </button>
        )}
        {(tc.reasoned_waiting > 0) && (
          <button
            type="button"
            className="ibc-tier ibc-tier-reasoned"
            onClick={() => navigate('/postvak')}
          >
            <strong>{tc.reasoned_waiting}</strong>
            <span>vraagt aandacht</span>
          </button>
        )}
        {(tc.user_acted > 0) && (
          <div className="ibc-tier ibc-tier-done">
            <strong>{tc.user_acted}</strong>
            <span>door jou afgerond</span>
          </div>
        )}
      </div>

      {hot.length > 0 && (
        <>
          <div className="ibc-divider" />
          <div className="ibc-signals-head">
            <span>Aandacht nodig</span>
          </div>
          <div className="ibc-signals">
            {hot.slice(0, 5).map(sig => (
              <HotSignalRow key={sig.mail_id} sig={sig} onClick={handleSignalClick} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
