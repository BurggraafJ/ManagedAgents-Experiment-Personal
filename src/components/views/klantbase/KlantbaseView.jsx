/* KlantbaseView — main view voor /klantbase.
   Twee modi:
     - 'over' (overdracht): sales pipeline → customer base verrijking
     - 'ren'  (verlenging): bestaande klant krijgt nieuwe deal
   Plus link naar /klantbase/uitleg voor de spelregels-pagina.

   Data: useKlantbaseData() — live Supabase, vervangt DEALS_OVER/REN dummies
   sinds v1.39. Acties (accept/reject/dismiss) bedraad aan klantbase RPCs.
*/
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import KlantbaseListPane from './KlantbaseListPane'
import KlantbaseDetailPane from './KlantbaseDetailPane'
import { useKlantbaseData } from '../../../hooks/useKlantbaseData'
import './klantbase.css'

export default function KlantbaseView() {
  const navigate = useNavigate()
  const location = useLocation()
  const isVerlenging = location.pathname.endsWith('/verlenging')
  const mode = isVerlenging ? 'ren' : 'over'

  const {
    proposalsOver, proposalsRen, loading, error, runStatus,
    requestRun,
    acceptProposal, rejectProposal, dismissProposal,
    approveField, acceptFieldWithEdits, rejectField, rerunField,
    approveAllPendingFields,
  } = useKlantbaseData()

  const deals = mode === 'over' ? proposalsOver : proposalsRen

  const [selectedId, setSelectedId] = useState(null)
  const selectedDeal = useMemo(
    () => deals.find(d => d.id === selectedId) || deals[0] || null,
    [deals, selectedId]
  )

  // Switch tussen modi: reset selectie naar eerste deal van die modus
  useEffect(() => {
    setSelectedId(deals[0]?.id || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Clock voor sync-pill
  const [clock, setClock] = useState('--:--')
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }))
    tick()
    const id = setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [])

  // Toast
  const [toast, setToast] = useState(null)
  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  async function handleApply(id) {
    try {
      await acceptProposal(id)
      showToast(mode === 'over'
        ? 'Verplaatst naar Customer Base — HubSpot wordt bijgewerkt'
        : 'Nieuwe deal aangemaakt · oude deal afgesloten')
    } catch (e) {
      showToast(`Fout: ${e.message || e}`)
    }
  }
  async function handleDismiss(id) {
    if (!window.confirm('Voorstel negeren? Het wordt uit deze lijst gehaald — je kunt het later opnieuw genereren.')) return
    try {
      await dismissProposal(id)
      showToast('Voorstel genegeerd')
    } catch (e) {
      showToast(`Fout: ${e.message || e}`)
    }
  }
  async function handleAddRenewal(name) {
    if (!name) return
    showToast(`Handmatige verlenging: ${name} — Pass 2 (Fase 6) implementeert dit.`)
    // TODO Fase 6: trigger renewal-scan voor specifieke company (request_klantbase_run met param)
  }
  async function handleRequestRun() {
    try {
      await requestRun()
      showToast('Klantbase-scan aangevraagd — wordt binnen 15 min uitgevoerd')
    } catch (e) {
      showToast(`Fout: ${e.message || e}`)
    }
  }

  const cntOver = proposalsOver.length
  const cntRen  = proposalsRen.length

  return (
    <div className="kb-app">
      {/* ───── Topbar ───── */}
      <header className="kb-topbar">
        <div className="kb-crumbs">
          <span className="kb-crumb">Werkruimte</span>
          <span className="kb-crumb-sep">/</span>
          <span className="kb-crumb">Klantbeheer</span>
          <span className="kb-crumb-sep">/</span>
          <span className="kb-crumb kb-crumb-current">Klantbase</span>
        </div>
        <div className="kb-topbar__right">
          <div className="kb-mode" role="tablist">
            <button
              type="button"
              className={mode === 'over' ? 'is-active' : ''}
              onClick={() => navigate('/klantbase')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h6l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m9 14 2 2 4-4"/></svg>
              Overdracht <span className="kb-mode-cnt">{cntOver}</span>
            </button>
            <button
              type="button"
              className={mode === 'ren' ? 'is-active' : ''}
              onClick={() => navigate('/klantbase/verlenging')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-15.4 6.4L3 16M3 21v-5h5"/></svg>
              Verlenging <span className="kb-mode-cnt">{cntRen}</span>
            </button>
            <a onClick={() => navigate('/klantbase/uitleg')} title="Spelregels & afspraken">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/></svg>
              Uitleg
            </a>
          </div>
          <span className={`kb-sync ${runStatus?.isRunning ? 'is-running' : runStatus?.isPending ? 'is-pending' : ''}`}>
            <span className="kb-sync__dot" />
            <span>
              {runStatus?.isRunning ? 'AI bezig' : runStatus?.isPending ? 'Wacht op AI' : 'Live'}
            </span>
            <span className="kb-sync__meta">{clock}</span>
          </span>
        </div>
      </header>

      {/* ───── Run-status banner: pending / running ───── */}
      {(runStatus?.isPending || runStatus?.isRunning) && (
        <RunStatusBanner status={runStatus} />
      )}

      {/* ───── Card met list + detail ───── */}
      <div className="kb-card">
        <KlantbaseListPane
          mode={mode}
          deals={deals}
          selectedId={selectedDeal?.id}
          onSelect={setSelectedId}
          onAddRenewal={handleAddRenewal}
        />
        <KlantbaseDetailPane
          key={selectedDeal?.id || 'empty'}
          deal={selectedDeal}
          mode={mode}
          loading={loading}
          error={error}
          onApply={handleApply}
          onDismiss={handleDismiss}
          onRequestRun={handleRequestRun}
          onApproveField={approveField}
          onAcceptFieldWithEdits={acceptFieldWithEdits}
          onRejectField={rejectField}
          onRerunField={rerunField}
          onApproveAllPending={approveAllPendingFields}
          showToast={showToast}
        />
      </div>

      {/* Toast */}
      {toast && (
        <div className="kb-toast is-show">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5"/>
          </svg>
          <span>{toast}</span>
        </div>
      )}
    </div>
  )
}

function RunStatusBanner({ status }) {
  const ts = status.isRunning ? status.runningSince : status.requestedAt
  const rel = formatRelative(ts)
  return (
    <div className={`kb-run-banner ${status.isRunning ? 'is-running' : 'is-pending'}`}>
      <span className="kb-run-banner__pulse">
        <span className="dot"/><span className="dot"/><span className="dot"/>
      </span>
      <div className="kb-run-banner__body">
        <strong>
          {status.isRunning
            ? 'AI scant nu de klantbase…'
            : 'Verzoek aangevraagd — wacht op AI'}
        </strong>
        <span className="kb-run-banner__meta">
          {status.isRunning
            ? `Gestart ${rel}. Voorstellen verschijnen vanzelf zodra ze klaar zijn.`
            : `Aangevraagd ${rel}. De orchestrator pakt het op binnen 15 minuten.`}
        </span>
      </div>
    </div>
  )
}

function formatRelative(iso) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (isNaN(ms) || ms < 0) return 'zojuist'
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'zojuist'
  if (min < 60) return `${min} min geleden`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}u geleden`
  const days = Math.floor(h / 24)
  return `${days}d geleden`
}
