/* Rechter detail-pane voor Klantbase: deal-header, AI-bar, velden in groepen,
   footer met progress + CTA. */
import { useState } from 'react'
import FieldRow from './FieldRow'
import { GROUP_ORDER } from './klantbase-data'

export default function KlantbaseDetailPane({ deal, mode, onApply, onDismiss, showToast }) {
  const [openField, setOpenField] = useState(null)
  const [fieldsState, setFieldsState] = useState(deal?.fields || [])
  const [aiRun, setAiRun] = useState(deal?.aiRun || '—')
  const [spinning, setSpinning] = useState(false)

  // Reset wanneer er een andere deal geselecteerd wordt
  // (key-prop op het parent-niveau zorgt dat dit component re-mount per deal-id)
  if (!deal) return <EmptyState mode={mode} />

  const isRen = mode === 'ren'
  const total = fieldsState.length
  const okCount = fieldsState.filter(f => f.status === 'approved' || f.status === 'edited').length
  const pendingCount = fieldsState.filter(f => f.status === 'pending').length
  const rejectedCount = fieldsState.filter(f => f.status === 'rejected').length
  const pct = Math.round(okCount / total * 100)
  const ready = pendingCount === 0

  function updateField(key, patch) {
    setFieldsState(prev => prev.map(f => f.key === key ? { ...f, ...patch } : f))
  }
  function approve(key) {
    updateField(key, { status: 'approved' })
    showToast?.('Veld goedgekeurd')
  }
  function reject(key) {
    updateField(key, { status: 'rejected' })
    showToast?.('Veld afgewezen')
  }
  function setValue(key, val) {
    const cur = fieldsState.find(f => f.key === key)
    if (!cur) return
    if (cur.proposed !== val) updateField(key, { proposed: val, status: 'edited' })
  }
  function rerun(key) {
    setSpinning(true)
    setTimeout(() => {
      updateField(key, { status: 'pending' })
      setSpinning(false)
      showToast?.('AI heeft veld opnieuw bekeken')
    }, 900)
  }
  function rerunAll() {
    setSpinning(true)
    setTimeout(() => {
      setAiRun('zojuist')
      setSpinning(false)
      showToast?.(`Hele run uitgevoerd · ${deal.aiSources} bronnen ververst`)
    }, 1400)
  }
  function approveAll() {
    setFieldsState(prev => prev.map(f => f.status === 'pending' ? { ...f, status: 'approved' } : f))
    showToast?.('Alle openstaande velden goedgekeurd')
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
        <p>Selecteer een voorstel uit de lijst hiernaast om alle business-metrics en de AI-redenering te zien.</p>
      </div>
    </main>
  )
}
