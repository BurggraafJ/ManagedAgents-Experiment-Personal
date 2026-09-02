import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { SEV_LABEL, CAT_LABEL, STATUS_LABEL, sortFindings } from '../../../lib/severity'
import { relativeTime } from '../../../lib/dateFormat'
import MIcon from '../../MIcon'
import { MSetHead } from '../MobileSettingsBits'

// Security (niveau 2) — open bevindingen afhandelen: één tik voor Opgelost /
// Accepteer (optimistic, zelfde UPDATE als de desktop SecurityView). Scan-logs
// blijven desktop. Auto-refresh 90s.
export default function MobileAdminSecurity({ onBack }) {
  const [tab, setTab] = useState('open')
  const [openId, setOpenId] = useState(null)
  const [updatingId, setUpdatingId] = useState(null)
  const [overrides, setOverrides] = useState({})

  const q = useSupabaseQuery('security_findings', {
    orderBy: ['found_at', { ascending: false }], limit: 300, initialData: null,
  })
  useEffect(() => {
    const id = setInterval(q.refresh, 90_000)
    return () => clearInterval(id)
  }, [q.refresh])

  const findings = useMemo(() => {
    if (!q.data) return null
    return q.data.map(f => overrides[f.id] ? { ...f, ...overrides[f.id] } : f)
  }, [q.data, overrides])

  async function updateStatus(id, newStatus) {
    setUpdatingId(id)
    const patch = { status: newStatus }
    if (newStatus === 'resolved') patch.resolved_at = new Date().toISOString()
    setOverrides(prev => ({ ...prev, [id]: patch }))
    const { error } = await supabase.from('security_findings').update(patch).eq('id', id)
    if (error) setOverrides(prev => { const n = { ...prev }; delete n[id]; return n })
    setUpdatingId(null)
  }

  const open = useMemo(() => sortFindings((findings || []).filter(f => f.status === 'open')), [findings])
  const done = useMemo(() => (findings || []).filter(f => f.status !== 'open'), [findings])
  const list = tab === 'open' ? open : done

  return (
    <div className="m-dash m-set m-ap">
      <MSetHead back={onBack} backLabel="Organisatie" title="Security" sub="Open bevindingen van de security-scan afhandelen."
        meta={findings && <><b>{open.length}</b> open · {done.length} afgehandeld</>}
        titleRight={<button type="button" className="m-ap-refresh" onClick={q.refresh} disabled={q.loading} aria-label="Ververs"><MIcon name="refresh" size={17} /></button>} />
      <div className="m-set__body">
        {q.error && <div className="m-set__errline">⚠ Fout: {q.error}</div>}
        {!q.error && !findings && <div className="m-set__empty">Laden…</div>}

        {findings && (
          <div className="m-ap-seg">
            <button type="button" className={`m-ap-seg__btn ${tab === 'open' ? 'is-active' : ''}`} onClick={() => setTab('open')}>Open <span>{open.length}</span></button>
            <button type="button" className={`m-ap-seg__btn ${tab === 'done' ? 'is-active' : ''}`} onClick={() => setTab('done')}>Afgehandeld <span>{done.length}</span></button>
          </div>
        )}

        {findings && (
          <div className="m-inset">
            {list.length === 0 && <div className="m-set__empty">{tab === 'open' ? 'Geen open bevindingen.' : 'Nog niets afgehandeld.'}</div>}
            {list.map(f => (
              <FindingRow key={f.id} f={f} expanded={openId === f.id} onToggle={() => setOpenId(openId === f.id ? null : f.id)}
                busy={updatingId === f.id} onUpdate={updateStatus} />
            ))}
          </div>
        )}

        <p className="m-set__note"><MIcon name="shield" size={18} /><span>Bron security_findings · ma–do 07:00 dagelijkse monitor, vrijdag weekly scan. Scan-logs bekijk je op desktop.</span></p>
      </div>
    </div>
  )
}

function FindingRow({ f, expanded, onToggle, busy, onUpdate }) {
  const sev = f.severity || 'info'
  return (
    <div className={`m-inset__static m-ap-finding ${expanded ? 'is-open' : ''}`}>
      <button type="button" className="m-inset__row m-ap-row" onClick={onToggle} aria-expanded={expanded}>
        <span className={`m-ap-sev m-ap-sev--${sev}`}>{SEV_LABEL[sev] || sev}</span>
        <span className="m-ap-row__main">
          <span className="m-ap-row__title">{f.title}</span>
          <span className="m-ap-row__sub">{CAT_LABEL[f.category] || f.category || 'Overig'} · {relativeTime(f.found_at) || '—'}{f.status !== 'open' && ` · ${STATUS_LABEL[f.status] || f.status}`}</span>
        </span>
        <span className={`m-inset__chev m-ap-chev ${expanded ? 'is-open' : ''}`}><MIcon name="chevron" size={16} /></span>
      </button>
      {expanded && (
        <div className="m-ap-expand">
          {(f.description || f.detail) && <pre className="m-ap-expand__pre">{f.description || f.detail}</pre>}
          {f.affected_object && <div className="m-ap-expand__obj">{f.affected_object}</div>}
          {f.notes && <div className="m-ap-expand__note">Notitie: {f.notes}</div>}
          <div className="m-ap-actions">
            {f.status === 'open' ? (
              <>
                <button type="button" className="m-ap-btn m-ap-btn--ok" disabled={busy} onClick={() => onUpdate(f.id, 'resolved')}>Opgelost</button>
                <button type="button" className="m-ap-btn m-ap-btn--warn" disabled={busy} onClick={() => onUpdate(f.id, 'accepted_risk')}>Accepteer risico</button>
              </>
            ) : (
              <button type="button" className="m-ap-btn" disabled={busy} onClick={() => onUpdate(f.id, 'open')}>Heropen</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
