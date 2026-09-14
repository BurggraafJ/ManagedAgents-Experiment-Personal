import { useMemo } from 'react'
import MeesterLijst, { MeesterGroep } from '../../../ui/MeesterLijst'
import SnedeKiezer from '../../../ui/SnedeKiezer'
import Bereikstaaf from '../../../ui/charts/Bereikstaaf'
import { getal, euro, euroKort, bereik, bucketLabel } from '../format'

/**
 * D1LandtHet — zone 3. Eén blok met drie sneden door dezélfde open deals:
 * **maand** (beslisdatum, standaard) · **fase** · **eigenaar**.
 *
 * Dit blok vervangt drie dingen die tot v1.180 onder elkaar stonden: de
 * forecast-staafgrafiek, het aparte Ontleding-blok en de werkbord-tabs. Geen
 * van die functies is weg — ze zijn van drie blokken naar één blok met sneden
 * gegaan (Research 1 §B D1 §5). Wat je vroeger als staafgrafiek zag, is nu de
 * balk ín de regel; wat de Ontleding-tabs deden, doet de snede-kiezer.
 *
 * Vier regels die in dit blok zitten en niet in het bord:
 *
 *  1. **Fase 1–2 wordt nooit opgeteld bij fase 3.** Het getal en het bedrag op
 *     een maandregel zijn fase 3; fase 1–2 staat als telling in de subregel met
 *     het woord "indicatief". Fase 1 is een verwachting over een gesprek, fase
 *     3 over een handtekening — ze mogen op één as, nooit in één getal.
 *  2. **"Geen beslisdatum" is een regel, geen weglating**, en hij staat in de
 *     vaste strook zodat hij nooit wegscrollt. Zonder die regel leest de
 *     forecast optimistischer dan hij is.
 *  3. **Geen kanspercentage.** Bodem is de minimumafname, plafond de
 *     contractomvang; er bestaat geen enkele "pipeline-waarde".
 *  4. **De segment-snede staat er zichtbaar uit**, met de dekking in de
 *     tooltip (F7). Weglaten zou verbergen dát die doorsnede bestaat, en de
 *     vraag elk kwartaal opnieuw oproepen. De vulgraad staat er als twee
 *     getallen uit de view, niet als percentage: de UI rekent niet (G5).
 *
 * De balk in de rij is de gedeelde **C5 Bereikstaaf** (`ui/charts`, v1.186;
 * tot v1.185 de bord-lokale `.d1-mbar` van 9 px). Alle rijen in het blok
 * delen één schaal — het hoogste plafond van de getoonde rijen — en die
 * schaal staat in de legenda (G2). De schaal is de enige berekening die dit
 * blok doet, en hij loopt over exact de rijen die getekend worden.
 */
const KOLOMKOPPEN = {
  maand:    ['fase 3', 'bodem – plafond'],
  fase:     ['deals', 'bodem – plafond'],
  eigenaar: ['deals', 'bodem – plafond'],
}

const GROEPSKOP = {
  maand: {
    naam: 'Op beslisdatum',
    tel: 'verwachte start van de proef, niet de afsluitdatum · euro per maand · ongewogen',
  },
  fase: {
    naam: 'Per fase',
    tel: 'alle open deals · euro per maand · fase 2 hoort er leeg bij te staan',
  },
  eigenaar: {
    naam: 'Per eigenaar',
    tel: 'werkverdeling, geen ranglijst · ongelijk in fase en omvang',
  },
}

/**
 * De sublijn van een regel volgt het C5-contract: "x van y gewaardeerd" staat
 * erbij zodra niet élke deal een waarde draagt — anders leest een laag
 * plafond als een lage verwachting in plaats van als ontbrekende velden.
 * Zijn ze allemaal gewaardeerd, dan zegt de balk het al en blijft de sublijn
 * bij de fase-telling.
 */
function subMetGewaardeerd(basis, aantal, gewaardeerd) {
  if (!aantal || gewaardeerd >= aantal) return basis
  const g = `${getal(gewaardeerd)} van ${getal(aantal)} gewaardeerd`
  return basis ? `${g} · ${basis}` : g
}

/** Maandregels uit de forecastview: f3 draagt het getal, f1–2 alleen de telling. */
function maandRijen(forecast) {
  const per = new Map()
  for (const r of forecast || []) {
    if (!per.has(r.bucket)) {
      per.set(r.bucket, {
        sleutel: r.bucket, soort: r.soort, maand_start: r.maand_start,
        volgnummer: r.volgnummer, binnen_kwartaal: r.binnen_kwartaal, groepen: {},
      })
    }
    per.get(r.bucket).groepen[r.fasegroep] = r
  }

  return [...per.values()]
    .sort((a, b) => a.volgnummer - b.volgnummer)
    .map(k => {
      const f3 = k.groepen.f3 || {}
      const f12 = k.groepen.f12 || {}
      const basis = k.binnen_kwartaal
        ? 'dit kwartaal'
        : (f12.aantal ? `f1–2 ${getal(f12.aantal)} · indicatief` : 'f1–2 0')
      return {
        sleutel: k.sleutel,
        soort: k.soort,
        naam: bucketLabel(k),
        sub: subMetGewaardeerd(basis, f3.aantal || 0, f3.aantal_gewaardeerd || 0),
        aantal: f3.aantal || 0,
        aantal_f12: f12.aantal || 0,
        gewaardeerd: f3.aantal_gewaardeerd || 0,
        bodem: f3.mrr_bodem,
        plafond: f3.mrr_plafond,
      }
    })
}

/** Fase- en eigenaarregels uit de ontledingsview. */
function ontleedRijen(ontleding, snede) {
  return (ontleding || [])
    .filter(r => r.snede === snede)
    .sort((a, b) => (a.volgnummer - b.volgnummer) || (b.aantal - a.aantal))
    .map(r => ({
      sleutel: r.sleutel,
      soort: 'groep',
      naam: r.label,
      // Hier altijd "x van y": het is de enige sublijn die deze regel heeft.
      sub: r.aantal
        ? `${getal(r.aantal_gewaardeerd)} van ${getal(r.aantal)} gewaardeerd`
        : 'geen open deals',
      aantal: r.aantal || 0,
      aantal_f12: 0,
      gewaardeerd: r.aantal_gewaardeerd || 0,
      bodem: r.mrr_bodem,
      plafond: r.mrr_plafond,
    }))
}

/**
 * Wat het detailpaneel van een regel meekrijgt. Bodem, plafond en het aantal
 * reizen mee uit de view, zodat het paneel dezelfde getallen toont als de regel
 * en ze niet zelf opnieuw optelt over de dealrijen.
 */
function keuzeVan(snede, rij) {
  return {
    snede,
    sleutel: rij.sleutel,
    naam: rij.naam,
    aantal: rij.aantal,
    bodem: rij.bodem,
    plafond: rij.plafond,
  }
}

export default function D1LandtHet({
  forecast, ontleding, meta, werkbordTellers,
  snede, onSnede, gekozen, onKies,
  periode = 'half',
}) {
  const gefilterdeForecast = useMemo(
    () => periode === 'kwartaal'
      ? (forecast || []).filter(r => r.binnen_kwartaal || r.soort === 'geen' || r.soort === 'later')
      : forecast,
    [forecast, periode],
  )

  const alle = useMemo(
    () => (snede === 'maand' ? maandRijen(gefilterdeForecast) : ontleedRijen(ontleding, snede)),
    [snede, gefilterdeForecast, ontleding],
  )

  // De "geen beslisdatum"-regel hoort in de vaste strook en niet in de lijst:
  // hij valt buiten élke maandkolom en moet in beeld blijven ook als de lijst
  // gescrold is.
  const rijen = alle.filter(r => r.soort !== 'geen')
  const geenDatum = alle.find(r => r.soort === 'geen')

  // Eén gedeelde schaal over de getoonde regels (G2): het hoogste plafond.
  // Dezelfde array die getekend wordt — de enige berekening in dit blok.
  const max = useMemo(
    () => Math.max(1, ...rijen.map(r => Number(r.plafond) || 0)),
    [rijen],
  )
  const heeftBalk = rijen.some(r => Number(r.plafond) > 0)

  const segmentDekking = meta
    ? `${getal(meta.companies_met_omvang)} van ${getal(meta.companies_zichtbaar)} companies draagt kantoorgrootte`
    : 'kantoorgrootte ontbreekt op de company'

  const sneden = [
    { id: 'maand', label: 'maand', titel: 'Op beslisdatum (verwachte start van de proef) — nooit op afsluitdatum' },
    { id: 'fase', label: 'fase' },
    { id: 'eigenaar', label: 'eigenaar', titel: 'Werkverdeling, geen ranglijst' },
    {
      // Zichtbaar uit, met de vulgraad in de tooltip (F7). Geen percentage op
      // de knop: dat zou de UI zelf uitrekenen (G5).
      id: 'segment',
      label: 'segment',
      uit: true,
      titel: `Niet beschikbaar: ${segmentDekking}. De company-sync haalt bovendien maximaal 2.000 companies per ronde op.`,
    },
  ]

  const legenda = [
    'donker = minimumafname · licht = contractomvang',
    heeftBalk ? `schaal tot ${euroKort(max)} plafond` : null,
    'fase 1–2 indicatief, nooit opgeteld',
  ].filter(Boolean).join(' · ')

  return (
    <MeesterLijst
      titel="Landt het?"
      snede={<SnedeKiezer sneden={sneden} actief={snede} onKies={onSnede} />}
      kolomkoppen={KOLOMKOPPEN[snede] || []}
      slot={
        <>
          {geenDatum && (
            <ForecastRij
              rij={geenDatum}
              max={max}
              vlag="⚠ valt buiten élke maandkolom"
              gekozen={gekozen?.snede === snede && gekozen?.sleutel === geenDatum.sleutel}
              onClick={() => onKies(keuzeVan(snede, geenDatum))}
            />
          )}
          <MeesterGroep naam="Legenda" tel={legenda} />
          <Tellers tellers={werkbordTellers} gekozen={gekozen} onKies={onKies} />
        </>
      }
    >
      <MeesterGroep naam={GROEPSKOP[snede]?.naam} tel={GROEPSKOP[snede]?.tel} />

      {rijen.length === 0 && (
        <div className="bs-leeg">Geen open deals in deze snede.</div>
      )}

      {rijen.map(r => (
        <ForecastRij
          key={`${snede}-${r.sleutel}`}
          rij={r}
          max={max}
          gekozen={gekozen?.snede === snede && gekozen?.sleutel === r.sleutel}
          onClick={() => onKies(keuzeVan(snede, r))}
        />
      ))}
    </MeesterLijst>
  )
}

/**
 * Eén regel met zijn bandbreedte als C5 Bereikstaaf. Donker loopt tot de
 * bodem, licht tot het plafond — dezelfde twee waarden die rechts als bedrag
 * staan, zodat de balk niets toevoegt dat het getal niet zegt en niets
 * verzwijgt dat het wél zegt. Eén afronding op het bord (€ 5,4k), het exacte
 * bedrag in de tooltip van de balk.
 */
function ForecastRij({ rij, max, vlag = null, gekozen, onClick }) {
  const kort = bereik(rij.bodem, rij.plafond, euroKort)
  const exact = bereik(rij.bodem, rij.plafond, euro)
  const titel = exact
    ? `bodem ${euro(rij.bodem)} · plafond ${euro(rij.plafond)} per maand · ${getal(rij.gewaardeerd)} van ${getal(rij.aantal)} gewaardeerd`
    : undefined

  return (
    <button
      type="button"
      className={`bs-rij d1-rij${vlag ? ' d1-rij--warn' : ''}${gekozen ? ' is-gekozen' : ''}`}
      onClick={onClick}
      aria-pressed={gekozen}
    >
      <span className="bs-rij__cel">
        <span className="bs-rij__naam">{rij.naam}</span>
        {rij.sub && <span className="bs-rij__sub">{rij.sub}</span>}
      </span>

      {vlag
        ? <span className="d1-rij__vlag">{vlag}</span>
        : (
          <span className="d1-rij__balk">
            <Bereikstaaf bodem={rij.bodem} plafond={rij.plafond} max={max} titel={titel} />
          </span>
        )}

      <span className={`bs-rij__n${rij.aantal === 0 ? ' bs-rij__n--nul' : ''}`}>{getal(rij.aantal)}</span>
      <span className="d1-rij__waarde" title={exact || undefined}>
        {kort || <span className="d1-rij__leegwaarde">geen waarde</span>}
      </span>
      <span className="bs-rij__caret" aria-hidden>▸</span>
    </button>
  )
}

/**
 * De vier werklijsten als tellers onder de lijst. Ze komen uit
 * `v_d1_werkbord_tellers` en niet uit een lijst in deze component: een lege
 * lijst levert nul regels in `v_d1_werkbord`, en zou de teller dan verdwijnen,
 * dan zag je het verschil niet tussen "opgeruimd" en "niet gemeten". Nu staat
 * er een gemeten nul.
 *
 * Eén deal kan op meerdere lijsten staan — het zijn vier handelingen, geen vier
 * categorieën. Daarom staat er geen totaal onder.
 */
function Tellers({ tellers, gekozen, onKies }) {
  if (!tellers || tellers.length === 0) return null

  return (
    <div className="d1-tellers">
      <span className="d1-tellers__label">Werk deze week</span>
      {tellers.map(t => (
        <button
          key={t.lijst}
          type="button"
          className={`d1-teller${gekozen?.lijst === t.lijst ? ' is-gekozen' : ''}${t.aantal === 0 ? ' is-schoon' : ''}`}
          onClick={() => onKies({ lijst: t.lijst, naam: t.lijst_label })}
          aria-pressed={gekozen?.lijst === t.lijst}
          title={t.toelichting || undefined}
        >
          {t.lijst_label}<b>{getal(t.aantal)}</b>
          <span className="bs-rij__caret" aria-hidden>▸</span>
        </button>
      ))}
    </div>
  )
}
