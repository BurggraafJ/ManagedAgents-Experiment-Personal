import { useEffect, useRef, useState } from 'react'
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
 * Twee varianten:
 *   `blok`    (standaard) — peildatum, bronnen en meldingen onder elkaar.
 *   `compact` — zone 5 van BordShell: één regel van 38 px met de peildatum,
 *               de bronbadges, één zin, en al het andere achter
 *               `▸ Wat ontbreekt (n)`. Nooit een `<ul>` meldingen ínline: een
 *               blok van meldingen duwt het werk van het scherm en wordt
 *               daardoor juist niet gelezen.
 *
 * Props:
 *   peildatum   ISO-string of Date — de stand van de data zelf
 *   minutenOud  leeftijd in minuten (optioneel, toont "· 23 min oud")
 *   verouderd   true → gele rand + waarschuwing
 *   bronnen     [{ label, status: 'groen'|'geel'|'rood', kort?, toelichting }]
 *   meldingen   [string] — hygiëneregels die dit bord raken
 *   actie       { label, onClick } — meestal de sprong naar D9
 *   variant     'blok' | 'compact'
 *   zin         compact: de ene regel tekst op de balk zelf
 *   voetnoot    compact: de bronregel onderin de popover
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

function formatKort(value) {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .replace(',', ' ')
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
  variant = 'blok',
  zin = null,
  voetnoot = null,
}) {
  const leeftijd = leeftijdLabel(minutenOud)

  if (variant === 'compact') {
    return (
      <CompacteRegel
        peildatum={peildatum}
        leeftijd={leeftijd}
        verouderd={verouderd}
        bronnen={bronnen}
        meldingen={meldingen}
        zin={zin}
        voetnoot={voetnoot}
        actie={actie}
      />
    )
  }

  return (
    <div className={`dsb ${verouderd ? 'dsb--verouderd' : ''}`} data-zone="vertrouwen">
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

/**
 * De compacte regel. De disclosure telt wat er achter zit — dat getal is de
 * hele belofte: klik je hem open, dan staan er precies zoveel regels.
 */
function CompacteRegel({ peildatum, leeftijd, verouderd, bronnen, meldingen, zin, voetnoot, actie }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const buiten = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', buiten)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', buiten)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className={`dsb dsb--compact ${verouderd ? 'dsb--verouderd' : ''}`} data-zone="vertrouwen">
      {/* De leeftijd staat in de tooltip en niet naast de datum: de bronbadge
          hiernaast draagt hem al ("actueel · 12 min"), en twee keer hetzelfde
          getal op één regel van 38 px kost ruimte die de zin nodig heeft. */}
      <span
        className="dsb__peil"
        title={`Peildatum ${formatPeildatum(peildatum)}${leeftijd ? ` · ${leeftijd}` : ''}`}
      >
        {formatKort(peildatum)}
      </span>

      {bronnen.map(b => (
        <span
          key={b.label}
          className={`dsb__bron dsb__bron--${b.status || 'groen'}`}
          title={`bron ${STATUS_WOORD[b.status] || 'groen'}${b.toelichting ? `: ${b.toelichting}` : ''}`}
        >
          <span className="dsb__bron-dot" aria-hidden />
          <b>{b.label}</b>
          <span className="dsb__bron-status">{b.kort || `bron ${STATUS_WOORD[b.status] || 'groen'}`}</span>
        </span>
      ))}

      {zin && <span className="dsb__zin">{zin}</span>}

      {actie && (
        <button type="button" className="dsb__actie dsb__actie--inline" onClick={actie.onClick}>
          {actie.label}
        </button>
      )}

      {meldingen.length > 0 && (
        <span className="dsb__pop" ref={wrap}>
          <button
            type="button"
            className="dsb__disclosure"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
          >
            Wat ontbreekt ({meldingen.length})
            <span className="dsb__caret" aria-hidden>{open ? '▾' : '▸'}</span>
          </button>
          {open && (
            <div className="dsb__popover">
              <ul className="dsb__meldingen">
                {meldingen.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
              {voetnoot && <div className="dsb__popvoet">{voetnoot}</div>}
            </div>
          )}
        </span>
      )}
    </div>
  )
}
