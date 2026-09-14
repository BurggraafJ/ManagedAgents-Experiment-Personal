import { useState } from 'react'
import { Link } from 'react-router-dom'
import { SettingsPage } from '../settings/SettingsLayout'
import { CONFIG_ITEMS } from './platformConfig'
import { useEdgeFunctionHealth, EDGE_FUNCTIONS } from '../../../hooks/useEdgeFunctionHealth'
import PlatformDatabase from './PlatformDatabase'
import './platform.css'

/**
 * PlatformPage — spoor 20, optie B "cockpit". Vervangt de drie losse pagina's
 * Configuratie · Edge Functions · Database door één scherm:
 *
 *   drie KPI's  →  selector (Config / Edge / Database)  →  één paneel.
 *
 * v1.183 (Jelle 2026-09-14): het segment "Alles | Config | Edge | Sync" is
 * "Config | Edge | Database" geworden. Geen Alles meer (twee kolommen met
 * een derde paneel eronder was geen cockpit maar een stapel), en de oude
 * TruthOfSources-kaartjes zijn niet langer als Sync-paneel ingeplakt: Database
 * is een eigen tabblad met een eigen tabel (PlatformDatabase). De KPI's
 * bovenaan zijn nu ook de knoppen naar dat tabblad.
 *
 * De inhoud is niet nieuw: de config-rijen komen 1:1 uit ConfiguratiePage, de
 * edge-status uit dezelfde agent_runs-query als EdgeFunctionsPage (nu in
 * hooks/useEdgeFunctionHealth.js), en Database leest dezelfde 28 tabellen als
 * de oude Database-pagina.
 */

const SEGMENTS = [
  { id: 'config',   label: 'Config' },
  { id: 'edge',     label: 'Edge' },
  { id: 'database', label: 'Database' },
]

function ConfigPanel() {
  return (
    <div className="pf-panel">
      <div className="pf-panel__head">
        <strong>Configuratie</strong>
        <span>alleen lezen</span>
      </div>
      {CONFIG_ITEMS.map(item => (
        <div key={item.label} className="pf-row">
          <div className="pf-row__main">
            <div className="pf-row__label">{item.label}</div>
            <div className="pf-row__hint">{item.hint}</div>
          </div>
          <span className={item.mono ? 'pf-row__value pf-row__value--mono' : 'pf-row__value'}>
            {item.value}
          </span>
          {item.link && (
            <a href={item.link} target="_blank" rel="noopener noreferrer" className="set-btn set-btn--ghost set-btn--sm">
              Open ↗
            </a>
          )}
        </div>
      ))}
      {/* Deployments staat niet meer in de nav (lock 20). De pagina bestaat
          nog — promote / redeploy / cancel — en is hier bereikbaar, want dit
          is waar je naar hosting kijkt. */}
      <div className="pf-panel__foot">
        <Link to="/organisatie/deployments" className="pf-link">Vercel-deploys beheren →</Link>
      </div>
    </div>
  )
}

function EdgePanel({ health }) {
  const { latestByAgent, runs7dByAgent, error } = health
  const rows = EDGE_FUNCTIONS
    .filter(fn => fn.agent)
    .map(fn => {
      const latest = latestByAgent[fn.agent]
      const runs = runs7dByAgent[fn.agent] || []
      return {
        ...fn,
        latest,
        tone: !latest ? 'idle' : latest.status === 'error' ? 'err'
          : (latest.status === 'success' || latest.status === 'ok') ? 'ok' : 'warn',
        errs7d: runs.filter(r => r.status === 'error').length,
        succ7d: runs.filter(r => r.status === 'success').length,
      }
    })
  // Fouten eerst — dat is de reden dat je dit paneel opent.
  const order = { err: 0, warn: 1, idle: 2, ok: 3 }
  const sorted = [...rows].sort((a, b) => order[a.tone] - order[b.tone])
  const attention = sorted.filter(r => r.tone === 'err' || r.tone === 'warn' || r.tone === 'idle')
  const healthy = sorted.length - attention.length
  // Hooguit zes rijen; de rest telt mee in de voetregel. Anders wordt dit bij
  // een brede storing een scrollbak in plaats van een aandachtslijst.
  const list = attention.length > 0 ? attention : sorted.slice(0, 3)
  const shown = list.slice(0, 6)
  const rest = (attention.length > 0 ? attention.length : 0) - shown.length

  return (
    <div className="pf-panel">
      <div className="pf-panel__head">
        <strong>Edge — aandacht</strong>
        <span>{attention.length} aandacht · {healthy} ok</span>
      </div>
      {error && <div className="pf-panel__err">⚠ {error}</div>}
      {shown.map(fn => (
        <div key={fn.slug} className="pf-row pf-row--fn">
          <span className={`pf-dot pf-dot--${fn.tone}`} aria-hidden />
          <div className="pf-row__main">
            <div className="pf-row__label">{fn.label}</div>
            <div className="pf-row__hint">
              {fn.latest
                ? `${fn.latest.status} · ${relTime(fn.latest.started_at)} geleden · 7d ${fn.succ7d}✓${fn.errs7d ? ` ${fn.errs7d}✗` : ''}`
                : 'nog geen run gezien'}
            </div>
          </div>
          <span className={`set-stat set-stat--${toneClass(fn.tone)}`}>
            <span className="set-stat__dot" />{labelFor(fn.tone)}
          </span>
        </div>
      ))}
      {(rest > 0 || (attention.length > 0 && healthy > 0)) && (
        <div className="pf-panel__foot">
          {rest > 0 && <>+ {rest} andere met aandacht</>}
          {rest > 0 && healthy > 0 && ' · '}
          {healthy > 0 && <>{healthy} functie{healthy === 1 ? '' : 's'} gezond</>}
        </div>
      )}
      {EDGE_FUNCTIONS.some(f => !f.agent) && (
        <div className="pf-panel__foot pf-panel__foot--muted">
          {EDGE_FUNCTIONS.filter(f => !f.agent).map(f => f.label).join(' · ')} draaien on-demand en loggen niet.
        </div>
      )}
    </div>
  )
}

export default function PlatformPage() {
  const [segment, setSegment] = useState('config')
  const health = useEdgeFunctionHealth()
  // Gevoed door PlatformDatabase zolang dat tabblad open staat; daarbuiten
  // blijft de laatst geziene stand staan, of "open het tabblad".
  const [dbSummary, setDbSummary] = useState(null)

  const tracked = EDGE_FUNCTIONS.filter(f => f.agent)
  const seen = tracked.filter(f => health.latestByAgent[f.agent])
  const broken = seen.filter(f => health.latestByAgent[f.agent].status === 'error')
  const okCount = seen.length - broken.length
  const edgeKpi = health.fetchedAt ? `${okCount}/${tracked.length}` : '—'
  // Groen alleen als álle gevolgde functies gezond zijn. Nul fouten op nul
  // gemeten runs is geen goed nieuws — dat is stilte, en die krijgt geen kleur.
  const edgeTone = !health.fetchedAt ? '' : broken.length > 0 ? 'err' : okCount === tracked.length ? 'ok' : 'warn'

  const dbTone = !dbSummary ? '' : dbSummary.broken.length > 0 ? 'err' : dbSummary.live === dbSummary.total ? 'ok' : 'warn'

  return (
    <SettingsPage
      title="Platform"
      intro="Eén cockpit: eerst de gezondheid, daaronder per tabblad de configuratie, de edge-status en de database-spiegels."
      right={
        <button type="button" className="set-btn set-btn--ghost set-btn--sm" onClick={health.refresh}>
          Vernieuwen
        </button>
      }
    >
      <div className="pf-app">
        <div className="pf-kpis">
          <button type="button" className={`pf-kpi ${segment === 'config' ? 'is-active' : ''}`} onClick={() => setSegment('config')}>
            <div className="pf-kpi__label">Configuratie</div>
            <div className="pf-kpi__value pf-kpi__value--ok">OK</div>
            <div className="pf-kpi__sub">EU-West-1 · Vercel main</div>
          </button>
          <button type="button" className={`pf-kpi ${segment === 'edge' ? 'is-active' : ''}`} onClick={() => setSegment('edge')}>
            <div className="pf-kpi__label">Edge functions</div>
            <div className={`pf-kpi__value ${edgeTone ? `pf-kpi__value--${edgeTone}` : ''}`}>{edgeKpi}</div>
            <div className="pf-kpi__sub">
              {!health.fetchedAt ? 'laden…'
                : broken.length > 0 ? `${broken.map(f => f.slug).slice(0, 2).join(', ')} in fout`
                : okCount === tracked.length ? 'geen fouten in de laatste run'
                : `${tracked.length - seen.length} zonder run in 7 dagen`}
            </div>
          </button>
          <button type="button" className={`pf-kpi ${segment === 'database' ? 'is-active' : ''}`} onClick={() => setSegment('database')}>
            <div className="pf-kpi__label">Database</div>
            <div className={`pf-kpi__value ${dbTone ? `pf-kpi__value--${dbTone}` : ''}`}>
              {dbSummary ? `${dbSummary.live}/${dbSummary.total}` : '6 bronnen'}
            </div>
            <div className="pf-kpi__sub">
              {!dbSummary ? 'spiegels live · open het tabblad'
                : dbSummary.broken.length > 0 ? `${dbSummary.broken.slice(0, 2).join(', ')} in fout`
                : dbSummary.live === dbSummary.total ? 'alle spiegels vers'
                : `${dbSummary.total - dbSummary.live} verlaat of nooit gesynct`}
            </div>
          </button>
        </div>

        <div className="pf-seg" role="tablist" aria-label="Platform-onderdeel">
          {SEGMENTS.map(s => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={segment === s.id}
              className={`pf-seg__btn ${segment === s.id ? 'is-active' : ''}`}
              onClick={() => setSegment(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="pf-col">
          {segment === 'config'   && <ConfigPanel />}
          {segment === 'edge'     && <EdgePanel health={health} />}
          {segment === 'database' && <PlatformDatabase onSummary={setDbSummary} />}
        </div>
      </div>
    </SettingsPage>
  )
}

function relTime(iso) {
  if (!iso) return 'nooit'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'net'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'net'
  if (min < 60) return `${min} min`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}u`
  return `${Math.floor(hr / 24)}d`
}

function toneClass(tone) {
  return tone === 'err' ? 'err' : tone === 'warn' ? 'warn' : tone === 'idle' ? 'info' : 'ok'
}

function labelFor(tone) {
  return tone === 'err' ? 'fout' : tone === 'warn' ? 'let op' : tone === 'idle' ? 'stil' : 'ok'
}
