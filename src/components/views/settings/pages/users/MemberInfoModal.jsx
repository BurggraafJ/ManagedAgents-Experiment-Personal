import { useMemo } from 'react'
import { useCapabilities } from '../../../../../hooks/useCapabilities'
import Modal from '../../../../ui/Modal'
import '../rechten/rechten.css'

// "Wat ziet een member?" — afgeleid uit dezelfde bron als de handhaving.
//
// Tot v1.190 stond hier een handgeschreven lijst (UsersPage.jsx:51). Die was
// aantoonbaar niet meer waar: hij beloofde Administratie en Contacten, terwijl
// de RLS op de HubSpot-spiegel `is_admin_or_higher()` is en een member er dus
// nul rijen ziet (RESEARCH-MULTI-USER §2, DESIGN-NOTES stap 4). Zo'n lijst
// veroudert stil — niemand merkt het, want er staat geen datum bij.
//
// Nu leest hij `capabilities` + `role_capabilities` voor de rol `member`. Dat
// is letterlijk waar `has_capability()` mee rekent, dus de tekst kan niet meer
// uit de pas lopen met de poort. En de rechten die aan staan maar vandaag niets
// opleveren (`levert_vandaag = false`) staan apart — dat is de eerlijke derde
// categorie die de oude lijst niet had.
//
// Deze component mount alleen als de modal open is (de ouder rendert hem
// conditioneel), zodat de drie selects niet bij elke paginaload draaien.
export default function MemberInfoModal({ onClose }) {
  const { caps, presetByRole, loading, error } = useCapabilities()

  const { zichtbaar, nietZichtbaar, leegVandaag } = useMemo(() => {
    const preset = presetByRole.get('member') || new Set()
    const modules = caps.filter(c => c.soort === 'module')
    const aan = modules.filter(c => c.grantable && preset.has(c.key))
    return {
      zichtbaar: aan.filter(c => c.levert_vandaag),
      leegVandaag: aan.filter(c => !c.levert_vandaag),
      nietZichtbaar: modules.filter(c => !preset.has(c.key) || !c.grantable),
    }
  }, [caps, presetByRole])

  const namen = (list) => list.map(c => c.label).join(' · ')

  return (
    <Modal open onClose={onClose} title="Wat ziet een member?" size="md" className="users-modal">
      {error && <p className="rch-warn">Rechten niet op te halen: {error}</p>}
      {loading && <p>Rechten ophalen…</p>}
      {!loading && !error && (
        <ul className="users-info__list">
          <li>
            <strong>Zichtbaar en gevuld:</strong> {namen(zichtbaar) || '—'}.
          </li>
          {leegVandaag.length > 0 && (
            <li>
              <strong>Staat aan, maar levert vandaag niets:</strong> {namen(leegVandaag)}.
              {' '}Het recht is toegekend; de RLS eronder geeft een member er nog geen
              rijen bij. Een lege lijst betekent hier dus niet "geen data" maar
              "nog niet opengezet".
            </li>
          )}
          <li>
            <strong>Niet zichtbaar:</strong> {namen(nietZichtbaar) || '—'}.
          </li>
          <li>
            <strong>RLS-isolatie:</strong> de member ziet 0 rijen van jouw mail / agenda /
            taken — alles filtert op <code>user_id = auth.uid()</code>.
          </li>
          <li>
            <strong>Postvak / Agenda:</strong> na inloggen Instellingen → Connectors →
            Koppelen (Microsoft). Zonder eigen koppeling blijft het postvak leeg.
          </li>
        </ul>
      )}
      <p className="users-info__src">
        Afgeleid uit <code>capabilities</code> + <code>role_capabilities</code> — dezelfde
        bron als <code>has_capability()</code>. Deze tekst kan dus niet verouderen.
      </p>
      <Modal.Footer>
        <button type="button" className="btn" onClick={onClose}>Sluiten</button>
      </Modal.Footer>
    </Modal>
  )
}
