import MetricCard from '../../../ui/MetricCard'
import { Kernzin } from '../../../ui/BordShell'
import AanvoerStrip, { wekenOnderDoel, wekenOnderDoelRaw, nettoStand } from './AanvoerStrip'
import { getal, decimaal, euroKort, bereik, dagMaand } from '../format'

/**
 * D1Antwoord — zone 2. Vier kaarten: één hero en drie contextkaarten.
 *
 * **Aanvoer staat links, forecast daarna** (CD-lock 2026-09-13). Dat is geen
 * smaak: bij een pipelinevorm van 7 · 0 · 25 zit het lek aan de bovenkant van
 * de trechter, en een bord dat opent met "waarde fase 3" nodigt uit tot het
 * verkeerde gesprek.
 *
 * Vier en niet vijf (ontwerplock `design-full/OPTIONS.md`, variant **c2**).
 * De dekkingskaart is eraf: zolang het kwartaaldoel niet als parameter
 * vastligt, was dat een kaartbreedte aan een niet-meting plus zeven regels
 * uitleg waarom hij leeg is. Hij staat nu als één amberregel in zone 5. De
 * kaart komt terug zodra `v_d1_dekking` een kwartaaldoel levert — dan is er
 * iets te tonen in plaats van iets uit te leggen.
 *
 * Wat er verder af ging (Research 1 §B D1 §5, de snoei):
 *  • de proxy-alinea ("tot 13-09 was dít het critical number") — staat in de
 *    tooltip van het getal en in `events_annotaties`;
 *  • "Exact: € 21.085 – € 51.710" als tweede regel onder hetzelfde bedrag —
 *    één afronding op het bord, het exacte getal in de tooltip;
 *  • de win-rate-kaart en zijn voetnoot van zes regels — naar de
 *    kwartaaldiagnose, want vier percentages op n = 14 tot 60 zijn geen
 *    maandagochtend.
 *
 * Woordbudget zone 2 (v1.186): telegram op de kaarten, precies één zin met een
 * persoonsvorm en dat is de kernzin. Wat een zin nodig heeft, staat in de
 * tooltip van het getal of van de regel.
 *
 * Geen C6 (dekking) zolang `v_d1_dekking.kwartaaldoel_mrr` NULL is: het doel
 * staat niet in `dash_parameters`, en een doelstaaf zonder doel is geen beeld.
 * De pass die het kwartaaldoel als parameter vastlegt, brengt C6 mee.
 */
export default function D1Antwoord({ aanvoerKop, aanvoer, perFase, meta, blokkers, onD9, onKiesWeek, gekozenWeek }) {
  const fase = Object.fromEntries((perFase || []).map(f => [f.fase, f]))
  const f3 = fase['3']
  const actief = (perFase || []).reduce((n, f) => n + (f.aantal || 0), 0)

  const doel = aanvoerKop?.doel ?? null
  const km = aanvoerKop?.kennismakingen ?? null
  const onderDoel = km !== null && doel !== null && km < doel
  const onder = wekenOnderDoel(aanvoer, doel)
  const onderRaw = wekenOnderDoelRaw(aanvoer, doel)
  const netto = nettoStand(aanvoer, doel)

  const blind = (blokkers?.blind_voor || []).filter(Boolean)
  const isBlind = blind.length > 0
  const nBlok = blokkers?.aantal

  return (
    <>
      {/* 1 · Aanvoer — het critical number. Links, met opzet. */}
      <MetricCard
        label="Aanvoer · kennismakingen"
        merk="ruw (HubSpot)"
        waarde={getal(km)}
        waardeSuffix={
          /* Het doel staat aan de lijn in de strip; het hier nóg eens noemen is
             de G4-fout in woorden. "onder doel" en niet "tekort", omdat de
             afgeleide regel ook "onder doel" zegt — één woord voor één begrip
             (C1-FUNCTIONAL-NOTES §Kaartcopy, akkoord Jelle 2026-09-14). */
          doel === null
            ? 'vorige week · geen doel'
            : <>vorige week{km !== null && <> · <b>{
              km > doel ? `${getal(km - doel)} boven doel`
                : km === doel ? 'gehaald'
                  : `${getal(doel - km)} onder doel`
            }</b></>}</>
        }
        leegTekst="geen weekdata"
        reden="Er is nog geen afgeronde week met kennismakingsdata."
        toon={onderDoel ? 'waarschuwing' : 'hero'}
        vergelijking={aanvoerKop
          ? (
            <span className="d1-metrics">
              <span className="d1-metric"><span className="d1-metric__l">gem. 4 wk</span><span className="d1-metric__v">{decimaal(aanvoerKop.km_gemiddeld_4wk)}</span></span>
              {onderRaw && <span className="d1-metric"><span className="d1-metric__l">onder doel</span><span className="d1-metric__v">{onderRaw.onder} / {onderRaw.totaal} wk</span></span>}
              {netto !== null && <span className="d1-metric"><span className="d1-metric__l">netto</span><span className="d1-metric__v">{netto > 0 ? '+' : ''}{getal(netto)}</span></span>}
            </span>
          )
          : null}
        /* Telegram, geen persoonsvorm: de kernzin is de enige zin in zone 2.
           De weekgrenzen staan in de tooltip van het getal — "vorige week"
           zegt de suffix al, en de tijdas van de strip nog een keer. */
        basis={aanvoerKop
          ? (
            <span title={`week ${dagMaand(aanvoerKop.week_start)} – ${dagMaand(aanvoerKop.week_eind)} · ${getal(aanvoerKop.km_gevuld)} van ${getal(aanvoerKop.km_noemer)} deals draagt een kennismakingsdatum; de rest telt niet mee`}>
              {getal(aanvoerKop.km_gevuld)} van {getal(aanvoerKop.km_noemer)} deals met datum
            </span>
          )
          : null}
        /* De twaalf weken zitten tússen het getal en zijn context: de strip is
           de vergelijking, niet een illustratie erbij (C1, zone 2). En elke
           staaf is een drill-target naar zone 4 (G7): het beeld dat de eerste
           blik draagt, gaat ergens heen in plaats van alleen te hoveren. */
        tussen={(
          <AanvoerStrip
            aanvoer={aanvoer}
            doel={doel}
            kop={aanvoerKop}
            onKiesWeek={onKiesWeek}
            gekozenWeek={gekozenWeek}
          />
        )}
      />

      {/* 2 · Actieve pipeline — absolute aantallen, fase-splits zichtbaar. */}
      <MetricCard
        label="Actieve pipeline"
        waarde={getal(actief)}
        waardeSuffix="open deals"
        vergelijking="Sales Pipeline, fase 1 t/m 3"
        basis={`${getal(meta?.verloren)} verloren, buiten deze telling`}
      >
        <div className="d1-faseregel">
          {['1', '2', '3'].map(k => (
            <span key={k} className={fase[k]?.aantal ? undefined : 'is-nul'}>
              f{k}<b>{getal(fase[k]?.aantal ?? 0)}</b>
            </span>
          ))}
        </div>
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
        /* Telegram, geen persoonsvorm (zone 2 heeft er precies één: de kernzin). */
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
        {/* Eén waarheid, twee borden: de doorverwijzing is een link en geen
            herhaling van de ranglijst die daar al staat. */}
        <button type="button" className="d1-kaartlink" onClick={onD9}>
          → Datakwaliteit (D9)
        </button>
      </MetricCard>
    </>
  )
}

/**
 * De kernzin: precies één zin met een persoonsvorm die zegt wat je met de
 * getallen hierboven doet. Hij leest de pipelinevorm — waar staat het werk, en
 * waar komt het vandaan — en niet het hoogste getal.
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
