import Kaart from './Kaart'
import Bandstapel from '../../../../ui/charts/visx/Bandstapel'
import { useTip } from '../../../../ui/charts/visx/Tip'
import { getal } from '../../format'
import { BAND_LABEL, faseZin } from './labels'

/**
 * Kantoorgrootte — de open pipeline naar advocaten-band van het kantoor, met
 * de fase-mix per band (F3 oranje · F2 deep · F1 grijs). De kernband 5–16
 * (ICP2, nl-first) staat vet. "onbekend" = geen company of geen totale_omvang:
 * de gatregel onder de stippellijn. Badge: deals met beslisdatum binnen 30
 * dagen. Bron: `v_d1_kantoorgrootte`.
 */
export default function KaartKantoorgrootte({ grootte, meta, eenheid, gekozen, onKies }) {
  const { tip, toon, verberg } = useTip()
  const lic = eenheid.lic
  const w = (r, f) => eenheid.kies(r, f, `${f}_licenties`)
  const rijen = (grootte || []).map(r => {
    const f1 = w(r, 'f1'), f2 = w(r, 'f2'), f3 = w(r, 'f3')
    return {
      key: r.kantoorband, label: BAND_LABEL[r.kantoorband] || r.band_label, kern: r.kern, onbekend: r.onbekend,
      totaal: eenheid.kies(r, 'aantal', 'mid_licenties'),
      segmenten: [{ fase: '3', waarde: f3 }, { fase: '2', waarde: f2 }, { fase: '1', waarde: f1 }],
      mix: [f1 ? `F1 ${eenheid.fmt(f1)}` : null, f2 ? `F2 ${eenheid.fmt(f2)}` : null, f3 ? `F3 ${eenheid.fmt(f3)}` : null].filter(Boolean).join(' · ') || 'leeg',
      rij: r,
    }
  })
  const max = Math.max(1, ...rijen.map(r => r.totaal))
  const tot = rijen.reduce((s, r) => s + r.totaal, 0)
  const close30 = (grootte || []).reduce((s, r) => s + (lic ? Number(r.close_30d_licenties) || 0 : r.close_30d || 0), 0)

  const hover = (e, r, fase) => toon(e, {
    kop: fase ? faseZin(fase) : `${r.label} advocaten`,
    regels: fase
      ? [`${eenheid.fmt(r.segmenten.find(s => s.fase === fase)?.waarde || 0)} ${eenheid.naam} in ${r.label}`]
      : [`${eenheid.fmt(r.totaal)} ${eenheid.naam} · ${r.mix}`, `${lic ? eenheid.fmt(Number(r.rij.close_30d_licenties) || 0) + ' lic' : getal(r.rij.close_30d) + ' deals'} met beslisdatum ≤ 30 d`],
    zin: r.onbekend ? 'geen kantoorgrootte op de company · hygiëne' : 'open pipeline naar advocaten-band; kern = 5–16',
  })

  return (
    <Kaart
      className="dl-kaart--grootte"
      label="Kantoorgrootte"
      meta="advocaten"
      sub={`${eenheid.fmt(lic ? tot : (meta?.open_deals ?? tot))} ${lic ? 'lic (mid)' : 'open'} · fase-mix per band`}
      legenda={[{ swatch: 'o', tekst: 'F3', titel: faseZin(3) }, { swatch: 'od', tekst: 'F2', titel: faseZin(2) }, { swatch: 'g', tekst: 'F1', titel: faseZin(1) }]}
      voetExtra={<><span>kern = ICP2</span><span className="dl-badge">{eenheid.fmt(close30)} {lic ? 'lic' : 'close'} ≤ 30 d</span></>}
      tip={tip}
    >
      <Bandstapel
        rijen={rijen}
        max={max}
        fmt={eenheid.fmt}
        gekozen={gekozen?.soort === 'band' ? gekozen.sleutel : null}
        onKies={r => onKies({ soort: 'band', sleutel: r.key, label: `Kantoorgrootte · ${r.label}`, band: r.rij })}
        onHover={hover}
        onLeave={verberg}
      />
    </Kaart>
  )
}
