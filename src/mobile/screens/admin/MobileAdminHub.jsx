import { useAdminCounts } from '../../../hooks/useAdminCounts'
import { showToast } from '../../../components/Toast'
import MIcon from '../../MIcon'
import { MSetHead, MSetGroup, MSetRow } from '../MobileSettingsBits'

// Admin-hub (niveau 1). Groepen per taak; de desktop-only pagina's staan
// onderaan in een gestippelde groep met `desktop`-tag en zonder chevron —
// tikken geeft één regel toast, opent nooit de geplette desktop-shell.
//
// v1.130: JelleMind is desktop-only (voorstellen beoordelen vraagt de volle
// kaart met tekst bewerken, verplaatsen en de regels-browser). De groep
// "Leren" is daarmee van de telefoon verdwenen; JelleMind staat hieronder.
const DESKTOP_ONLY = [
  { icon: 'brain',   title: 'JelleMind',           sub: 'Voorstellen beoordelen' },
  { icon: 'spark',   title: 'Intelligence',        sub: 'Pijplijn · Kwaliteit · Kosten' },
  { icon: 'sliders', title: 'Configuratie' },
  { icon: 'zap',     title: 'Edge Functions' },
  { icon: 'rocket',  title: 'Deployments' },
  { icon: 'db',      title: 'Database & API Keys' },
]

export default function MobileAdminHub({ go }) {
  const c = useAdminCounts()
  const onlyDesktop = () => showToast({ kind: 'info', message: 'Alleen op desktop' })

  const healthRight = c.healthAttention == null ? null
    : c.healthAttention > 0
      ? <span className="m-ap-attn">{c.healthAttention} aandacht</span>
      : <span className="m-ap-ok">gezond</span>

  return (
    <div className="m-dash m-set m-ap">
      <MSetHead eyebrow="Meer" title="Admin" sub="Wie mag erin, draaien de agents en wat staat er open." />
      <div className="m-set__body">
        <MSetGroup label="Toegang">
          <MSetRow icon="users" tone="warm" title="Gebruikers" sub="Wie mag erin, met welke rol"
            meta={c.users ?? null} onClick={() => go('gebruikers')} />
        </MSetGroup>

        <MSetGroup label="Bewaking">
          <MSetRow icon="activity" tone="amber" title="Health" sub="Welke agent is ziek" onClick={() => go('health')}
            right={<>{healthRight}<span className="m-inset__chev"><MIcon name="chevron" size={16} /></span></>} />
          <MSetRow icon="shield" tone="rose" title="Security" sub="Open bevindingen afhandelen" onClick={() => go('security')}
            right={<>
              {c.securityOpen > 0 && <span className={`m-ap-badge ${c.securityUrgent > 0 ? 'm-ap-badge--err' : ''}`}>{c.securityOpen}</span>}
              <span className="m-inset__chev"><MIcon name="chevron" size={16} /></span>
            </>} />
        </MSetGroup>

        <section className="m-set__group m-ap-desk">
          <div className="m-set__grouplbl">Alleen op desktop <span className="m-ap-desk__cnt">{DESKTOP_ONLY.length}</span></div>
          <div className="m-inset">
            {DESKTOP_ONLY.map(it => (
              <MSetRow key={it.title} icon={it.icon} title={it.title} sub={it.sub} onClick={onlyDesktop} className="m-ap-desk__row"
                right={<span className="m-ap-tag"><MIcon name="laptop" size={13} />desktop</span>} />
            ))}
          </div>
        </section>

        <p className="m-set__note"><MIcon name="laptop" size={18} /><span>Updates staan onder Instellingen › Wat is nieuw. Legal AI open je op desktop.</span></p>
      </div>
    </div>
  )
}
