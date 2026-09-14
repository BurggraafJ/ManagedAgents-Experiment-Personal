import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useD10Verlies } from '../../../../hooks/useD10Verlies'
import BordShell, { BordKop, BordFilter, BordZuster } from '../../../ui/BordShell'
import DataStatusBar from '../../../ui/DataStatusBar'
import D10Antwoord, { D10Kernzin, D10Subregel } from './D10Antwoord'
import D10Ontleding from './D10Ontleding'
import D10Detail from './D10Detail'
import { PERIODES } from './d10sneden'
import { getal, datumKort } from '../format'
import './d10-bord.css'

/**
 * D10 — Klantverlies (/klantverlies).
 *
 * Eén vraag: hoeveel verliezen we, waar in de klantreis, en wie staat op het
 * punt te vertrekken? Type: stuurbord op maandritme; de CS-lijsten erin worden
 * wekelijks gelezen. Eigenaar: Jelle (CD) met CS.
 *
 * Vorm sinds v1.182: BordShell, vijf zones, master 58 % / detail 42 %. De
 * pagina scrollt niet — de panelen scrollen. Datzelfde skelet draagt D9 (v1.180)
 * en D1 (v1.181); wie het ene bord kan lezen, leest de andere twee.
 *
 * **Dit bord rekent niet.** Elk getal komt uit de `v_d10_*`-laag. Dat is de les
 * uit `KpiStrip.jsx`, dat client-side over de churn-array optelde en daardoor
 * jarenlang "Totaal verloren 18" kon tonen — B en C op één hoop, bijna twintig
 * keer de werkelijke churn, zonder dat iemand het zag.
 *
 * Wat er van dit bord af is en waar het heen ging (Research 1 §B D10 §5):
 *   A-kaart              → één regel onder de kernzin, met link naar D1
 *   Noemer-kaart         → de tweede helft van diezelfde regel
 *   kernzin van 4 regels → één zin
 *   13-maandsgrafiek     → de snede `↻ 13 maanden`
 *   diagnose in 3 kolommen → de sneden `waarom` en `wanneer`
 *   kolom "Waar" (2 rode lege plekken) → één ⛔-regel + `Wat ontbreekt`
 *   werkbordtabel 16 × 7 → de snede `wie` links, de records in zone 4
 *   5 bronbadges + 4 meldingen → 2 badges, één zin, de rest achter een teller
 * Geen van die functies is verdwenen. De dossierlaag kwám er zelfs bij: die
 * stond sinds v1.178 helemaal van de route af en is nu zone 4 (Research 1 §E4).
 *
 * Van 6.000 px naar één scherm. Dat is geen woordregel maar de layoutregel van
 * `BordShell`: de werkrij is `minmax(0, 1fr)` en kan dus niet meegroeien.
 *
 * Sinds v1.187 (clean herbouw, skill v0.9.1): paginafilter **periode** in de
 * zevende shell-slot (D10 is het eerste bord dat hem nodig heeft), snede `wie`
 * zonder balken (G3), C7 Reeksnaast en C9 Verdeling als gedeelde primitieven,
 * en telegram in zone 2 met de definities in de tooltip (regel 21).
 */
export default function D10View() {
  const {
    meta, kop, maandreeks, redenen, verlenging, proeven, records, annotaties, dossiers,
    loading, error, schemaMissing, refreshedAt, refresh,
  } = useD10Verlies()

  const nav = useNavigate()
  const [snede, setSnede] = useState('wie')
  const [periode, setPeriode] = useState('m13')
  const [gekozen, setGekozen] = useState(null)

  // Het filter vernauwt de populatie van het hele bord (F1). Een snede die de
  // nieuwe stand niet kan waarmaken staat uit; wie erop stond, valt terug op
  // de standaardsnede in plaats van op een leeg blok.
  const kiesPeriode = (id) => {
    setPeriode(id)
    setGekozen(null)
    if (id === 'maand' && (snede === 'waarom' || snede === 'wanneer')) setSnede('wie')
  }

  // Alles wat de sneden nodig hebben in één object: master en detail lezen
  // dezelfde data en kunnen dus niet uiteenlopen.
  const data = useMemo(
    () => ({ meta, kop, maandreeks, redenen, verlenging, proeven, records, annotaties, dossiers }),
    [meta, kop, maandreeks, redenen, verlenging, proeven, records, annotaties, dossiers],
  )

  // Twee bronbadges op de regel van 38 px, niet vijf. De mirror staat er altijd
  // — zijn leeftijd bepaalt wat elk getal hierboven waard is. AFAS staat erbij
  // omdat zijn afwezigheid de reden is dat er geen churnpercentage op betalende
  // klanten staat, en die reden hoort bij het getal en niet drie schermen lager.
  // De andere drie (verliesreden, gebruiksdata, dossierachterstand) zijn geen
  // bronnen maar ontbrekende vullingen; die horen in `Wat ontbreekt`.
  const bronnen = useMemo(() => {
    if (!meta) return []
    return [
      {
        label: 'HubSpot-mirror',
        status: meta.mirror_verouderd ? 'geel' : 'groen',
        kort: meta.mirror_verouderd ? 'stand ouder dan een uur' : 'actueel',
        toelichting: meta.mirror_verouderd
          ? 'stand ouder dan een uur — er is een synchronisatie overgeslagen'
          : `${getal(meta.deals_zichtbaar)} deals zichtbaar · delta-synchronisatie elke 30 minuten`,
      },
      {
        label: 'AFAS',
        status: 'rood',
        kort: 'niet gekoppeld',
        toelichting: 'geen facturatiebron — een telling van betalende klanten bestaat hier niet, en dus ook geen churnpercentage daarover',
      },
    ]
  }, [meta])

  // Achter `▸ Wat ontbreekt (n)`: elke regel ≤ 25 woorden (regel 21), met de
  // reden erbij — een lege plek zonder reden is geen voorbehoud maar een storing.
  const meldingen = useMemo(() => {
    if (!meta) return []
    const uit = []

    if (meta.a_met_reden === 0 && meta.a_totaal > 0) {
      uit.push(
        `Verliesreden in HubSpot: 0 van ${getal(meta.a_totaal)} verloren sales-deals. ` +
        'Het waarom achter prospectverlies is niet te meten; de snede waarom toont dat als gat.'
      )
    }
    uit.push(
      `Segment op kantoorgrootte niet te maken: totale_omvang op ${getal(meta.companies_met_omvang)} van ` +
      `${getal(meta.companies_zichtbaar)} companies. Zelfde lege plek als op D1 — één veld, drie borden.`
    )
    uit.push(
      'Early-warning op dalend gebruik niet te maken: gebruiksdata is nergens ontsloten. ' +
      'De lege plek blijft staan als argument voor de koppeling.'
    )
    if (meta.dossiers_ontbrekend > 0) {
      uit.push(
        `${getal(meta.dossiers_ontbrekend)} van ${getal(meta.beeindigd)} beëindigde klantdeals zonder dossier; ` +
        `churn-agent draaide voor het laatst ${datumKort(meta.laatste_run)}. Zichtbaar in de snede waarom als "nog geen dossier".`
      )
    }
    if (meta.grensgevallen > 0) {
      uit.push(
        `${getal(meta.grensgevallen)} van ${getal(meta.bc_totaal)} klantverliezen binnen ${getal(meta.grensmarge_dagen)} dagen ` +
        `van de B/C-grens (${getal(meta.duurgrens_dagen)} dagen, dash_parameters). Een duurregel, geen statusveld.`
      )
    }
    if (meta.bc_zonder_plafond > 0) {
      uit.push(
        `${getal(meta.bc_zonder_plafond)} beëindigd contract zonder contractomvang — het plafond van de verloren waarde dekt dat record niet.`
      )
    }
    return uit
  }, [meta])

  const zin = (
    <>
      <span className="dsb-warn">Geen churn-% op betalende klanten.</span>{' '}
      Verliesreden staat in HubSpot bij {getal(meta?.a_met_reden ?? 0)} van {getal(meta?.a_totaal ?? 0)}.
    </>
  )

  const geenRechten = !loading && !error && !schemaMissing && (meta?.deals_zichtbaar ?? 0) === 0

  const voetnoot = (
    <>
      Bron: HubSpot-mirror (<code>hubspot_deals</code>) via <code>v_d10_*</code> · fasen uit{' '}
      <code>dim_stage_fase</code> · B/C-duurgrens {getal(meta?.duurgrens_dagen)} dagen, marge{' '}
      {getal(meta?.grensmarge_dagen)} uit <code>dash_parameters</code> · AI-categorieën uit{' '}
      <code>churn_customers</code> (laatste run {datumKort(meta?.laatste_run) || 'onbekend'}) ·
      contractwaarde uit HubSpot, <b>niet gefactureerd</b> (AFAS niet gekoppeld) · A, B en C nooit
      opgeteld — alleen C is churn.
      {refreshedAt && <> Ververst {refreshedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}, daarna elke 5 minuten.</>}
    </>
  )

  const vertrouwen = (
    <DataStatusBar
      variant="kop"
      peildatum={meta?.peildatum}
      minutenOud={meta?.minuten_oud}
      verouderd={!!meta?.mirror_verouderd}
      bronnen={bronnen}
      meldingen={meldingen}
      caveat="⚠ Geen churn-% op betalende klanten"
      zin={zin}
      voetnoot={voetnoot}
    />
  )

  const kop1 = (
    <BordKop
      /* Top-level bord: terug naar Dashboard, en `app: true` omdat de
         app-topbalk op desktop dezelfde weg al draagt (v1.189). */
      terug={{ label: 'Dashboard', onClick: () => nav('/'), app: true }}
      kruimel="Stuurinformatie · D10"
      vraag="Hoeveel verliezen we, waar en waarom?"
      meta={<>maandritme · <b>Jelle</b> met <b>CS</b></>}
      vertrouwen={vertrouwen}
      /* Het paginafilter stond in v1.187 in een eigen strook tussen kop en
         antwoord (34 px, dit bord op 246 tegen een budget van 224) en in
         v1.188 op de vraagregel tussen de knoppen. Sinds v1.189 staat hij in
         de witte standaardbalk van de kop, met de zusterpagina en ververs.
         Eén paginafilter (F5: stuurbord, periode — alleen omdat hier meer dan
         één periode betekenis heeft); de stand geldt voor de verliezen, de
         CS-lijsten zijn de stand van vandaag. */
      filters={
        <>
          <BordFilter
            label="periode"
            opties={PERIODES}
            actief={periode}
            onKies={kiesPeriode}
          />
          <BordZuster onClick={() => nav('/pipeline/hygiene')}>Datakwaliteit</BordZuster>
        </>
      }
      acties={
        <button type="button" className="bs-btn" onClick={refresh} disabled={loading}>
          {loading ? 'Verversen…' : 'Ververs'}
        </button>
      }
    />
  )

  if (loading || schemaMissing || error || geenRechten) {
    return (
      <div className="bs bs--d10">
        {kop1}
        {loading && (
          <>
            <div className="skeleton" style={{ height: 132 }} />
            <div className="skeleton" style={{ height: 20, maxWidth: 520 }} />
            <div className="skeleton" style={{ flex: 1, minHeight: 160 }} />
          </>
        )}

        {!loading && schemaMissing && (
          <div className="d10-melding d10-melding--info">
            <b>De metric-laag van dit bord staat nog niet in de database.</b>
            <p>
              De views komen uit de migraties <code>20260913110000_d10_verlies_a_basis</code> en{' '}
              <code>20260913111000_d10_verlies_b_werkbord</code>. Rol die uit, dan vult dit bord
              zichzelf — er is geen tweede stap in de app nodig.
            </p>
          </div>
        )}

        {!loading && error && (
          <div className="d10-melding d10-melding--fout">
            Kan het verliesbord niet laden: {error}
          </div>
        )}

        {/* Nul zichtbare mirror-rijen is geen nul maar een toestand:
            /klantverlies is niet adminOnly, terwijl hubspot_deals
            is_admin_or_higher() plus een tweede factor eist. "0 verliezen"
            tonen zou dan een leugen zijn die niemand kan zien. */}
        {!loading && geenRechten && (
          <div className="d10-melding d10-melding--info">
            <b>Geen records — of geen rechten.</b>
            <p>
              Dit bord leest de HubSpot-mirror, en die is afgeschermd met beheerdersrechten plus een
              tweede factor. Wie daar niet aan voldoet krijgt nul rijen terug en géén foutmelding.
              Nul betekent hier dus niet "geen klantverlies".
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <BordShell
      className="bs--d10"
      kop={kop1}
      antwoord={<D10Antwoord kop={kop} meta={meta} periode={periode} />}
      kernzin={
        <>
          <D10Kernzin kop={kop} periode={periode} />
          <D10Subregel kop={kop} meta={meta} periode={periode} onD1={() => nav('/pipeline')} />
        </>
      }
      master={
        <D10Ontleding
          data={data}
          meta={meta}
          snede={snede}
          periode={periode}
          onSnede={(id) => { setSnede(id); setGekozen(null) }}
          gekozen={gekozen}
          onKies={setGekozen}
        />
      }
      detail={
        <D10Detail
          data={data}
          snede={snede}
          periode={periode}
          gekozen={gekozen}
          onDossier={(r) => nav(`/klantverlies/${r.deal_id}`)}
        />
      }
    />
  )
}
