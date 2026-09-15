import { useMemo } from 'react'
import DetailPaneel from '../../../ui/DetailPaneel'
import WorkTable from '../../../ui/WorkTable'
import { weekNr } from './AanvoerStrip'
import { kanaalLabel } from './kanaalLabels'
import { getal, euroKort, bereik, datumKort } from '../format'

/**
 * D1Detail — zone 4. De deals achter wat er links (of bóven) gekozen is.
 *
 * **Eén paneel, drie ingangen** (de gedeelde sink, v0.9.2): de deals van een
 * snede-regel, de regels van een werklijst, en — nieuw — de kennismakingen van
 * één week uit de periodestrip in zone 2. Dat laatste is wat een hero-chart een
 * drill-pad geeft zonder een tweede route te openen: het beeld dat de eerste
 * blik draagt, schrijft naar hetzelfde paneel als de lijst eronder. De kop van
 * het paneel zegt daarom altijd wélke selectie erin staat ("Week 36" tegenover
 * "Fase 3"); zonder dat weet je bij de derde ingang niet meer wat je aankijkt.
 *
 * Het paneel kiest nooit zelf een eerste regel — wie binnenkomt moet aan het
 * antwoord genoeg hebben; het detail is een vervolgvraag.
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
  { key: 'grootte', label: 'Grootte', breedte: '56px', klasse: 'wt__rechts wt__mono',
    render: d => d.totale_omvang != null ? getal(d.totale_omvang) : <span className="d1-rij__leegwaarde">–</span> },
  { key: 'afname', label: 'Afname', breedte: '56px', klasse: 'wt__rechts wt__mono',
    render: d => d.bodem_lic != null ? getal(d.bodem_lic) : <span className="d1-rij__leegwaarde">–</span> },
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

/* De kennismakingen van één week. Geen bedragen: een kennismaking is een
   gesprek, geen kans met een bodem en een plafond — die staan pas in de
   forecastregels. Wél de stand van vandaag, want de helft van de vraag achter
   een staaf is "en wat is daarvan geworden?". */
const WEEK_KOLOMMEN = [
  { key: 'deal', label: 'Deal', breedte: 'minmax(0, 1fr)', klasse: 'wt__naam',
    render: d => d.dealname || '(zonder naam)' },
  { key: 'owner', label: 'Owner', breedte: '52px', klasse: 'wt__mono',
    render: d => d.eigenaar ? d.eigenaar.split(' ')[0] : '—' },
  { key: 'grootte', label: 'Grootte', breedte: '56px', klasse: 'wt__rechts wt__mono',
    render: d => d.totale_omvang != null ? getal(d.totale_omvang) : <span className="d1-rij__leegwaarde">–</span> },
  { key: 'segment', label: 'ICP', breedte: '42px', klasse: 'wt__mono',
    render: d => d.segment_bucket || <span className="d1-rij__leegwaarde">–</span> },
  { key: 'stand', label: 'Stand nu', breedte: '120px', klasse: 'wt__rechts d1-rij__stand',
    render: d => d.stage_label || d.fase_label || '—' },
  { key: 'link', label: '', breedte: '20px', klasse: 'wt__ext',
    render: d => (d.hubspot_url
      ? <a href={d.hubspot_url} target="_blank" rel="noreferrer" title="Open in HubSpot">↗</a>
      : null) },
]

const VOET = <>Regel opent <b>HubSpot</b> in een nieuw tabblad · de route van dit bord verandert niet</>

export default function D1Detail({ deals, aanvoerDeals, forecast, werkbord, werkbordTellers, gekozen }) {
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
    // bóven het paneel en klopt die aanwijzing niet meer. En sinds de strip
    // ook een ingang is, zou "links" bovendien de helft van de waarheid zijn.
    return (
      <DetailPaneel leegTekst="Kies een regel, een werklijst of een week in de strip. De deals erachter komen hier te staan, met een link naar HubSpot." />
    )
  }

  // ── Een week uit de aanvoerstrip (C1 → zone 4) ────────────────────────────
  if (gekozen.week) {
    const w = gekozen.week
    // Dezelfde regel als in v_d1_aanvoer: gehouden is "tot en met vandaag".
    // Een kennismaking die in deze week nog gepland staat telt niet mee in de
    // staaf, en hoort dus ook niet in de lijst eronder — maar hij wordt wel
    // genoemd, anders is het verschil tussen "niets gebeurd" en "staat nog te
    // gebeuren" van het scherm af.
    const vandaag = new Date().toISOString().slice(0, 10)
    const inWeek = (aanvoerDeals || []).filter(d =>
      d.kennismaking && d.kennismaking >= w.week_start && d.kennismaking <= w.week_eind)
    const gehouden = inWeek
      .filter(d => d.kennismaking <= vandaag)
      .sort((a, b) => (b.totale_omvang ?? -1) - (a.totale_omvang ?? -1))
    const uitView = w.kennismakingen ?? null
    const open = gehouden.filter(d => d.is_open).length

    return (
      <DetailPaneel
        titel={`Week ${weekNr(w.week_label)} · ${getal(uitView ?? gehouden.length)} ${(uitView ?? gehouden.length) === 1 ? 'kennismaking' : 'kennismakingen'}`}
        sub={
          <>
            {datumKort(w.week_start)} – {datumKort(w.week_eind)}
            {w.is_huidige_week
              ? <> · <b>loopt nog</b>, telt niet mee in de reeks</>
              : <> · <b>{getal(open)}</b> nog open</>}
          </>
        }
        voet={
          <>
            {getal(gehouden.length)} van {getal(uitView ?? gehouden.length)} getoond
            {w.kennismakingen_gepland > 0 && <> · {getal(w.kennismakingen_gepland)} in deze week nog gepland, buiten de telling</>}
            {' '}· deze lijst toont ook deals die intussen gewonnen of verloren zijn. {VOET}
          </>
        }
      >
        <WorkTable
          kolommen={WEEK_KOLOMMEN}
          rijen={gehouden}
          sleutel={d => d.deal_id}
          leegTekst={uitView === 0
            ? 'Geen kennismakingen in deze week. Dat is een gemeten nul, geen ontbrekende meting.'
            : 'De staaf telt kennismakingen die hier niet als rij terugkomen — meld dit, het hoort niet te kunnen.'}
          rijTitel={d => [`kennismaking ${datumKort(d.kennismaking)}`, d.stage_label, d.beslisdatum ? `beslisdatum ${datumKort(d.beslisdatum)}` : null].filter(Boolean).join(' · ')}
        />
      </DetailPaneel>
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

  // ── Een kanaal-chip ──────────────────────────────────────────────────────
  if (gekozen.kanaal) {
    const rijen = (deals || []).filter(d => d.kanaal === gekozen.kanaal)
      .sort((a, b) => (b.mrr_plafond ?? -1) - (a.mrr_plafond ?? -1))
    const label = kanaalLabel(gekozen.kanaal)

    return (
      <DetailPaneel
        titel={`${label} · ${getal(rijen.length)} open ${rijen.length === 1 ? 'deal' : 'deals'}`}
        sub={<>Acquisitiekanaal <b>{label}</b> · alle open fases</>}
        voet={<>{getal(rijen.length)} getoond · bron: hs_analytics_source. {VOET}</>}
      >
        <WorkTable
          kolommen={DEAL_KOLOMMEN}
          rijen={rijen}
          sleutel={d => d.deal_id}
          leegTekst={`Geen open deals met kanaal "${label}".`}
          rijTitel={d => [d.fase_label, d.eigenaar, d.beslisdatum ? `beslisdatum ${datumKort(d.beslisdatum)}` : null].filter(Boolean).join(' · ')}
        />
      </DetailPaneel>
    )
  }

  // ── Een ICP-chip ───────────────────────────────────────────────────────
  if (gekozen.segment) {
    const rijen = (deals || []).filter(d => d.segment_bucket === gekozen.segment)
      .sort((a, b) => (b.mrr_plafond ?? -1) - (a.mrr_plafond ?? -1))

    return (
      <DetailPaneel
        titel={`${gekozen.segment} · ${getal(rijen.length)} open ${rijen.length === 1 ? 'deal' : 'deals'}`}
        sub={<>ICP-segment <b>{gekozen.segment}</b> · alle open fases</>}
        voet={<>{getal(rijen.length)} getoond · segment op kantoorgrootte. {VOET}</>}
      >
        <WorkTable
          kolommen={DEAL_KOLOMMEN}
          rijen={rijen}
          sleutel={d => d.deal_id}
          leegTekst={`Geen open deals in segment "${gekozen.segment}".`}
          rijTitel={d => [d.fase_label, d.eigenaar, d.beslisdatum ? `beslisdatum ${datumKort(d.beslisdatum)}` : null].filter(Boolean).join(' · ')}
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
