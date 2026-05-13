import Modal from '../../../ui/Modal'
import RagHealthPanel from '../../../RagHealthPanel'

// RagHealthModal — opent het volledige RagHealthPanel in een modal
// (full mode, niet compact) wanneer Jelle in MaestroListHeader's
// 3-dots-menu op "RAG-gegevens" klikt.
//
// V8.5 (2026-05-13): voorheen rendete InboxPanel het compacte panel
// altijd zichtbaar boven de mail-list (later achter een toggle in V8.4).
// Jelle wil de gegevens nu in een modal-popup zodat het standaard niet
// aanwezig is en bij gebruik veel meer ruimte krijgt voor de wekelijkse
// breakdown.
//
// Hergebruikt de Maestro-modal styling (className="theme-maestro mcm-rag-modal")
// die ook RagDetailsModal gebruikt — dus paper/ink/orange tokens binnen
// portal-scope.

export default function RagHealthModal({ open, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="RAG-coverage · mail-drafts"
      size="lg"
      className="theme-maestro mcm-rag-modal"
    >
      <div style={{
        fontSize: 12.5,
        color: 'var(--neutral-500, #737373)',
        marginTop: -4,
        marginBottom: 14,
        lineHeight: 1.5,
      }}>
        Wekelijkse coverage-stats van auto-draft. Hoeveel % van de
        gegenereerde drafts kreeg RAG-context, welk % had Fireflies-laag,
        wat is de P95 build-tijd, etc. Aggregaten over de afgelopen 4 weken.
      </div>
      <RagHealthPanel recordType="autodraft_mail" weeks={4} />
    </Modal>
  )
}
