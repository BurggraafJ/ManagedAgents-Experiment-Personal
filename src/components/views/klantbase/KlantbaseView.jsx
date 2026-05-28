/* KlantbaseView — main view voor /klantbase.
   Twee modi:
     - 'over' (overdracht): sales pipeline → customer base verrijking
     - 'ren'  (verlenging): bestaande klant krijgt nieuwe deal
   Plus link naar /klantbase/uitleg voor de spelregels-pagina.

   UI-fase: gebruikt dummy data uit klantbase-data.js. Functionele
   integratie (HubSpot-fetch, AI-run, accept/reject persist) komt
   in fase 2 — zie het project-voorstel op Confluence.
*/
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import KlantbaseListPane from './KlantbaseListPane'
import KlantbaseDetailPane from './KlantbaseDetailPane'
import { DEALS_OVER, DEALS_REN } from './klantbase-data'
import './klantbase.css'

export default function KlantbaseView() {
  const navigate = useNavigate()
  const location = useLocation()
  const isVerlenging = location.pathname.endsWith('/verlenging')
  const mode = isVerlenging ? 'ren' : 'over'

  // Voor de UI-fase houden we de deal-lijsten lokaal in state zodat
  // accept/dismiss-acties optisch werken. Vervangen door hook in fase 2.
  const [overDeals, setOverDeals] = useState(DEALS_OVER)
  const [renDeals, setRenDeals]   = useState(DEALS_REN)
  const deals = mode === 'over' ? overDeals : renDeals

  const [selectedId, setSelectedId] = useState(deals[0]?.id || null)
  const selectedDeal = deals.find(d => d.id === selectedId) || deals[0] || null

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

  function handleApply(id) {
    if (mode === 'over') {
      setOverDeals(prev => prev.filter(d => d.id !== id))
      showToast('Verplaatst naar Customer Base — HubSpot bijgewerkt')
    } else {
      setRenDeals(prev => prev.filter(d => d.id !== id))
      showToast('Nieuwe deal aangemaakt · oude deal afgesloten')
    }
  }
  function handleDismiss(id) {
    if (!window.confirm('Voorstel negeren? Het wordt uit deze lijst gehaald — je kunt het later opnieuw genereren.')) return
    if (mode === 'over') setOverDeals(prev => prev.filter(d => d.id !== id))
    else setRenDeals(prev => prev.filter(d => d.id !== id))
  }
  function handleAddRenewal(name) {
    if (!name || !renDeals[0]) return
    showToast(`AI verzamelt data voor ${name}…`)
    setTimeout(() => {
      const id = 'R-' + Math.floor(Math.random() * 9000 + 1000)
      const init = name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
      const newDeal = {
        ...renDeals[0],
        id, company: name,
        avCls: 'av-' + (Math.floor(Math.random() * 6) + 1), avInit: init,
        domain: name.toLowerCase().replace(/[^a-z]/g, '') + '.nl',
        hubspot: 'https://app.hubspot.com/deals/new',
        oldDealName: name + ' — Lopend',
        oldDealStage: 'Customer',
        closedAt: 'zojuist gevonden',
        dueDate: '01 jul 2026', dueLabel: 'Handmatig aangemaakt', dueUrg: false,
        aiRun: 'zojuist', aiSources: 3,
        aiSummary: 'AI heeft data verzameld op basis van: bestaande HubSpot-deal, e-mailcontact en gebruiksstatistieken. Concept klaar voor review.',
        renBasis: 'Voorspelling op basis van handmatig opgegeven company-naam + bestaande HubSpot-records.',
        proposedFrom: '01-07-2026', oldEnds: '30-06-2026',
        filter: 'check',
        fields: renDeals[0].fields.map(f => ({ ...f, status: 'pending' })),
      }
      setRenDeals(prev => [newDeal, ...prev])
      setSelectedId(id)
      showToast('Voorspelling klaar — controleer de velden')
    }, 1000)
  }

  const cntOver = useMemo(() => overDeals.length, [overDeals])
  const cntRen  = useMemo(() => renDeals.length, [renDeals])

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
          <span className="kb-sync">
            <span className="kb-sync__dot" />
            <span>Live</span>
            <span className="kb-sync__meta">{clock}</span>
          </span>
        </div>
      </header>

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
          onApply={handleApply}
          onDismiss={handleDismiss}
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
