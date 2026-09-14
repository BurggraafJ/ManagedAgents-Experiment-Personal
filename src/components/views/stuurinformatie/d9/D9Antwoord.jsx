import MetricCard from '../../../ui/MetricCard'
import { ContextChip, Kernzin } from '../../../ui/BordShell'

/**
 * D9Antwoord — zone 2. Eén hero met het critical number en ernaast de kaart
 * "Waar het zit": per blokkerende check het aantal records mét zijn noemer.
 *
 * Drie regels die hier hard zijn (skill dashboarding v0.9.1):
 *
 *  1. **Een blind getal is een ondergrens, geen nul.** Zolang `blind_voor`
 *     niet leeg is staat er `≥ n` in amber met het woord "ondergrens", en
 *     zegt de chip op de kopregel wélke checks niet meetellen. Een kale 0
 *     terwijl drie van de vier blokkerende checks nog niet meetbaar zijn, is
 *     de gevaarlijkste vorm van een dashboard.
 *  2. **Geen balk over ongelijksoortige noemers (G3 — C4 is op D9 verboden).**
 *     16 van 161 open deals naast 7 van 32 sales-deals zijn geen vergelijkbare
 *     lengtes. De kaart geeft daarom getallen mét hun noemer per rij, geen
 *     staven. De telling per check komt uit `v_d9_checks`; de kaart rekent niets.
 *  3. **De kaart telt niet op.** Eén deal kan op drie lijsten staan; precies
 *     daarom is het critical number een deal-telling uit
 *     `v_d9_forecast_blokkers` en geen som van de rijen hiernaast.
 *
 * Hero zonder C3: `snap_hygiene_dag` bewaart de stand per check, niet het
 * blokker-deal-getal, dus er ís geen reeks voor dit getal — geen spark, geen
 * `reeks start` (dat is een lege bron, geen check; principes.md regel 19).
 *
 * Woordbudget zone 2: telegram op de kaarten, de uitleg in de tooltip; de
 * enige zin met een persoonsvorm in deze zone is de kernzin.
 */
export default function D9Antwoord({ blokkers, blokkerChecks }) {
  const blind = (blokkers?.blind_voor || []).filter(Boolean)
  const isBlind = blind.length > 0
  const aantal = blokkers?.aantal
  const gemeten = blokkerChecks.filter(c => c.aantal !== null && c.aantal !== undefined)
  const nogBlind = blokkerChecks.filter(c => c.aantal === null || c.aantal === undefined)

  return (
    <>
      <MetricCard
        label="Forecast-blokkers"
        merk={isBlind ? 'ondergrens' : 'deals'}
        kopExtra={isBlind && (
          <ContextChip>
            <span title="Die velden staan nog niet in de mirror: de propertylijst van hubspot-sync-etl moet uitgebreid en daarna één keer volledig gesynct.">
              ⚠ blind voor {blind.join(' · ')}
            </span>
          </ContextChip>
        )}
        waarde={aantal === null || aantal === undefined ? null : `${isBlind ? '≥ ' : ''}${aantal}`}
        waardeSuffix={blokkers?.noemer ? `van ${blokkers.noemer} open sales-deals` : null}
        leegTekst="niet te meten"
        reden="De mirror levert geen open sales-deals — zonder noemer is er geen ondergrens te geven."
        vergelijking={
          <span title="snap_hygiene_dag bewaart de stand per check, niet per deal — het blokkergetal van vorige week is daardoor niet terug te halen.">
            vorige week · niet bewaard
          </span>
        }
        basis="blokkerend = H2 · H3 · H4 · H5 · deal met ≥ 1 fout"
        toon={isBlind ? 'waarschuwing' : 'hero'}
      />

      {/* Dezelfde kaart-anatomie als MetricCard (.mc), met een lijst in
          plaats van één getal. Getallen met noemer — geen lengtes. */}
      <div className="mc">
        <div className="mc__kop">
          <span className="mc__label">Waar het zit</span>
          <span className="mc__merk">
            {gemeten.length} van {blokkerChecks.length} meetbaar
          </span>
        </div>

        <div className="d9-rang">
          {gemeten.map(c => (
            <div key={c.check_id} className="d9-rang__rij" title={c.definitie || undefined}>
              <span className="d9-rang__code">{c.check_id}</span>
              <span className="d9-rang__naam">{c.titel}</span>
              <span className="d9-rang__n">
                {c.aantal.toLocaleString('nl-NL')}
                {c.noemer !== null && c.noemer !== undefined && (
                  <span className="d9-rang__noemer"> van {c.noemer.toLocaleString('nl-NL')}</span>
                )}
              </span>
            </div>
          ))}

          {/* De blinde blokkers op één regel: ze staan hier omdat ze de `≥`
              verklaren, niet omdat er iets te ordenen valt. */}
          {nogBlind.length > 0 && (
            <div
              className="d9-rang__rij d9-rang__rij--blind"
              title={nogBlind.map(c => `${c.check_id} · ${c.titel}`).join('\n')}
            >
              <span className="d9-rang__code">{nogBlind.map(c => c.check_id).join(' · ')}</span>
              <span className="d9-rang__naam">
                {nogBlind.length === 1 ? nogBlind[0].titel : `${nogBlind.length} blokkers nog niet meetbaar`}
              </span>
              <span className="d9-rang__blind">wacht op mirror</span>
            </div>
          )}

          {blokkerChecks.length === 0 && (
            <div className="d9-rang__rij d9-rang__rij--blind">
              <span className="d9-rang__code">—</span>
              <span className="d9-rang__naam">geen blokkerende checks in deze stand</span>
            </div>
          )}
        </div>

        <span
          className="mc__basis"
          title="Eén deal kan op twee lijsten staan; de rijen tellen daarom niet op tot het getal links. Elke rij draagt zijn eigen noemer — dat is waarom hier geen balken staan."
        >
          records, niet deals · noemer per check
        </span>
      </div>
    </>
  )
}

/**
 * De kernzin: precies één zin met een persoonsvorm — de enige in zone 2 — die
 * zegt wat je met de getallen hierboven doet. Erachter hoogstens één
 * telegram-fragment. Hij noemt geen getal dat er al staat; herhalen is geen
 * context, en de blinde checks staan al in de chip.
 */
export function D9Kernzin({ blokkerChecks }) {
  const gemeten = blokkerChecks
    .filter(c => c.aantal !== null && c.aantal !== undefined && c.aantal > 0)
    .sort((a, b) => (b.aantal || 0) - (a.aantal || 0))
  const blind = blokkerChecks.filter(c => c.aantal === null || c.aantal === undefined)

  if (gemeten.length === 0) {
    return (
      <Kernzin>
        <b>Aan de blokkers valt deze week niets op te ruimen</b>
        {blind.length > 0 ? ' · eerst meten wat nog blind is' : ' · alles schoon'}
      </Kernzin>
    )
  }

  return (
    <Kernzin>
      <b>Eén kwartier opruimen en D1 klopt weer</b> · eerst {gemeten[0].check_id}
    </Kernzin>
  )
}
