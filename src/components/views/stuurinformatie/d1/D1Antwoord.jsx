import MetricCard from '../../../ui/MetricCard'
import { Kernzin } from '../../../ui/BordShell'
import AanvoerStrip, { wekenOnderDoelRaw, nettoStand } from './AanvoerStrip'
import { getal, decimaal, euroKort, bereik, dagMaand } from '../format'

/**
 * D1Antwoord — zone 2. Vijf kaarten: één hero en vier contextkaarten.
 *
 * De vijf kaarten vormen het geheel (skill v0.9.4):
 *   1. **Aanvoer** (hero, C1-hero) — het critical number
 *   2. **Actieve pipeline** — stand + fasesplit + instroom/uitstroom
 *   3. **Waarde fase 3** — bereik bodem–plafond
 *   4. **Dekking kwartaal** — ratio + run-rate
 *   5. **Win rate 12 mnd** — percentage + bandbreedte
 *
 * Blokkers staan niet in zone 2 (vertrouwen in de kop, zone 5). Dat getal
 * hoort bij de datastatus, niet bij de pipelinevraag. Dekking en win rate
 * staan hier als context-kaart met een lege plek waar het doel ontbreekt —
 * een lege plek die je in tien seconden ziet is beter dan een kaart die
 * helemaal niet bestaat (Research §5: "de skill is te licht").
 */
export default function D1Antwoord({
  aanvoerKop, aanvoer, perFase, meta, dekking, winRate,
  onKiesWeek, gekozenWeek,
}) {
  const fase = Object.fromEntries((perFase || []).map(f => [f.fase, f]))
  const f3 = fase['3']
  const actief = (perFase || []).reduce((n, f) => n + (f.aantal || 0), 0)

  const doel = aanvoerKop?.doel ?? null
  const km = aanvoerKop?.kennismakingen ?? null
  const onderDoel = km !== null && doel !== null && km < doel
  const onderRaw = wekenOnderDoelRaw(aanvoer, doel)
  const netto = nettoStand(aanvoer, doel)

  const huidigeWeek = (aanvoer || []).find(w => w.is_huidige_week)
  const instroom = huidigeWeek?.nieuwe_deals ?? null

  const hoofdhoek = (winRate || []).find(h => h.hoofdhoek)

  return (
    <>
      {/* 1 · Aanvoer — het critical number. Links, met opzet. */}
      <MetricCard
        label="Aanvoer · kennismakingen"
        merk="ruw (HubSpot)"
        waarde={getal(km)}
        waardeSuffix={
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
        basis={aanvoerKop
          ? (
            <span title={`week ${dagMaand(aanvoerKop.week_start)} – ${dagMaand(aanvoerKop.week_eind)} · ${getal(aanvoerKop.km_gevuld)} van ${getal(aanvoerKop.km_noemer)} deals draagt een kennismakingsdatum; de rest telt niet mee`}>
              {getal(aanvoerKop.km_gevuld)} van {getal(aanvoerKop.km_noemer)} deals met datum
            </span>
          )
          : null}
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

      {/* 2 · Actieve pipeline — stand + fasesplit + richting. */}
      <MetricCard
        label="Actieve pipeline"
        waarde={getal(actief)}
        waardeSuffix="open deals"
        vergelijking={instroom !== null
          ? <span className="d1-metrics">
              <span className="d1-metric"><span className="d1-metric__l">instroom deze wk</span><span className="d1-metric__v">{getal(instroom)}</span></span>
              {(meta?.trend_dagen || 0) === 0 && <span className="d1-metric"><span className="d1-metric__l">trend</span><span className="d1-metric__v">nog geen data</span></span>}
            </span>
          : 'Sales Pipeline, fase 1 t/m 3'}
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

      {/* 4 · Dekking kwartaal — ratio plafond/doel. Lege plek als het doel
           niet vastligt: dat zíe je, een kaart die er helemaal niet is niet. */}
      <MetricCard
        label={`Dekking ${dekking?.kwartaal_label || 'kwartaal'}`}
        waarde={dekking?.dekking_plafond != null
          ? `${decimaal(dekking.dekking_plafond, 1)}×`
          : null}
        leegTekst="doel niet vastgelegd"
        reden="Kwartaaldoel staat niet in dash_parameters."
        vergelijking={dekking?.kwartaaldoel_mrr != null
          ? <span className="d1-metrics">
              <span className="d1-metric"><span className="d1-metric__l">run-rate</span><span className="d1-metric__v">{euroKort(dekking.mrr_plafond)}/mnd</span></span>
              <span className="d1-metric"><span className="d1-metric__l">restdagen</span><span className="d1-metric__v">{getal(dekking.dagen_resterend)}</span></span>
            </span>
          : null}
        basis={dekking?.kwartaaldoel_mrr != null
          ? `plafond fase 3 tegen doel ${euroKort(dekking.kwartaaldoel_mrr)}/mnd`
          : null}
      />

      {/* 5 · Win rate — de hoofdhoek (conservatief, Methodiek 2). */}
      <MetricCard
        label="Win rate"
        waarde={hoofdhoek?.win_rate != null
          ? `${decimaal(hoofdhoek.win_rate, 1)} %`
          : null}
        leegTekst="geen afgesloten trajecten"
        reden="Geen gewonnen of verloren deals met een afsluitdatum dit jaar."
        vergelijking={hoofdhoek
          ? <span className="d1-metrics">
              <span className="d1-metric"><span className="d1-metric__l">gewonnen</span><span className="d1-metric__v">{getal(hoofdhoek.gewonnen)}</span></span>
              <span className="d1-metric"><span className="d1-metric__l">verloren</span><span className="d1-metric__v">{getal(hoofdhoek.verloren)}</span></span>
            </span>
          : null}
        basis={hoofdhoek
          ? `n = ${getal(hoofdhoek.basis_n)} · ${hoofdhoek.jaar}`
          : null}
      />
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
