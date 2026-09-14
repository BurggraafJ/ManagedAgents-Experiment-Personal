import { useEffect, useState } from 'react'
import { useTruthOfSources } from '../../../hooks/useTruthOfSources'
import {
  fmtNum, relTime, pct, sourceSummaries, embeddingCoverage, SOURCE_KICKER,
} from '../../../lib/truthOfSources'
import { SOURCE_ICONS } from '../truth-of-sources/SourceIcons'
import SourceDetailModal from '../truth-of-sources/SourceDetailModal'

/**
 * PlatformDatabase — het Database-tabblad van Platform (v1.183).
 *
 * Tot v1.182 zat de sync-status als "Sync"-paneel in het segment Alles: de
 * oude TruthOfSources-kaartjes (NowView-huid) in een cockpit die met .set-*
 * tekent. Jelle 2026-09-14: "Config/Edge, en Database als aparte selector met
 * beter design". Dit is die selector: één tabel met de zes spiegels (status ·
 * records · laatste sync · via welke functie), daaronder de embedding-dekking
 * per tabel. Klik op een rij opent het bestaande detail-venster — dat is niet
 * herbouwd, alleen de lijst ervoor.
 *
 * Data: useTruthOfSources (zelfde 28 leesqueries, 30 s refresh). De hook
 * draait alleen zolang dit tabblad open staat; `onSummary` meldt live/totaal
 * aan de KPI-strook bovenaan Platform.
 */
export default function PlatformDatabase({ onSummary }) {
  const { loading, error, data: tos, refresh } = useTruthOfSources()
  const [open, setOpen] = useState(null)
  const rows = sourceSummaries(tos)
  const coverage = embeddingCoverage(tos)

  useEffect(() => {
    if (!onSummary) return
    if (!tos) { onSummary(null); return }
    onSummary({
      live: rows.filter(r => r.health.tag === 's-success').length,
      total: rows.length,
      broken: rows.filter(r => r.health.tag === 's-error').map(r => r.title),
      fetchedAt: tos.fetchedAt,
    })
  }, [tos]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return <div className="pf-panel"><div className="pf-panel__err">⚠ {error}</div></div>
  }

  return (
    <>
      <div className="pf-panel pf-db">
        <div className="pf-panel__head">
          <strong>Database — bronnen</strong>
          <span>
            {tos ? `6 spiegels · ververst per 30 s · laatst ${tos.fetchedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}` : 'laden…'}
            {' · '}
            <button type="button" className="pf-db__refresh" onClick={refresh}>vernieuw</button>
          </span>
        </div>

        {loading && !tos ? (
          <div className="pf-db__skeleton" aria-hidden />
        ) : (
          <table className="pf-db__table">
            <colgroup>
              <col /><col className="pf-db__col-num" /><col className="pf-db__col-sync" /><col className="pf-db__col-via" /><col className="pf-db__col-status" />
            </colgroup>
            <thead>
              <tr>
                <th>Bron</th>
                <th className="is-right">Records</th>
                <th>Laatste sync</th>
                <th>Via</th>
                <th aria-label="Status" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.source} className="pf-db__row" onClick={() => setOpen(r.source)}
                  tabIndex={0} role="button" aria-label={`Open details voor ${r.title}`}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(r.source) } }}>
                  <td>
                    <div className="pf-db__source">
                      <span className={`pf-db__icon pf-db__icon--${r.source}`}>{SOURCE_ICONS[r.source]}</span>
                      <div className="pf-db__name">
                        <span className="pf-db__title">{r.title}</span>
                        <span className="pf-db__kicker">{SOURCE_KICKER[r.source]}</span>
                        {r.error && (
                          <span className="pf-db__error">{r.error.length > 90 ? r.error.slice(0, 90) + '…' : r.error}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="is-right">
                    <span className="pf-db__num">{fmtNum(r.total)}</span>
                    <span className="pf-db__unit">{r.totalLabel}</span>
                  </td>
                  <td><span className="pf-db__mono">{relTime(r.lastSync)}</span></td>
                  <td>
                    <span className="pf-db__mono">{r.run?.agent_name || r.agent}</span>
                    {r.run?.status && (
                      <span className={`pf-db__runstatus pf-db__runstatus--${r.run.status}`}> · {r.run.status}</span>
                    )}
                  </td>
                  <td className="is-right">
                    <span className={`set-pill set-pill--${pillTone(r.health.tag)}`}>
                      <span className="set-pill__dot" />{r.health.label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="pf-panel__foot">Klik op een bron voor de volledige uitsplitsing, gekoppelde functies en het logboek.</div>
      </div>

      {tos && (
        <div className="pf-panel">
          <div className="pf-panel__head">
            <strong>Embeddings — dekking</strong>
            <span>text-embedding-3-large · 3072d halfvec · via chunker</span>
          </div>
          <div className="pf-cov">
            {coverage.map(c => {
              const p = pct(c.embedded, c.total)
              const tone = p === null ? 'idle' : p >= 99 ? 'ok' : p >= 80 ? 'warn' : 'err'
              return (
                <div key={c.key} className="pf-cov__row">
                  <span className="pf-cov__label">{c.label}</span>
                  <span className="pf-cov__track" aria-hidden>
                    <span className={`pf-cov__fill pf-cov__fill--${tone}`} style={{ width: `${p ?? 0}%` }} />
                  </span>
                  <span className="pf-cov__nums">
                    <span className="pf-db__mono">{fmtNum(c.embedded)} / {fmtNum(c.total)}</span>
                    <span className={`pf-cov__pct pf-cov__pct--${tone}`}>{p === null ? '–' : `${p}%`}</span>
                  </span>
                </div>
              )
            })}
          </div>
          <div className="pf-panel__foot pf-panel__foot--muted">
            Dekking = records met een vector gedeeld door alle records in die tabel. Chunker-tokens (7 d): {fmtNum(tos.embed.tokens7d)} in {fmtNum(tos.embed.runs7d)} runs.
          </div>
        </div>
      )}

      {open && tos && <SourceDetailModal source={open} data={tos} onClose={() => setOpen(null)} />}
    </>
  )
}

function pillTone(tag) {
  return tag === 's-success' ? 'ok' : tag === 's-error' ? 'err' : tag === 's-warning' ? 'warn' : 'info'
}
