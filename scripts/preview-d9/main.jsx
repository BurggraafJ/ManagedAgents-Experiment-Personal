import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import D9View from '../../src/components/views/stuurinformatie/d9/D9View'

// Preview-harnas voor docs/previews/d9-*.png.
//
// Dit rendert de ECHTE view én de echte hook (useD9Hygiene); alleen de
// netwerklaag is gestubt (vite.preview.config.js aliast lib/supabase naar
// ./mock-supabase.js). Een preview kan dus niet naast de code komen te staan:
// verandert de hook van view-naam of kolom, dan valt de screenshot om.
//
// Draaien:  npm run preview:d9   →  scripts/preview-d9/capture.sh
const view = new URLSearchParams(location.search).get('view') || 'desktop'
document.documentElement.classList.add('theme-light')

function Desktop() {
  return (
    <div className="theme-maestro" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <D9View />
    </div>
  )
}

function Mobile() {
  return (
    <div className="shell shell--m theme-maestro">
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column' }}>
        <D9View />
      </main>
    </div>
  )
}

// Eén variant klapt de recordlijst van H5 open, zodat het drill-pad (teller →
// check → records) op de screenshot te zien is.
function OpenRecords({ children }) {
  useEffect(() => {
    const t = setTimeout(() => {
      const knop = Array.from(document.querySelectorAll('.d9-rij__knop'))
        .find(el => el.textContent.includes('H5'))
      knop?.click()
    }, 250)
    return () => clearTimeout(t)
  }, [])
  return children
}

const views = {
  desktop:         <Desktop />,
  'desktop-drill': <OpenRecords><Desktop /></OpenRecords>,
  mobile:          <Mobile />,
  'mobile-drill':  <OpenRecords><Mobile /></OpenRecords>,
}

createRoot(document.getElementById('root')).render(views[view] || views.desktop)
