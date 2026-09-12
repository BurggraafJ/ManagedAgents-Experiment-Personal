import TrendCel from './TrendCel'
import CheckRecords from './CheckRecords'

/**
 * CheckTable — de checktabel van D9: per regel één telling, één eigenaar, één
 * definitie en de borden die de fout vertekent.
 *
 * Drie dingen die deze tabel bewust wél doet:
 *  • het aantal staat náást zijn basis ("16 van 168 open deals + klantdeals"),
 *    want een telling zonder noemer is niet te wegen;
 *  • een check die niet meetbaar is toont "—" en de reden, nooit een nul;
 *  • de definitie zit in de tooltip van de titel, zodat niemand hoeft te raden
 *    waarom een record op de lijst staat.
 *
 * En één ding dat hij bewust níét doet: kleuren op basis van "veel of weinig".
 * Er is geen norm per check, dus is er geen kleur (principes.md regel 14). De
 * enige klemtoon is de vlag `blokkerend` — de vier checks die de forecast
 * vertekenen, en dat is een norm die wél bestaat.
 */
const STATUS_TEKST = {
  wacht_op_mirror: 'wacht op mirror',
  niet_meetbaar:   'niet meetbaar',
  niet_gekoppeld:  'bron niet gekoppeld',
  constatering:    'constatering',
}

export default function CheckTable({ checks, trend, records, meta, open, onToggle }) {
  const zichtbaar = checks.filter(
    c => c.status === 'meetbaar' || c.status === 'constatering' || c.status === 'wacht_op_mirror'
  )

  return (
    <div className="d9-tabel">
      <div className="d9-tabel__head">
        <span>Check</span>
        <span className="d9-tabel__num">Aantal</span>
        <span>Trend 8 weken</span>
        <span>Eigenaar</span>
        <span>Raakt</span>
      </div>

      {zichtbaar.map(c => {
        const isOpen = open === c.check_id
        const meetbaar = c.status === 'meetbaar' || c.status === 'constatering'
        const schoon = meetbaar && c.aantal === 0
        const uitklapbaar = meetbaar && !!c.records_view

        return (
          <div key={c.check_id} className={`d9-rij ${isOpen ? 'is-open' : ''}`}>
            <button
              type="button"
              className="d9-rij__knop"
              onClick={() => uitklapbaar && onToggle(c)}
              aria-expanded={isOpen}
              disabled={!uitklapbaar}
            >
              {/* Definitie én reden zitten in de tooltip, niet als lopende tekst
                  in de rij: vijf keer dezelfde uitleg onder elkaar duwt de
                  checks waar je wél iets mee kunt onder de vouw. De reden staat
                  één keer voluit in de datastatus-regel erboven. */}
              <span className="d9-rij__check">
                <span className="d9-rij__id">{c.check_id}</span>
                <span
                  className="d9-rij__titel"
                  title={[c.definitie, c.reden].filter(Boolean).join('\n\n')}
                >
                  {c.titel}
                  {c.blokkerend && <span className="d9-rij__blokkerend">blokkeert forecast</span>}
                </span>
              </span>

              <span className="d9-tabel__num">
                {meetbaar ? (
                  <span className={`d9-rij__aantal ${schoon ? 'is-schoon' : ''}`}>
                    {c.aantal?.toLocaleString('nl-NL')}
                  </span>
                ) : (
                  <span className="d9-rij__nvt">— {STATUS_TEKST[c.status]}</span>
                )}
                {c.noemer !== null && c.noemer !== undefined && (
                  <span className="d9-rij__noemer">van {c.noemer} {c.noemer_label}</span>
                )}
                {schoon && <span className="d9-rij__schoon">✓ schoon</span>}
              </span>

              <span className="d9-rij__trend">
                <TrendCel
                  trend={trend[c.check_id]}
                  meetbaar={meetbaar}
                  trendVanaf={meta?.trend_vanaf}
                />
              </span>

              <span className="d9-rij__eigenaar">{c.eigenaar}</span>

              <span className="d9-rij__raakt">
                {(c.raakt || []).map(b => <span key={b} className="d9-chip">{b}</span>)}
                {uitklapbaar && <span className="d9-rij__caret" aria-hidden>{isOpen ? '▾' : '▸'}</span>}
              </span>
            </button>

            {isOpen && <CheckRecords state={records[c.check_id]} />}
          </div>
        )
      })}
    </div>
  )
}
