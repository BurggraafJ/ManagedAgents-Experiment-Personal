import { useNavigate } from 'react-router-dom'
import { useHomeTiles } from '../../../hooks/useHomeTiles'
import { UI_ICONS, getIcon } from '../../shell/SidebarIcons'
import './home.css'

// HomeView — Dashboard-tegels, landingspagina van de desktop-shell (v1.158).
//
// Zes klikbare dashboard-tegels in B-stijl (getal · delta · label · spark) plus
// een activiteitenstrook onderin. Drie tegels hangen aan echte data
// (agent-runs, kennisbank); de andere drie zijn placeholders tot we per
// dashboard afspreken wát erin komt — die dragen daarom een Soon/Const-pill,
// exact dezelfde twee statussen als in de sidebar. Een Prod-status bestaat niet.
//
// De vragenbak (RAG-zoeken) is níét verdwenen: die heeft sinds v1.158 een eigen
// route (/zoeken) en is bereikbaar via het zoekveld in de sidebar, het
// zoek-icoon in de topbalk en ⌘K. Mobiel blijft / de vragenbak.
export default function HomeView({ profile }) {
  const navigate = useNavigate()
  const { runs7d, today, kbArticles } = useHomeTiles()

  const firstName = (profile?.display_name || '').trim().split(/\s+/)[0] || null
  const tiles = buildTiles({ runs7d, kbArticles })

  return (
    <div className="theme-maestro dsk-home">
      <div className="dsk-home__inner">
        <header className="dsk-home__head">
          <h2 className="dsk-home__h1">{greeting()}{firstName ? `, ${firstName}` : ''}</h2>
          <p className="dsk-home__sub">
            Zes dashboards staan klaar. Klik er een aan om te openen — de inhoud vullen we samen in.
          </p>
        </header>

        <div className="dsk-home__grid">
          {tiles.map(t => (
            <button
              key={t.id}
              type="button"
              className="dsk-tile"
              onClick={() => t.to && navigate(t.to)}
              disabled={!t.to}
              title={t.to ? `Open ${t.name}` : `${t.name} — nog geen dashboard`}
            >
              <span className="dsk-tile__top">
                <span className="dsk-tile__ico" aria-hidden>{t.icon}</span>
                <span className="dsk-tile__name">{t.name}</span>
                {t.status && (
                  <span className={`dsk-tile__pill dsk-tile__pill--${t.status}`}>
                    {t.status === 'soon' ? 'Soon' : 'Const'}
                  </span>
                )}
              </span>

              <span className="dsk-tile__kpi">
                <span className={`dsk-tile__num ${t.value === null ? 'is-empty' : ''}`}>
                  {t.value === null ? 'Geen data' : t.value}
                </span>
                {t.delta && (
                  <span className={`dsk-tile__delta ${t.deltaDown ? 'is-down' : ''}`}>{t.delta}</span>
                )}
              </span>

              <span className="dsk-tile__label">
                {t.label}
                {t.to && <span className="dsk-tile__arrow" aria-hidden>{UI_ICONS.arrow}</span>}
              </span>

              <span className="dsk-tile__spark" aria-hidden>
                {normalizeSpark(t.spark).map((h, i, arr) => (
                  <span
                    key={i}
                    className={`dsk-tile__bar ${i >= arr.length - 2 ? 'is-on' : ''}`}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </span>
            </button>
          ))}
        </div>

        <section className="dsk-strip">
          <header className="dsk-strip__head">
            <span className="dsk-strip__ico" aria-hidden>{getIcon('health')}</span>
            <h3 className="dsk-strip__title">Agent-activiteit vandaag</h3>
            <span className="dsk-strip__note">
              {today.agents > 0
                ? `${today.agents} ${today.agents === 1 ? 'agent draaide' : 'agents draaiden'}${today.lastAt ? ` · laatste run ${timeOf(today.lastAt)}` : ''}`
                : 'nog geen runs vandaag'}
            </span>
          </header>
          <div className="dsk-strip__body">
            {today.runs.slice(0, 7).map(run => (
              <div key={run.id} className="dsk-row">
                <span className={`dsk-row__dot dsk-row__dot--${toneOf(run.status)}`} aria-hidden />
                <span className="dsk-row__name">{run.agent_name}</span>
                <span className="dsk-row__txt">{run.summary || run.status || '—'}</span>
                <span className="dsk-row__time">{timeOf(run.started_at)}</span>
              </div>
            ))}
            {today.runs.length === 0 && (
              <div className="dsk-row dsk-row--empty">Nog geen agent-runs vandaag.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- helpers

function buildTiles({ runs7d, kbArticles }) {
  return [
    {
      id: 'omzet', name: 'Omzet & facturatie', icon: UI_ICONS.euro, status: 'soon',
      value: null, label: 'Dashboard nog leeg', spark: null, to: null,
    },
    {
      id: 'pipeline', name: 'Sales pipeline', icon: UI_ICONS.chart, status: 'const',
      value: null, label: 'Dashboard nog leeg', spark: null, to: '/administratie',
    },
    {
      id: 'health', name: 'Klantgezondheid', icon: UI_ICONS.heart, status: 'const',
      value: null, label: 'Dashboard nog leeg', spark: null, to: '/klantverlies',
    },
    {
      id: 'agents', name: 'Agent-activiteit', icon: getIcon('health'),
      value: runs7d.rate === null ? null : `${runs7d.rate}%`,
      label: `Runs geslaagd (7d)${runs7d.total ? ` · ${runs7d.total} runs` : ''}`,
      spark: runs7d.spark, to: '/briefing',
    },
    {
      id: 'kennis', name: 'Kennis & RAG', icon: getIcon('kennisbank'),
      value: kbArticles === null ? null : kbArticles.toLocaleString('nl-NL'),
      label: kbArticles === null ? 'Dashboard nog leeg' : 'Artikelen in de kennisbank',
      spark: null, to: '/kennisbank',
    },
    {
      id: 'mail', name: 'Mail & doorlooptijd', icon: getIcon('autodraft'), status: 'const',
      value: null, label: 'Dashboard nog leeg', spark: null, to: '/postvak',
    },
  ]
}

// Spark naar percentages van de hoogste staaf. Zonder data een vlakke,
// rustige rij — geen verzonnen cijfers, alleen een lege vorm.
function normalizeSpark(spark) {
  if (!spark || spark.length === 0) return [22, 30, 24, 38, 30, 46, 40]
  const max = Math.max(...spark, 1)
  return spark.map(v => Math.max(8, Math.round((v / max) * 100)))
}

function greeting(now = new Date()) {
  const h = now.getHours()
  if (h < 6)  return 'Goedenacht'
  if (h < 12) return 'Goedemorgen'
  if (h < 18) return 'Goedemiddag'
  return 'Goedenavond'
}

function timeOf(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

function toneOf(status) {
  if (status === 'success') return 'ok'
  if (status === 'running' || status === 'pending') return 'busy'
  return 'warn'
}
