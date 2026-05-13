import { hasKennismakingKeyword, CAT_META, ACTION_HINT } from '../../../lib/hubspotInbox'

// KennismakingRow — Maestro v2 (rebuild 2026-05-12).
// Eén tr in de "Eerste kennismakingen" / "Andere externe afspraken"-tabel.
// Mockup-native cells met smart truncation + hover-popovers (.cell-pop) voor
// volledige tekst.

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
  </svg>
)

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

  const subjectFull = event.subject || '(zonder titel)'
  const subjectShort = subjectFull.length > 60 ? subjectFull.slice(0, 60).trim() + '…' : subjectFull
  const bodyPreview = event.body_preview ? event.body_preview.slice(0, 80).trim() : null

  const isExternalLocation = !!(event.location_text && !event.online_meeting_url)
  const locShort = event.online_meeting_url ? 'Teams' : (event.location_text || '—')

  const cat = cls?.category || 'pending'
  const meta = CAT_META[cat] || CAT_META.pending
  const ev = cls?.evidence || {}
  const inOthersTable = !!skip || isDismissed

  const actionLabel = skip ? `Skip · ${skip.label}` : ACTION_HINT[cat]

  return (
    <tr className={isDismissed ? 'is-dismissed' : undefined}>
      {/* Wanneer */}
      <td>
        <div className="km-when-date">{dateLabel}</div>
        <div className="compact-sub">{timeLabel}</div>
      </td>

      {/* Categorie */}
      <td>
        <span className={`pill pill--${meta.tone}`} title={meta.hint}>{meta.label}</span>
        {hasKennismakingKeyword(event) && (
          <span className="km-tag" title="Subject bevat kennismaking-keyword">·kennis</span>
        )}
      </td>

      {/* Onderwerp */}
      <td className="cell-hover">
        <div className="compact-line cell-trunc">{subjectShort}</div>
        {bodyPreview && <div className="compact-sub cell-trunc">{bodyPreview}</div>}
        <div className="cell-pop">
          <div className="cell-pop__title">{subjectFull}</div>
          {event.body_preview && (
            <div className="cell-pop__body">{event.body_preview}</div>
          )}
        </div>
      </td>

      {/* Externe deelnemers */}
      <td className="cell-hover">
        {externals.length === 0 ? (
          <span className="km-soft">—</span>
        ) : (
          <>
            <div className="compact-line cell-trunc">
              {externals[0]?.name || externals[0]?.email}
            </div>
            {externals.length > 1 && (
              <div className="compact-sub cell-trunc">
                {externals[1]?.name || externals[1]?.email}
                {externals.length > 2 ? ` · +${externals.length - 2}` : ''}
              </div>
            )}
            <div className="cell-pop">
              <div className="cell-pop__title">Externe deelnemers · {externals.length}</div>
              {externals.slice(0, 10).map((a, i) => (
                <div key={i} className="cell-pop__line">
                  {a.name || a.email}
                  {a.email && a.name && <span className="cell-pop__sub"> {a.email.split('@')[1]}</span>}
                </div>
              ))}
              {externals.length > 10 && (
                <div className="cell-pop__sub">+{externals.length - 10} meer…</div>
              )}
            </div>
          </>
        )}
      </td>

      {/* Bron-match */}
      <SourceCell cat={cat} ev={ev} hasProposal={hasProposal} pipelineLookup={pipelineLookup} />

      {/* Locatie */}
      <td className="cell-hover">
        <div className="compact-line cell-trunc">{locShort}</div>
        {isExternalLocation && <div className="compact-sub cell-trunc">extern</div>}
        {(event.location_text || event.online_meeting_url) && (
          <div className="cell-pop">
            <div className="cell-pop__title">Locatie</div>
            {event.online_meeting_url ? (
              <div>Microsoft Teams · online</div>
            ) : (
              <>
                <div>{event.location_text}</div>
                {isExternalLocation && <div className="cell-pop__sub">Externe locatie — fysieke afspraak</div>}
              </>
            )}
          </div>
        )}
      </td>

      {/* Datum in HubSpot */}
      <td className="km-datum-cell" title="kennismaking_datum-property in HubSpot voor de gekoppelde deal">
        <DatumCell event={event} cls={cls} hsIndex={hsIndex} />
      </td>

      {/* Voorgestelde actie / Reden */}
      <td className={`km-reason${skip ? ' is-skip' : ''}`} title={skip ? `Skip-reden: ${skip.reason}` : 'Voorstel-categorie bepaalt de actie'}>
        {actionLabel}
      </td>

      {/* Tools */}
      <td className="km-action-cell">
        {isDismissed ? (
          <button
            type="button"
            className="fut-trash fut-trash--restore"
            onClick={() => onUndoDismiss?.(event)}
            title="Terugplaatsen — skill mag dit event weer voorstellen"
            aria-label="Terugplaatsen"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 00-15-6.7L3 13" />
            </svg>
          </button>
        ) : !inOthersTable && (
          <button
            type="button"
            className="fut-trash"
            onClick={() => onDismiss?.(event)}
            title="Niet meer tonen — skill verplaatst dit event naar 'Andere afspraken'"
            aria-label="Verbergen"
          >
            <TrashIcon />
          </button>
        )}
      </td>
    </tr>
  )
}

function SourceCell({ cat, ev, hasProposal, pipelineLookup }) {
  if (cat === 'recruitment' && ev?.issue_key) {
    return (
      <td className="cell-hover">
        <div className="compact-line cell-trunc">{ev.issue_key}</div>
        <div className="compact-sub cell-trunc">
          {(ev.summary || '').slice(0, 32)}{ev.status ? ` · ${ev.status}` : ''}
        </div>
        <div className="cell-pop">
          <div className="cell-pop__title">Recruitment-issue</div>
          <div>{ev.issue_key} — {ev.summary || '(geen titel)'}</div>
          {ev.status && <div className="cell-pop__sub">{ev.status}</div>}
        </div>
      </td>
    )
  }

  if ((cat === 'customer' || cat === 'sales' || cat === 'lead') && (ev?.contact || ev?.company)) {
    const dealLabel = ev?.deal ? pipelineLookup?.resolve(ev.deal.pipeline_id, ev.deal.dealstage) : null
    const primary = ev.company?.name
      || (ev.contact ? `${ev.contact.firstname || ''} ${ev.contact.lastname || ''}`.trim() : '—')
    const sub = ev?.deal
      ? `${dealLabel?.pipelineLabel || '?'} · ${dealLabel?.stageLabel || '?'}`
      : (ev?.contact ? 'contact, geen deal' : (ev?.company ? 'company, geen contact' : '—'))
    return (
      <td className="cell-hover">
        <div className="compact-line cell-trunc">{primary}</div>
        <div className="compact-sub cell-trunc">{sub}</div>
        <div className="cell-pop">
          <div className="cell-pop__title">Bron-match</div>
          <div>{primary}</div>
          <div className="cell-pop__sub">{sub}</div>
          {ev?.deal?.deal_id && (
            <div className="cell-pop__sub">deal-id: {ev.deal.deal_id}</div>
          )}
        </div>
      </td>
    )
  }

  if (cat === 'partner') {
    return (
      <td>
        <span className="km-soft">partner_domains</span>
      </td>
    )
  }

  if (hasProposal) {
    return (
      <td>
        <div className="km-proposal-ok">✓ Voorstel in Admin</div>
        <div className="compact-sub">nieuw record onder "Nieuw"</div>
      </td>
    )
  }

  return (
    <td>
      <span className="km-soft">— geen match</span>
    </td>
  )
}

function DatumCell({ event, cls, hsIndex }) {
  const ev = cls?.evidence
  const dealId = ev?.deal?.deal_id
  const startDate = (event.start_time || '').slice(0, 10)

  if (!dealId) {
    return <span className="km-soft" title="Geen gekoppelde deal in HubSpot">—</span>
  }
  const cached = hsIndex?.kennismakingDatumByDeal?.get(dealId)
  if (!cached) {
    return <span className="km-soft" title="Nog niet gecheckt — wacht op skill-fetch">?</span>
  }
  const cachedDate = cached.kennismaking_datum
  if (!cachedDate) {
    return <span className="km-datum km-datum--bad" title="kennismaking_datum NIET ingevuld in HubSpot">✗</span>
  }
  const matchesEvent = String(cachedDate).slice(0, 10) === startDate
  return (
    <span
      className={matchesEvent ? 'km-datum km-datum--ok' : 'km-datum km-datum--warn'}
      title={matchesEvent
        ? `kennismaking_datum = ${cachedDate} (matcht event)`
        : `kennismaking_datum = ${cachedDate} (verschilt van ${startDate})`}
    >
      {matchesEvent ? '✓' : '⚠'}
    </span>
  )
}
