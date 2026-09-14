import MetricCard from '../../../ui/MetricCard'
import { Kernzin } from '../../../ui/BordShell'
import { getal, bereik } from '../format'
import { kopWaarde, periodeKort } from './d10sneden'

/**
 * D10Antwoord — zone 2. Twee kaarten: B als hero, C ernaast. Geen beeld: B's
 * reeks staat al in de snede `↻ 13 maanden` (G4).
 *
 * De twee kaarten die eraf gingen, gingen niet wég (ontwerplock d10-full.png,
 * Research 1 §E): A · prospectverlies is één regel onder de kernzin met een
 * link naar D1; de noemer is de tweede helft van diezelfde regel.
 *
 * **Het venster komt uit het paginafilter** (v1.187): één waarde per kaart, in
 * de stand die de strook toont. Tot v1.186 stonden "in 13 maanden" en "deze
 * maand" allebei in de kaart — een periodefilter als kaartanatomie
 * (principes.md regel 5, besluit 2026-09-13).
 *
 * **Woordbudget zone 2**: telegram, en precies één zin met een persoonsvorm —
 * de kernzin. De definitie ("telt niet als churn: de proef eindigde zonder
 * klant te worden") is soort-3-tekst en woont in de tooltip, niet op de kaart
 * (regel 21). Eén regel draagt de hele zone: **A, B en C worden nooit opgeteld.**
 */
export default function D10Antwoord({ kop, meta, periode }) {
  const byId = Object.fromEntries((kop || []).map(r => [r.soort, r]))
  const b = byId.B
  const c = byId.C
  const venster = periodeKort(periode)
  const maand = periode === 'maand'

  return (
    <>
      {b && (
        <MetricCard
          label="B · Proef niet omgezet"
          merk="stuurgetal"
          waarde={getal(kopWaarde(b, periode))}
          waardeSuffix={venster}
          toon="hero"
          vergelijking={
            <>
              {maand && <>vorige maand {getal(b.vorige_maand)} · </>}
              {meta?.proeven
                ? <><b>{getal(meta.proeven)} lopende proeven</b> · de kans, niet de schade</>
                : 'geen lopende proef · niets te keren'}
            </>
          }
          basis={
            <span title="Telt niet als churn: de proef eindigde zonder klant te worden. Mediaan = startdatum → einddatum over alle B-records (v_d10_kop).">
              {b.duur_mediaan == null
                ? 'geen duurmeting · geen churn'
                : `mediaan ${getal(b.duur_mediaan)} dagen na start (${getal(b.duur_min)}–${getal(b.duur_max)}) · geen churn`}
            </span>
          }
        />
      )}

      {c && (
        <MetricCard
          label="C · Opzegging"
          merk="churn"
          waarde={getal(kopWaarde(c, periode))}
          waardeSuffix={venster}
          vergelijking={
            c.totaal > 0
              ? `${getal(c.duur_mediaan)} dagen na start · ${bereik(c.waarde_bodem, c.waarde_plafond) || 'contractwaarde onbekend'} per maand`
              : 'geen opzegging in dertien maanden'
          }
          /* Geen percentage onder de tien waarnemingen — bij n = 1 springt elk
             percentage in stappen van honderd procent. */
          basis={
            <span title="Onder de tien waarnemingen is elk percentage ruis; het aantal is het hoofdgetal (principes.md regel 4). Een churnpercentage op betalende klanten vraagt bovendien AFAS.">
              {meta?.churn_pct_toonbaar ? 'churn-% in de snede wanneer, met beide noemers' : `geen % onder n = 10 · n = ${getal(c.laatste_13_maanden)}`}
            </span>
          }
        />
      )}
    </>
  )
}

/**
 * De kernzin: één zin over de verhouding tussen B en C in het gekozen venster.
 * Niet als vierde getal — een getal daarvoor zou meteen weer iemand
 * verleiden er iets bij op te tellen.
 */
export function D10Kernzin({ kop, periode }) {
  const b = (kop || []).find(r => r.soort === 'B')
  const c = (kop || []).find(r => r.soort === 'C')
  if (!b || !c) return null

  const nb = kopWaarde(b, periode) || 0
  const nc = kopWaarde(c, periode) || 0
  const totaal = nb + nc
  const venster = periodeKort(periode)

  if (totaal === 0) {
    return <Kernzin><b>Geen klantverlies {venster}.</b> Dat is een gemeten nul, geen ontbrekende meting.</Kernzin>
  }

  const adoptie = nb >= nc
  return (
    <Kernzin>
      <b>{getal(nb)} van de {getal(totaal)} klantverliezen {venster} {nb === 1 ? 'is een proef' : 'zijn proeven'}</b>
      {' '}— een {adoptie ? 'adoptievraag, geen retentievraag' : 'retentievraag, niet alleen een adoptievraag'}.
    </Kernzin>
  )
}

/**
 * De subregel onder de kernzin: A en de noemer, de twee kaarten die van dit
 * bord af zijn. Klein, op één regel, telegram. A hoort hier omdat zijn
 * afwezigheid gevaarlijker is dan zijn aanwezigheid: zonder deze regel wordt
 * hij vroeg of laat bij B opgeteld. De link gaat naar D1, waar hij thuishoort.
 */
export function D10Subregel({ kop, meta, periode, onD1 }) {
  const a = (kop || []).find(r => r.soort === 'A')

  return (
    <div className="d10-subregel" data-zone="kernzin">
      {a && (
        <span>
          <b>A · prospectverlies</b> {getal(kopWaarde(a, periode))} {periodeKort(periode)} · funnelverlies ·{' '}
          <button type="button" className="d10-inline-link" onClick={onD1}>op D1 ▸</button>
        </span>
      )}
      {meta && (
        <span className="d10-subregel__noemer" title="De populatie van B en C: klantdeals in fase actief of vernieuwd; incl. proeven telt de fase proef mee (v_d10_meta).">
          Noemer {getal(meta.noemer_klantdeals)} klantdeals = {getal(meta.noemer_kantoren)} kantoren ·{' '}
          {getal(meta.klantdeals_incl_proef)} incl. proeven
        </span>
      )}
    </div>
  )
}
