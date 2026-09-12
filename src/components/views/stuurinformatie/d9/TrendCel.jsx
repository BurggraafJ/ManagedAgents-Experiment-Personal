/**
 * TrendCel — acht weken per check, uit snap_hygiene_dag.
 *
 * Zolang er geen snapshots zijn, staat er een streepje met "beschikbaar vanaf
 * <datum>". Er wordt bewust géén vlakke lijn getekend: dat zou suggereren dat
 * er niets beweegt, en dat is een ander bericht dan "we meten nog niet".
 * Het doel van de trend is het onderscheid structureel/incidenteel — een check
 * die na opruimen weer volloopt vraagt een verplicht veld, geen langere lijst.
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
      <span className="d9-trend d9-trend--leeg" title={`De hygiënetrend start bij de eerste dagsnapshot (cron dash-snap-hygiene-dag, 07:45 NL).`}>
        — <span className="d9-trend__wacht">vanaf {eersteSnapshotLabel(trendVanaf)}</span>
      </span>
    )
  }

  const max = Math.max(...reeks, 1)
  const laatste = trend.laatste
  const week = trend.week_terug
  const delta = (laatste !== null && week !== null && week !== undefined) ? laatste - week : null

  return (
    <span className="d9-trend" title={`${reeks.length} dagsnapshots · hoogste ${max}`}>
      <span className="d9-trend__bars">
        {reeks.slice(-40).map((v, i) => (
          <span
            key={i}
            className="d9-trend__bar"
            style={{ height: `${Math.max(2, Math.round((v / max) * 18))}px` }}
          />
        ))}
      </span>
      {delta !== null && delta !== 0 && (
        <span className={`d9-trend__delta ${delta < 0 ? 'is-beter' : 'is-slechter'}`}>
          {delta < 0 ? '▼' : '▲'} {Math.abs(delta)} t.o.v. vorige week
        </span>
      )}
      {delta === 0 && <span className="d9-trend__delta">gelijk aan vorige week</span>}
    </span>
  )
}
