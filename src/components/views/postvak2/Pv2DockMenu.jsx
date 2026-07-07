import Ic from './pv2Icons'

/* Pv2DockMenu — dropdown bij de primaire actieknop (design: DockMenu).
 * Alle items zijn aan echte variant 1-acties gekoppeld; wat een voorstel
 * is (andere actie kiezen) komt uit autodraft_action_decisions. */

const CATEGORY_ICONS = { reply: 'edit', forward: 'send', file: 'folder-in', schedule: 'calendar', delegate: 'arrow-right', defer: 'archive' }

export default function Pv2DockMenu({
  onClose, up,
  proposals = [], catalogMap, currentProposalId, onSwitchProposal, conceptAvailable, onSwitchConcept, isConcept,
  onApproveNext, onArchive, onMarkProcessed, onSnooze,
  onTimeline, onSpelcheck, onPin, isFlagged, onRag,
  onSpam, onDelete,
}) {
  return (
    <div className={`dd dd-left ${up ? 'dd-up' : ''}`} onClick={e => e.stopPropagation()}>
      {(proposals.length > 0 || conceptAvailable) && <div className="dd-label">Andere actie kiezen</div>}
      {conceptAvailable && (
        <button className={`dd-item ${isConcept ? 'is-active' : ''}`} onClick={() => { onSwitchConcept(); onClose() }}>
          <Ic n="edit" s={15}/> Concept opstellen {isConcept && <span className="dd-kbd">nu</span>}
        </button>
      )}
      {proposals.map(p => {
        const cat = catalogMap?.get(p.action_slug)
        const category = cat?.category || p.action_slug?.split('.')?.[0]
        return (
          <button key={p.id} className={`dd-item ${currentProposalId === p.id && !isConcept ? 'is-active' : ''}`}
                  onClick={() => { onSwitchProposal(p); onClose() }}>
            <Ic n={CATEGORY_ICONS[category] || 'zap'} s={15}/> {cat?.display_name || p.action_slug}
            {p.classifier_confidence != null && <span className="dd-kbd">{Math.round(p.classifier_confidence * 100)}%</span>}
          </button>
        )
      })}
      <div className="dd-sep"/>
      <div className="dd-label">Afhandelen zonder reply</div>
      <button className="dd-item" onClick={() => { onClose(); onApproveNext && onApproveNext() }}><Ic n="check-circle" s={15}/> Goedkeuren + volgende</button>
      <button className="dd-item" onClick={() => { onClose(); onArchive && onArchive() }}><Ic n="archive" s={15}/> Gereed — archiveer</button>
      <button className="dd-item" onClick={() => { onClose(); onMarkProcessed && onMarkProcessed() }}><Ic n="eye-off" s={15}/> Al verwerkt in Outlook</button>
      <button className="dd-item" onClick={() => { onClose(); onSnooze && onSnooze() }}><Ic n="hourglass" s={15}/> Uitstellen · 1 dag</button>
      <div className="dd-sep"/>
      <div className="dd-label">Meer</div>
      <button className="dd-item" onClick={() => { onClose(); onTimeline && onTimeline() }}><Ic n="history" s={15}/> Tijdlijn</button>
      {onSpelcheck && (
        <button className="dd-item" onClick={() => { onClose(); onSpelcheck() }}><Ic n="spell" s={15}/> Spelcheck</button>
      )}
      <button className="dd-item" onClick={() => { onClose(); onPin && onPin() }}><Ic n="pin" s={15}/> {isFlagged ? 'Pin verwijderen' : 'Pin op postvak'}</button>
      <button className="dd-item" onClick={() => { onClose(); onRag && onRag() }}><Ic n="cube" s={15}/> RAG-details</button>
      <div className="dd-sep"/>
      <button className="dd-item danger" onClick={() => { onClose(); onSpam && onSpam() }}><Ic n="shield-x" s={15}/> Markeer als spam</button>
      <button className="dd-item danger" onClick={() => { onClose(); onDelete && onDelete() }}><Ic n="trash" s={15}/> Verwijderen</button>
    </div>
  )
}
