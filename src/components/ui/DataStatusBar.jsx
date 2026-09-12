import './data-status-bar.css'

/**
 * DataStatusBar — de vaste regel onder een stuurbord die zegt hoeveel gewicht
 * de cijfers erboven kunnen dragen: peildatum, bronnen met hun status, en de
 * hygiënefouten die dít bord raken.
 *
 * Gedeeld tussen D9, D1 en D10 (skill `dashboarding`, principes.md regel 16 en
 * datakwaliteit.md "De vertrouwensindicator op elk bord").
 *
 * Eén ontwerpregel die je hier terugziet: de bronstatus groen/geel/rood is een
 * ándere betekenis dan de prestatiekleur op het bord. Daarom staat hij als
 * tekstbadge ("bron geel — definitie open") en nooit als gekleurd vlak dat
 * naast een KPI op "we halen het niet" lijkt.
 *
 * Props:
 *   peildatum   ISO-string of Date — de stand van de data zelf
 *   minutenOud  leeftijd in minuten (optioneel, toont "· 23 min oud")
 *   verouderd   true → gele rand + waarschuwing
 *   bronnen     [{ label, status: 'groen'|'geel'|'rood', toelichting }]
 *   meldingen   [string] — hygiëneregels die dit bord raken
 *   actie       { label, onClick } — meestal de sprong naar D9
 */
const STATUS_WOORD = { groen: 'groen', geel: 'geel', rood: 'rood' }

function formatPeildatum(value) {
  if (!value) return 'onbekend'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return 'onbekend'
  return d.toLocaleString('nl-NL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function leeftijdLabel(minuten) {
  if (minuten === null || minuten === undefined) return null
  if (minuten < 1) return 'zojuist ververst'
  if (minuten < 60) return `${minuten} min oud`
  const uren = Math.floor(minuten / 60)
  if (uren < 24) return `${uren} uur oud`
  const dagen = Math.floor(uren / 24)
  return `${dagen} ${dagen === 1 ? 'dag' : 'dagen'} oud`
}

export default function DataStatusBar({
  peildatum,
  minutenOud = null,
  verouderd = false,
  bronnen = [],
  meldingen = [],
  actie = null,
}) {
  const leeftijd = leeftijdLabel(minutenOud)

  return (
    <div className={`dsb ${verouderd ? 'dsb--verouderd' : ''}`}>
      <div className="dsb__rij">
        <span className="dsb__label">Peildatum</span>
        <span className="dsb__waarde">{formatPeildatum(peildatum)}</span>
        {leeftijd && <span className="dsb__meta">· {leeftijd}</span>}
        {verouderd && (
          <span className="dsb__waarschuwing">
            ⚠ ouder dan een uur — er is een synchronisatie overgeslagen
          </span>
        )}
      </div>

      {bronnen.length > 0 && (
        <div className="dsb__rij dsb__rij--bronnen">
          {bronnen.map(b => (
            <span
              key={b.label}
              className={`dsb__bron dsb__bron--${b.status || 'groen'}`}
              title={b.toelichting || undefined}
            >
              <span className="dsb__bron-dot" aria-hidden />
              {b.label}
              <span className="dsb__bron-status">
                {' '}— bron {STATUS_WOORD[b.status] || 'groen'}
                {b.toelichting ? `: ${b.toelichting}` : ''}
              </span>
            </span>
          ))}
        </div>
      )}

      {meldingen.length > 0 && (
        <ul className="dsb__meldingen">
          {meldingen.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}

      {actie && (
        <button type="button" className="dsb__actie" onClick={actie.onClick}>
          {actie.label}
        </button>
      )}
    </div>
  )
}
