import IntelligenceHubView           from '../intelligence/IntelligenceHubView'
import IntelligenceQualityView       from '../intelligence/IntelligenceQualityView'
import IntelligenceObservabilityView from '../intelligence/IntelligenceObservabilityView'
import { AdminTabs } from './HealthArea'

// IntelligenceArea (v1.128) — één gebied met tabs Pijplijn · Kwaliteit ·
// Kosten. De drie bestaande views blijven 1:1 staan; alleen de navigatie is
// samengevoegd. De Hub tekent met .itl-* classes die onder .itl-app scopen —
// daarom in een .itl-app-wrapper (embed-variant, geen 100vh-shell).
const TABS = [
  { key: 'pijplijn',  label: 'Pijplijn',  path: '/admin/intelligence' },
  { key: 'kwaliteit', label: 'Kwaliteit', path: '/admin/intelligence/kwaliteit' },
  { key: 'kosten',    label: 'Kosten',    path: '/admin/intelligence/kosten' },
]

export default function IntelligenceArea({ tab = 'pijplijn' }) {
  return (
    <>
      <AdminTabs tabs={TABS} active={tab} />
      {tab === 'kwaliteit' && <IntelligenceQualityView />}
      {tab === 'kosten' && <IntelligenceObservabilityView />}
      {tab === 'pijplijn' && <div className="itl-app itl-app--embed"><IntelligenceHubView /></div>}
    </>
  )
}
