import { useMemo } from 'react'
import DetailPaneel from '../../../ui/DetailPaneel'
import WorkTable from '../../../ui/WorkTable'
import { getal, euroKort, bereik, datumKort } from '../format'

/**
 * D1Detail — zone 4. De deals achter de regel die links gekozen is.
 *
 * Twee soorten inhoud, één paneel: de deals van een snede-regel, of de regels
 * van een werklijst. Het paneel kiest nooit zelf een eerste regel — wie
 * binnenkomt moet aan het antwoord genoeg hebben; het detail is een
 * vervolgvraag.
 *
 * **De selectie rekent niet, hij kiest.** De maandgrenzen komen uit de
 * forecastview (elke maandregel draagt zijn eigen sleutel `YYYY-MM`); hier
 * wordt alleen gekeken of de beslisdatum van een deal in die sleutel begint.
 * Een deal met een datum die in géén van de getoonde maanden valt hoort bij
 * "later" — precies zoals de view hem telt. Zo staat de datumlogica op één
 * plek en kan het paneel niet een andere november krijgen dan de lijst.
 *
 * De voetnoot zegt daarom altijd `n van m getoond`, met `m` uit de view. Lopen
 * die twee uiteen, dan is dat zichtbaar in plaats van stil.
 */

/** Welke deals horen bij deze regel? Selectie op sleutels, geen datumrekenwerk. */
function kiesDeals(deals, keuze, maandSleutels) {
  if (!keuze) return []
  const { snede, sleutel } = keuze

  if (snede === 'fase') return deals.filter(d => d.fase === sleutel)
  if (snede === 'eigenaar') return deals.filter(d => (d.hubspot_owner_id || 'geen') === sleutel)

  // maand
  if (sleutel === 'geen') return deals.filter(d => !d.beslisdatum)
  if (sleutel === 'later') {
    return deals.filter(d => d.beslisdatum && !maandSleutels.has(String(d.beslisdatum).slice(0, 7)))
  }
  return deals.filter(d => d.beslisdatum && String(d.beslisdatum).slice(0, 7) === sleutel)
}

const DEAL_KOLOMMEN = [
  { key: 'deal', label: 'Deal', breedte: 'minmax(0, 1fr)', klasse: 'wt__naam',
    render: d => d.dealname || '(zonder naam)' },
  { key: 'owner', label: 'Owner', breedte: '52px', klasse: 'wt__mono',
    render: d => d.eigenaar ? d.eigenaar.split(' ')[0] : '—' },
  { key: 'waarde', label: 'Bodem – plafond', breedte: '122px', klasse: 'wt__rechts',
    render: d => bereik(d.mrr_bodem, d.mrr_plafond, euroKort)
      || <span className="d1-rij__leegwaarde">niet gewaardeerd</span> },
  { key: 'link', label: '', breedte: '20px', klasse: 'wt__ext',
    render: d => (d.hubspot_url
      ? <a href={d.hubspot_url} target="_blank" rel="noreferrer" title="Open in HubSpot">↗</a>
      : null) },
]

const WERK_KOLOMMEN = [
  { key: 'deal', label: 'Deal', breedte: 'minmax(0, 1fr)', klasse: 'wt__naam',
    render: r => r.dealname || '(zonder naam)' },
  { key: 'eigenaar', label: 'Owner', breedte: '52px', klasse: 'wt__mono',
    render: r => r.eigenaar ? r.eigenaar.split(' ')[0] : <span className="d1-rij__leegwaarde">geen</span> },
  { key: 'dagen', label: 'Dagen open', breedte: '82px', klasse: 'wt__rechts',
    render: r => getal(r.dagen_open) ?? '—' },
  { key: 'link', label: '', breedte: '20px', klasse: 'wt__ext',
    render: r => (r.hubspot_url
      ? <a href={r.hubspot_url} target="_blank" rel="noreferrer" title="Open in HubSpot">↗</a>
      : null) },
]

const VOET = <>Regel opent <b>HubSpot</b> in een nieuw tabblad · de route van dit bord verandert niet</>

export default function D1Detail({ deals, forecast, werkbord, werkbordTellers, gekozen }) {
  const maandSleutels = useMemo(
    () => new Set((forecast || []).filter(r => r.soort === 'maand').map(r => r.bucket)),
    [forecast],
  )

  const gekozenDeals = useMemo(
    () => kiesDeals(deals || [], gekozen?.snede ? gekozen : null, maandSleutels),
    [deals, gekozen, maandSleutels],
  )

  if (!gekozen) {
    // "links" staat er bewust niet in: op een telefoon zakt de lijst naar
    // bóven het paneel en klopt die aanwijzing niet meer.
    return (
      <DetailPaneel leegTekst="Kies een regel of een werklijst. De deals erachter komen hier te staan, met een link naar HubSpot." />
    )
  }

  // ── Een werklijst ─────────────────────────────────────────────────────────
  if (gekozen.lijst) {
    const teller = (werkbordTellers || []).find(t => t.lijst === gekozen.lijst)
    const rijen = (werkbord || []).filter(r => r.lijst === gekozen.lijst)

    return (
      <DetailPaneel
        titel={teller?.lijst_label || gekozen.naam}
        sub={
          <>
            <b>{getal(teller?.aantal ?? rijen.length)}</b> {rijen.length === 1 ? 'deal' : 'deals'}
            {teller?.toelichting && <> · {teller.toelichting}</>}
          </>
        }
        voet={
          <>
            {getal(rijen.length)} van {getal(teller?.aantal ?? rijen.length)} getoond ·
            {' '}een deal kan op meer dan één werklijst staan. {VOET}
          </>
        }
      >
        <WorkTable
          kolommen={WERK_KOLOMMEN}
          rijen={rijen}
          sleutel={r => `${r.lijst}-${r.deal_id}`}
          leegTekst={`Geen deals op deze lijst. “${teller?.lijst_label || 'Deze lijst'}” staat op nul — dat is een gemeten nul, geen ontbrekende meting.`}
          rijTitel={r => [r.reden, r.beslisdatum ? `beslisdatum ${datumKort(r.beslisdatum)}` : 'geen beslisdatum'].filter(Boolean).join(' · ')}
        />
      </DetailPaneel>
    )
  }

  // ── Een snede-regel ───────────────────────────────────────────────────────
  // Fase 3 eerst, fase 1–2 daaronder onder een eigen kop: ze staan in dezelfde
  // lijst maar nooit in hetzelfde bedrag.
  const f3 = gekozenDeals.filter(d => d.fase === '3')
  const f12 = gekozenDeals.filter(d => d.fase !== '3')
  const perFase = gekozen.snede === 'maand'
  const zonderWaarde = gekozenDeals.filter(d => !d.waardeerbaar).length

  // Bodem, plafond en het aantal komen mee uit de regel die links is gekozen,
  // en dus uit de view — ze worden hier niet opnieuw opgeteld. Twee optellingen
  // over dezelfde deals zijn twee kansen om uiteen te lopen, en de tweede zou
  // niemand opvallen.
  const bandbreedte = bereik(gekozen.bodem, gekozen.plafond, euroKort)
  const uitView = gekozen.aantal ?? null
  const getoond = perFase ? f3.length : gekozenDeals.length

  return (
    <DetailPaneel
      titel={`${gekozen.naam}${perFase ? ' · fase 3' : ''} · ${getal(uitView ?? getoond)} deals`}
      sub={
        <>
          {bandbreedte ? <><b>{bandbreedte}</b> per maand</> : <b>geen gewaardeerde deals</b>}
          {perFase && <> · beslisdatum = verwachte start van de proef</>}
        </>
      }
      voet={
        <>
          {getal(getoond)} van {getal(uitView ?? getoond)} getoond
          {perFase && f12.length > 0 && <> · {getal(f12.length)} in fase 1–2 eronder</>}
          {zonderWaarde > 0 && <> · {getal(zonderWaarde)} zonder waarde {zonderWaarde === 1 ? 'telt' : 'tellen'} niet mee in de bandbreedte</>}
          . {VOET}
        </>
      }
    >
      {gekozenDeals.length === 0 && (
        <div className="bs-leeg">Geen open deals in deze regel.</div>
      )}

      {f3.length > 0 && (
        <WorkTable
          kolommen={DEAL_KOLOMMEN}
          rijen={f3}
          sleutel={d => d.deal_id}
          rijTitel={d => [d.fase_label, d.beslisdatum ? `beslisdatum ${datumKort(d.beslisdatum)}` : 'geen beslisdatum', `${d.dagen_open} dagen open`].filter(Boolean).join(' · ')}
        />
      )}

      {f12.length > 0 && (
        <>
          <div className="bs-groep">
            <span className="bs-groep__naam">Fase 1–2 · indicatief</span>
            <span className="bs-groep__tel">{getal(f12.length)} {f12.length === 1 ? 'deal' : 'deals'} — telt niet mee in het bedrag hierboven</span>
          </div>
          {/* Dezelfde kolommen, maar zonder tweede kolomkop: die zou precies de
              drie regels wegduwen waar hij boven staat. */}
          <div className="d1-detail--vervolg">
            <WorkTable
              kolommen={DEAL_KOLOMMEN}
              rijen={f12}
              sleutel={d => d.deal_id}
              rijTitel={d => [d.fase_label, d.beslisdatum ? `beslisdatum ${datumKort(d.beslisdatum)}` : 'geen beslisdatum'].filter(Boolean).join(' · ')}
            />
          </div>
        </>
      )}
    </DetailPaneel>
  )
}
