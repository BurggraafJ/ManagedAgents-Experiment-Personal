import { useNavigate } from 'react-router-dom'
import { useStuurTiles } from '../../../hooks/useStuurTiles'
import { getal, decimaal } from '../stuurinformatie/format'
import { UI_ICONS, getIcon } from '../../shell/SidebarIcons'
import './home.css'

// HomeView — Dashboard-tegels, landingspagina van de desktop-shell.
//
// v1.179: de volledige Confluence D1–D10-set. Drie live borden (D1 Pipeline,
// D9 Datakwaliteit, D10 Klantverlies) via dezelfde useStuurTiles als de
// mobiele stuurkaarten, gevolgd door zeven Soon-tegels (D2–D8) die nog geen
// dashboard hebben. Kennis & RAG, Mail & doorlooptijd en Omzet & facturatie
// waren geen D-bord uit de Confluence-set en zijn van Home af.
export default function HomeView({ profile }) {
  const navigate = useNavigate()
  const { d1, d9, d10, loading } = useStuurTiles()

  const firstName = (profile?.display_name || '').trim().split(/\s+/)[0] || null
  const tiles = buildTiles({ d1, d9, d10, loading })

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

              {/* Geen reeks, geen strook: een tegel zonder meting hoort geen
                  balkjes te dragen, ook niet grijze. */}
              {normalizeSpark(t.spark) && (
                <span className="dsk-tile__spark" aria-hidden>
                  {normalizeSpark(t.spark).map((h, i, arr) => (
                    <span
                      key={i}
                      className={`dsk-tile__bar ${i >= arr.length - 2 ? 'is-on' : ''}`}
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- helpers

function buildTiles({ d1, d9, d10, loading }) {
  const leegRechten = 'Geen records — of geen rechten'
  const nogTeBouwen = 'Nog te bouwen'
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
      id: 'd2', name: 'Aanvoer & kanaal', icon: getIcon('contacten'), badge: 'D2', status: 'soon',
      value: null, label: nogTeBouwen, spark: null, to: null,
    },
    {
      id: 'd3', name: 'Adoptie & klantgezondheid', icon: getIcon('health'), badge: 'D3', status: 'soon',
      value: null, label: nogTeBouwen, spark: null, to: null,
    },
    {
      id: 'd4', name: 'Klantbasis & retentie', icon: getIcon('klantbase'), badge: 'D4', status: 'soon',
      value: null, label: nogTeBouwen, spark: null, to: null,
    },
    {
      id: 'd5', name: 'Cash & order-to-cash', icon: UI_ICONS.euro, badge: 'D5', status: 'soon',
      value: null, label: nogTeBouwen, spark: null, to: null,
    },
    {
      id: 'd6', name: 'Marge & unit economics', icon: getIcon('intelligence'), badge: 'D6', status: 'soon',
      value: null, label: nogTeBouwen, spark: null, to: null,
    },
    {
      id: 'd7', name: 'Capaciteit & inzet', icon: getIcon('beheer'), badge: 'D7', status: 'soon',
      value: null, label: nogTeBouwen, spark: null, to: null,
    },
    {
      id: 'd8', name: 'MT-cockpit', icon: UI_ICONS.chart, badge: 'D8', status: 'soon',
      value: null, label: nogTeBouwen, spark: null, to: null,
    },
  ]
}

/**
 * Geen reeks = geen grafiek.
 *
 * Tot v1.181 gaf deze functie bij `spark: null` een vaste reeks
 * `[22, 30, 24, 38, 30, 46, 40]` terug. D9, D10 en alle `soon`-tegels geven
 * `null`, en kregen dus zeven verzonnen balkjes — een stijgende lijn die niets
 * meet, op tegels waarvan er één "≥ 12 deals blokkeren de forecast" zegt. Dat
 * is de ergste soort dashboardfout: niet een verkeerd getal, maar een beeld
 * naast een goed getal (Research 2 §1, "de nep-sparkline").
 */
function normalizeSpark(spark) {
  if (!spark || spark.length === 0) return null
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
