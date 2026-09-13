import MetricCard from '../../../ui/MetricCard'
import AanvoerStrip from './AanvoerStrip'
import { getal, decimaal, euro, euroKort, bereik, dagMaand, datumKort } from './format'

/**
 * De eerste blik van D1: vijf kaarten in de volgorde van de keten.
 *
 * **Aanvoer staat links, forecast daarna** (CD-lock 2026-09-13). Dat is geen
 * smaak: de gemeten pipelinevorm is 7 · 0 · 25, dus het lek zit aan de bovenkant
 * van de trechter. Een bord dat opent met "waarde fase 3" nodigt uit tot het
 * verkeerde gesprek.
 *
 * Het critical number is **gehouden kennismakingen per week** (doel uit
 * dash_parameters). De interim-proxy "nieuwe pipeline per week" is er niet af
 * gehaald maar naar de tweede regel van dezelfde kaart verhuisd, expliciet
 * gelabeld — twee reeksen die elkaar opvolgen mogen nooit stil in elkaar
 * overlopen (onderzoek §4.1; de omslag staat als gebeurtenis in
 * events_annotaties).
 */
export default function D1Kaarten({ aanvoerKop, aanvoer, perFase, dekking, winRate, meta }) {
  const fase = Object.fromEntries((perFase || []).map(f => [f.fase, f]))
  const f3 = fase['3']
  const actief = (perFase || []).reduce((n, f) => n + (f.aantal || 0), 0)
  const hoofdhoek = (winRate || []).find(h => h.hoofdhoek)

  const doel = aanvoerKop?.doel ?? null
  const km = aanvoerKop?.kennismakingen ?? null
  const onderDoel = km !== null && doel !== null && km < doel

  return (
    <div className="d1-kaarten">
      {/* 1 · Aanvoer — het critical number. Links, met opzet. */}
      <MetricCard
        label="Gehouden kennismakingen"
        merk="ruw (HubSpot)"
        waarde={getal(km)}
        waardeSuffix="vorige week"
        leegTekst="geen weekdata"
        reden="Er is nog geen afgeronde week met kennismakingsdata."
        toon={onderDoel ? 'waarschuwing' : 'hero'}
        vergelijking={doel === null
          ? 'geen doel vastgelegd'
          : `doel ${getal(doel)} per week${km !== null ? ` · ${km >= doel ? 'gehaald' : `${getal(doel - km)} tekort`}` : ''}`}
        basis={aanvoerKop
          ? `week ${dagMaand(aanvoerKop.week_start)} – ${dagMaand(aanvoerKop.week_eind)} · ${getal(aanvoerKop.km_gevuld)} van ${getal(aanvoerKop.km_noemer)} deals draagt een datum`
          : null}
      >
        <AanvoerStrip aanvoer={aanvoer} doel={doel} />
        <div className="mc__extra">
          Gemiddeld {decimaal(aanvoerKop?.km_gemiddeld_4wk)} per week over vier weken ·
          deze week tot nu {getal(aanvoerKop?.kennismakingen_lopend) ?? '0'}
          {meta?.kennismaking_gepland > 0 && <> · {getal(meta.kennismaking_gepland)} staat gepland</>}
        </div>
        <div className="mc__extra mc__extra--bron">
          <b>proxy</b> — tot 13-09 was dít het critical number:{' '}
          {getal(aanvoerKop?.nieuwe_deals) ?? '—'} nieuwe deals die week,{' '}
          {getal(aanvoerKop?.nieuw_4wk) ?? '—'} over vier weken. Blijft staan tot beide reeksen
          elkaar bevestigen.
        </div>
      </MetricCard>

      {/* 2 · Actieve pipeline — absolute aantallen, fase-splits zichtbaar. */}
      <MetricCard
        label="Actieve pipeline"
        waarde={getal(actief)}
        waardeSuffix="open deals"
        vergelijking="Sales Pipeline, fase 1 t/m 3"
        basis={`${getal(meta?.sales_deals)} deals in de pipeline · ${getal(meta?.verloren)} verloren, buiten deze telling`}
      >
        <div className="mc__splits">
          {['1', '2', '3'].map(k => (
            <span key={k} className={fase[k]?.aantal ? undefined : 'is-nul'}>
              f{k} <b>{getal(fase[k]?.aantal ?? 0)}</b>
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
      >
        <div className="mc__extra">
          Exact: {bereik(f3?.mrr_bodem, f3?.mrr_plafond) || '—'} per maand.
        </div>
        <div className="mc__extra">
          Prijs van de deal waar gevuld{meta?.op_lijstprijs > 0
            ? `, lijstprijs bij ${getal(meta.op_lijstprijs)} deals`
            : ' — geen enkele deal valt terug op de lijstprijs'}.
          Geen kanspercentage: bodem is de minimumafname, plafond de contractomvang.
        </div>
      </MetricCard>

      {/* 4 · Dekking — leeg tot het kwartaaldoel is vastgelegd. Nooit een 0. */}
      <MetricCard
        label={`Dekking ${dekking?.kwartaal_label || 'kwartaal'}`}
        waarde={dekking?.dekking_plafond !== null && dekking?.dekking_plafond !== undefined
          ? `${decimaal(dekking.dekking_plafond, 1)}×`
          : null}
        leegTekst="doel niet vastgelegd"
        reden="Het kwartaaldoel staat handmatig op Omzet & Doelen (peildatum 12-08-2026, in euro per maand) en is nog niet als parameter overgenomen. Zolang het er niet is, toont dit bord een lege plek en geen berekening."
        vergelijking={dekking?.dekkingsnorm
          ? `norm ${decimaal(dekking.dekkingsnorm, 1)}×`
          : 'geen dekkingsnorm vastgelegd'}
        basis={dekking
          ? `plafond fase 3 ${euro(dekking.mrr_plafond)} · nog ${getal(dekking.dagen_resterend)} dagen in het kwartaal`
          : null}
      >
        {dekking?.doel_peildatum && (
          <div className="mc__extra">
            Peildatum van het doel: {datumKort(dekking.doel_peildatum)} — ouder dan de data hierboven.
            Bron: {dekking.doel_bron}.
          </div>
        )}
      </MetricCard>

      {/* 5 · Win rate — hoofdhoek hier, de andere drie in de bandbreedte. */}
      <MetricCard
        label="Win rate"
        waarde={hoofdhoek?.win_rate !== null && hoofdhoek?.win_rate !== undefined
          ? `${decimaal(hoofdhoek.win_rate, 1)} %`
          : null}
        leegTekst="geen afgesloten trajecten"
        reden="Er zijn geen gewonnen of verloren deals met een afsluitdatum in dit jaar."
        vergelijking={hoofdhoek
          ? `afsluitjaar ${hoofdhoek.jaar} · backburner telt als verloren`
          : null}
        basis={hoofdhoek
          ? `n = ${getal(hoofdhoek.basis_n)} (${getal(hoofdhoek.gewonnen)} gewonnen, ${getal(hoofdhoek.verloren)} verloren)`
          : null}
      >
        <div className="mc__extra mc__extra--let-op">
          {getal(hoofdhoek?.zonder_closedate)} van {getal(hoofdhoek?.populatie)} afgesloten trajecten
          heeft géén afsluitdatum en valt dus uit deze hoek — vooral aan de verloren kant.
          De bandbreedte hieronder laat zien wat dat doet.
        </div>
      </MetricCard>
    </div>
  )
}
