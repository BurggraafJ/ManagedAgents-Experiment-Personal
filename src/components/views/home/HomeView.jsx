import { useNavigate } from 'react-router-dom'
import { useHomeTiles } from '../../../hooks/useHomeTiles'
import { useStuurTiles } from '../../../hooks/useStuurTiles'
import { getal, decimaal } from '../stuurinformatie/format'
import { UI_ICONS, getIcon } from '../../shell/SidebarIcons'
import './home.css'

// HomeView — Dashboard-tegels, landingspagina van de desktop-shell.
//
// v1.178: drie live Confluence-borden als primaire dashboards (zelfde bron
// als de mobiele stuurkaarten via useStuurTiles): D1 Pipeline, D9 Datakwaliteit,
// D10 Klantverlies. Agent-activiteit (tegel + strip) en de lege Const-tegel
// "Klantgezondheid" zijn weg — D10 ís het klantverlies-dashboard. Kennis,
// Mail en Omzet blijven als secundaire placeholders.
export default function HomeView({ profile }) {
  const navigate = useNavigate()
  const { kbArticles } = useHomeTiles()
  const { d1, d9, d10, loading } = useStuurTiles()

  const firstName = (profile?.display_name || '').trim().split(/\s+/)[0] || null
  const tiles = buildTiles({ kbArticles, d1, d9, d10, loading })

  return (
    <div className="theme-maestro dsk-home">
      <div className="dsk-home__inner">
        <header className="dsk-home__head">
          <h2 className="dsk-home__h1">{greeting()}{firstName ? `, ${firstName}` : ''}</h2>
          <p className="dsk-home__sub">
            Stuurinformatie eerst — tik een bord open. De overige dashboards vullen we bij.
          </p>
        </header>

        <div className="dsk-home__grid">
          {tiles.map(t => (
            <button
              key={t.id}
              type="button"
              className={`dsk-tile${t.tone ? ` dsk-tile--${t.tone}` : ''}`}
              onClick={() => t.to && navigate(t.to)}
              disabled={!t.to}
              title={t.to ? `Open ${t.name}` : `${t.name} — nog geen dashboard`}
            >
              <span className="dsk-tile__top">
                <span className="dsk-tile__ico" aria-hidden>{t.icon}</span>
                <span className="dsk-tile__name">{t.name}</span>
                {t.badge && <span className="dsk-tile__badge">{t.badge}</span>}
                {t.status && (
                  <span className={`dsk-tile__pill dsk-tile__pill--${t.status}`}>
                    {t.status === 'soon' ? 'Soon' : 'Const'}
                  </span>
                )}
              </span>

              <span className="dsk-tile__kpi">
                <span className={`dsk-tile__num ${t.value === null ? 'is-empty' : ''}`}>
                  {t.value === null ? (t.empty || 'Geen data') : t.value}
                </span>
                {t.delta && (
                  <span className={`dsk-tile__delta ${t.deltaDown ? 'is-down' : ''}`}>{t.delta}</span>
                )}
              </span>

              <span className="dsk-tile__label">
                {t.label}
                {t.to && <span className="dsk-tile__arrow" aria-hidden>{UI_ICONS.arrow}</span>}
              </span>

              {t.extra && <span className="dsk-tile__extra">{t.extra}</span>}

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
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- helpers

function buildTiles({ kbArticles, d1, d9, d10, loading }) {
  const leegRechten = 'Geen records — of geen rechten'
  return [
    {
      id: 'd1', name: 'Pipeline & forecast', icon: UI_ICONS.chart, badge: 'D1',
      tone: d1 && d1.doel !== null && d1.kennismakingen !== null && d1.kennismakingen < d1.doel ? 'warn' : null,
      value: loading ? '…' : (d1 ? (getal(d1.kennismakingen) ?? '—') : null),
      empty: leegRechten,
      delta: d1 && d1.doel !== null
        ? (d1.kennismakingen >= d1.doel ? 'doel gehaald' : `doel ${getal(d1.doel)}/wk`)
        : null,
      deltaDown: d1 && d1.doel !== null && d1.kennismakingen !== null && d1.kennismakingen < d1.doel,
      label: d1
        ? `Kennismakingen vorige week${d1.gemiddeld4wk !== null ? ` · gem. ${decimaal(d1.gemiddeld4wk)} over 4 wk` : ''}`
        : 'Dashboard nog leeg',
      extra: d1 ? `${getal(d1.actief)} open deals · ${d1.perFase.map(f => `f${f.fase} ${getal(f.aantal ?? 0)}`).join(' · ')}` : null,
      spark: d1 ? d1.perFase.map(f => f.aantal || 0) : null,
      to: '/pipeline',
    },
    {
      id: 'd9', name: 'Datakwaliteit', icon: getIcon('security'), badge: 'D9',
      tone: d9?.blindVoor?.length ? 'amber' : null,
      value: loading ? '…' : (d9 ? `${d9.blindVoor?.length ? '≥' : ''}${getal(d9.aantal) ?? '—'}` : null),
      empty: leegRechten,
      label: d9
        ? `van ${getal(d9.noemer)} open deals blokkeren de forecast`
        : 'Dashboard nog leeg',
      extra: d9?.blindVoor?.length
        ? `Ondergrens · blind voor ${d9.blindVoor.join(' · ')}`
        : (d9 ? 'H2 · H3 · H4 · H5' : null),
      spark: null,
      to: '/pipeline/hygiene',
    },
    {
      id: 'd10', name: 'Klantverlies · maandritme', icon: UI_ICONS.heart, badge: 'D10',
      value: loading ? '…' : (d10 ? (getal(d10.b.deze_maand) ?? '—') : null),
      empty: leegRechten,
      delta: d10 ? `${getal(d10.b.laatste_13_maanden)} / 13 mnd` : null,
      label: d10
        ? `Proeven niet omgezet deze maand · vorige ${getal(d10.b.vorige_maand)}`
        : 'Dashboard nog leeg',
      extra: d10
        ? `${getal(d10.c.deze_maand)} opzeggingen deze maand · ${getal(d10.c.laatste_13_maanden)} in 13 mnd`
        : null,
      spark: null,
      to: '/klantverlies',
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
    {
      id: 'omzet', name: 'Omzet & facturatie', icon: UI_ICONS.euro, status: 'soon',
      value: null, label: 'Dashboard nog leeg', spark: null, to: null,
    },
  ]
}

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
