import { useNavigate } from 'react-router-dom'
import D10Zone from '../../klantverlies-v2/D10Zone'
import '../../klantverlies-v2/d10.css'

/**
 * D10 — Klantverlies / maandritme (/klantverlies).
 *
 * Pure stuurbord-pagina (v1.178). Bereikbaar vanaf de Home-tegels/stuurkaarten,
 * niet als nav-module. De oude CS-dossiershell (crumbs Customer Success,
 * Churn-agent-pill, FilterBar, ChurnCard-maandgroepen) is van de live route
 * af — die code blijft geparkeerd onder klantverlies-v2 tot een latere purge.
 *
 * D10Zone bevat het echte bord: VerliesStrip · trend · diagnose · VerliesWerkbord.
 * Detail `/klantverlies/:dealId` blijft geparkt voor diepe links; het werkbord
 * linkt nu naar HubSpot, niet naar die dossiers.
 */
export default function D10View() {
  const nav = useNavigate()

  return (
    <div className="d10-app">
      <header className="d10-topbar">
        <div className="d10-crumbs">
          <button type="button" className="d10-crumb-link" onClick={() => nav('/')}>Dashboard</button>
          <span className="d10-crumb-sep">/</span>
          <span className="d10-crumb-current">Klantverlies · maandritme</span>
        </div>
        <div className="d10-topbar__right">
          <span className="d10-ritme" title="Stuurbord maandritme · CS-werkbord voor wie op het punt staat te vertrekken">
            Stuurbord · D10
          </span>
          <button type="button" className="d10-btn d10-btn--sm" onClick={() => nav('/pipeline/hygiene')}>
            Datakwaliteit
          </button>
        </div>
      </header>

      <div className="d10-card">
        <div className="d10-card-inner">
          <D10Zone />
        </div>
      </div>
    </div>
  )
}
