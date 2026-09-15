import MetricCard from '../../../ui/MetricCard'
import MetricPairs, { MetricPair } from '../../../ui/MetricPairs'
import { ContextChip, Kernzin } from '../../../ui/BordShell'
import HeroStrip from './HeroStrip'
import BewegingStrip from './BewegingStrip'
import { kanaalLabel } from './kanaalLabels'
import { getal, bereik, euroKort } from '../format'

/**
 * D1Antwoord — zone 2. Optie B (design-lock 2026-09-14) + Fase-4-chips
 * (klantvraag-reset 2026-09-15): HeroStrip full-width, bewegingsstrip,
 * drie contextkaarten met ICP- en kanaal-chips, licenties naast €.
 */
export default function D1Antwoord({
  aanvoerKop, aanvoer, perFase, meta, blokkers,
  kanaal, icp, beweging,
  onKiesWeek, gekozenWeek, onKiesKanaal, onKiesIcp,
}) {
  const fase = Object.fromEntries((perFase || []).map(f => [f.fase, f]))
  const f3 = fase['3']
  const actief = (perFase || []).reduce((n, f) => n + (f.aantal || 0), 0)

  const doel = aanvoerKop?.doel ?? null

  const blind = (blokkers?.blind_voor || []).filter(Boolean)
  const isBlind = blind.length > 0
  const nBlok = blokkers?.aantal

  const icpTekst = (icp || []).map(r => `${r.segment} ${getal(r.aantal)}`).join(' · ')
  const kanaalTekst = (kanaal || []).slice(0, 4).map(r =>
    `${kanaalLabel(r.kanaal)} ${getal(r.aantal)}`).join(' · ')
  const kanaalOnbekend = (kanaal || []).find(r => r.kanaal === 'UNKNOWN')

  return (
    <>
      {/* 1 · Aanvoer — het critical number. HeroStrip (Optie B). */}
      <HeroStrip
        kop={aanvoerKop}
        aanvoer={aanvoer}
        doel={doel}
        onKiesWeek={onKiesWeek}
        gekozenWeek={gekozenWeek}
      />

      {/* 1b · Beweging — pipeline in- en uitstroom per week. */}
      <BewegingStrip beweging={beweging} />

      {/* 2 · Actieve pipeline + ICP-chip. */}
      <MetricCard
        label="Actieve pipeline"
        waarde={getal(actief)}
        waardeSuffix="open deals"
        vergelijking="Sales Pipeline, fase 1 t/m 3"
        basis={`${getal(meta?.verloren)} verloren, buiten deze telling`}
      >
        <MetricPairs compact>
          {['1', '2', '3'].map(k => (
            <MetricPair
              key={k}
              label={`fase ${k}`}
              waarde={getal(fase[k]?.aantal ?? 0)}
            />
          ))}
        </MetricPairs>
        {icp.length > 0 && (
          <ChipStrook
            label="ICP"
            items={icp}
            renderItem={r => r.segment}
            renderN={r => getal(r.aantal)}
            onClick={onKiesIcp}
            titel={`ICP-segmenten open deals: ${icpTekst}`}
          />
        )}
      </MetricCard>

      {/* 3 · Waarde fase 3 — bodem–plafond € + licenties ernaast. */}
      <MetricCard
        label="Waarde fase 3"
        waarde={bereik(f3?.mrr_bodem, f3?.mrr_plafond, euroKort)}
        waardeSuffix="per maand"
        leegTekst="niet te waarderen"
        reden="Geen enkele fase-3-deal draagt minimumafname, contractomvang én prijs."
        vergelijking={`${getal(f3?.bodem_licenties)} – ${getal(f3?.plafond_licenties)} licenties`}
        basis={`${getal(f3?.aantal_gewaardeerd)} van ${getal(f3?.aantal)} deals gewaardeerd · ongewogen`}
      >
        {kanaal.length > 0 && (
          <ChipStrook
            label="Kanaal"
            items={kanaal.slice(0, 4)}
            renderItem={r => kanaalLabel(r.kanaal)}
            renderN={r => getal(r.aantal)}
            onClick={onKiesKanaal}
            titel={`Acquisitiekanaal open deals: ${kanaalTekst}`}
            waarschuwing={kanaalOnbekend
              ? `${getal(kanaalOnbekend.aantal)} deal${kanaalOnbekend.aantal === 1 ? '' : 's'} zonder bron`
              : null}
          />
        )}
      </MetricCard>

      {/* 4 · Blokkers — hetzelfde getal als op D9, inclusief de ondergrens. */}
      <MetricCard
        label="Blokkers"
        merk={isBlind ? 'ondergrens' : 'deals'}
        waarde={nBlok === null || nBlok === undefined ? null : `${isBlind ? '≥ ' : ''}${getal(nBlok)}`}
        waardeSuffix={blokkers?.noemer ? `van ${getal(blokkers.noemer)}` : null}
        leegTekst="niet te meten"
        reden="De mirror levert geen open sales-deals — zonder noemer is er geen ondergrens te geven."
        vergelijking={
          <span title="Deals met minstens één blokkerende hygiënefout (H2 · H3 · H4 · H5) — hun bodem, plafond of beslisdatum is niet te vertrouwen, en dus de forecast hierboven ook niet helemaal.">
            vertekening van deze forecast
          </span>
        }
        basis={isBlind
          ? `zelfde getal als op D9 · blind voor ${blind.join(' · ')}`
          : 'zelfde getal als op D9'}
        toon={isBlind ? 'waarschuwing' : 'normaal'}
      />
    </>
  )
}

/**
 * ChipStrook — een compacte rij tags in een kaart: ICP of kanaal.
 * Geen berekening: labels en aantallen komen uit de view.
 */
function ChipStrook({ label, items, renderItem, renderN, onClick, titel, waarschuwing }) {
  return (
    <div className="d1-chips" title={titel || undefined}>
      <span className="d1-chips__label">{label}</span>
      {items.map((r, i) => (
        <button
          key={i}
          type="button"
          className="d1-chip"
          onClick={onClick ? () => onClick(r) : undefined}
        >
          <span className="d1-chip__naam">{renderItem(r)}</span>
          <span className="d1-chip__n">{renderN(r)}</span>
        </button>
      ))}
      {waarschuwing && <span className="d1-chips__warn">{waarschuwing}</span>}
    </div>
  )
}

/**
 * De kernzin: precies één zin met een persoonsvorm die zegt wat je met de
 * getallen hierboven doet.
 */
export function D1Kernzin({ perFase }) {
  const fase = Object.fromEntries((perFase || []).map(f => [f.fase, f]))
  const boven = (fase['1']?.aantal || 0) + (fase['2']?.aantal || 0)
  const onder = fase['3']?.aantal || 0

  if (boven === 0 && onder === 0) {
    return <Kernzin><b>Er staat geen open deal in de pipeline.</b> Dat is een lege trechter, geen schone.</Kernzin>
  }
  if (boven >= onder) {
    return (
      <Kernzin>
        <b>{getal(boven)} {boven === 1 ? 'kans' : 'kansen'} bovenin tegen {getal(onder)} in onderhandeling</b>
        {' '}— het werk zit aan de onderkant.
      </Kernzin>
    )
  }
  return (
    <Kernzin>
      <b>{getal(boven)} {boven === 1 ? 'kans' : 'kansen'} bovenin tegen {getal(onder)} in onderhandeling</b>
      {' '}— het lek zit aan de bovenkant.
    </Kernzin>
  )
}
