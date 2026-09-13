import { useMemo } from 'react'
import MeesterLijst, { MeesterGroep } from '../../../ui/MeesterLijst'
import SnedeKiezer from '../../../ui/SnedeKiezer'
import { getal, euroKort, bereik, bucketLabel } from '../format'

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
 *     tooltip. Weglaten zou verbergen dát die doorsnede bestaat, en de vraag
 *     elk kwartaal opnieuw oproepen.
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
    tel: 'werkverdeling, geen ranglijst — de deals zijn niet gelijk verdeeld naar fase of omvang',
  },
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
      return {
        sleutel: k.sleutel,
        soort: k.soort,
        naam: bucketLabel(k),
        sub: k.binnen_kwartaal
          ? 'dit kwartaal'
          : (f12.aantal ? `f1–2 ${getal(f12.aantal)} · indicatief` : 'f1–2 0'),
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
}) {
  const alle = useMemo(
    () => (snede === 'maand' ? maandRijen(forecast) : ontleedRijen(ontleding, snede)),
    [snede, forecast, ontleding],
  )

  // De "geen beslisdatum"-regel hoort in de vaste strook en niet in de lijst:
  // hij valt buiten élke maandkolom en moet in beeld blijven ook als de lijst
  // gescrold is.
  const rijen = alle.filter(r => r.soort !== 'geen')
  const geenDatum = alle.find(r => r.soort === 'geen')

  // Schaal over de getoonde regels heen, zodat ze onderling vergelijkbaar zijn.
  const max = useMemo(
    () => Math.max(1, ...rijen.map(r => Number(r.plafond) || 0)),
    [rijen],
  )

  const segmentDekking = meta
    ? `${getal(meta.companies_met_omvang)} van ${getal(meta.companies_zichtbaar)} companies draagt kantoorgrootte`
    : 'kantoorgrootte ontbreekt op de company'

  const sneden = [
    { id: 'maand', label: 'maand', titel: 'Op beslisdatum (verwachte_start_pilot) — nooit op afsluitdatum' },
    { id: 'fase', label: 'fase' },
    { id: 'eigenaar', label: 'eigenaar', titel: 'Werkverdeling, geen ranglijst' },
    {
      id: 'segment',
      label: `segment · ${meta ? `${((meta.companies_met_omvang / Math.max(1, meta.companies_zichtbaar)) * 100).toFixed(1).replace('.', ',')} %` : '—'} gevuld`,
      uit: true,
      titel: `Niet beschikbaar: ${segmentDekking}. De company-sync haalt bovendien maximaal 2.000 companies per ronde op.`,
    },
  ]

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
          <MeesterGroep
            naam="Legenda"
            tel="donker = minimumafname · licht = contractomvang · fase 1–2 indicatief, nooit opgeteld"
          />
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
 * Eén regel met zijn bandbreedte als balk. Donker loopt tot de bodem, licht
 * tot het plafond — dezelfde twee waarden die rechts als bedrag staan, zodat de
 * balk niets toevoegt dat het getal niet zegt en niets verzwijgt dat het wél
 * zegt. Zonder waarde geen balk: een verzonnen breedte is een verzonnen
 * verwachting.
 */
function ForecastRij({ rij, max, vlag = null, gekozen, onClick }) {
  const bodem = Number(rij.bodem) || 0
  const plafond = Number(rij.plafond) || 0
  const heeftWaarde = plafond > 0
  const euro = bereik(rij.bodem, rij.plafond, euroKort)

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
          <span className="d1-mbar" aria-hidden>
            {heeftWaarde && (
              <span className="d1-mbar__baan">
                <span className="d1-mbar__diep" style={{ width: `${Math.round((bodem / max) * 100)}%` }} />
                <span className="d1-mbar__licht" style={{ width: `${Math.round(((plafond - bodem) / max) * 100)}%` }} />
              </span>
            )}
          </span>
        )}

      <span className={`bs-rij__n${rij.aantal === 0 ? ' bs-rij__n--nul' : ''}`}>{getal(rij.aantal)}</span>
      <span className="d1-rij__waarde">
        {euro || <span className="d1-rij__leegwaarde">geen waarde</span>}
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
