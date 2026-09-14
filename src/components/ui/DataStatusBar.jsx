import { useEffect, useId, useRef, useState } from 'react'
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
 *   `kop`     — zone 5 van BordShell, in de witte standaardbalk. Sinds v1.190
 *               één compact label **Sync** met een statuspunt; álles erachter
 *               (peildatum, bronnen, waarschuwing, `Wat ontbreekt (n)`,
 *               voetnoot én de knop Ververs) staat in één paneel dat opent op
 *               hover, focus of klik. Nooit een `<ul>` meldingen ínline: een
 *               blok van meldingen duwt het werk van het scherm en wordt
 *               daardoor juist niet gelezen.
 *
 * Waarom één woord (Jelle, 14-09-2026): in v1.189 stonden peildatum, de
 * mirror-badge, een caveat-chip, `Wat ontbreekt (6)` én Ververs naast elkaar in
 * de balk — te veel sync- en statustekst voor een regel die je alleen leest als
 * je iets wantrouwt. De **kleur van de punt** is nu de eerste blik (groen: alles
 * actueel; amber: een bron verouderd of een waarschuwing open; rood: een bron
 * ontbreekt), de woorden staan één hover verder. Ververs verhuist mee: dat is de
 * handeling die bij de sync hoort, niet een losse knop naast de filters.
 *
 * Props:
 *   peildatum   ISO-string of Date — de stand van de data zelf
 *   minutenOud  leeftijd in minuten (optioneel, toont "· 23 min oud")
 *   verouderd   true → gele rand + waarschuwing
 *   bronnen     [{ label, status: 'groen'|'geel'|'rood', kort?, toelichting }]
 *   meldingen   [string] — hygiëneregels die dit bord raken
 *   actie       { label, onClick } — meestal de sprong naar D9
 *   variant     'blok' | 'kop'
 *   caveat      kop: de korte waarschuwing (≤ 8 woorden); kleurt de punt amber
 *   zin         kop: de volle zin, bovenin het paneel
 *   voetnoot    kop: de bronregel onderin het paneel
 *   ververs     kop: { onClick, bezig } — de knop Ververs in het paneel
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

/** De kleur van de punt: de strengste status in het paneel. */
function syncStatus({ verouderd, bronnen, caveat }) {
  if (bronnen.some(b => b.status === 'rood')) return 'rood'
  if (verouderd || caveat || bronnen.some(b => b.status === 'geel')) return 'geel'
  return 'groen'
}

const SYNC_WOORD = { groen: 'actueel', geel: 'let op', rood: 'bron ontbreekt' }

export default function DataStatusBar({
  peildatum,
  minutenOud = null,
  verouderd = false,
  bronnen = [],
  meldingen = [],
  actie = null,
  variant = 'blok',
  caveat = null,
  zin = null,
  voetnoot = null,
  ververs = null,
}) {
  const leeftijd = leeftijdLabel(minutenOud)

  if (variant === 'kop') {
    return (
      <SyncGroep
        peildatum={peildatum}
        leeftijd={leeftijd}
        verouderd={verouderd}
        bronnen={bronnen}
        meldingen={meldingen}
        caveat={caveat}
        zin={zin}
        voetnoot={voetnoot}
        actie={actie}
        ververs={ververs}
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
 * De Sync-groep in de balk: één trigger, één paneel.
 *
 * Drie wegen naar hetzelfde paneel, en ze mogen elkaar niet in de weg zitten:
 *   • hover (muis) opent zolang de muis erboven staat — `zweeft`;
 *   • focus (toetsenbord) opent en Tab loopt het paneel in — `zweeft`;
 *   • klik of tap zet het paneel vast — `vast` — en een tweede klik sluit hem
 *     ook als de muis er nog boven staat (`gesloten`, tot de muis weggaat).
 * Zonder die laatste regel zou een klik op een al-gehoverd paneel niets doen,
 * en op een telefoon is de tap de enige weg.
 */
function SyncGroep({ peildatum, leeftijd, verouderd, bronnen, meldingen, caveat, zin, voetnoot, actie, ververs }) {
  const [vast, setVast] = useState(false)
  const [zweeft, setZweeft] = useState(false)
  const [gesloten, setGesloten] = useState(false)
  const wrap = useRef(null)
  const paneelId = useId()

  const open = vast || (zweeft && !gesloten)

  useEffect(() => {
    if (!vast) return undefined
    const buiten = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setVast(false) }
    document.addEventListener('mousedown', buiten)
    return () => document.removeEventListener('mousedown', buiten)
  }, [vast])

  const sluit = () => { setVast(false); setZweeft(false); setGesloten(true) }
  const status = syncStatus({ verouderd, bronnen, caveat })
  const n = meldingen.length

  return (
    <div
      className={`dsb dsb--kop dsb--${status} ${verouderd ? 'dsb--verouderd' : ''}`}
      data-zone="vertrouwen"
      ref={wrap}
      onMouseEnter={() => setZweeft(true)}
      onMouseLeave={() => { setZweeft(false); setGesloten(false) }}
      onFocus={() => setZweeft(true)}
      onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget)) setZweeft(false) }}
      onKeyDown={(e) => { if (e.key === 'Escape') sluit() }}
    >
      <button
        type="button"
        className="dsb__sync"
        onClick={() => (open ? sluit() : setVast(true))}
        aria-expanded={open}
        aria-controls={paneelId}
        title={`Sync ${SYNC_WOORD[status]} · peildatum ${formatPeildatum(peildatum)}${leeftijd ? ` · ${leeftijd}` : ''}${n ? ` · ${n} ontbreekt` : ''}`}
      >
        <span className="dsb__sync-dot" aria-hidden />
        Sync
        <span className="dsb__sr">, {SYNC_WOORD[status]}{n ? `, ${n} ontbreekt` : ''}</span>
      </button>

      <div className="dsb__popover" id={paneelId} hidden={!open}>
        <div className="dsb__poprij">
          <span className="dsb__label">Peildatum</span>
          <span className={`dsb__waarde${verouderd ? ' dsb__waarde--verouderd' : ''}`}>{formatPeildatum(peildatum)}</span>
          {leeftijd && <span className="dsb__meta">· {leeftijd}</span>}
        </div>
        {verouderd && (
          <div className="dsb__waarschuwing">⚠ ouder dan een uur — er is een synchronisatie overgeslagen</div>
        )}

        {bronnen.length > 0 && (
          <ul className="dsb__popbronnen">
            {bronnen.map(b => (
              <li key={b.label} className={`dsb__popbron dsb__popbron--${b.status || 'groen'}`}>
                <span className="dsb__bron-dot" aria-hidden />
                <b>{b.label}</b>
                <span className="dsb__bron-status">
                  {b.kort || `bron ${STATUS_WOORD[b.status] || 'groen'}`}
                  {b.toelichting ? ` — ${b.toelichting}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}

        {(zin || caveat) && <div className="dsb__popzin">{zin || <span className="dsb-warn">{caveat}</span>}</div>}

        {n > 0 && (
          <div className="dsb__popblok">
            <div className="dsb__popkop">Wat ontbreekt ({n})</div>
            <ul className="dsb__meldingen">
              {meldingen.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </div>
        )}

        {voetnoot && <div className="dsb__popvoet">{voetnoot}</div>}

        {(ververs || actie) && (
          <div className="dsb__popacties">
            {ververs && (
              <button type="button" className="dsb__actie" onClick={ververs.onClick} disabled={!!ververs.bezig}>
                {ververs.bezig ? 'Verversen…' : 'Ververs'}
              </button>
            )}
            {actie && (
              <button type="button" className="dsb__actie" onClick={actie.onClick}>
                {actie.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
