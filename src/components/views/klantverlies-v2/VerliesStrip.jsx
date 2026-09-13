import MetricCard from '../../ui/MetricCard'
import { getal, euro, bereik } from '../stuurinformatie/format'

/**
 * VerliesStrip — de eerste blik van D10: drie soorten verlies naast elkaar,
 * plus de noemer waartegen ze gelezen moeten worden.
 *
 * Dit bestand is de opvolger van `KpiStrip.jsx` (v1.174 en eerder). Die strip
 * deed drie dingen die dit bord verbiedt: hij telde B en C op tot één "Totaal
 * verloren", hij las `hubspot_deals.amount` als MRR (dat veld is nul op álle
 * beëindigde klantdeals, dus de kaart toonde structureel "—"), en hij dateerde
 * op `churned_at ?? closedate` zonder te zeggen welke van de twee je zag.
 * De vier oude kaarten komen alle vier terug — twee van betekenis gewijzigd,
 * en die wijziging is precies waarom deze strip bestaat (CD-lock OB-8):
 *
 *   Totaal verloren   → uit elkaar getrokken in A, B en C; het oude getal
 *                       beschrijft de dossiertabel en staat daar nu ook
 *   Deze maand        → blijft, maar per soort, met de vorige maand ernaast
 *   Top-reden 30 dgn  → blijft, in het Waarom-blok, mét zijn bronlabel
 *   Verloren MRR      → vervangen door contractwaarde bodem–plafond
 *
 * Eén regel draagt de hele strip: **A, B en C worden nooit opgeteld.** Elke
 * kaart zegt in woorden of hij churn is. Alleen C is dat.
 */

// Kaartvolgorde en -toon per soort. B is het stuurgetal (CD-lock): niet omdat
// het het grootste getal is, maar omdat het het getal is waar iemand iets aan
// kan doen — negentien van de twintig verliezen zitten in de proef.
const TOON = { A: 'normaal', B: 'hero', C: 'normaal' }

function Chip({ soort, label }) {
  return (
    <span className={`d10-chip d10-chip--${soort === 'C' ? 'churn' : 'geen'}`}>
      {label}
    </span>
  )
}

export default function VerliesStrip({ kop, meta }) {
  const byId = Object.fromEntries(kop.map(r => [r.soort, r]))
  const a = byId.A, b = byId.B, c = byId.C

  return (
    <div className="d10-strip">
      {a && (
        <MetricCard
          label="A · Prospectverlies"
          waarde={getal(a.deze_maand)}
          waardeSuffix="deze maand"
          toon={TOON.A}
          vergelijking={`vorige maand ${getal(a.vorige_maand)} · ${getal(a.laatste_13_maanden)} in 13 maanden`}
          basis={`${getal(a.totaal)} deals staan in een verliesstage`}
        >
          <Chip soort="A" label={a.churn_label} />
          <p className="d10-kaart__voet">
            Verliesmaand uit de stage-datum — {getal(meta?.a_stage_entry)} van {getal(meta?.a_totaal)}.
            Geen contractwaarde: dit is pipeline, geen contract.
          </p>
        </MetricCard>
      )}

      {b && (
        /* Het inzicht van B zit niet in "deze maand" maar in het venster van
           dertien maanden: 19 van de 20 verliezen. Dat getal staat daarom even
           groot en direct onder het maandcijfer, zodat de maandagochtend-blik
           er niet op een kleine 2 blijft hangen (CD-review D10 v1.175). Het is
           dezelfde reeks in een ander venster — geen optelling met A of C. */
        <MetricCard
          label="B · Proef niet omgezet"
          merk="stuurgetal"
          waarde={getal(b.deze_maand)}
          waardeSuffix="deze maand"
          waarde2={getal(b.laatste_13_maanden)}
          waarde2Suffix="in 13 maanden"
          toon={TOON.B}
          vergelijking={`vorige maand ${getal(b.vorige_maand)} · ${getal(meta?.proeven)} proeven lopen nu`}
          basis={`mediaan ${getal(b.duur_mediaan)} dagen na start (${getal(b.duur_min)}–${getal(b.duur_max)})`}
        >
          <Chip soort="B" label={b.churn_label} />
          <p className="d10-kaart__voet">
            {bereik(b.waarde_bodem, b.waarde_plafond) || '—'} contractwaarde per maand
            {b.plafond_bekend < b.totaal && ` · ${getal(b.totaal - b.plafond_bekend)} zonder plafond`}
            {' '}— uit HubSpot, <b>niet gefactureerd</b> (AFAS niet gekoppeld).
          </p>
        </MetricCard>
      )}

      {c && (
        <MetricCard
          label="C · Opzegging"
          merk="churn"
          waarde={getal(c.deze_maand)}
          waardeSuffix="deze maand"
          toon={TOON.C}
          vergelijking={`vorige maand ${getal(c.vorige_maand)} · ${getal(c.laatste_13_maanden)} in 13 maanden`}
          basis={c.totaal > 0
            ? `${getal(c.duur_mediaan)} dagen na start · ${bereik(c.waarde_bodem, c.waarde_plafond) || '—'} per maand`
            : 'geen opzegging in het venster'}
        >
          <Chip soort="C" label={c.churn_label} />
          <p className="d10-kaart__voet">
            {meta?.churn_pct_toonbaar
              ? 'Churnpercentage staat in de diagnose, met beide noemers.'
              : `Geen churnpercentage: ${getal(c.laatste_13_maanden)} waarneming${c.laatste_13_maanden === 1 ? '' : 'en'} in 13 maanden. Onder de tien is elk percentage ruis.`}
          </p>
        </MetricCard>
      )}

      <MetricCard
        label="Noemer"
        waarde={getal(meta?.noemer_klantdeals)}
        waardeSuffix="klantdeals"
        vergelijking={`${getal(meta?.noemer_kantoren)} kantoren · ${getal(meta?.klantdeals_incl_proef)} incl. proeven`}
        basis="actief + vernieuwd in de Customer Base"
      >
        <span className="d10-chip d10-chip--bron">deal-telling ≠ klant-telling</span>
        <p className="d10-kaart__voet">
          {getal(meta?.noemer_klantdeals)} deals zijn {getal(meta?.noemer_kantoren)} kantoren — welke van de twee
          de noemer is, verandert elk percentage. AFAS is niet gekoppeld, dus een telling
          van <b>betalende</b> klanten bestaat hier niet.
        </p>
      </MetricCard>
    </div>
  )
}

/**
 * VerliesKernzin — de zin die dit bord bestaat om te kunnen zeggen. Staat
 * bewust in tekst en niet als vierde getal: het gaat om de verhouding tussen de
 * twee soorten, en een getal daarvoor zou meteen weer iemand verleiden er iets
 * bij op te tellen.
 */
export function VerliesKernzin({ kop }) {
  const b = kop.find(r => r.soort === 'B')
  const c = kop.find(r => r.soort === 'C')
  if (!b || !c) return null
  const totaal = (b.laatste_13_maanden || 0) + (c.laatste_13_maanden || 0)
  if (totaal === 0) return null

  return (
    <p className="d10-kernzin">
      <b>{getal(b.laatste_13_maanden)} van de {getal(totaal)}</b> klantverliezen in dertien maanden zijn
      proeven die niet zijn omgezet; <b>{getal(c.laatste_13_maanden)}</b> is een opzegging in de
      licentieperiode. Dat is een adoptievraag, geen retentievraag — en het is de reden dat
      B hierboven het stuurgetal is en niet het churnpercentage.
      {c.waarde_bodem != null && (
        <> De enige opzegging kostte {bereik(c.waarde_bodem, c.waarde_plafond) || euro(c.waarde_bodem)} contractwaarde per maand.</>
      )}
    </p>
  )
}
