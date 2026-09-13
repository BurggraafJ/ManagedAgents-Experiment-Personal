/**
 * TrendCel — acht weken per check, uit snap_hygiene_dag.
 *
 * Zolang er geen snapshots zijn staat er "reeks start" met de datum in de
 * tooltip. Er wordt bewust géén vlakke lijn getekend: dat zou suggereren dat
 * er niets beweegt, en dat is een ander bericht dan "we meten nog niet".
 * Het doel van de trend is het onderscheid structureel/incidenteel — een check
 * die na opruimen weer volloopt vraagt een verplicht veld, geen langere lijst.
 *
 * De cel is 84 px breed in de meesterlijst, dus alles wat langer is dan twee
 * woorden staat in de `title` en niet in de rij (Research 2 §2.3: uitleg hoort
 * in de tooltip, nooit in een vierde regel op het bord).
 */
function eersteSnapshotLabel(trendVanaf) {
  if (!trendVanaf) return 'de eerste snapshot'
  const d = new Date(trendVanaf)
  if (Number.isNaN(d.getTime())) return 'de eerste snapshot'
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

export default function TrendCel({ trend, meetbaar, trendVanaf }) {
  if (!meetbaar) return <span className="d9-trend d9-trend--leeg">n.v.t.</span>

  const reeks = (trend?.reeks || []).filter(v => v !== null && v !== undefined)
  if (reeks.length < 2) {
    return (
      <span
        className="d9-trend d9-trend--leeg"
        title={`Nog geen reeks: de hygiënetrend start bij de eerste dagsnapshot (cron dash-snap-hygiene-dag, 07:45 NL) — vanaf ${eersteSnapshotLabel(trendVanaf)}.`}
      >
        reeks start
      </span>
    )
  }

  const max = Math.max(...reeks, 1)
  const laatste = trend.laatste
  const week = trend.week_terug
  const delta = (laatste !== null && week !== null && week !== undefined) ? laatste - week : null

  return (
    <span
      className="d9-trend"
      title={`${reeks.length} dagsnapshots · hoogste ${max}${
        delta === null ? '' : delta === 0 ? ' · gelijk aan vorige week' : ` · ${Math.abs(delta)} ${delta < 0 ? 'minder' : 'meer'} dan vorige week`
      }`}
    >
      <span className="d9-trend__bars">
        {reeks.slice(-24).map((v, i) => (
          <span
            key={i}
            className="d9-trend__bar"
            style={{ height: `${Math.max(2, Math.round((v / max) * 14))}px` }}
          />
        ))}
      </span>
      {delta !== null && delta !== 0 && (
        <span className={`d9-trend__delta ${delta < 0 ? 'is-beter' : 'is-slechter'}`}>
          {delta < 0 ? '▼' : '▲'} {Math.abs(delta)}
        </span>
      )}
      {delta === 0 && <span className="d9-trend__delta">gelijk</span>}
    </span>
  )
}
