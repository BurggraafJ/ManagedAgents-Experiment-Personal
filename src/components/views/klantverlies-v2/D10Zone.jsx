import { useNavigate } from 'react-router-dom'
import { useD10Verlies } from '../../../hooks/useD10Verlies'
import DataStatusBar from '../../ui/DataStatusBar'
import VerliesStrip, { VerliesKernzin } from './VerliesStrip'
import VerliesTrend from './VerliesTrend'
import VerliesDiagnose from './VerliesDiagnose'
import VerliesWerkbord from './VerliesWerkbord'
import { getal, datumKort } from '../stuurinformatie/format'
import './d10.css'

/**
 * D10Zone — de stuurbordzone bovenaan /klantverlies.
 *
 * Deze zone **vervangt** de oude `KpiStrip` (CD-lock 2026-09-13, OB-8). Niet
 * erboven: twee koppen naast elkaar, waarvan één "Totaal verloren 18" zegt,
 * zou het bord precies de dubbelzinnigheid geven die D10 moet wegnemen. Het
 * oude getal is niet verdwenen — het beschrijft de dossiertabel en staat daar
 * nu ook, als regel boven de lijst.
 *
 * Alles onder deze zone (filters, maandgroepen, `ChurnCard`,
 * `KlantverliesDetailView`, de categorieënpopup) blijft ongewijzigd: dat is de
 * CS-werkbordlaag van D10 en die was al goed.
 *
 * De zone mount `useD10Verlies`; `useChurnData` blijft in `KlantverliesV2View`.
 * Twee verschillende hooks in één tree is toegestaan — dezelfde hook twee keer
 * niet (pre-flight punt 4).
 */
export default function D10Zone() {
  const navigate = useNavigate()
  const {
    meta, kop, maandreeks, redenen, verlenging, proeven, annotaties,
    loading, error, schemaMissing,
  } = useD10Verlies()

  if (loading) {
    return (
      <div className="d10">
        <div className="skeleton" style={{ height: 132 }} />
        <div className="skeleton" style={{ height: 180 }} />
      </div>
    )
  }

  if (schemaMissing) {
    return (
      <div className="d10">
        <div className="d10-banner">
          De metric-laag van dit bord bestaat nog niet in deze database. De migraties
          <code> 20260913110000_d10_verlies_a_basis</code> en <code>…_b_werkbord</code> zijn nog
          niet toegepast. De dossiers hieronder werken gewoon.
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="d10">
        <div className="d10-banner">Kan het verliesbord niet laden: {error}</div>
      </div>
    )
  }

  // 0 zichtbare mirror-rijen is geen nul maar een toestand: /klantverlies is
  // niet adminOnly, terwijl hubspot_deals is_admin_or_higher() plus een tweede
  // factor eist. Een member krijgt dan nul rijen en géén foutmelding — en "0
  // verliezen" tonen zou dan een leugen zijn die niemand kan zien.
  const geenZicht = !meta || (meta.deals_zichtbaar ?? 0) === 0
  if (geenZicht) {
    return (
      <div className="d10">
        <div className="d10-banner d10-banner--rechten">
          <b>Geen records — of geen rechten.</b> Dit bord leest de HubSpot-mirror, en die eist
          beheerdersrechten plus een tweede factor. Zonder die twee levert de database nul rijen
          én geen foutmelding. De dossiers hieronder staan los daarvan en werken wel.
        </div>
      </div>
    )
  }

  const meldingen = []
  if (meta.dossiers_ontbrekend > 0) {
    meldingen.push(
      `${getal(meta.dossiers_ontbrekend)} van de ${getal(meta.beeindigd)} beëindigde klantdeals heeft nog geen dossier — ` +
      `de churn-agent draaide voor het laatst op ${datumKort(meta.laatste_run)}.`
    )
  }
  if (meta.a_met_reden === 0 && meta.a_totaal > 0) {
    meldingen.push(`${getal(meta.a_totaal)} van de ${getal(meta.a_totaal)} verloren sales-deals heeft geen verliesreden — het "waarom" van A is niet te meten.`)
  }
  if (meta.grensgevallen > 0) {
    meldingen.push(`${getal(meta.grensgevallen)} van de ${getal(meta.bc_totaal)} klantverliezen liggen binnen ${getal(meta.grensmarge_dagen)} dagen van de B/C-grens van ${getal(meta.duurgrens_dagen)} dagen.`)
  }
  if (meta.bc_zonder_plafond > 0) {
    meldingen.push(`${getal(meta.bc_zonder_plafond)} beëindigd contract mist de contractomvang — het plafond van de verloren waarde dekt dat record niet.`)
  }

  return (
    <div className="d10">
      <header className="d10-kop">
        <div>
          <div className="d10-kop__eyebrow"><span className="d10-kop__dot" />Stuurbord · maandritme</div>
          <h2 className="d10-kop__titel">Hoeveel verliezen we, waar en waarom?</h2>
        </div>
        <div className="d10-kop__meta">
          <span>peildatum {datumKort(meta.peildatum)}</span>
          <span className="d10-kop__sep">·</span>
          <span>HubSpot-mirror</span>
          <span className="d10-kop__sep">·</span>
          <span className="d10-kop__afas">AFAS niet gekoppeld</span>
        </div>
      </header>

      <VerliesStrip kop={kop} meta={meta} />
      <VerliesKernzin kop={kop} />
      <VerliesTrend maandreeks={maandreeks} annotaties={annotaties} />
      <VerliesDiagnose redenen={redenen} kop={kop} meta={meta} />
      <VerliesWerkbord proeven={proeven} verlenging={verlenging} />

      <DataStatusBar
        peildatum={meta.peildatum}
        minutenOud={meta.minuten_oud}
        verouderd={meta.mirror_verouderd}
        bronnen={[
          { label: 'HubSpot-mirror (deals)', status: 'groen', toelichting: `${getal(meta.deals_zichtbaar)} deals zichtbaar` },
          { label: 'AI-samenvattingen (churn-agent)', status: meta.dossiers_ontbrekend > 0 ? 'geel' : 'groen', toelichting: `${getal(meta.dossiers)} dossiers · laatste run ${datumKort(meta.laatste_run)}` },
          { label: 'Verliesredenen HubSpot', status: 'rood', toelichting: 'veld bestaat, 0 van 57 gevuld' },
          { label: 'AFAS (betalende klanten)', status: 'rood', toelichting: 'niet gekoppeld — geen churnpercentage op betalende klanten' },
          { label: 'Gebruiksdata (early-warning)', status: 'rood', toelichting: 'niet ontsloten' },
        ]}
        meldingen={meldingen}
        actie={{ label: 'Naar datakwaliteit', onClick: () => navigate('/pipeline/hygiene') }}
      />
    </div>
  )
}
