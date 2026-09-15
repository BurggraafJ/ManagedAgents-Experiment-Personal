import { useMemo } from 'react'
import DetailPaneel from '../../../../ui/DetailPaneel'
import WorkTable from '../../../../ui/WorkTable'
import { getal, datumKort } from '../../format'
import { eenheid as maakEenheid, FASE_KORT, FASE_UITLEG, kanaalLabel, BAND_LABEL, bereikKort, euroK, dagMaandKort } from './labels'

/**
 * D1Detail — zone 4, de gedeelde sink van het Live-bord (D1-LIVE-INTERACTION.md).
 * Zeven ingangen, één paneel: week · fase · maand · waarde · beweging · kanaal
 * (UI: Leadsource) · band. De kop noemt altijd de herkomst, de chips de getallen
 * van de snede, de tabel de records met een HubSpot-deeplink per rij. Weg gaat
 * het paneel via `◂ Overzicht` in de balk of Esc (D1View) — niet via een
 * tweede klik (v1.211). **Sinds v1.212 bestaat het paneel alleen in focus:**
 * D1View mount het pas bij een selectie, dus een lege staat ("klik een staaf")
 * is er niet meer; zonder `gekozen` rendert dit component niets.
 *
 * **Kennismakingen (v1.211, Jelle 15-09-2026).** Achter een weekstaaf staan
 * altijd kantoorgrootte (advocaten, `totale_omvang`), de kennismakingdatum en
 * de pipeline. Die laatste komt uit `hubspot_pipelines` voor de ene pipeline
 * die dit bord leest (prop `pipeline`); v_d1_deals filtert al op de Sales
 * Pipeline, dus de kolom zegt op elke rij hetzelfde — dat is de constatering,
 * niet een bug. Fase en licentieband blijven staan.
 *
 * **De selectie rekent niet, hij kiest.** Alle sleutels komen uit de view-rij
 * die links is aangeklikt (bucket, fase, kanaal, kantoorband, week_start) en
 * worden hier alleen vergeleken. De chips tonen de view-getallen; de voet zegt
 * `n van m` zodat een verschil zichtbaar is in plaats van stil.
 *
 * **Focus-split (v1.210).** Met `focus` is de sink ~560 px in plaats van 300 en
 * krijgt elke tabel de kolommen die in 300 px moesten wijken: eigenaar, €/mnd
 * en bron (`extra`, vóór de HubSpot-link). Op een telefoon vult het paneel het
 * scherm en draagt de kop `◂ Overzicht` — daar is geen kaartkop in beeld die
 * hem kan dragen (dl-detail__terug, alleen zichtbaar onder 1000 px).
 */
const Link = d => (d.hubspot_url ? <a href={d.hubspot_url} target="_blank" rel="noreferrer" title="Open in HubSpot" className="dl-hs">↗</a> : null)
const kantoor = (d, extra) => (
  <span className="dl-cel">
    <span className="dl-cel__k" title={d.dealname || d.company_naam || undefined}>{d.dealname || d.company_naam || '(zonder naam)'}</span>
    <span className="dl-cel__b">{BAND_LABEL[d.kantoorband] || d.kantoorband || '—'}{extra}</span>
  </span>
)
const licCel = d => (d.bodem_lic != null && d.plafond_lic != null ? bereikKort(d.bodem_lic, d.plafond_lic) : <span className="dl-cel__leeg">–</span>)
const KOL = {
  kantoor: (extra) => ({ key: 'kantoor', label: 'kantoor', breedte: 'minmax(0, 1fr)', render: d => kantoor(d, extra ? extra(d) : null) }),
  lic: { key: 'lic', label: 'lic', breedte: '52px', klasse: 'wt__rechts wt__mono', render: licCel },
  eur: { key: 'eur', label: '€/mnd', breedte: '78px', klasse: 'wt__rechts wt__mono', render: d => (d.mrr_plafond != null ? `${euroK(d.mrr_bodem)}–${euroK(d.mrr_plafond)}` : <span className="dl-cel__leeg">–</span>) },
  close: { key: 'close', label: 'close', breedte: '44px', klasse: 'wt__rechts wt__mono', render: d => <span className={d.beslisdatum ? '' : 'dl-cel__leeg'}>{dagMaandKort(d.beslisdatum)}</span> },
  fase: { key: 'fase', label: 'fase', breedte: '34px', klasse: 'wt__mono', render: d => (d.fase && FASE_KORT[d.fase] ? `F${d.fase}` : (d.fase === 'gewonnen' ? 'won' : d.fase === 'verloren' ? 'verl' : d.fase || '—')) },
  link: { key: 'link', label: '', breedte: '16px', klasse: 'wt__ext', render: Link },
  // Kennismakingen (v1.211): kantoorgrootte in advocaten, `?` = geen company of geen totale_omvang.
  // Kolombreedtes volgen de kopletters (9,5 px mono, .06em): KANTOORGROOTTE ≈ 88 px, KENNISMAKING ≈ 76 px.
  // Mét sidebar op 1440 is de brede sink ≈ 520 px; wat hier bij komt gaat van de kantoornaam af.
  grootte: { key: 'grootte', label: 'kantoorgrootte', breedte: '90px', klasse: 'wt__rechts wt__mono', render: d => (d.totale_omvang != null ? getal(d.totale_omvang) : <span className="dl-cel__gat">?</span>) },
  // Alleen in de brede sink (focus-split): wie, wat het waard is, waar het vandaan kwam.
  eigenaar: { key: 'eigenaar', label: 'eigenaar', breedte: '60px', klasse: 'wt__rechts dl-cel__s', render: d => (d.eigenaar ? d.eigenaar.split(' ')[0] : <span className="dl-cel__leeg">–</span>) },
  bron: { key: 'bron', label: 'leadsource', breedte: '70px', klasse: 'wt__rechts dl-cel__s', render: d => <span className={d.kanaal && d.kanaal !== 'UNKNOWN' ? '' : 'dl-cel__gat'}>{kanaalLabel(d.kanaal)}</span> },
}
const KOL_BREED = { eigenaar: KOL.eigenaar, eur: KOL.eur, bron: KOL.bron }
/** De pipeline van het bord — één label voor alle rijen (zie kop); `?` als de read mislukte. */
const pipelineKol = pipeline => ({ key: 'pipeline', label: 'pipeline', breedte: '84px', klasse: 'wt__rechts dl-cel__s',
  render: () => (pipeline?.label ? pipeline.label : <span className="dl-cel__leeg">?</span>) })
/** Basiskolommen + de extra's van de brede sink, de link altijd achteraan. */
const breed = (kolommen, extra) => [...kolommen.slice(0, -1), ...extra.map(k => KOL_BREED[k]).filter(k => !kolommen.includes(k)), KOL.link]
const dagen = (veld, drempel) => ({ key: veld, label: 'dagen', breedte: '44px', klasse: 'wt__rechts wt__mono',
  render: d => <span className={`dl-dagen${drempel && d[veld] > drempel ? ' is-lang' : ''}`}>{d[veld] != null ? `${getal(d[veld])} d` : <span className="dl-cel__leeg">?</span>}</span> })
const datum = (veld, label, breedte = '44px') => ({ key: veld, label, breedte, klasse: 'wt__rechts wt__mono', render: d => dagMaandKort(d[veld]) })

const teLang = drempel => d => (drempel && d.dagen_in_fase > drempel ? <span className="dl-chip">te lang</span> : null)
/** F1/F2/F3 nooit zonder gewone taal ernaast (Jelle): als tooltip op de fase-mix-chip. */
const FASE_TITEL = [1, 2, 3].map(f => `F${f} = ${FASE_UITLEG[f]}`).join(' · ')

export default function D1Detail({ gekozen, deals, aanvoerDeals, bewegingDeals, pipeline = null, modus, meta, focus = false, onTerug = null }) {
  const eenheid = maakEenheid(modus)
  const uit = useMemo(() => {
    if (!gekozen) return null
    const open = deals || []
    const lic = eenheid.lic
    const som = rijen => (lic ? rijen.reduce((s, d) => s + (Number(d.mid_lic) || 0), 0) : rijen.length)
    switch (gekozen.soort) {
      case 'week': {
        const w = gekozen.week
        const rijen = (aanvoerDeals || []).filter(d => d.kennismaking && d.kennismaking >= w.week_start && d.kennismaking <= w.week_eind)
          .sort((a, b) => String(a.kennismaking).localeCompare(String(b.kennismaking)))
        const uitView = gekozen.gepland ? w.kennismakingen_gepland : w.kennismakingen
        return {
          chips: [`${eenheid.fmt(lic ? som(rijen) : uitView)} ${gekozen.gepland ? 'gepland' : gekozen.lopend ? 'gehouden · loopt nog' : 'gehouden'}`, ...(gekozen.gepland || lic ? [] : ['doel 8', { t: `${uitView - 8 >= 0 ? '+' : '−'}${Math.abs(uitView - 8)} ${uitView - 8 >= 0 ? 'op/boven' : 'onder'} doel`, warn: uitView < 8 }])],
          kolommen: [
            KOL.kantoor(d => <> · {kanaalLabel(d.kanaal)}{!d.is_open ? ` · ${d.fase === 'gewonnen' ? 'gewonnen' : 'afgevallen'}` : ''}</>),
            KOL.grootte, datum('kennismaking', 'kennismaking', '78px'), pipelineKol(pipeline), KOL.fase, KOL.lic, KOL.link,
          ],
          // Geen brede extra's: de drie vaste kolommen van Jelle nemen die ruimte al (eigenaar staat in de rij-tooltip).
          extra: [],
          rijen, uitView: gekozen.gepland || gekozen.lopend ? rijen.length : uitView, sort: 'kennismaking ↑',
          voet: `bron HubSpot-mirror · kennismaking_datum · kantoorgrootte = totale_omvang (advocaten) · pipeline = ${pipeline?.label || '?'}${gekozen.gepland ? ' · nog niet gehouden' : ''}`,
          leeg: gekozen.gepland ? 'Geen kennismakingen gepland in deze week.' : 'Geen kennismakingen in deze week. Dat is een gemeten nul, geen ontbrekende meting.',
        }
      }
      case 'fase': {
        const r = gekozen.rij
        const rijen = open.filter(d => String(d.fase) === gekozen.sleutel).sort((a, b) => (b.dagen_in_fase ?? -1) - (a.dagen_in_fase ?? -1))
        return {
          chips: [{ t: FASE_UITLEG[r.fase], uitleg: true }, `${getal(r.aantal)} deals`, r.mediaan_dagen != null ? `mediaan ${r.mediaan_dagen} d` : 'geen fasedatum', ...(r.te_lang > 0 ? [{ t: `${getal(r.te_lang)} te lang`, warn: true }] : []), ...(lic && bereikKort(r.bodem_licenties, r.plafond_licenties) ? [`${bereikKort(r.bodem_licenties, r.plafond_licenties)} lic`] : [])],
          kolommen: lic ? [KOL.kantoor(teLang(r.te_lang_drempel)), KOL.lic, KOL.eur, dagen('dagen_in_fase', r.te_lang_drempel), KOL.link] : [KOL.kantoor(teLang(r.te_lang_drempel)), dagen('dagen_in_fase', r.te_lang_drempel), KOL.lic, KOL.close, KOL.link],
          extra: lic ? ['eigenaar', 'bron'] : ['eigenaar', 'eur', 'bron'],
          rijen, uitView: r.aantal, sort: 'dagen in fase ↓', voet: `te lang = > ${r.te_lang_drempel ?? '—'} d (1,5× mediaan) · ? = geen fasedatum of geen beslisdatum`,
        }
      }
      case 'maand': {
        const b = gekozen.bucket
        const rijen = open.filter(d => (b.soort === 'geen' ? !d.beslisdatum
          : b.soort === 'later' ? d.beslisdatum && !(gekozen.maanden || []).includes(String(d.beslisdatum).slice(0, 7))
            : d.beslisdatum && String(d.beslisdatum).slice(0, 7) === b.bucket))
          .sort((a, b2) => (a.fase === '3' ? 0 : 1) - (b2.fase === '3' ? 0 : 1) || String(a.beslisdatum || '').localeCompare(String(b2.beslisdatum || '')))
        const n3 = b.f3?.aantal ?? 0, n12 = b.f12?.aantal ?? 0
        return {
          chips: [`fase 3 ${eenheid.fmt(lic ? b.f3?.mid_licenties : n3)}`, `fase 1–2 ${eenheid.fmt(lic ? b.f12?.mid_licenties : n12)}`, ...(b.soort === 'geen' ? [{ t: 'geen beslisdatum', warn: true }] : [])],
          kolommen: [KOL.kantoor(), KOL.fase, KOL.lic, KOL.close, KOL.link],
          extra: ['eigenaar', 'eur', 'bron'],
          rijen, uitView: n3 + n12, sort: 'fase · beslisdatum ↑', voet: 'beslisdatum = verwachte start van de proef · fase 1–2 indicatief',
        }
      }
      case 'waarde': {
        const r = gekozen.rij
        const rijen = open.filter(d => String(d.fase) === gekozen.sleutel).sort((a, b) => (b.mrr_plafond ?? -1) - (a.mrr_plafond ?? -1))
        return {
          chips: [{ t: FASE_UITLEG[r.fase], uitleg: true }, `${bereikKort(r.bodem_licenties, r.plafond_licenties) || '—'} lic`, `${euroK(r.mrr_bodem) || '—'}–${euroK(r.mrr_plafond) || '—'}`, `${getal(r.aantal_gewaardeerd)} van ${getal(r.aantal)} gewaardeerd`],
          kolommen: [KOL.kantoor(), KOL.lic, KOL.eur, KOL.close, KOL.link],
          extra: ['eigenaar', 'bron'],
          rijen, uitView: r.aantal, sort: 'plafond ↓', voet: 'bodem = minimumafname, plafond = contractomvang · × prijs per gebruiker',
        }
      }
      case 'beweging': {
        const w = gekozen.week, t = gekozen.type
        const inWeek = v => v && v.slice(0, 10) >= w.week_start && v.slice(0, 10) <= w.week_eind
        const rijen = (bewegingDeals || []).filter(d => (t === 'nieuw' ? inWeek(d.hs_created_at) : d.fase === t && inWeek(d.closedate)))
        const n = t === 'nieuw' ? w.instroom : t === 'gewonnen' ? w.gewonnen : w.verloren
        return {
          chips: [`${eenheid.fmt(lic ? (t === 'nieuw' ? w.instroom_licenties : t === 'gewonnen' ? w.gewonnen_licenties : w.verloren_licenties) : n)} ${t}`, `netto ${w.netto >= 0 ? '+' : '−'}${Math.abs(w.netto)}`],
          kolommen: [KOL.kantoor(d => <> · {kanaalLabel(d.kanaal)}</>), datum(t === 'nieuw' ? 'hs_created_at' : 'closedate', t === 'nieuw' ? 'nieuw' : 'gesloten'), KOL.fase, KOL.lic, KOL.link],
          extra: ['eigenaar', 'eur'],
          rijen, uitView: n, sort: 'datum', voet: t === 'nieuw' ? 'nieuw = deal aangemaakt in HubSpot (hs_created_at)' : `${t} = closedate in deze week`,
        }
      }
      case 'kanaal': {
        const s = gekozen.slice, r = s.rij
        const rijen = open.filter(d => (d.kanaal || 'UNKNOWN') === gekozen.sleutel).sort((a, b) => String(a.fase).localeCompare(String(b.fase)) || String(a.beslisdatum || '9').localeCompare(String(b.beslisdatum || '9')))
        return {
          chips: [`${eenheid.fmt(s.waarde)} ${eenheid.naam}`, ...(s.onbekend ? [{ t: 'leadsource ontbreekt', warn: true }] : [])],
          kolommen: [KOL.kantoor(), KOL.fase, KOL.lic, KOL.close, KOL.link],
          extra: ['eigenaar', 'eur'],
          rijen, uitView: r.aantal, sort: 'fase · close ↑', voet: s.onbekend ? 'hygiëne: vul de leadsource (hs_analytics_source) in HubSpot in — link per rij' : 'leadsource = eerste bron van de deal · hs_analytics_source',
        }
      }
      case 'band': {
        const b = gekozen.band
        const rijen = open.filter(d => (d.kantoorband || 'onbekend') === gekozen.sleutel).sort((a, b2) => String(a.beslisdatum || '9').localeCompare(String(b2.beslisdatum || '9')))
        return {
          chips: [`${eenheid.fmt(lic ? b.mid_licenties : b.aantal)} ${eenheid.naam}`, { t: `F1 ${b.f1} · F2 ${b.f2} · F3 ${b.f3}`, titel: FASE_TITEL }, ...(b.close_30d > 0 ? [`${b.close_30d} close ≤ 30 d`] : [])],
          kolommen: [KOL.kantoor(d => (d.beslisdatum && d.beslisdatum <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) ? <> <span className="dl-chip dl-chip--ok">≤ 30 d</span></> : null)), KOL.fase, KOL.lic, KOL.close, KOL.link],
          extra: ['eigenaar', 'eur', 'bron'],
          rijen, uitView: b.aantal, sort: 'close ↑', voet: b.onbekend ? 'hygiëne: kantoorgrootte (totale_omvang) ontbreekt op de company' : 'band = totale_omvang op de eerste company · kern = 5–16',
        }
      }
      default: return null
    }
  }, [gekozen, deals, aanvoerDeals, bewegingDeals, eenheid])

  if (!gekozen || !uit) return null
  const { chips, kolommen, extra, rijen, uitView, sort, voet, leeg } = uit
  return (
    <DetailPaneel
      titel={
        <span className="dl-detail__kop">
          {onTerug && (
            <button type="button" className="dl-terug dl-detail__terug" onClick={onTerug} title="Terug naar het overzicht">◂ Overzicht</button>
          )}
          <span className="dl-detail__lab">Detail</span>
          <span className="dl-detail__sel">{gekozen.label}</span>
        </span>
      }
      sub={<span className="dl-chips">{chips.filter(c => typeof c === 'string' || c.t).map((c, i) => (typeof c === 'string' ? <span key={i}>{c}</span> : <span key={i} className={c.warn ? 'is-warn' : c.uitleg ? 'is-uitleg' : ''} title={c.titel || undefined}>{c.t}</span>))}</span>}
      voet={<><span>{uitView != null ? `${getal(rijen.length)} van ${getal(uitView)}` : `${getal(rijen.length)} deals`} · {sort}</span><span className="dl-detail__bron">{voet}</span></>}
    >
      <WorkTable
        kolommen={focus && extra ? breed(kolommen, extra) : kolommen}
        rijen={rijen}
        sleutel={d => d.deal_id}
        leegTekst={leeg || 'Geen deals achter deze snede — een gemeten nul.'}
        rijTitel={d => [d.stage_label, d.eigenaar ? `eigenaar ${d.eigenaar}` : null, d.beslisdatum ? `beslisdatum ${datumKort(d.beslisdatum)}` : 'geen beslisdatum', d.dagen_in_fase != null ? `${d.dagen_in_fase} dagen in fase` : null].filter(Boolean).join(' · ')}
      />
    </DetailPaneel>
  )
}
