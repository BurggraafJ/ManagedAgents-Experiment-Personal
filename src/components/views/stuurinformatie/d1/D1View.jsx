import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useD1Pipeline } from '../../../../hooks/useD1Pipeline'
import DataStatusBar from '../../../ui/DataStatusBar'
import D1Kaarten from './D1Kaarten'
import ForecastBars from './ForecastBars'
import WinRateHoeken from './WinRateHoeken'
import Ontleding from './Ontleding'
import WerkbordTabs from './WerkbordTabs'
import { getal } from './format'
import './d1.css'

/**
 * D1 — Pipeline & forecast (/pipeline).
 *
 * Eén vraag: halen we het kwartaal, en waar zit het lek?
 * Typen: werkbord (dagelijks) · stuurbord (sales-weekly) · diagnosebord
 * (kwartaal). Eigenaar: Jay (Sales Manager) met Jelle (CD).
 *
 * Dit bord rekent niet. Elk getal komt uit de `v_d1_*`-laag; de component kiest
 * alleen hoe het getoond wordt. Dat is de les uit de KPI-strip van
 * /klantverlies, die client-side optelde en daardoor jarenlang een getal kon
 * tonen dat bijna twintig keer te hoog was zonder dat iemand het zag.
 *
 * De volgorde van de eerste blik is vastgelegd in de CD-lock van 13-09-2026:
 * **aanvoer links, forecast daarna**, absolute aantallen, fase-splits zichtbaar.
 * Bij een pipelinevorm van 7 · 0 · 25 zit het lek aan de bovenkant van de
 * trechter; een bord dat opent met "waarde fase 3" nodigt uit tot het verkeerde
 * gesprek.
 */
export default function D1View() {
  const {
    meta, aanvoerKop, aanvoer, perFase, dekking, winRate, forecast,
    ontleding, werkbordTellers, werkbord, blokkers,
    loading, error, schemaMissing, refreshedAt, refresh,
  } = useD1Pipeline()

  const nav = useNavigate()

  const bronnen = useMemo(() => {
    if (!meta) return []
    return [
      {
        label: 'HubSpot-mirror',
        status: meta.mirror_verouderd ? 'geel' : 'groen',
        toelichting: meta.mirror_verouderd
          ? 'stand ouder dan een uur'
          : 'delta-synchronisatie elke 30 minuten, volledige ronde per 24 uur',
      },
      {
        label: 'Forecast-velden',
        status: (meta.prop_beslisdatum && meta.prop_prijs) ? 'groen' : 'rood',
        toelichting: (meta.prop_beslisdatum && meta.prop_prijs)
          ? 'beslisdatum, minimumafname, contractomvang en prijs staan in de mirror'
          : 'beslisdatum of prijs staat nog niet in de mirror',
      },
      {
        label: 'Kwartaaldoel',
        status: dekking?.kwartaaldoel_mrr ? 'groen' : 'geel',
        toelichting: dekking?.kwartaaldoel_mrr
          ? 'vastgelegd in dash_parameters'
          : 'niet vastgelegd — de dekkingskaart blijft leeg',
      },
      {
        label: 'Kantoorgrootte',
        status: meta.segment_bruikbaar ? 'groen' : 'rood',
        toelichting: `${getal(meta.companies_met_omvang)} van ${getal(meta.companies_zichtbaar)} companies — geen segment-ontleding`,
      },
      {
        label: 'Pipeline-trend',
        status: (meta.trend_dagen || 0) >= 14 ? 'groen' : 'geel',
        toelichting: (meta.trend_dagen || 0) === 0
          ? 'nog geen dagsnapshots'
          : `${meta.trend_dagen} dagen gemeten`,
      },
    ]
  }, [meta, dekking])

  const meldingen = useMemo(() => {
    if (!meta) return []
    const uit = []
    if (blokkers && blokkers.aantal !== null && blokkers.aantal !== undefined) {
      uit.push(
        `${getal(blokkers.aantal)} van ${getal(blokkers.noemer)} open sales-deals heeft minstens één ` +
        `blokkerende hygiënefout — die deals vertekenen de forecast hierboven. Open het ` +
        `datakwaliteitsbord voor de records.` +
        ((blokkers.blind_voor || []).length > 0
          ? ` Let op: ${blokkers.blind_voor.join(' · ')} telt nog niet mee, dus dit getal is een ondergrens.`
          : '')
      )
    }
    uit.push(
      `${getal(meta.closedate_onbruikbaar)} van ${getal(meta.open_deals)} open deals heeft geen ` +
      `bruikbare afsluitdatum (${getal(meta.closedate_leeg)} leeg, ${getal(meta.closedate_verlopen)} verlopen). ` +
      `Dit bord forecast daarom op beslisdatum, niet op closedate.`
    )
    if (meta.verloren_zonder_reden > 0) {
      uit.push(
        `${getal(meta.verloren_zonder_reden)} van ${getal(meta.verloren)} verloren deals heeft geen ` +
        `verliesreden. De win rate klopt, maar het "waarom" erachter is niet te meten.`
      )
    }
    if ((meta.trend_dagen || 0) === 0) {
      uit.push('Er zijn nog geen dagsnapshots, dus geen pipeline-trend en geen slippage. De eerste vulling van snap_deal_dag start de reeks; elke dag zonder snapshot is trend die niet meer terugkomt.')
    }
    return uit
  }, [meta, blokkers])

  const geenRechten = !loading && !error && !schemaMissing && (meta?.deals_zichtbaar ?? 0) === 0

  return (
    <div className="d1-app">
      <header className="d1-topbar">
        <div className="d1-crumbs">
          <span className="d1-crumb">Werkruimte</span>
          <span className="d1-crumb-sep">/</span>
          <span className="d1-crumb">Stuurinformatie</span>
          <span className="d1-crumb-sep">/</span>
          <span className="d1-crumb-current">Pipeline</span>
        </div>
        <div className="d1-topbar__right">
          <span className="d1-ritme" title="Werkbord dagelijks · stuurbord in de sales-weekly · diagnose per kwartaal">
            Sales-weekly · eigenaar Jay (sales) met Jelle (CD)
          </span>
          <button type="button" className="d1-btn d1-btn--sm" onClick={() => nav('/pipeline/hygiene')}>
            Datakwaliteit
          </button>
          <button type="button" className="d1-btn d1-btn--sm" onClick={refresh} disabled={loading}>
            {loading ? 'Verversen…' : 'Ververs'}
          </button>
        </div>
      </header>

      <div className="d1-card">
        <div className="d1-card-inner">
          <div className="d1-wrap">
            <div className="d1-ph">
              <div>
                <div className="d1-ph__eyebrow"><span className="d1-ph__eyebrow-dot" />Stuurinformatie · D1</div>
                <h2 className="d1-ph__title">Halen we het kwartaal, en waar zit het lek?</h2>
                <p className="d1-ph__intro">
                  Aanvoer eerst, forecast daarna. Aantallen zijn absoluut; waardes altijd als bodem–plafond
                  en op beslisdatum, nooit op afsluitdatum. Wat niet gemeten kan worden staat als lege plek
                  op het bord, niet als nul.
                </p>
              </div>
            </div>

            {loading && (
              <>
                <div className="skeleton" style={{ height: 148 }} />
                <div className="skeleton" style={{ height: 240 }} />
                <div className="skeleton" style={{ height: 320 }} />
              </>
            )}

            {!loading && schemaMissing && (
              <div className="d1-melding d1-melding--info">
                <b>De metric-laag staat nog niet in de database.</b>
                <p>
                  De views <code>v_d1_pipeline_per_fase</code>, <code>v_d1_forecast_per_maand</code>,{' '}
                  <code>v_d1_win_rate</code>, <code>v_d1_werkbord</code> en <code>v_d1_dekking</code> komen
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

            {!loading && !schemaMissing && !error && !geenRechten && (
              <>
                <D1Kaarten
                  aanvoerKop={aanvoerKop}
                  aanvoer={aanvoer}
                  perFase={perFase}
                  dekking={dekking}
                  winRate={winRate}
                  meta={meta}
                />
                <ForecastBars forecast={forecast} />
                <WinRateHoeken winRate={winRate} />
                <Ontleding ontleding={ontleding} meta={meta} />

                <DataStatusBar
                  peildatum={meta?.peildatum}
                  minutenOud={meta?.minuten_oud}
                  verouderd={!!meta?.mirror_verouderd}
                  bronnen={bronnen}
                  meldingen={meldingen}
                  actie={{ label: 'Naar Datakwaliteit & hygiëne →', onClick: () => nav('/pipeline/hygiene') }}
                />

                <WerkbordTabs werkbordTellers={werkbordTellers} werkbord={werkbord} />
              </>
            )}

            <div className="d1-foot">
              Bron: HubSpot-mirror (<code>hubspot_deals</code>) via de metric-laag <code>v_d1_*</code> ·
              fase-indeling uit <code>dim_stage_fase</code> · doelen, drempels en prijzen uit{' '}
              <code>dash_parameters</code> · trend uit <code>snap_deal_dag</code> (dagelijks 07:40 NL).
              Beslisdatum = <code>verwachte_start_pilot</code> (besluit Jelle 01-09-2026).
              {refreshedAt && <> · scherm ververst {refreshedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}, daarna elke 5 minuten.</>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
