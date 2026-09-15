import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useD1Pipeline } from '../../../../hooks/useD1Pipeline'
import BordShell, { BordKop, BordTabs, BordToggle } from '../../../ui/BordShell'
import BordPeriode from '../../../ui/BordPeriode'
import DataStatusBar from '../../../ui/DataStatusBar'
import D1Live from './live/D1Live'
import D1Detail from './live/D1Detail'
import { getal } from '../format'
import './d1.css'
import './live/d1live.css'

/**
 * D1 — Pipeline & forecast, tab Live (/pipeline).
 *
 * Eén vraag: komt er genoeg van de juiste kantoren binnen, en landt het op
 * tijd? Eigenaar: Jay (Sales Manager) met Jelle (CD), sales-weekly.
 *
 * Vorm sinds v1.209 (Design ronde 5, Jelle-lock 2026-09-15): zeven kaarten met
 * Visx-charts in twee rijen — Kennismakingen · Tijd in fase · Landt het? ·
 * (Waarde) · Beweging · Leadsource · Kantoorgrootte — en één detail-sink rechts.
 * Geen HeroStrip, geen Aanvoerstrip, geen werktellers: PR #128 is afgewezen en
 * dit bord is opnieuw gebouwd vanuit het ontwerp, niet vanuit de vorige code.
 *
 * Wat vast ligt (skill dashboard-build-preferences):
 *   • witte standaardbalk: Live | Monthly · [◂ Overzicht] · periodefilter — Deals | Licenties · ● Sync
 *   • één selectie-state voor het hele bord (D1Live)
 *   • hover = één zin + de getallen van de snede; klik = de records in de sink
 *   • de pagina scrollt niet (BordShell); onder 1000 px stapelen de kaarten
 *
 * Focus-split (v1.210, Jelle 2026-09-15): mét een selectie wordt het bord een
 * 50/50 — alleen de gekozen kaart links, de sink breed rechts. `is-focus` op de
 * shell stuurt de kolommen (d1live.css). Op een telefoon is er geen
 * naast-elkaar: de sink vult het scherm en draagt zelf de terugknop (D1Detail).
 *
 * Polish v1.211 (Jelle 15-09-2026, D1-LIVE-POLISH-2026-09-15.md):
 *   • de weg terug is één knop, `◂ Overzicht` in de balk naast Live | Monthly,
 *     alleen zichtbaar in focus; Esc blijft als stille sneltoets (geen hint);
 *     de tweede klik op dezelfde snede wist niets meer;
 *   • geen vraagregel en geen meta meer boven het bord — de kop is de balk;
 *     het Sync-paneel opent alleen nog op klik (`stil`), niet op hover;
 *   • Kanaal heet in de UI Leadsource (de data blijft `hs_analytics_source`);
 *   • het kennismakingen-detail draagt altijd kantoorgrootte, kennismakingdatum
 *     en pipeline.
 *
 * Polish 2 v1.212 (Jelle 15-09-2026 ~20:41, D1-LIVE-POLISH-2-IDLE.md):
 *   • idle heeft géén detailkolom meer — `detail` is null tot er een selectie is
 *     en de zeven kaarten krijgen de hele breedte; de lege "klik een staaf"-sink
 *     bestaat niet meer;
 *   • `◂ Overzicht` is de eerste, primaire knop in de balk (vóór Live | Monthly),
 *     nog steeds alleen in focus; Esc blijft stil, geen tweede-klik-wissen.
 *
 * Dit bord rekent niet. Elk getal komt uit de `v_d1_*`-laag (migratie
 * 20260915130000); de kaarten kiezen alleen hoe het getoond wordt.
 */
export default function D1View() {
  const data = useD1Pipeline()
  const { meta, dekking, blokkers, loading, error, schemaMissing, refreshedAt, refresh } = data

  const nav = useNavigate()
  const [periode, setPeriode] = useState('half')
  const [modus, setModus] = useState('deals')
  const [gekozen, setGekozen] = useState(null)
  const focus = !!gekozen

  // Esc = terug naar de grid. Op window en niet op de kaart: het toetsenbord-
  // focus ligt na een klik op een <rect>, en die is weg zodra de grid weg is.
  useEffect(() => {
    if (!focus) return undefined
    const onKey = e => { if (e.key === 'Escape') setGekozen(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus])

  // Mobiel: de sink komt in plaats van de kaarten en begint bóven, niet waar
  // je net Leadsource stond te lezen.
  useEffect(() => {
    if (!focus || typeof window === 'undefined' || !window.matchMedia('(max-width: 1000px)').matches) return
    document.querySelector('.bs--d1-live')?.scrollIntoView({ block: 'start' })
  }, [focus])

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
        label: 'Forecast-velden', status: 'rood', kort: 'ontbreekt',
        toelichting: 'beslisdatum of prijs staat nog niet in de mirror — de forecast rust dan op een onvolledige basis',
      },
    ].filter(Boolean)
  }, [meta])

  const meldingen = useMemo(() => {
    if (!meta) return []
    const uit = []
    if (blokkers && blokkers.aantal !== null && blokkers.aantal !== undefined) {
      uit.push(`${getal(blokkers.aantal)} van ${getal(blokkers.noemer)} open sales-deals draagt een blokkerende hygiënefout en vertekent de forecast. De records staan op het datakwaliteitsbord.`)
    }
    uit.push(`${getal(meta.closedate_onbruikbaar)} van ${getal(meta.open_deals)} open deals heeft geen bruikbare afsluitdatum (${getal(meta.closedate_leeg)} leeg, ${getal(meta.closedate_verlopen)} verlopen). Dit bord forecast daarom op beslisdatum, de verwachte start van de proef.`)
    const zonderBron = (data.kanaal || []).find(k => k.onbekend)?.aantal || 0
    if (zonderBron > 0) uit.push(`${getal(zonderBron)} van ${getal(meta.open_deals)} open deals heeft geen leadsource (hs_analytics_source). De kaart Leadsource toont ze als eigen slice.`)
    const zonderFase = (data.aging || []).reduce((s, r) => s + (r.zonder_fasedatum || 0), 0)
    if (zonderFase > 0) uit.push(`${getal(zonderFase)} open deals hebben geen datum waarop ze hun fase bereikten; ze tellen niet mee in mediaan en P90 van Tijd in fase.`)
    if (!meta.segment_bruikbaar) uit.push(`${getal(meta.companies_met_omvang)} van ${getal(meta.companies_zichtbaar)} companies draagt kantoorgrootte; deals zonder staan in Kantoorgrootte als "onbekend".`)
    if (meta.verloren_zonder_reden > 0) uit.push(`${getal(meta.verloren_zonder_reden)} van ${getal(meta.verloren)} verloren deals heeft geen verliesreden.`)
    return uit
  }, [meta, blokkers, data.kanaal, data.aging])

  const caveat = dekking?.kwartaaldoel_mrr ? null : '⚠ Kwartaaldoel niet vastgelegd'
  const zin = dekking?.kwartaaldoel_mrr
    ? <>Dekking {dekking.kwartaal_label} · plafond fase 3 {dekking.dekking_plafond ? `${String(dekking.dekking_plafond).replace('.', ',')}×` : ''} het kwartaaldoel</>
    : <span className="dsb-warn">⚠ Kwartaaldoel niet vastgelegd — geen dekking te tonen.</span>

  const voetnoot = (
    <>
      Bron: HubSpot-mirror (<code>hubspot_deals</code>) via <code>v_d1_*</code> · fase-indeling uit <code>dim_stage_fase</code> ·
      doel uit <code>dash_parameters</code> · leadsource = <code>hs_analytics_source</code> · pipeline uit <code>hubspot_pipelines</code> · tijd in fase uit <code>hs_v2_date_entered_*</code>.
      Beslisdatum = <code>verwachte_start_pilot</code>. Licenties = (bodem + plafond) / 2 over gewaardeerde deals.
      {refreshedAt && <> Scherm ververst {refreshedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}, daarna elke 5 minuten.</>}
    </>
  )

  const geenRechten = !loading && !error && !schemaMissing && (meta?.deals_zichtbaar ?? 0) === 0
  const terug = () => setGekozen(null)

  // Geen `vraag` en geen `meta` (v1.211): de vraag staat op de D1-pagina in
  // Confluence en in de paginatitel; hier kostte hij 40 px en las hij als kop
  // boven een bord dat al een kop heeft.
  const kop = (
    <BordKop
      vertrouwen={
        <DataStatusBar
          variant="kop" peildatum={meta?.peildatum} minutenOud={meta?.minuten_oud} verouderd={!!meta?.mirror_verouderd}
          bronnen={bronnen} meldingen={meldingen} caveat={caveat} zin={zin} voetnoot={voetnoot}
          ververs={{ onClick: refresh, bezig: loading }} stil
        />
      }
      filters={
        <>
          {/* De ene weg terug uit de focus-split (naast Esc). Alleen in focus:
              buiten focus is er niets om naar terug te gaan, en een knop die
              niets doet is ruis in de balk. Eérste in de balk en primair
              (v1.212, Jelle 15-09-2026: "prominenter, vóór Live | Monthly") —
              in focus is terug de handeling die je het vaakst nodig hebt. */}
          {focus && (
            <button type="button" className="dl-terug dl-terug--balk" onClick={terug} title="Terug naar het overzicht (Esc)">
              ◂ Overzicht
            </button>
          )}
          <BordTabs tabs={[
            { id: 'live', label: 'Live', actief: true },
            { id: 'monthly', label: 'Monthly', actief: false, onClick: () => nav('/pipeline/kwartaal') },
          ]} />
          <BordPeriode
            opties={[{ id: 'half', label: '6 maanden', kort: '6 mnd' }, { id: 'kwartaal', label: 'Dit kwartaal', kort: 'kwartaal' }]}
            actief={periode}
            onKies={id => { setPeriode(id); setGekozen(null) }}
            scope="forecast"
          />
        </>
      }
      rechts={
        <BordToggle
          label="Diagram-units"
          opties={[{ id: 'deals', label: 'Deals' }, { id: 'lic', label: 'Licenties' }]}
          actief={modus}
          onKies={id => { setModus(id); setGekozen(null) }}
        />
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
            <div className="skeleton" style={{ flex: 1, minHeight: 160 }} />
          </>
        )}
        {!loading && schemaMissing && (
          <div className="d1-melding d1-melding--info">
            <b>De metric-laag staat nog niet (volledig) in de database.</b>
            <p>
              Dit bord leest <code>v_d1_kanaal</code>, <code>v_d1_fase_aging</code>, <code>v_d1_kantoorgrootte</code> en{' '}
              <code>v_d1_aanvoer_gepland</code> uit migratie <code>20260915130000_d1_live_ronde5</code>,{' '}
              <code>v_d1_aanvoer_deals</code> + <code>v_d1_km_pipelines</code> uit{' '}
              <code>20260915210000_d1_lead_gepland</code>, naast de basis uit{' '}
              <code>20260913100000</code> / <code>20260913101000</code>. Rol die uit, dan vult dit bord zichzelf.
            </p>
          </div>
        )}
        {!loading && error && <div className="d1-melding d1-melding--fout">Kan de pipelinegegevens niet ophalen: {error}</div>}
        {!loading && geenRechten && (
          <div className="d1-melding d1-melding--info">
            <b>Geen records — of geen rechten.</b>
            <p>Dit bord leest de HubSpot-mirror, afgeschermd met beheerdersrechten plus een tweede factor. Wie daar niet aan voldoet krijgt nul rijen en géén foutmelding. Nul betekent hier dus niet "geen pipeline".</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <BordShell
      className={`bs--d1 bs--d1-live${focus ? ' is-focus' : ''}`}
      kop={kop}
      master={<D1Live data={data} modus={modus} periode={periode} gekozen={gekozen} onKies={setGekozen} />}
      /* Geen sink in idle (v1.212): de zeven kaarten krijgen de hele breedte, de
         detailkolom bestaat pas als er iets te tonen is. Een lege "klik een
         staaf"-kolom van 300 px was een instructie op de plek van data. */
      detail={focus ? <D1Detail gekozen={gekozen} deals={data.deals} aanvoerDeals={data.aanvoerDeals} bewegingDeals={data.bewegingDeals} pipeline={data.pipeline} modus={modus} meta={meta} focus onTerug={terug} /> : null}
    />
  )
}
