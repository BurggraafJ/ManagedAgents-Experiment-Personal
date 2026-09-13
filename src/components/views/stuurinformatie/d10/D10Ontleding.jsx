import { useMemo } from 'react'
import MeesterLijst, { MeesterGroep } from '../../../ui/MeesterLijst'
import SnedeKiezer from '../../../ui/SnedeKiezer'
import { getal, decimaal } from '../format'
import { rijenVoor, REDEN_BLOKKEN } from './d10sneden'

/**
 * D10Ontleding — zone 3. Eén blok, vier sneden op dezelfde populatie:
 * **wie staat op het punt** · waarom · wanneer · ↻ 13 maanden.
 *
 * Dit blok vervangt drie blokken die tot v1.178 onder elkaar stonden
 * (VerliesTrend, VerliesDiagnose, VerliesWerkbord) plus hun vier voetnoten.
 * Geen van die functies is weg; ze zijn van drie blokken met tabs naar één blok
 * met sneden gegaan. Wat je vroeger als staafdiagram zag is de balk ín de regel.
 *
 * Vier regels die in dit blok zitten en niet in het bord:
 *
 *  1. **De standaardsnede is "wie staat op het punt".** Dit bord wordt
 *     maandelijks gelezen, maar de enige regels waar iemand vandaag iets aan
 *     kan doen zijn de proeven die nu lopen — niet de verliezen van vorig jaar.
 *  2. **Een lege lijst is een gemeten nul.** De vier CS-lijsten staan er alle
 *     vier, ook op nul. Een lijst die verdwijnt omdat hij leeg is, verliest het
 *     verschil tussen "opgeruimd" en "niet gemeten".
 *  3. **De twee redenbronnen worden nooit gemengd.** AI-lezing en het
 *     HubSpot-veld staan onder eigen groepskoppen met hun eigen noemer; de
 *     gatregels houden hun rode kleur en hun bronlabel.
 *  4. **Wat niet te maken is, staat in de vaste strook** en scrollt dus nooit
 *     weg — maar als één regel, niet als twee rode kaarten (lege-plekken-budget,
 *     Research 1 §D).
 */
const KOLOMKOPPEN = {
  wie: ['kantoren'],
  waarom: ['records'],
  wanneer: ['mediaan dgn'],
  trend: ['A · B · C'],
}

const VOETNOOT = {
  wie: (
    <>
      Verlengmoment = <b>startdatum + 12 maanden</b>; HubSpot kent geen verlengingsdatum.
      Eén kantoor kan in twee lijsten staan.
    </>
  ),
  waarom: (
    <>
      Geen van beide bronnen is een <b>gemeten</b> opzegreden — de klant is het nooit gevraagd.
      De rode regels zijn ontbrekende registratie, geen reden: daar valt niets uit te citeren.
    </>
  ),
  wanneer: null,
  trend: (
    <>
      Drie reeksen <b>náást</b> elkaar, nooit gestapeld — en geen maandtotaal: stapelen én
      optellen suggereren allebei dat A, B en C hetzelfde meten. Eén schaal over dertien maanden.
    </>
  ),
}

export default function D10Ontleding({ data, meta, snede, onSnede, gekozen, onKies }) {
  const rijen = useMemo(() => rijenVoor(snede, data), [snede, data])

  const segmentDekking = meta && meta.companies_zichtbaar
    ? decimaal((meta.companies_met_omvang / meta.companies_zichtbaar) * 100, 1)
    : null

  const sneden = [
    { id: 'wie', label: 'wie staat op het punt', titel: 'De vier CS-lijsten: wie staat op het punt te vertrekken?' },
    { id: 'waarom', label: 'waarom', titel: 'Twee bronnen, nooit gemengd: de AI-lezing over B en C, het HubSpot-veld over A' },
    { id: 'wanneer', label: 'wanneer', titel: 'Tijd tot verlies per soort — elk met zijn eigen grondslag' },
    { id: 'trend', label: '↻ 13 maanden', titel: 'Dertien maanden, drie reeksen náást elkaar' },
  ]

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
      voet={VOETNOOT[snede]}
    >
      {snede === 'wie' && (
        <MeesterGroep
          naam="CS-lijsten"
          tel={`${getal(rijen.reduce((n, r) => n + r.n, 0))} regels · wekelijks ritme · de bovenste twee gaan over de proef`}
        />
      )}
      {snede === 'wanneer' && (
        <MeesterGroep
          naam="Tijd tot verlies"
          tel={`mediaan, want één uitschieter vervormt een gemiddelde over ${getal(meta?.bc_totaal)} records · de grens B/C is ${getal(meta?.duurgrens_dagen)} dagen`}
        />
      )}
      {snede === 'trend' && (
        <MeesterGroep naam="Per maand" tel="nieuwste boven · nul is een meting, geen gat" />
      )}

      {rijen.length === 0 && <div className="bs-leeg">Geen regels in deze snede.</div>}

      {rijen.map((r, i) => (
        <Regel
          key={r.id}
          rij={r}
          snede={snede}
          /* De groepskop van "waarom" hoort tússen de rijen: de eerste rij van
             elk blok draagt hem, zodat de twee bronnen nooit als één lijst
             gelezen kunnen worden. */
          groepskop={snede === 'waarom' && r.blok !== rijen[i - 1]?.blok ? REDEN_BLOKKEN[r.blok] : null}
          gekozen={gekozen?.id === r.id}
          onClick={() => onKies(r)}
        />
      ))}
    </MeesterLijst>
  )
}

/**
 * Eén regel. De vorm verschilt per snede omdat de vraag verschilt — maar de
 * grammatica niet: links naam plus grondslag, rechts het getal, altijd een
 * caret naar de records.
 */
function Regel({ rij, snede, groepskop, gekozen, onClick }) {
  const klasse = [
    'bs-rij', 'd10-rij', `d10-rij--${snede}`,
    rij.gat ? 'd10-rij--gat' : '',
    rij.vlag && !rij.gat ? 'd10-rij--warn' : '',
    gekozen ? 'is-gekozen' : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      {groepskop && <MeesterGroep naam={groepskop.naam} tel={groepskop.tel} />}

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

          {/* De balk staat ónder de naam en niet in een eigen kolom: hij is de
              vergelijking tússen de regels, en een aparte kolom zou de naam op
              een paneel van 42 % breedte afknijpen. */}
          {rij.balk != null && (
            <span className="d10-balk" aria-hidden>
              <i
                style={{
                  width: `${Math.max(2, Math.round(rij.balk * 100))}%`,
                  ...(rij.kleur ? { background: rij.kleur } : {}),
                }}
              />
            </span>
          )}

          {snede === 'trend' && <TrendReeks rij={rij} />}
        </span>

        {/* De trendsnede draagt geen getal: de drie reeksen zíjn de meting. Een
            getal ernaast zou één van de drie tot "het maandcijfer" maken. */}
        {snede !== 'trend' && (
          <span className={`bs-rij__n${rij.n === 0 ? ' bs-rij__n--nul' : ''}`}>
            {rij.nTekst ?? (rij.n === null || rij.n === undefined ? '—' : getal(rij.n))}
            {rij.noemer != null && <span className="d10-noemer"> / {getal(rij.noemer)}</span>}
          </span>
        )}

        <span className="bs-rij__caret" aria-hidden>▸</span>
      </button>
    </>
  )
}

/**
 * De drie reeksen van één maand, náást elkaar. Nooit gestapeld en nooit
 * opgeteld: A is pipeline, B is proef, C is churn. Ze delen één schaal, zodat
 * de maanden onderling vergelijkbaar blijven.
 */
function TrendReeks({ rij }) {
  return (
    <span className="d10-reeks" aria-hidden>
      {/* Label vóór de baan: met de baan op `flex:1` landt een label erachter
          aan de rechterrand van zijn derde, ver van de balk waar het bij hoort,
          en lees je "A2" als het getal van de kolom ernaast. */}
      {['A', 'B', 'C'].map(s => (
        <span key={s} className={`d10-reeks__soort d10-reeks__soort--${s.toLowerCase()}`}>
          <span className={`d10-reeks__n${(rij.reeks[s] || 0) === 0 ? ' is-nul' : ''}`}>
            {s} {getal(rij.reeks[s] || 0)}
          </span>
          <span className="d10-reeks__baan">
            <i style={{ width: `${Math.round(((rij.reeks[s] || 0) / rij.max) * 100)}%` }} />
          </span>
        </span>
      ))}
    </span>
  )
}
