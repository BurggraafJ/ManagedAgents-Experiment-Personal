import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useD1Pipeline } from '../../../../hooks/useD1Pipeline'
import { BordKop, BordZuster } from '../../../ui/BordShell'
import MetricCard from '../../../ui/MetricCard'
import WinRateHoeken, { hoekNaam } from './WinRateHoeken'
import Balkrang from '../../../ui/charts/Balkrang'
import { getal, decimaal, euro, euroKort, bereik, datumKort } from '../format'
import './d1.css'

/**
 * D1 · Kwartaaldiagnose (/pipeline/kwartaal).
 *
 * De bestemming van wat van het weekbord af moest zonder weg te mogen: de
 * win-rate-hoeken, de dekking tegen het kwartaaldoel, de stage-ontleding en de
 * salescyclus. Vier percentages op n = 14 tot 60, met een uitleg waarom het er
 * vier zijn, is kwartaalwerk — maar het is geen wegwerpwerk, en daarom staat
 * het één klik van /pipeline vandaan in plaats van nergens (Research 1 §B D1
 * §5: "naar [Kwartaaldiagnose ▸], één klik vanaf hetzelfde bord").
 *
 * Dit is bewust géén BordShell: een diagnosebord beantwoordt geen enkele vraag
 * in tien seconden en heeft geen master-detail. Het is een leesstuk dat je een
 * keer per kwartaal doorneemt, en het mag scrollen.
 */
export default function D1Kwartaal() {
  const {
    meta, dekking, winRate, ontleding,
    loading, error, schemaMissing,
  } = useD1Pipeline()

  const nav = useNavigate()

  const stages = useMemo(
    () => (ontleding || [])
      .filter(r => r.snede === 'stage')
      .sort((a, b) => (a.volgnummer - b.volgnummer) || (b.aantal - a.aantal)),
    [ontleding],
  )

  const hoofdhoek = (winRate || []).find(h => h.hoofdhoek)

  // Salescyclus: de spreiding van hoe lang open deals al open staan. Geen
  // gemiddelde — bij 32 deals verbergt één getal precies wat je wilt weten.
  const cyclus = useMemo(() => {
    const rijen = (ontleding || []).filter(r => r.snede === 'fase' && r.aantal > 0)
    if (rijen.length === 0) return null
    return {
      jongste: Math.min(...rijen.map(r => r.jongste_dagen).filter(n => n !== null && n !== undefined)),
      oudste: Math.max(...rijen.map(r => r.oudste_dagen).filter(n => n !== null && n !== undefined)),
    }
  }, [ontleding])

  const kop = (
    <BordKop
      /* Geen terugknop en geen kruimel meer in de kop (v1.191): `◂ Pipeline`
         (de ouder van /pipeline/kwartaal) en de titel staan in de app-topbalk.
         De balk draagt hier alleen de twee zusterpagina's — dezelfde twee als
         op het weekbord, want dit is de andere helft van dezelfde vraag. Geen
         Sync: dit leesstuk heeft zijn bronregel in de voet, en een tweede
         vertrouwensgroep voor dezelfde v_d1_*-laag is een tweede waarheid. */
      vraag="Wat zegt dit kwartaal over de trechter zelf?"
      meta={<>per kwartaal · <b>Jelle</b> met <b>Jay</b></>}
      filters={
        <>
          <BordZuster onClick={() => nav('/pipeline')}>Pipeline & forecast</BordZuster>
          <BordZuster onClick={() => nav('/pipeline/hygiene')}>Datakwaliteit</BordZuster>
        </>
      }
    />
  )

  if (loading || schemaMissing || error) {
    return (
      <div className="bs bs--d1 d1-kwartaal">
        {kop}
        {loading && <div className="skeleton" style={{ height: 240 }} />}
        {!loading && schemaMissing && (
          <div className="d1-melding d1-melding--info">
            <b>De metric-laag staat nog niet in de database.</b>
            <p>Rol de migraties <code>20260913100000</code> en <code>20260913101000</code> uit.</p>
          </div>
        )}
        {!loading && error && (
          <div className="d1-melding d1-melding--fout">Kan de pipelinegegevens niet ophalen: {error}</div>
        )}
      </div>
    )
  }

  return (
    <div className="bs bs--d1 d1-kwartaal">
      {kop}

      <div className="d1-kwartaal__kaarten">
        {/* Dekking — hier wél als kaart. Op een kwartaalbord is de uitleg
            waarom een doel ontbreekt precies het onderwerp; op het weekbord
            kostte diezelfde uitleg een kaartbreedte aan een niet-meting. */}
        <MetricCard
          label={`Dekking ${dekking?.kwartaal_label || 'kwartaal'}`}
          waarde={dekking?.dekking_plafond !== null && dekking?.dekking_plafond !== undefined
            ? `${decimaal(dekking.dekking_plafond, 1)}×`
            : null}
          leegTekst="doel niet vastgelegd"
          reden="Het kwartaaldoel staat handmatig op Omzet & Doelen (peildatum 12-08-2026, in euro per maand) en is nog niet als parameter overgenomen. Zolang het er niet is, toont dit bord een lege plek en geen berekening op een verzonnen noemer."
          vergelijking={dekking?.dekkingsnorm
            ? `norm ${decimaal(dekking.dekkingsnorm, 1)}×`
            : 'geen dekkingsnorm vastgelegd'}
          basis={dekking
            ? `plafond fase 3 ${euro(dekking.mrr_plafond)} · nog ${getal(dekking.dagen_resterend)} dagen in het kwartaal`
            : null}
        >
          {dekking?.doel_peildatum && (
            <div className="mc__extra">
              Peildatum van het doel: {datumKort(dekking.doel_peildatum)} — ouder dan de data hierboven.
              Bron: {dekking.doel_bron}.
            </div>
          )}
        </MetricCard>

        <MetricCard
          label="Win rate"
          waarde={hoofdhoek?.win_rate !== null && hoofdhoek?.win_rate !== undefined
            ? `${decimaal(hoofdhoek.win_rate, 1)} %`
            : null}
          leegTekst="geen afgesloten trajecten"
          reden="Er zijn geen gewonnen of verloren deals met een afsluitdatum in dit jaar."
          vergelijking={hoofdhoek ? `hoek ${hoekNaam(hoofdhoek)}` : null}
          basis={hoofdhoek
            ? `n = ${getal(hoofdhoek.basis_n)} (${getal(hoofdhoek.gewonnen)} gewonnen, ${getal(hoofdhoek.verloren)} verloren)`
            : null}
        />

        <MetricCard
          label="Salescyclus"
          waarde={cyclus ? `${getal(cyclus.jongste)} – ${getal(cyclus.oudste)}` : null}
          waardeSuffix="dagen open"
          leegTekst="geen open deals"
          reden="Zonder open deals is er geen doorlooptijd te tonen."
          vergelijking="spreiding, geen gemiddelde"
          basis="hoe lang de open deals al lopen — niet hoe lang gewonnen deals erover deden"
        >
          <div className="mc__extra">
            Dit is de leeftijd van wat er nú staat, niet de doorlooptijd van gewonnen trajecten.
            Die laatste vraagt een datum bij elke fase-overgang; <code>hs_v2_date_entered_*</code>
            {' '}staat in de mirror maar draagt nog geen volledige reeks.
          </div>
        </MetricCard>

        <MetricCard
          label="Segment · kantoorgrootte"
          waarde={null}
          leegTekst="niet te snijden"
          reden={meta
            ? `${getal(meta.companies_met_omvang)} van ${getal(meta.companies_zichtbaar)} companies draagt totale_omvang, en de HubSpot-ETL synchroniseert maximaal 2.000 companies per ronde. Een segment-ontleding zou op een paar procent van de basis rusten.`
            : 'kantoorgrootte ontbreekt op de company'}
          vergelijking="de lege plek is het argument voor het veld"
          basis="zodra de dekking klopt, verschijnt segment als vierde snede op /pipeline"
        />
      </div>

      {/* Geen eigen kop eromheen: WinRateHoeken draagt zijn titel en zijn uitleg
          zelf, en twee koppen boven hetzelfde raster lezen als twee blokken. */}
      <WinRateHoeken winRate={winRate} />

      <section className="d1-blok">
        <header className="d1-blok__kop">
          <div>
            <h3 className="d1-blok__titel">Per stage</h3>
            <p className="d1-blok__intro">
              De fijnste snede door de open deals. Op het weekbord staat fase (drie regels); hier de
              stages eronder, want een stage die opstopt is een kwartaalvraag.
            </p>
          </div>
        </header>

        {/* C4 Balkrang in kolom-layout (v1.184): de balk in eigen kolom, het
            getal in de goot erachter; bereik en dekking zijn slots van de
            tabel, niet van de balk. De noemer (open deals) staat één keer in
            de groepskop en komt uit v_d1_meta — niet uit een som hier. */}
        <Balkrang
          layout="auto"
          groepen={[{
            id: 'stage',
            naam: 'Open deals per stage',
            tel: 'HubSpot-mirror',
            kort: 'stage',
            noemer: meta?.open_deals ?? null,
            noemerTekst: meta?.open_deals !== null && meta?.open_deals !== undefined
              ? `${getal(meta.open_deals)} open deals`
              : null,
            noemerTip: {
              kop: `${getal(meta?.open_deals)} open deals`,
              tekst: `alle open deals in de Sales Pipeline, fase 1 t/m 3 · v_d1_ontleding (snede stage) · peildatum ${datumKort(meta?.peildatum) || 'onbekend'}`,
            },
            rijen: stages.map(r => ({ id: r.sleutel, naam: r.label, waarde: r.aantal ?? 0, data: r })),
          }]}
          extraKoppen={['bereik', 'dekking']}
          extra={r => [
            bereik(r.data.mrr_bodem, r.data.mrr_plafond, euroKort)
              || <span className="c4__extra-leeg">geen waarde</span>,
            r.data.aantal ? `${getal(r.data.aantal_gewaardeerd)}/${getal(r.data.aantal)} gewaardeerd` : '—',
          ]}
          leeg="Geen open deals."
          getal={getal}
          voet={stages.length > 0 && (
            <>
              schaal 0 – {getal(Math.max(1, ...stages.map(r => r.aantal || 0)))} · noemer {getal(meta?.open_deals)} open
              deals, één keer in de kop · <b>v_d1_ontleding</b> (snede stage) · {datumKort(meta?.peildatum) || 'peildatum onbekend'}
            </>
          )}
        />
      </section>

      <div className="d1-foot">
        Bron: HubSpot-mirror (<code>hubspot_deals</code>) via <code>v_d1_win_rate</code>,{' '}
        <code>v_d1_dekking</code> en <code>v_d1_ontleding</code> · peildatum{' '}
        {datumKort(meta?.peildatum) || 'onbekend'}. Dit bord hoort bij het kwartaalgesprek; de
        weekstand staat op <button type="button" className="d1-inline-link" onClick={() => nav('/pipeline')}>het pipelinebord</button>.
      </div>
    </div>
  )
}
