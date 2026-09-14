import { useEffect, useState } from 'react'
import Modal from '../../../../ui/Modal'
import { usdFijn, maandLabel } from '../../../../../hooks/useModelUsage'

// De doorkijk achter één bedrag (Jelle, 2026-09-14: "klik op een persoon →
// meer inzage in vragen, niet alleen totalen").
//
// Bron: `v_user_model_usage_detail` — dezelfde rijen die het maandtotaal
// optellen, één per vraag. Owner ziet iedereen, een member zichzelf; de poort
// zit in het WHERE-predicaat van de view (migratie 20260914160000).
//
// v1.192 was dit een paneel ónder de tabel, met als redenering dat je wilt
// vergelijken met de rij erboven. Jelle keek ernaar en wilde een popup
// ("gebruik van iemand = modal", 2026-09-14 18:18). Hij heeft gelijk om een
// reden die ik niet had meegewogen: de vragenlijst is breed en lang, dus in de
// praktijk duwt het paneel de tabel juist van het scherm af en scrol je naar
// een rij die je niet meer ziet. Een modal geeft de lijst de volle breedte en
// laat de tabel staan waar hij stond.
//
// Drie dingen die dit scherm niet doet:
//  • niet de hele maand in één keer ophalen — pas laden bij een klik
//  • geen bedrag afronden op centen: $0,0054 is een gewone rij, en met twee
//    decimalen wordt de kolom een rij nullen (zie usdFijn)
//  • geen lege lijst presenteren als "geen verbruik". Leeg betekent hier
//    "geen vraag van deze persoon gemeten in deze maand", en dat staat er.

const MAX = 200

export default function UsageDetail({ person, maand, loadDetail, onClose }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let levend = true
    setRows(null)
    setError(null)
    loadDetail(person.user_id, maand)
      .then(d => { if (levend) setRows(d) })
      .catch(e => { if (levend) setError(e.message || String(e)) })
    return () => { levend = false }
  }, [person.user_id, maand, loadDetail])

  const totaal = (rows || []).reduce((n, r) => n + Number(r.est_cost_usd || 0), 0)

  // `theme-maestro` hoort op de dialoog zelf: een Modal portaleert naar
  // document.body en valt daarmee buiten de themawrapper, terwijl de tokens van
  // deze tabel (--ink, --paper, --border) daar wonen en niet op :root.
  return (
    <Modal open onClose={onClose} size="xl" title={`${person.name} · ${maandLabel(maand)}`} className="usg-detail theme-maestro">
      <p className="usg-detail__meta">
        {rows
          ? <><b>{rows.length}</b> {rows.length === 1 ? 'vraag' : 'vragen'} · <b>{usdFijn(totaal)}</b>
            {rows.length === MAX && <> · alleen de {MAX} nieuwste</>}</>
          : 'Vragen ophalen…'}
      </p>

      {error && (
        <div className="users-form__notice users-form__notice--error">
          <strong>Fout bij ophalen:</strong> {error}
        </div>
      )}

      {!error && rows && rows.length === 0 && (
        <p className="usg-detail__leeg">
          Geen enkele vraag van {person.name} is in {maandLabel(maand)} aan hem of haar
          gekoppeld. Dat is <em>niet gemeten</em>, niet nul — de regel{' '}
          <b>Niet toe te wijzen</b> onder de tabel telt precies dit soort vragen.
        </p>
      )}

      {!error && rows && rows.length > 0 && (
        <div className="usg-detail__wrap">
          <table className="users-table usg-vragen">
            <thead>
              <tr>
                <th>Wanneer</th>
                <th>Vraag</th>
                <th>Route</th>
                <th className="is-right">Kosten</th>
                <th className="is-right">Duur</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className={r.fout ? 'is-fout' : ''}>
                  <td className="usg-wanneer" title={new Date(r.asked_at).toLocaleString('nl-NL')}>
                    {new Date(r.asked_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                    {' '}
                    <span className="usg-tijd">
                      {new Date(r.asked_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </td>
                  <td className="usg-vraag" title={r.question || ''}>
                    {r.question || <span className="usg-none">(geen vraagtekst vastgelegd)</span>}
                    {r.fout && <span className="usg-sub usg-sub--warn">fout</span>}
                  </td>
                  <td>
                    <span className="usg-route">{r.route || '—'}</span>
                    {r.answer_model && <span className="usg-model">{r.answer_model}</span>}
                  </td>
                  <td className="is-right">
                    {r.est_cost_usd === null
                      ? <span className="usg-none" title="Deze vraag heeft geen kostenschatting.">—</span>
                      : usdFijn(r.est_cost_usd)}
                  </td>
                  <td className="is-right usg-duur">
                    {r.latency_ms ? `${(r.latency_ms / 1000).toFixed(1)} s` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
