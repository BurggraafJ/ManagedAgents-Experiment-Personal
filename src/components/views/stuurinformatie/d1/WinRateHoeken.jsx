import { getal, decimaal } from './format'

const BASIS_LABEL = {
  closedate_jaar: 'afsluitjaar',
  alles: 'alles, ongeacht datum',
}
const BACKBURNER_LABEL = {
  verloren: 'backburner = verloren',
  buiten: 'backburner buiten',
}

/**
 * Win rate als vier hoeken van één bandbreedte, niet als één percentage.
 *
 * Methodiek 2 filtert op het closedate-jaar. Op de mirror heeft 26 van de 57
 * verloren deals géén closedate, en ze vallen vooral aan de verloren kant weg
 * (21 van de 36 backburner-deals). Een jaarfilter laat die stilzwijgend vallen
 * en tilt de win rate dus structureel op. De vier hoeken maken dat zichtbaar in
 * plaats van er een keuze van te maken die niemand heeft genomen.
 *
 * Hoofdhoek = afsluitjaar × backburner verloren, de conservatieve hoek
 * (CD-lock 2026-09-13). De andere drie staan er klein naast, elk met hun eigen
 * n — een percentage op veertien trajecten is geen percentage maar een
 * schatting, en dat moet je kunnen zien.
 */
export default function WinRateHoeken({ winRate }) {
  if (!winRate || winRate.length === 0) return null

  const jaar = winRate[0]?.jaar

  return (
    <section className="d1-blok d1-wr">
      <header className="d1-blok__kop">
        <div>
          <h3 className="d1-blok__titel">Win rate — vier hoeken van één bandbreedte</h3>
          <p className="d1-blok__intro">
            Afgesloten trajecten tot proefstart. Open deals zitten er nooit in. De datumbasis en de
            behandeling van backburner zijn allebei een keuze; ze staan hier naast elkaar in plaats
            van verstopt in één getal.
          </p>
        </div>
      </header>

      <div className="d1-wr__raster">
        <span className="d1-wr__hoekkop" />
        <span className="d1-wr__hoekkop">{BACKBURNER_LABEL.verloren}</span>
        <span className="d1-wr__hoekkop">{BACKBURNER_LABEL.buiten}</span>

        {['closedate_jaar', 'alles'].map(basis => (
          <Rij key={basis} basis={basis} jaar={jaar} winRate={winRate} />
        ))}
      </div>

      <p className="d1-wr__voet">
        Het verschil tussen de bovenste en de onderste rij is het datumfilter:{' '}
        {getal(winRate.find(h => h.backburner === 'verloren')?.zonder_closedate)} van{' '}
        {getal(winRate.find(h => h.backburner === 'verloren')?.populatie)} afgesloten trajecten draagt
        geen afsluitdatum. Omdat die vooral aan de verloren kant ontbreekt, tilt het jaarfilter de win
        rate structureel op. Zolang dit open staat is de conservatieve hoek de hoofdhoek.
      </p>
    </section>
  )
}

function Rij({ basis, jaar, winRate }) {
  const label = basis === 'closedate_jaar' ? `${BASIS_LABEL.closedate_jaar} ${jaar}` : BASIS_LABEL.alles
  return (
    <>
      <span className="d1-wr__rijkop">{label}</span>
      {['verloren', 'buiten'].map(bb => {
        const h = winRate.find(x => x.basis === basis && x.backburner === bb)
        if (!h) return <span key={bb} className="d1-wr__cel" />
        return (
          <div key={bb} className={`d1-wr__cel${h.hoofdhoek ? ' is-hoofd' : ''}`}>
            <span className="d1-wr__waarde">
              {h.win_rate === null || h.win_rate === undefined
                ? <span className="d1-wr__leeg">geen basis</span>
                : `${decimaal(h.win_rate, 1)} %`}
            </span>
            <span className="d1-wr__basis">
              n = {getal(h.basis_n)} · {getal(h.gewonnen)} gewonnen / {getal(h.verloren)} verloren
            </span>
            {h.hoofdhoek && <span className="d1-wr__merk">hoofdgetal</span>}
          </div>
        )
      })}
    </>
  )
}
