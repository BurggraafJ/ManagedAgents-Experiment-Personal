import { useMemo } from 'react'
import MeesterLijst, { MeesterGroep } from '../../../ui/MeesterLijst'
import SnedeKiezer from '../../../ui/SnedeKiezer'
import Balkrang, { balkrangSchaal } from '../../../ui/charts/Balkrang'
import Reeksnaast, { reeksnaastSchaal } from '../../../ui/charts/Reeksnaast'
import { getal, decimaal, datumKort } from '../format'
import { rijenVoor, REDEN_BLOKKEN } from './d10sneden'

/**
 * D10Ontleding — zone 3. Eén blok, vier sneden op dezelfde populatie:
 * **wie staat op het punt** · waarom · wanneer · ↻ 13 maanden.
 *
 * De beelden volgen de mapping in chart-catalogus §5 (skill v0.9.1):
 *
 *   wie      geen beeld — vier CS-lijsten met vier populaties zijn geen
 *            vergelijkbare staven (G3); tellingen, geen balken (v1.187: de
 *            balk uit v1.182–1.186 is weg)
 *   waarom   C4 Balkrang — twee bronnen onder eigen groepskoppen, gat rood
 *            onderaan, sorteer-toggle
 *   wanneer  geen beeld in de rij — de grondslagen verschillen (G3); de
 *            spreiding (C9) staat in zone 4 achter de gekozen regel
 *   trend    C7 Reeksnaast — A, B en C náást elkaar, nooit gestapeld
 *
 * Het paginafilter periode (zone 1b) vernauwt de populatie vóór de snede:
 * `waarom` en `wanneer` lezen views zonder maandvenster en staan onder "deze
 * maand" zichtbaar uit met de reden (F7) in plaats van een getal te tonen dat
 * de filterstand negeert (F1).
 */
const KOLOMKOPPEN = {
  wie: ['kantoren'],
  waarom: ['records'],
  wanneer: ['mediaan dgn'],
  trend: ['A · B · C'],
}

const REEKSEN = [
  { id: 'A', label: 'A', kleur: 'n400' },
  { id: 'B', label: 'B', kleur: 'orange' },
  { id: 'C', label: 'C', kleur: 'deep' },
]

const NOEMER_TEKST = { 1: n => `${getal(n)} verloren klanten B + C`, 2: n => `${getal(n)} verloren deals A` }
const NOEMER_TIP = {
  1: (n, peil) => ({ kop: `${getal(n)} verloren klanten B + C`, tekst: `alle beëindigde klantdeals — met dossier én de records die de churn-agent nog niet zag · v_d10_redenen · peildatum ${peil}` }),
  2: (n, peil) => ({ kop: `${getal(n)} verloren deals A`, tekst: `alle verloren sales-deals in het venster van het bord · v_d10_redenen · peildatum ${peil}` }),
}

function redenGroepen(rijen, peildatum) {
  const peil = datumKort(peildatum) || 'onbekend'
  return [1, 2].map(blok => {
    const eigen = rijen.filter(r => r.blok === blok)
    if (eigen.length === 0) return null
    const noemer = eigen[0].noemer ?? null
    return {
      id: `blok-${blok}`,
      naam: REDEN_BLOKKEN[blok].naam,
      tel: REDEN_BLOKKEN[blok].tel,
      kort: blok === 1 ? 'AI' : 'HubSpot',
      noemer,
      noemerTekst: noemer !== null ? NOEMER_TEKST[blok](noemer) : null,
      noemerTip: noemer !== null ? NOEMER_TIP[blok](noemer, peil) : null,
      l5: noemer !== null
        ? `0 van ${getal(noemer)} ${blok === 2 ? 'A-verliezen' : 'B/C-verliezen'} draagt een reden — niets te rangschikken.`
        : null,
      rijen: eigen.map(r => ({ ...r, waarde: r.n })),
    }
  }).filter(Boolean)
}

const GEEN_MAANDVENSTER = 'telt over het hele venster van dertien maanden — de view kent geen maandsnede (F7)'

export default function D10Ontleding({ data, meta, snede, periode, onSnede, gekozen, onKies }) {
  const rijen = useMemo(() => rijenVoor(snede, data, periode), [snede, data, periode])
  const groepen = useMemo(() => (snede === 'waarom' ? redenGroepen(rijen, meta?.peildatum) : null), [snede, rijen, meta])

  const segmentDekking = meta && meta.companies_zichtbaar
    ? decimaal((meta.companies_met_omvang / meta.companies_zichtbaar) * 100, 1)
    : null
  const maand = periode === 'maand'

  const sneden = [
    { id: 'wie', label: 'wie staat op het punt', titel: 'De vier CS-lijsten: wie staat op het punt te vertrekken? De stand van vandaag — geen verliezen, dus buiten het periodefilter.' },
    { id: 'waarom', label: 'waarom', uit: maand, titel: maand ? GEEN_MAANDVENSTER : 'Twee bronnen, nooit gemengd: de AI-lezing over B en C, het HubSpot-veld over A' },
    { id: 'wanneer', label: 'wanneer', uit: maand, titel: maand ? GEEN_MAANDVENSTER : 'Tijd tot verlies per soort — elk met zijn eigen grondslag; de spreiding staat rechts' },
    { id: 'trend', label: maand ? '↻ per maand' : '↻ 13 maanden', titel: 'Drie reeksen náást elkaar, één schaal' },
  ]

  const trendMax = snede === 'trend' && rijen.length ? rijen[0].max : 1

  const voet = {
    wie: <>Verlengmoment = <b>startdatum + 12 maanden</b>; HubSpot kent geen verlengingsdatum. Eén kantoor kan in twee lijsten staan.</>,
    waarom: groepen && (
      <>
        Schaal per bron: {balkrangSchaal(groepen, getal)} · <b>v_d10_redenen</b> · {datumKort(meta?.peildatum) || 'peildatum onbekend'}.
        {' '}Geen gemeten opzegreden — rood is ontbrekende registratie, geen reden.
      </>
    ),
    wanneer: <>Mediaan uit <b>v_d10_kop</b>, over alle records van de soort. Kies een soort: de spreiding staat rechts.</>,
    trend: <>{reeksnaastSchaal(trendMax, getal)} · nooit gestapeld, geen maandtotaal — A is pipeline, B is proef, C is churn.</>,
  }[snede]

  return (
    <MeesterLijst
      titel="Ontleding"
      snede={<SnedeKiezer sneden={sneden} actief={snede} onKies={onSnede} />}
      kolomkoppen={KOLOMKOPPEN[snede] || []}
      slot={
        /* De twee vragen die vandaag niet te beantwoorden zijn, als één regel.
           Vijf lege plekken naast elkaar lezen als een defect bord; één
           overtuigt, en de rest staat achter `Wat ontbreekt` in zone 5. */
        <button
          type="button"
          className={`bs-rij bs-rij--blok${gekozen?.id === 'niet-te-maken' ? ' is-gekozen' : ''}`}
          onClick={() => onKies({ id: 'niet-te-maken', soort: 'leeg', naam: 'Niet te maken' })}
          aria-pressed={gekozen?.id === 'niet-te-maken'}
        >
          <span>
            ⛔ Niet te maken · 2 lijsten — segment
            {segmentDekking && ` (${segmentDekking} % gevuld)`} en early-warning (geen gebruiksdata)
          </span>
          <span className="bs-rij__caret" aria-hidden>▸</span>
        </button>
      }
      voet={voet}
    >
      {snede === 'wie' && (
        <MeesterGroep
          naam="CS-lijsten"
          tel={`${getal(rijen.reduce((n, r) => n + r.n, 0))} regels · stand van vandaag · wekelijks ritme`}
        />
      )}
      {snede === 'wanneer' && (
        <MeesterGroep
          naam="Tijd tot verlies"
          tel={`mediaan, want één uitschieter vervormt een gemiddelde · grens B/C ${getal(meta?.duurgrens_dagen)} dagen`}
        />
      )}
      {snede === 'trend' && (
        <MeesterGroep naam="Per maand" tel={maand ? 'de lopende maand · loopt nog' : 'nieuwste boven · nul is een meting, geen gat'} />
      )}

      {groepen && (
        <Balkrang
          layout="onder"
          groepen={groepen}
          gekozenId={gekozen?.id ?? null}
          onKies={r => onKies(r)}
          leeg="Geen regels in deze snede."
          getal={getal}
        />
      )}

      {snede === 'trend' && (
        <Reeksnaast
          reeksen={REEKSEN}
          rijen={rijen.map(r => ({ id: r.id, naam: r.naam, sub: r.sub, waarden: r.reeks, huidig: r.huidig, markering: r.markering }))}
          max={trendMax}
          verborgen="A"
          gekozenId={gekozen?.id ?? null}
          onKies={r => onKies(rijen.find(x => x.id === r.id))}
          getal={getal}
        />
      )}

      {!groepen && snede !== 'trend' && rijen.length === 0 && <div className="bs-leeg">Geen regels in deze snede.</div>}

      {!groepen && snede !== 'trend' && rijen.map(r => (
        <Regel key={r.id} rij={r} snede={snede} gekozen={gekozen?.id === r.id} onClick={() => onKies(r)} />
      ))}
    </MeesterLijst>
  )
}

/**
 * Eén regel van de sneden zonder beeld (`wie`, `wanneer`): links naam plus
 * grondslag, rechts het getal, altijd een caret naar de records.
 */
function Regel({ rij, snede, gekozen, onClick }) {
  const klasse = ['bs-rij', 'd10-rij', `d10-rij--${snede}`, rij.vlag ? 'd10-rij--warn' : '', gekozen ? 'is-gekozen' : '']
    .filter(Boolean).join(' ')

  return (
    <button type="button" className={klasse} onClick={onClick} aria-pressed={gekozen}>
      <span className="bs-rij__cel">
        <span className="bs-rij__naam">{rij.naam}</span>
        {(rij.sub || rij.vlag || rij.extra) && (
          <span className="bs-rij__sub">
            {rij.sub}
            {rij.sub && (rij.vlag || rij.extra) && ' · '}
            {rij.extra}
            {rij.vlag && <span className="d10-vlag">{rij.vlag}</span>}
          </span>
        )}
      </span>
      <span className={`bs-rij__n${rij.n === 0 ? ' bs-rij__n--nul' : ''}`}>
        {rij.nTekst ?? (rij.n === null || rij.n === undefined ? '—' : getal(rij.n))}
      </span>
      <span className="bs-rij__caret" aria-hidden>▸</span>
    </button>
  )
}
