import MetricCard from '../../../ui/MetricCard'
import { Kernzin } from '../../../ui/BordShell'
import { getal, euro, bereik } from '../format'

/**
 * D10Antwoord — zone 2. Twee kaarten: B als hero, C ernaast.
 *
 * Van vier kaarten naar twee (ontwerplock `design-full/d10-full.png`, Research 1
 * §B D10 §5). De twee die eraf gingen, gingen niet wég:
 *
 *   A · prospectverlies → één regel onder de kernzin, mét link naar D1. A is
 *                         funnelverlies en hoort in de keten van D1; hij blijft
 *                         zichtbaar zodat niemand A + B + C optelt.
 *   Noemer              → de tweede helft van diezelfde regel. Een definitie is
 *                         geen stuurgetal, en een kaartbreedte voor "66
 *                         klantdeals = 46 kantoren" duwt het werk van het scherm.
 *
 * **B draagt het venster van dertien maanden als hoofdgetal**, niet de lopende
 * maand. Dat is de omkering uit het ontwerplock ten opzichte van v1.178: op een
 * bord dat maandelijks gelezen wordt bleef de blik hangen op een kleine 2,
 * terwijl het inzicht in de 19 zit. De maand staat er direct achter, zodat het
 * venster nooit voor een maandcijfer aangezien kan worden.
 *
 * Eén regel draagt de hele zone: **A, B en C worden nooit opgeteld.** Alleen C
 * is churn, en elke kaart zegt dat in woorden.
 */
export default function D10Antwoord({ kop, meta }) {
  const byId = Object.fromEntries((kop || []).map(r => [r.soort, r]))
  const b = byId.B
  const c = byId.C

  return (
    <>
      {b && (
        <MetricCard
          label="B · Proef niet omgezet"
          merk="stuurgetal"
          waarde={getal(b.laatste_13_maanden)}
          waardeSuffix={
            <>in 13 maanden · <b>{getal(b.deze_maand)} deze maand</b>, vorige maand {getal(b.vorige_maand)}</>
          }
          toon="hero"
          vergelijking={
            meta?.proeven
              ? <><b>{getal(meta.proeven)} proeven lopen nu</b> — dat is de kans, niet de schade</>
              : 'geen lopende proef — er is vandaag niets om te keren'
          }
          basis={
            b.duur_mediaan == null
              ? 'geen duurmeting · telt niet als churn: de proef eindigde zonder klant te worden'
              : `mediaan ${getal(b.duur_mediaan)} dagen na start (${getal(b.duur_min)}–${getal(b.duur_max)}) · telt niet als churn: de proef eindigde zonder klant te worden`
          }
        />
      )}

      {c && (
        <MetricCard
          label="C · Opzegging"
          merk="churn"
          waarde={getal(c.laatste_13_maanden)}
          waardeSuffix={<>in 13 maanden · {getal(c.deze_maand)} deze maand</>}
          vergelijking={
            c.totaal > 0
              ? `${getal(c.duur_mediaan)} dagen na start · ${bereik(c.waarde_bodem, c.waarde_plafond) || 'contractwaarde onbekend'} per maand`
              : 'geen opzegging in het venster van dertien maanden'
          }
          /* Geen percentage onder de tien waarnemingen — dat is geen
             voorzichtigheid maar een rekenregel: bij n = 1 springt elk
             percentage in stappen van honderd procent. */
          basis={
            meta?.churn_pct_toonbaar
              ? 'churnpercentage staat in de snede wanneer, met beide noemers'
              : `geen churnpercentage bij n = ${getal(c.laatste_13_maanden)} — onder de tien is elk percentage ruis`
          }
        />
      )}
    </>
  )
}

/**
 * De kernzin: één zin over de verhouding tussen B en C. Niet als vierde getal,
 * want het gaat om de verhouding — en een getal daarvoor zou meteen weer
 * iemand verleiden er iets bij op te tellen.
 *
 * Tot v1.178 was dit een alinea van vier regels met de contractwaarde erin. Die
 * waarde staat nu op de C-kaart zelf; hier staat alleen wat je ermee moet doen.
 */
export function D10Kernzin({ kop }) {
  const b = (kop || []).find(r => r.soort === 'B')
  const c = (kop || []).find(r => r.soort === 'C')
  if (!b || !c) return null

  const totaal = (b.laatste_13_maanden || 0) + (c.laatste_13_maanden || 0)
  if (totaal === 0) {
    return (
      <Kernzin>
        <b>Geen klantverlies in dertien maanden.</b> Dat is een gemeten nul — geen ontbrekende meting.
      </Kernzin>
    )
  }

  const adoptie = (b.laatste_13_maanden || 0) >= (c.laatste_13_maanden || 0)
  return (
    <Kernzin>
      <b>{getal(b.laatste_13_maanden)} van de {getal(totaal)} klantverliezen {b.laatste_13_maanden === 1 ? 'is een proef' : 'zijn proeven'}</b>
      {' '}— een {adoptie ? 'adoptievraag, geen retentievraag' : 'retentievraag, niet alleen een adoptievraag'}.
    </Kernzin>
  )
}

/**
 * De subregel onder de kernzin: A en de noemer, de twee kaarten die van dit
 * bord af zijn. Ze staan er nog — klein, op één regel, in deze volgorde.
 *
 * A hoort hier omdat zijn afwezigheid gevaarlijker is dan zijn aanwezigheid:
 * zonder deze regel is niet te zien dát er een derde soort verlies bestaat, en
 * dan wordt hij vroeg of laat bij B opgeteld. De link gaat naar D1, waar hij
 * thuishoort.
 */
export function D10Subregel({ kop, meta, onD1 }) {
  const a = (kop || []).find(r => r.soort === 'A')

  return (
    <div className="d10-subregel" data-zone="kernzin">
      {a && (
        <span>
          <b>A · prospectverlies</b> {getal(a.deze_maand)} deze maand ·{' '}
          {getal(a.laatste_13_maanden)} in 13 mnd — funnelverlies, staat op{' '}
          <button type="button" className="d10-inline-link" onClick={onD1}>D1 ▸</button>
        </span>
      )}
      {meta && (
        <span className="d10-subregel__noemer">
          Noemer {getal(meta.noemer_klantdeals)} klantdeals = {getal(meta.noemer_kantoren)} kantoren ·{' '}
          {getal(meta.klantdeals_incl_proef)} incl. proeven
        </span>
      )}
    </div>
  )
}

/** Contractwaarde als los bedrag, waar geen bereik te maken is. */
export function waardeRegel(bodem, plafond) {
  return bereik(bodem, plafond) || euro(bodem) || null
}
