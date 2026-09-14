import MetricCard from '../../../ui/MetricCard'
import MetricPairs, { MetricPair } from '../../../ui/MetricPairs'
import { Kernzin } from '../../../ui/BordShell'
import HeroStrip from './HeroStrip'
import { getal, bereik, euroKort } from '../format'

/**
 * D1Antwoord — zone 2. Optie B (design-lock 2026-09-14): HeroStrip
 * full-width boven drie contextkaarten.
 *
 * HeroStrip draagt het critical number (Aanvoer · kennismakingen) met
 * het getal linksboven, drie echte metric-vakjes rechtsboven en de
 * C1-strip full-width eronder. MetricCard wordt alleen nog gebruikt
 * voor de drie contextkaarten.
 */
export default function D1Antwoord({ aanvoerKop, aanvoer, perFase, meta, blokkers, onD9, onKiesWeek, gekozenWeek }) {
  const fase = Object.fromEntries((perFase || []).map(f => [f.fase, f]))
  const f3 = fase['3']
  const actief = (perFase || []).reduce((n, f) => n + (f.aantal || 0), 0)

  const doel = aanvoerKop?.doel ?? null

  const blind = (blokkers?.blind_voor || []).filter(Boolean)
  const isBlind = blind.length > 0
  const nBlok = blokkers?.aantal

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

      {/* 2 · Actieve pipeline — absolute aantallen, fase-splits als vakjes. */}
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
      </MetricCard>

      {/* 3 · Waarde fase 3 — nooit één getal, altijd bodem–plafond. */}
      <MetricCard
        label="Waarde fase 3"
        waarde={bereik(f3?.mrr_bodem, f3?.mrr_plafond, euroKort)}
        waardeSuffix="per maand"
        leegTekst="niet te waarderen"
        reden="Geen enkele fase-3-deal draagt minimumafname, contractomvang én prijs."
        vergelijking={`${getal(f3?.bodem_licenties)} – ${getal(f3?.plafond_licenties)} licenties`}
        basis={`${getal(f3?.aantal_gewaardeerd)} van ${getal(f3?.aantal)} deals gewaardeerd · ongewogen`}
      />

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
      >
        <button type="button" className="d1-kaartlink" onClick={onD9}>
          → Datakwaliteit (D9)
        </button>
      </MetricCard>
    </>
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
