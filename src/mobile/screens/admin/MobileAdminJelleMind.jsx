import { useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useMindData } from '../../../hooks/useMindData'
import { SCOPES, lessonTypeMeta, fmtAppliesTo, fmtRelative } from '../../../lib/jellemind'
import MIcon from '../../MIcon'
import { MSetHead, MSetGroup } from '../MobileSettingsBits'

// JelleMind (niveau 2, light) — alleen de open voorstellen, per mind-scope,
// met Klopt / Verwerp via dezelfde RPC (submit_jellemind_decision) als de
// desktop ProposalCard. Tekst bewerken, verplaatsen, AI-herformulering, de
// regels-browser en de signalen-feed blijven desktop.
export default function MobileAdminJelleMind({ onBack }) {
  const { proposals, loading, error, reload } = useMindData()
  const byScope = useMemo(() => {
    const out = {}
    for (const s of SCOPES) out[s.key] = []
    for (const p of proposals) (out[p.mind_scope] || out.jelle).push(p)
    return out
  }, [proposals])

  return (
    <div className="m-dash m-set m-ap">
      <MSetHead back={onBack} backLabel="Admin" title="JelleMind" sub="Voorstellen beoordelen — wat agents uit jouw correcties geleerd hebben."
        meta={proposals.length ? `${proposals.length} open` : null}
        titleRight={<button type="button" className="m-ap-refresh" onClick={reload} disabled={loading} aria-label="Ververs"><MIcon name="refresh" size={17} /></button>} />
      <div className="m-set__body">
        {error && <div className="m-set__errline">⚠ Fout: {error}</div>}
        {loading && proposals.length === 0 && <div className="m-set__empty">Laden…</div>}
        {!loading && !error && proposals.length === 0 && <div className="m-set__empty">Geen open voorstellen.</div>}

        {SCOPES.map(scope => byScope[scope.key].length > 0 && (
          <MSetGroup key={scope.key} label={<>{scope.label} <span className="m-ap-desk__cnt">{byScope[scope.key].length}</span></>}>
            {byScope[scope.key].map(row => <ProposalRow key={row.id} row={row} scope={scope} onDecided={reload} />)}
          </MSetGroup>
        ))}

        <p className="m-set__note"><MIcon name="brain" size={18} /><span>Tekst aanpassen, verplaatsen naar een andere mind en de regels-browser doe je op desktop.</span></p>
      </div>
    </div>
  )
}

function ProposalRow({ row, scope, onDecided }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const meta = lessonTypeMeta(row.lesson_type)

  async function decide(action) {
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('submit_jellemind_decision', { p_proposal_id: row.id, p_action: action })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.reason || 'onbekende fout')
      onDecided()
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div className={`m-inset__static m-ap-prop ${open ? 'is-open' : ''}`}>
      <button type="button" className="m-inset__row m-ap-row" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="m-ap-row__main">
          <span className="m-ap-row__tags">
            <span className="m-ap-pill m-ap-pill--type">{meta.label}</span>
            <span className="m-ap-row__meta">voor {fmtAppliesTo(row.applies_to)} · {Math.round((row.confidence || 0) * 100)}% · {fmtRelative(row.created_at)}</span>
          </span>
          {row.proposed_question && <span className="m-ap-row__title">{row.proposed_question}</span>}
          <span className={`m-ap-prop__text ${open ? '' : 'is-clamped'}`}>{row.lesson_text}</span>
        </span>
        <span className={`m-inset__chev m-ap-chev ${open ? 'is-open' : ''}`}><MIcon name="chevron" size={16} /></span>
      </button>
      {open && (
        <div className="m-ap-expand">
          {row.evidence_summary && <div className="m-ap-expand__note"><strong>Voorbeelden:</strong> {row.evidence_summary}</div>}
          {err && <div className="m-set__errline">⚠ {err}</div>}
          <div className="m-ap-actions">
            <button type="button" className="m-ap-btn m-ap-btn--neg" disabled={busy} onClick={() => decide('reject')}>Verwerp</button>
            <button type="button" className="m-ap-btn m-ap-btn--primary" disabled={busy} onClick={() => decide('accept')}>✓ Klopt</button>
          </div>
          <div className="m-ap-expand__scope">Mind: {scope.label}</div>
        </div>
      )}
    </div>
  )
}
