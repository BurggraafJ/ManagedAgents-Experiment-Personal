/* Rechter detail-pane voor Klantbase: deal-header, AI-bar, velden in groepen,
   footer met progress + CTA. */
import { useState } from 'react'
import FieldRow from './FieldRow'
import { GROUP_ORDER } from './klantbase-data'

export default function KlantbaseDetailPane({
  deal, mode, loading, error, onApply, onDismiss, showToast,
  onRequestRun, onApproveField, onAcceptFieldWithEdits, onRejectField,
  onRerunField, onApproveAllPending,
}) {
  const [openField, setOpenField] = useState(null)
  const [fieldsState, setFieldsState] = useState(deal?.fields || [])
  const [aiRun, setAiRun] = useState(deal?.aiRun || '—')
  const [spinning, setSpinning] = useState(false)

  // Reset wanneer er een andere deal geselecteerd wordt
  // (key-prop op het parent-niveau zorgt dat dit component re-mount per deal-id)
  if (loading && !deal) return <LoadingState />
  if (error && !deal) return <ErrorState error={error} />
  if (!deal) return <EmptyState mode={mode} />

  const isRen = mode === 'ren'
  const total = fieldsState.length
  const okCount = fieldsState.filter(f => f.status === 'approved' || f.status === 'edited').length
  const pendingCount = fieldsState.filter(f => f.status === 'pending').length
  const rejectedCount = fieldsState.filter(f => f.status === 'rejected').length
  const pct = total > 0 ? Math.round(okCount / total * 100) : 0
  const ready = total > 0 && pendingCount === 0

  function updateField(key, patch) {
    setFieldsState(prev => prev.map(f => f.key === key ? { ...f, ...patch } : f))
  }
  async function approve(key) {
    const f = fieldsState.find(x => x.key === key)
    if (!f) return
    const prevStatus = f.status
    updateField(key, { status: 'approved' })
    try {
      await onApproveField?.(f.id)
      showToast?.('Veld goedgekeurd')
    } catch (e) {
      updateField(key, { status: prevStatus })
      showToast?.(`Fout: ${e.message || e}`)
    }
  }
  async function reject(key) {
    const f = fieldsState.find(x => x.key === key)
    if (!f) return
    const prevStatus = f.status
    updateField(key, { status: 'rejected' })
    try {
      await onRejectField?.(f.id)
      showToast?.('Veld afgewezen')
    } catch (e) {
      updateField(key, { status: prevStatus })
      showToast?.(`Fout: ${e.message || e}`)
    }
  }
  async function setValue(key, val) {
    const cur = fieldsState.find(f => f.key === key)
    if (!cur) return
    if (cur.proposed === val) return
    const prev = { proposed: cur.proposed, status: cur.status }
    updateField(key, { proposed: val, status: 'edited' })
    try {
      await onAcceptFieldWithEdits?.(cur.id, val)
    } catch (e) {
      updateField(key, prev)
      showToast?.(`Fout: ${e.message || e}`)
    }
  }
  async function rerun(key) {
    const f = fieldsState.find(x => x.key === key)
    if (!f) return
    setSpinning(true)
    try {
      await onRerunField?.(f.id)
      updateField(key, { status: 'pending' })
      showToast?.('AI gaat veld opnieuw bekijken — even geduld')
    } catch (e) {
      showToast?.(`Fout: ${e.message || e}`)
    } finally {
      setSpinning(false)
    }
  }
  async function rerunAll() {
    setSpinning(true)
    try {
      await onRequestRun?.()
      setAiRun('zojuist aangevraagd')
      showToast?.('Klantbase-scan aangevraagd · alle velden worden herzien')
    } catch (e) {
      showToast?.(`Fout: ${e.message || e}`)
    } finally {
      setSpinning(false)
    }
  }
  async function approveAll() {
    const prev = fieldsState
    setFieldsState(p => p.map(f => f.status === 'pending' ? { ...f, status: 'approved' } : f))
    try {
      await onApproveAllPending?.(deal.proposalId || deal.id)
      showToast?.('Alle openstaande velden goedgekeurd')
    } catch (e) {
      setFieldsState(prev)
      showToast?.(`Fout: ${e.message || e}`)
    }
  }

  const byGroup = {}
  fieldsState.forEach(f => { (byGroup[f.group] ||= []).push(f) })

  return (
    <main className="kb-detail">
      <header className="kb-det-head">
        <div className="kb-det-meta-row">
          <div className="kb-det-co">
            <div className={`kb-det-co-av kb-${deal.avCls}`}>{deal.avInit}</div>
            <div className="kb-det-co-main">
              <h1 className="kb-det-co-name">{deal.company}</h1>
              <div className="kb-det-co-sub">
                <a href={`https://${deal.domain}`} target="_blank" rel="noopener noreferrer">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                  {deal.domain}
                </a>
                <span className="sep">·</span>
                {isRen ? (
                  <span>Oude deal <b>{deal.oldDealName}</b> · stage <b>{deal.oldDealStage}</b></span>
                ) : (
                  <span>Deal <b>{deal.id}</b> · stage <b>{deal.stage}</b></span>
                )}
                <span className="sep">·</span>
                <span>Won op <b>{deal.closedAt}</b></span>
                <span className="sep">·</span>
                <a href={deal.hubspot} target="_blank" rel="noopener noreferrer">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <path d="M15 3h6v6M10 14 21 3"/>
                  </svg>
                  Open in HubSpot
                </a>
              </div>
            </div>
          </div>
          <div className={`kb-det-due ${deal.dueUrg ? 'urg' : ''}`}>
            <div>
              <span className="kb-det-due-lbl">{deal.dueLabel}</span>
              <span className="kb-det-due-val">{deal.dueDate}</span>
            </div>
          </div>
        </div>

        {deal.missingLoa ? (
          <div className="kb-loa-missing">
            <div className="kb-loa-missing__ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <path d="M14 2v6h6"/>
                <path d="M12 11v6M9 14h6"/>
              </svg>
            </div>
            <div className="kb-loa-missing__main">
              <div className="kb-loa-missing__lbl">Licentieovereenkomst ontbreekt</div>
              <h3 className="kb-loa-missing__title">
                Upload de getekende licentieovereenkomst op de HubSpot-deal
              </h3>
              <div className="kb-loa-missing__body">
                De agent kan pas de 19 facturatie-velden invullen als de LoA als
                bijlage op deze deal staat. Zodra je hem hebt geüpload, klik op
                <b> Hele run opnieuw</b> rechts — binnen 15 minuten verschijnen
                de voorstellen.
              </div>
              <div className="kb-loa-missing__actions">
                <a href={deal.hubspot} target="_blank" rel="noopener noreferrer" className="kb-btn-ai">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <path d="M15 3h6v6M10 14 21 3"/>
                  </svg>
                  Open deal in HubSpot
                </a>
                <button className={`kb-btn-ai ${spinning ? 'is-spinning' : ''}`} onClick={rerunAll}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8"/>
                    <path d="M21 3v5h-5M21 12a9 9 0 0 1-15.4 6.4L3 16M3 21v-5h5"/>
                  </svg>
                  Hele run opnieuw
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="kb-ai-bar">
            <div className="kb-ai-bar-l">
              <span className="kb-ai-mark"><span className="pulse" />AI</span>
              <div className="kb-ai-bar-txt">
                {deal.aiSummary} <span className="kb-muted">— laatste run {aiRun}, {deal.aiSources} bronnen.</span>
              </div>
            </div>
            <div className="kb-ai-bar-r">
              <button className={`kb-btn-ai ${spinning ? 'is-spinning' : ''}`} onClick={rerunAll}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8"/>
                  <path d="M21 3v5h-5M21 12a9 9 0 0 1-15.4 6.4L3 16M3 21v-5h5"/>
                </svg>
                Hele run opnieuw
              </button>
              <button className="kb-btn-ai" onClick={approveAll}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5"/>
                </svg>
                Alles goedkeuren
              </button>
            </div>
          </div>
        )}
      </header>

      <div className="kb-fields">
        {isRen && <RenBanner d={deal} />}
        {GROUP_ORDER.filter(g => byGroup[g]).map(g => (
          <div key={g}>
            <div className="kb-f-group-head">
              {g}
              {isRen && groupNAhint(g, byGroup[g])}
            </div>
            <div className="kb-f-cols">
              <span>Veld</span>
              <span>{isRen ? 'Was → Voorspelde nieuwe waarde' : 'Voorgestelde waarde'}</span>
              <span>Bron</span>
              <span>Acties</span>
            </div>
            {byGroup[g].map(f => (
              <FieldRow
                key={f.key}
                f={f}
                isOpen={openField === f.key}
                isRen={isRen}
                onToggle={() => setOpenField(prev => prev === f.key ? null : f.key)}
                onApprove={() => approve(f.key)}
                onReject={() => reject(f.key)}
                onRerun={() => rerun(f.key)}
                onSetValue={(val) => setValue(f.key, val)}
              />
            ))}
          </div>
        ))}
      </div>

      <footer className="kb-det-foot">
        <div className="kb-det-foot-l">
          <div className="kb-det-prog">
            <b>{okCount}</b> / {total} velden klaar
            <div className="bar"><i style={{ width: `${pct}%` }} /></div>
            <span className="kb-det-prog-mini">{pct}%</span>
          </div>
          <div className="kb-det-prog-mini">
            {pendingCount} te checken{rejectedCount ? ` · ${rejectedCount} afgewezen` : ''}
          </div>
        </div>
        <div className="kb-det-foot-r">
          <button className="kb-btn kb-btn--ghost" onClick={() => onDismiss?.(deal.id)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            </svg>
            Negeren
          </button>
          <button
            className={`kb-btn-cta ${ready ? '' : 'warn'}`}
            disabled={!ready}
            onClick={() => onApply?.(deal.id)}
          >
            {isRen ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7"/></svg>
                {ready
                  ? 'Maak nieuwe deal & sluit oude'
                  : `Wacht: ${pendingCount} veld${pendingCount === 1 ? '' : 'en'} te checken`}
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                {ready
                  ? 'Verplaats naar Customer Base'
                  : `Wacht: ${pendingCount} veld${pendingCount === 1 ? '' : 'en'} te checken`}
              </>
            )}
          </button>
        </div>
      </footer>
    </main>
  )
}

function RenBanner({ d }) {
  return (
    <div className="kb-ren-banner">
      <div className="kb-ren-banner-ic">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
          <path d="M12 3v2M21 12h-2M12 21v-2M3 12h2"/>
        </svg>
      </div>
      <div className="kb-ren-banner-main">
        <div className="kb-ren-banner-lbl">Voorspelling</div>
        <h3 className="kb-ren-banner-title">
          Dit is hoe de <b>nieuwe deal</b> er volgens de agent uit komt te zien.
        </h3>
        <div className="kb-ren-banner-body">
          {d.renBasis || 'Voorspelling op basis van licentieovereenkomst, mail en gebruiksdata.'} Pas waar nodig aan voordat je hem definitief maakt.
        </div>
        <div className="kb-ren-banner-foot">
          <span className="item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>
            </svg>
            Nieuwe deal start <b>{d.proposedFrom}</b>
          </span>
          <span className="item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            </svg>
            Oude deal eindigt <b>{d.oldEnds}</b>
          </span>
          <span className="item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v3M12 19v3M22 12h-3M5 12H2M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/>
            </svg>
            Run: <b>{d.aiRun}</b>
          </span>
        </div>
      </div>
    </div>
  )
}

function groupNAhint(group, fields) {
  if (group !== 'Proefperiode') return null
  const propIs = fields.every(f => f.proposed === '—' || f.proposed === 'n.v.t.' || f.proposed === '0')
  if (propIs) {
    return <span className="kb-f-group-na">historisch — niet van toepassing op nieuwe deal</span>
  }
  return null
}

function EmptyState({ mode }) {
  return (
    <main className="kb-detail">
      <div className="kb-empty-state">
        <div className="ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
            <circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 3"/>
          </svg>
        </div>
        <h3>{mode === 'over' ? 'Geen overdracht geselecteerd' : 'Geen verlenging geselecteerd'}</h3>
        <p>Selecteer een voorstel uit de lijst hiernaast om alle business-metrics en de AI-redenering te zien. Geen voorstellen? De klantbase-skill draait dagelijks 06:30 — of klik bij een geselecteerd voorstel op "Hele run opnieuw".</p>
      </div>
    </main>
  )
}

function LoadingState() {
  return (
    <main className="kb-detail">
      <div className="kb-empty-state">
        <div className="ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
            <circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 3"/>
          </svg>
        </div>
        <h3>Voorstellen laden…</h3>
        <p>Klantbase-data wordt opgehaald uit Supabase.</p>
      </div>
    </main>
  )
}

function ErrorState({ error }) {
  return (
    <main className="kb-detail">
      <div className="kb-empty-state">
        <div className="ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
            <circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 17h.01"/>
          </svg>
        </div>
        <h3>Fout bij laden</h3>
        <p>{String(error)}</p>
      </div>
    </main>
  )
}
