import MetricCard from '../../../ui/MetricCard'
import { ContextChip, Kernzin } from '../../../ui/BordShell'

/**
 * D9Antwoord — zone 2. Eén hero met het critical number en ernaast de
 * ranglijst van de blokkers.
 *
 * Twee regels die hier hard zijn:
 *
 *  1. **Een blind getal is een ondergrens, geen nul.** Zolang `blind_voor`
 *     niet leeg is staat er `≥ n` in amber met het woord "ondergrens", en
 *     zegt de chip wélke checks niet meetellen. Een kale 0 terwijl drie van
 *     de vier blokkerende checks nog niet meetbaar zijn, is de gevaarlijkste
 *     vorm van een dashboard.
 *  2. **De ranglijst telt niet op.** De balken staan naast elkaar, er staat
 *     geen totaal onder. Records optellen over ongelijksoortige checks zou
 *     dubbel tellen — één deal kan op drie lijsten staan. Precies daarom is
 *     het critical number een deal-telling uit `v_d9_forecast_blokkers` en
 *     geen som van de rijen hieronder.
 */
export default function D9Antwoord({ blokkers, blokkerChecks }) {
  const blind = (blokkers?.blind_voor || []).filter(Boolean)
  const isBlind = blind.length > 0
  const aantal = blokkers?.aantal
  const gemeten = blokkerChecks.filter(c => c.aantal !== null && c.aantal !== undefined)
  const max = Math.max(1, ...gemeten.map(c => c.aantal || 0))

  return (
    <>
      <MetricCard
        label="Forecast-blokkers"
        merk={isBlind ? 'ondergrens' : 'deals'}
        waarde={aantal === null || aantal === undefined ? null : `${isBlind ? '≥ ' : ''}${aantal}`}
        waardeSuffix={blokkers?.noemer ? `van ${blokkers.noemer} open sales-deals` : null}
        leegTekst="niet te meten"
        reden="De mirror levert geen open sales-deals — zonder noemer is er geen ondergrens te geven."
        vergelijking="vorige week — niet bewaard (de snapshot telt per check, niet per deal)"
        basis="blokkerend = H2 · H3 · H4 · H5 — minstens één fout per deal"
        toon={isBlind ? 'waarschuwing' : 'hero'}
      >
        {isBlind && (
          <ContextChip>
            ⚠ blind voor {blind.join(' · ')} — die velden staan nog niet in de mirror
          </ContextChip>
        )}
      </MetricCard>

      {/* Dezelfde kaart-anatomie als MetricCard (.mc), maar met een ranglijst
          in plaats van één getal: het inzicht zit hier in de verhouding. */}
      <div className="mc">
        <div className="mc__kop">
          <span className="mc__label">Waar het zit</span>
          <span className="mc__merk">
            {gemeten.length} van {blokkerChecks.length} meetbaar
          </span>
        </div>

        <div className="d9-rang">
          {blokkerChecks.map(c => {
            const meet = c.aantal !== null && c.aantal !== undefined
            return (
              <div
                key={c.check_id}
                className={`d9-rang__rij${meet ? '' : ' d9-rang__rij--blind'}`}
                title={c.definitie || undefined}
              >
                <span className="d9-rang__code">{c.check_id}</span>
                <span className="d9-rang__naam">{c.titel}</span>
                {meet ? (
                  <>
                    <span className="d9-rang__baan">
                      <span className="d9-rang__vul" style={{ width: `${Math.round(((c.aantal || 0) / max) * 100)}%` }} />
                    </span>
                    <span className="d9-rang__n">{c.aantal.toLocaleString('nl-NL')}</span>
                  </>
                ) : (
                  <span className="d9-rang__blind">wacht op mirror</span>
                )}
              </div>
            )
          })}
          {blokkerChecks.length === 0 && (
            <div className="d9-rang__rij d9-rang__rij--blind">
              <span className="d9-rang__code">—</span>
              <span className="d9-rang__naam">geen blokkerende checks in deze stand</span>
            </div>
          )}
        </div>

        <span className="mc__basis">records, niet deals — één deal kan twee fouten dragen</span>
      </div>
    </>
  )
}

/**
 * De kernzin: precies één zin met een persoonsvorm, die zegt wat je met de
 * getallen hierboven doet. Hij noemt geen getal dat er al staat; herhalen is
 * geen context.
 */
export function D9Kernzin({ blokkerChecks }) {
  const gemeten = blokkerChecks
    .filter(c => c.aantal !== null && c.aantal !== undefined && c.aantal > 0)
    .sort((a, b) => (b.aantal || 0) - (a.aantal || 0))
  const blind = blokkerChecks.filter(c => c.aantal === null || c.aantal === undefined)

  if (gemeten.length === 0) {
    return (
      <Kernzin>
        <b>Aan de blokkers valt deze week niets op te ruimen.</b>{' '}
        {blind.length > 0
          ? `${blind.map(c => c.check_id).join(' · ')} meten nog niet mee — daar ligt de volgende stap.`
          : 'Alle blokkerende checks staan schoon.'}
      </Kernzin>
    )
  }

  return (
    <Kernzin>
      <b>Eén kwartier opruimen en D1 klopt weer.</b>{' '}
      {gemeten[0].check_id} is de grootste blokker
      {blind.length > 0 ? ` — en ${blind.length === 1 ? 'één check meet' : `${blind.length} checks meten`} nog niet mee.` : '.'}
    </Kernzin>
  )
}
