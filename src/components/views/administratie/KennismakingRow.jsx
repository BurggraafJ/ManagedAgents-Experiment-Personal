import { hasKennismakingKeyword, CAT_META, ACTION_HINT } from '../../../lib/hubspotInbox'
import styles from './HubSpotInboxFutureView.module.css'

/**
 * Eén rij in de "Eerste kennismakingen" óf "Andere externe afspraken"-tabel.
 * Visueel identiek aan de oude inline-versie; alleen styling is verplaatst
 * naar HubSpotInboxFutureView.module.css + utility-classes.
 */
export default function KennismakingRow({
  event,
  externals,
  cls,
  skip,
  isDismissed,
  hasProposal,
  pipelineLookup,
  hsIndex,
  onDismiss,
  onUndoDismiss,
}) {
  const when = new Date(event.start_time)
  const dateLabel = when.toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })
  const timeLabel = when.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })

  const subjectShort = (event.subject || '(zonder titel)').slice(0, 80)
  const isExternalLocation = !!(event.location_text && !event.online_meeting_url)
  const locShort = event.online_meeting_url ? 'Teams' : (event.location_text || '—')

  const cat = cls?.category || 'pending'
  const meta = CAT_META[cat] || CAT_META.pending
  const ev = cls?.evidence || {}
  const inOthersTable = !!skip || isDismissed

  const sourceCell = renderSourceCell({ cat, ev, hasProposal, pipelineLookup })
  const actionLabel = skip ? `Skip · ${skip.label}` : ACTION_HINT[cat]

  return (
    <tr>
      <td className={`mono ${styles.cellMono}`}>
        <div>{dateLabel}</div>
        <div className={`muted ${styles.cellSubMuted}`}>{timeLabel}</div>
      </td>
      <td>
        <span className={`v-badge v-badge--${meta.tone}`} title={meta.hint}>{meta.label}</span>
        {hasKennismakingKeyword(event) && (
          <span className={`muted ${styles.cellTiny}`} title="Subject bevat kennismaking-keyword">·kennis</span>
        )}
      </td>
      <td className={styles.cellSubject}>
        <div title={event.subject || ''}>{subjectShort}</div>
        {event.body_preview && (
          <div className={`muted ${styles.cellBodyPreview}`}>{event.body_preview.slice(0, 80)}</div>
        )}
      </td>
      <td className={styles.cellSmall}>
        {externals.map((a, i) => (
          <div key={i} title={a.email}>
            {a.name || a.email}
            {a.email && a.name && <span className={`muted ${styles.cellTinyLeft}`}>{a.email.split('@')[1]}</span>}
          </div>
        ))}
      </td>
      <td className={styles.cellSmall}>{sourceCell}</td>
      <td className={styles.cellSmall} title={event.location_text || ''}>
        {locShort}
        {isExternalLocation && <span className={`muted ${styles.cellTiny}`}>·extern</span>}
      </td>
      <td className={styles.cellDatum} title="kennismaking_datum-property in HubSpot voor de gekoppelde deal">
        <DatumCell event={event} cls={cls} hsIndex={hsIndex} />
      </td>
      <td
        className={`muted ${styles.cellReason}${skip ? ' ' + styles.cellReasonSkip : ''}`}
        title={skip ? `Skip-reden: ${skip.reason}` : 'Voorstel-categorie bepaalt de actie'}
      >
        {actionLabel}
      </td>
      <td className={styles.cellActionRight}>
        {isDismissed ? (
          <button
            type="button"
            onClick={() => onUndoDismiss?.(event)}
            title="Terugplaatsen — skill mag dit event weer voorstellen"
            className={styles.iconBtnAccent}
          >
            ↶
          </button>
        ) : !inOthersTable && (
          <button
            type="button"
            onClick={() => onDismiss?.(event)}
            title="Niet meer tonen — skill verplaatst dit event naar 'Andere afspraken' en biedt het niet opnieuw aan"
            className={styles.iconBtn}
          >
            🗑
          </button>
        )}
      </td>
    </tr>
  )
}

// Bron-match cel — afhankelijk van categorie. Pure JSX, geen state.
function renderSourceCell({ cat, ev, hasProposal, pipelineLookup }) {
  if (cat === 'recruitment' && ev?.issue_key) {
    return (
      <>
        <div className={`mono ${styles.sourceMono}`}>{ev.issue_key}</div>
        <div className={`muted ${styles.sourceMuted}`} title={ev.summary}>
          {(ev.summary || '').slice(0, 32)}{ev.status ? ` · ${ev.status}` : ''}
        </div>
      </>
    )
  }
  if ((cat === 'customer' || cat === 'sales' || cat === 'lead') && (ev?.contact || ev?.company)) {
    const dealLabel = ev?.deal ? pipelineLookup?.resolve(ev.deal.pipeline_id, ev.deal.dealstage) : null
    return (
      <>
        <div className={styles.sourceLine}>
          {ev.company?.name || (ev.contact ? `${ev.contact.firstname || ''} ${ev.contact.lastname || ''}`.trim() : '—')}
        </div>
        <div className={`muted ${styles.sourceMuted}`}>
          {ev?.deal
            ? `${dealLabel?.pipelineLabel || '?'} · ${dealLabel?.stageLabel || '?'}`
            : (ev?.contact ? 'contact, geen deal' : (ev?.company ? 'company, geen contact' : '—'))}
        </div>
      </>
    )
  }
  if (cat === 'partner') {
    return <div className={`muted ${styles.sourceLine}`}>partner_domains</div>
  }
  if (hasProposal) {
    // Geen match in HubSpot, maar wel een voorstel in de Admin-tab —
    // voorkom dat dit als "geen match" leest terwijl er actie klaar staat.
    return (
      <>
        <div className={styles.sourceProposalLink}>✓ Voorstel in Admin</div>
        <div className={`muted ${styles.sourceMuted}`}>nieuw record — onder "Nieuw"-groep</div>
      </>
    )
  }
  return <span className="muted">— geen match</span>
}

// DatumCell — toont ✓ / ⚠ / ✗ / — voor de kennismaking_datum HubSpot-property,
// gelezen uit hubspot_deal_property_cache. Cache wordt gevuld door de
// (toekomstige v1.13) skill-fetch via Composio HubSpot REST. Tot die tijd
// staat alles op "?" en in tooltip leg ik dat uit.
function DatumCell({ event, cls, hsIndex }) {
  const ev = cls?.evidence
  const dealId = ev?.deal?.deal_id
  const startDate = (event.start_time || '').slice(0, 10)
  if (!dealId) return <span className="muted" title="Geen gekoppelde deal in HubSpot">—</span>
  const cached = hsIndex?.kennismakingDatumByDeal?.get(dealId)
  if (!cached) {
    return (
      <span className="muted" title="Nog niet gecheckt — wacht op skill-fetch (volgende daily-admin-future run, v1.13)">
        ?
      </span>
    )
  }
  const cachedDate = cached.kennismaking_datum
  if (!cachedDate) {
    return (
      <span className={styles.datumBad} title="kennismaking_datum NIET ingevuld in HubSpot">
        ✗
      </span>
    )
  }
  const matchesEvent = String(cachedDate).slice(0, 10) === startDate
  return (
    <span
      className={matchesEvent ? styles.datumOk : styles.datumWarn}
      title={matchesEvent
        ? `kennismaking_datum = ${cachedDate} (matcht event)`
        : `kennismaking_datum = ${cachedDate} (verschilt van event-datum ${startDate})`}
    >
      {matchesEvent ? '✓' : '⚠'}
    </span>
  )
}
