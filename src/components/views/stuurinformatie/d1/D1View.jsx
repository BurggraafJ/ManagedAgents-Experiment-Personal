import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useD1Pipeline } from '../../../../hooks/useD1Pipeline'
import BordShell, { BordKop } from '../../../ui/BordShell'
import DataStatusBar from '../../../ui/DataStatusBar'
import D1Antwoord, { D1Kernzin } from './D1Antwoord'
import D1LandtHet from './D1LandtHet'
import D1Detail from './D1Detail'
import { getal } from '../format'
import './d1.css'

/**
 * D1 — Pipeline & forecast (/pipeline).
 *
 * Eén vraag: halen we het kwartaal, en waar zit het lek?
 * Typen: werkbord (dagelijks) · stuurbord (sales-weekly) · diagnosebord
 * (kwartaal, op een eigen route). Eigenaar: Jay (Sales Manager) met Jelle (CD).
 *
 * Vorm sinds v1.181: BordShell, vijf zones, master 58 % / detail 42 %. De
 * pagina scrollt niet — de panelen scrollen. Datzelfde skelet draagt D9 en D10;
 * wie het ene bord kan lezen, leest de andere twee.
 *
 * Dit bord rekent niet. Elk getal komt uit de `v_d1_*`-laag; de component kiest
 * alleen hoe het getoond wordt, en welke dealrijen achter een regel horen. Dat
 * is de les uit de KPI-strip van /klantverlies, die client-side optelde en
 * daardoor jarenlang een getal kon tonen dat bijna twintig keer te hoog was
 * zonder dat iemand het zag.
 *
 * De volgorde van de eerste blik is vastgelegd in de CD-lock van 13-09-2026:
 * **aanvoer links, forecast daarna**, absolute aantallen, fase-splits zichtbaar.
 * Bij een pipelinevorm van 7 · 0 · 25 zit het lek aan de bovenkant van de
 * trechter; een bord dat opent met "waarde fase 3" nodigt uit tot het verkeerde
 * gesprek.
 *
 * Beelden (skill v0.9.1, chart-catalogus mapping D1): **C1** Periodestrip in de
 * hero (kennismakingen, 12 weken, doellijn uit `dash_parameters`), **C5**
 * Bereikstaaf per regel in "Landt het?" — beide uit `ui/charts`, geen
 * bord-lokale variant. **C6** (dekking) pas zodra `kwartaaldoel_mrr` als
 * parameter bestaat; tot dan één amberregel in zone 5 en geen lege kaart.
 *
 * Wat er van dit bord af is en waar het heen ging (Research 1 §B D1 §5):
 *   forecast-staafgrafiek  → de balk ín de maandregel van "Landt het?"
 *   Ontleding-blok         → de sneden fase en eigenaar in datzelfde blok
 *   werkbord-tabs          → de tellers onder de lijst, records in zone 4
 *   dekkingskaart          → één amberregel in zone 5 tot het doel vastligt
 *   win-rate-kaart + hoeken→ /pipeline/kwartaal (de kwartaaldiagnose)
 *   intro- en proxy-alinea → tooltip van het getal
 * Geen van die functies is verdwenen; ze staan alleen niet meer alle zes
 * tegelijk op een maandagochtend.
 */
export default function D1View() {
  const {
    meta, aanvoerKop, aanvoer, perFase, dekking, forecast,
    ontleding, deals, werkbordTellers, werkbord, blokkers,
    loading, error, schemaMissing, refreshedAt, refresh,
  } = useD1Pipeline()

  const nav = useNavigate()
  const [snede, setSnede] = useState('maand')
  const [gekozen, setGekozen] = useState(null)

  // Hooguit twee bronbadges op de regel van 38 px, niet vier. De mirror staat er
  // altijd — zijn leeftijd bepaalt hoeveel elk getal hierboven waard is. De
  // forecastvelden komen er alleen bij zodra ze er níét zijn: een groene badge
  // die "in de mirror" zegt kost de breedte die de amberzin nodig heeft, en die
  // zin is het enige op deze regel waar iemand iets mee moet.
  //
  // Het kwartaaldoel en de kantoorgrootte zijn geen bronnen maar ontbrekende
  // parameters; die horen in `Wat ontbreekt`, en het kwartaaldoel staat
  // bovendien voluit als amberzin op de regel zelf.
  const bronnen = useMemo(() => {
    if (!meta) return []
    const velden = meta.prop_beslisdatum && meta.prop_prijs
    return [
      {
        label: 'HubSpot-mirror',
        status: meta.mirror_verouderd ? 'geel' : 'groen',
        kort: meta.mirror_verouderd ? 'stand ouder dan een uur' : `actueel · ${meta.minuten_oud ?? 0} min`,
        toelichting: meta.mirror_verouderd
          ? 'stand ouder dan een uur — er is een synchronisatie overgeslagen'
          : 'delta-synchronisatie elke 30 minuten, volledige ronde per 24 uur',
      },
      !velden && {
        label: 'Forecast-velden',
        status: 'rood',
        kort: 'ontbreekt',
        toelichting: 'beslisdatum of prijs staat nog niet in de mirror — de forecast hierboven rust dan op een onvolledige basis',
      },
    ].filter(Boolean)
  }, [meta])

  // Achter `▸ Wat ontbreekt (n)`: hoogstens 25 woorden per regel (principes.md
  // regel 21). Wat meer uitleg nodig heeft, staat op de D-pagina.
  const meldingen = useMemo(() => {
    if (!meta) return []
    const uit = []
    if (!dekking?.kwartaaldoel_mrr) {
      uit.push(
        'Kwartaaldoel niet vastgelegd: het staat handmatig op Omzet & Doelen (peildatum 12-08-2026) ' +
        'en nog niet in dash_parameters. Zonder doel geen dekking en geen doelstaaf.'
      )
    }
    if (blokkers && blokkers.aantal !== null && blokkers.aantal !== undefined) {
      uit.push(
        `${getal(blokkers.aantal)} van ${getal(blokkers.noemer)} open sales-deals draagt een blokkerende ` +
        'hygiënefout en vertekent de forecast. De records staan op het datakwaliteitsbord.' +
        ((blokkers.blind_voor || []).length > 0
          ? ` Blind voor ${blokkers.blind_voor.join(' · ')}: dit getal is een ondergrens.`
          : '')
      )
    }
    uit.push(
      `${getal(meta.closedate_onbruikbaar)} van ${getal(meta.open_deals)} open deals heeft geen ` +
      `bruikbare afsluitdatum (${getal(meta.closedate_leeg)} leeg, ${getal(meta.closedate_verlopen)} verlopen). ` +
      'Dit bord forecast daarom op beslisdatum, de verwachte start van de proef.'
    )
    if (!meta.segment_bruikbaar) {
      uit.push(
        `${getal(meta.companies_met_omvang)} van ${getal(meta.companies_zichtbaar)} companies draagt ` +
        'kantoorgrootte; de company-sync haalt 2.000 per ronde. De segment-snede staat daarom zichtbaar uit.'
      )
    }
    if (meta.verloren_zonder_reden > 0) {
      uit.push(
        `${getal(meta.verloren_zonder_reden)} van ${getal(meta.verloren)} verloren deals heeft geen ` +
        'verliesreden. De win rate klopt, het waarom erachter is niet te meten.'
      )
    }
    if ((meta.trend_dagen || 0) === 0) {
      uit.push('Nog geen dagsnapshots in snap_deal_dag, dus geen pipeline-trend en geen slippage. Elke dag zonder snapshot is trend die niet terugkomt.')
    }
    return uit
  }, [meta, dekking, blokkers])

  // Zone 5 draagt de dekking als één amberregel zolang er geen doel is
  // (ontwerplock variant c2; chart-catalogus §C6 "Niet"). Een vijfde kaart die
  // uitlegt waarom hij leeg is, kost een kaartbreedte aan een niet-meting.
  // De definitie van de beslisdatum is soort-3-tekst en staat in de popover-
  // voetnoot, niet op de regel (principes.md regel 21).
  const zin = useMemo(() => {
    if (!dekking?.kwartaaldoel_mrr) {
      return <span className="dsb-warn">⚠ Kwartaaldoel niet vastgelegd — geen dekking te tonen.</span>
    }
    return <>Dekking {dekking.kwartaal_label} · plafond fase 3 tegen het kwartaaldoel</>
  }, [dekking])

  const geenRechten = !loading && !error && !schemaMissing && (meta?.deals_zichtbaar ?? 0) === 0

  const kop = (
    <BordKop
      kruimel="Stuurinformatie · D1"
      vraag="Halen we het kwartaal, en waar zit het lek?"
      meta={<>sales-weekly · <b>Jay</b> met <b>Jelle</b></>}
      acties={
        <>
          <button type="button" className="bs-btn" onClick={() => nav('/pipeline/hygiene')}>
            Datakwaliteit
          </button>
          <button type="button" className="bs-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Verversen…' : 'Ververs'}
          </button>
        </>
      }
    />
  )

  if (loading || schemaMissing || error || geenRechten) {
    return (
      <div className="bs bs--d1">
        {kop}
        {loading && (
          <>
            <div className="skeleton" style={{ height: 148 }} />
            <div className="skeleton" style={{ height: 20, maxWidth: 460 }} />
            <div className="skeleton" style={{ flex: 1, minHeight: 160 }} />
          </>
        )}

        {!loading && schemaMissing && (
          <div className="d1-melding d1-melding--info">
            <b>De metric-laag staat nog niet in de database.</b>
            <p>
              De views <code>v_d1_pipeline_per_fase</code>, <code>v_d1_forecast_per_maand</code>,{' '}
              <code>v_d1_ontleding</code>, <code>v_d1_werkbord</code> en <code>v_d1_dekking</code> komen
              uit de migraties <code>20260913100000</code> en <code>20260913101000</code>. Rol die uit,
              dan vult dit bord zichzelf — er is geen tweede stap in de app nodig.
            </p>
          </div>
        )}

        {!loading && error && (
          <div className="d1-melding d1-melding--fout">
            Kan de pipelinegegevens niet ophalen: {error}
          </div>
        )}

        {!loading && geenRechten && (
          <div className="d1-melding d1-melding--info">
            <b>Geen records — of geen rechten.</b>
            <p>
              Dit bord leest de HubSpot-mirror, en die is afgeschermd met beheerdersrechten plus een
              tweede factor. Wie daar niet aan voldoet krijgt nul rijen terug en géén foutmelding.
              Nul betekent hier dus niet "geen pipeline".
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <BordShell
      className="bs--d1"
      kop={kop}
      antwoord={
        <D1Antwoord
          aanvoerKop={aanvoerKop}
          aanvoer={aanvoer}
          perFase={perFase}
          meta={meta}
          blokkers={blokkers}
          onD9={() => nav('/pipeline/hygiene')}
        />
      }
      kernzin={<D1Kernzin perFase={perFase} />}
      master={
        <D1LandtHet
          forecast={forecast}
          ontleding={ontleding}
          meta={meta}
          werkbordTellers={werkbordTellers}
          snede={snede}
          onSnede={(id) => { setSnede(id); setGekozen(null) }}
          gekozen={gekozen}
          onKies={setGekozen}
        />
      }
      detail={
        <D1Detail
          deals={deals}
          forecast={forecast}
          werkbord={werkbord}
          werkbordTellers={werkbordTellers}
          gekozen={gekozen}
        />
      }
      vertrouwen={
        <DataStatusBar
          variant="compact"
          peildatum={meta?.peildatum}
          minutenOud={meta?.minuten_oud}
          verouderd={!!meta?.mirror_verouderd}
          bronnen={bronnen}
          meldingen={meldingen}
          zin={zin}
          actie={{ label: 'Kwartaaldiagnose ▸', onClick: () => nav('/pipeline/kwartaal') }}
          voetnoot={
            <>
              Bron: HubSpot-mirror (<code>hubspot_deals</code>) via de metric-laag <code>v_d1_*</code> ·
              fase-indeling uit <code>dim_stage_fase</code> · doelen, drempels en prijzen uit{' '}
              <code>dash_parameters</code> · trend uit <code>snap_deal_dag</code> (dagelijks 07:40 NL).
              Beslisdatum = <code>verwachte_start_pilot</code> (besluit Jelle 01-09-2026).
              Forecast-velden (beslisdatum, minimumafname, contractomvang, prijs):{' '}
              {meta?.prop_beslisdatum && meta?.prop_prijs
                ? 'alle vier in de mirror.'
                : 'nog niet volledig in de mirror — zie de rode bronbadge.'}
              {' '}Win rate, segment en salescyclus staan op de kwartaaldiagnose — dat is
              kwartaalwerk, geen maandagochtend.
              {refreshedAt && <> Scherm ververst {refreshedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}, daarna elke 5 minuten.</>}
            </>
          }
        />
      }
    />
  )
}
