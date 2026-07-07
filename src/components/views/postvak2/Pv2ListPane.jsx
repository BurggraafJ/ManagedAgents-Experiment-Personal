import { useEffect, useState } from 'react'
import Ic from './pv2Icons'
import Pv2Row from './Pv2Row'
import { catVars, msgTime } from './pv2lib'

/* Pv2ListPane — lijstpaneel (design: .list): categorie-filter (segmented of
 * compacte dropdown bij smal paneel), daggroepen, rijen, empty-states,
 * skeleton bij eerste load en de Logs-weergave (autodraft_decisions). */

const EMPTY_MSG = {
  drafts: ['Geen concepten', 'Geplaatste Outlook-concepten verschijnen hier tot je ze verstuurt.'],
  logs: ['Logs', 'Verwerkings-beslissingen verschijnen hier.'],
  'niet-jou': ['Niets gefilterd', 'Mails die niet voor jou zijn verschijnen hier.'],
  'wachten-klant': ['Niets in afwachting', 'Klant-mails die op antwoord wachten staan hier.'],
  'wachten-algemeen': ['Niets in afwachting', 'Mails die op antwoord wachten staan hier.'],
  pin: ['Geen pins', 'Gepinde mails verschijnen hier.'],
}

const LOG_ACTION_LABEL = {
  send: 'Concept geplaatst', ignore: 'Genegeerd', spam: 'Spam', amend: 'Aanpassing gevraagd',
  processed: 'Als verwerkt gemarkeerd', skip: 'Overgeslagen',
}

function LogRows({ decisions, mails }) {
  const byMail = new Map((mails || []).map(m => [m.mail_id, m]))
  return (
    <>
      {(decisions || []).slice(0, 120).map(d => {
        const m = byMail.get(d.mail_id)
        return (
          <div key={d.id} className="logrow">
            <span className="logrow-ico"><Ic n={d.action === 'send' ? 'send' : d.action === 'spam' ? 'shield-x' : d.action === 'amend' ? 'sparkles' : 'archive'} s={13}/></span>
            <div className="logrow-main">
              <div className="logrow-t">{m?.subject || d.final_subject || d.mail_id}</div>
              <div className="logrow-s">
                {LOG_ACTION_LABEL[d.action] || d.action}
                {d.target_folder ? ` → ${d.target_folder}` : ''}
                {d.execution_status ? ` · ${d.execution_status}` : ''}
              </div>
            </div>
            <span className="logrow-kind">{d.decision_kind || d.action}</span>
            <span className="logrow-time">{msgTime(d.decided_at)}</span>
          </div>
        )
      })}
      {(!decisions || decisions.length === 0) && (
        <div className="list-empty">
          <div className="list-empty-ico"><Ic n="log" s={22}/></div>
          <div className="list-empty-t">Nog geen beslissingen</div>
          <div className="list-empty-s">Alles wat je hier beslist wordt gelogd.</div>
        </div>
      )}
    </>
  )
}

export default function Pv2ListPane({
  activeTab, groups, loading, hasMore, onLoadMore,
  filter, setFilter, catFilters,
  listW, navCollapsed, onToggleNav,
  decisions, mails,
  rowProps,
}) {
  const [catOpen, setCatOpen] = useState(false)
  const compact = typeof listW === 'number' && listW < 404
  useEffect(() => {
    if (!catOpen) return undefined
    const c = e => { if (!e.target.closest('.seg-compact')) setCatOpen(false) }
    document.addEventListener('mousedown', c)
    return () => document.removeEventListener('mousedown', c)
  }, [catOpen])

  const curFilter = catFilters.find(f => f.id === filter) || catFilters[0]
  const isLogs = activeTab === 'logs'
  const isEmpty = !isLogs && groups.length === 0
  const emptyMsg = EMPTY_MSG[activeTab] || ['Niets hier', 'Geen mails in deze weergave.']

  return (
    <section className="list">
      <div className="list-head">
        <div className="filters">
          {onToggleNav && (
            <button className={`list-navtoggle ${navCollapsed ? 'is-collapsed' : ''}`} onClick={onToggleNav}
                    title={navCollapsed ? 'Mappen tonen' : 'Mappen verbergen'}>
              <Ic n="sidebar" s={16}/>
            </button>
          )}
          {!isLogs && (compact ? (
            <div className="seg-compact">
              <button className={`seg-compact-btn ${catOpen ? 'open' : ''}`} onClick={() => setCatOpen(o => !o)}
                      style={curFilter.accent ? catVars(curFilter.accent) : null}>
                {curFilter.accent && <span className="seg-dot" style={{ background: 'var(--cat)' }}/>}
                <span className="seg-compact-lbl">{curFilter.label}</span>
                <span className="seg-count">{curFilter.count}</span>
                <Ic n="chev" s={12}/>
              </button>
              {catOpen && (
                <div className="dd seg-dd" onClick={e => e.stopPropagation()}>
                  {catFilters.map(f => (
                    <button key={f.id} className={`dd-item ${filter === f.id ? 'is-on' : ''}`}
                            onClick={() => { setFilter(f.id); setCatOpen(false) }}
                            style={f.accent ? catVars(f.accent) : null}>
                      <span className="seg-dot" style={{ background: f.accent ? 'var(--cat)' : 'transparent' }}/>
                      <span style={{ flex: 1, textAlign: 'left' }}>{f.label}</span>
                      <span className="seg-count">{f.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="segmented">
              {catFilters.map(f => (
                <button key={f.id} className={`seg ${filter === f.id ? 'active' : ''}`}
                        onClick={() => setFilter(f.id)} style={f.accent ? catVars(f.accent) : null}>
                  {f.accent && <span className="seg-dot" style={{ background: 'var(--cat)' }}/>}
                  <span className="seg-label">{f.label}</span>
                  <span className="seg-count">{f.count}</span>
                </button>
              ))}
            </div>
          ))}
          <span style={{ flex: 1 }}/>
        </div>
      </div>
      <div className="list-scroll">
        {isLogs ? (
          <LogRows decisions={decisions} mails={mails}/>
        ) : isEmpty ? (
          loading ? (
            <div aria-busy="true" aria-label="Mails worden geladen">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="skel-row">
                  <div className="skel-av"/>
                  <div className="skel-lines">
                    <div className="skel-line skel-line--w40"/>
                    <div className="skel-line skel-line--w80"/>
                    <div className="skel-line skel-line--w60"/>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="list-empty">
              <div className="list-empty-ico"><Ic n="inbox" s={22}/></div>
              <div className="list-empty-t">{emptyMsg[0]}</div>
              <div className="list-empty-s">{emptyMsg[1]}</div>
            </div>
          )
        ) : groups.map(group => (
          <div key={group.day}>
            <div className="list-day"><span>{group.day}</span><span className="list-day-count">{group.items.length}</span></div>
            {group.items.map(it => (
              <Pv2Row key={it.mail_id} it={it} {...rowProps(it)}/>
            ))}
          </div>
        ))}
        {!isLogs && !isEmpty && hasMore && (
          <button type="button" className="list-more" onClick={onLoadMore}>Meer laden…</button>
        )}
        <div style={{ height: 24 }}/>
      </div>
    </section>
  )
}
