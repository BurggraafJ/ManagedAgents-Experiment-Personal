import { Section, Stat, fmtDate } from './chrome'

// Toont hoe vaak het record als RAG-bron is opgehaald in andere bundles + de
// chunks die het zelf in de chunks-tabel heeft.
//
// 2026-05-12: Maestro-styling — tokens via var(--*), eigen-chunk-card en
// bundle-card mockup-conform met paper/border-soft/orange.
export default function OutgoingTab({ outgoing, recordType }) {
  if (!outgoing) {
    return (
      <div style={{
        padding: 24,
        textAlign: 'center',
        color: 'var(--neutral-500, #737373)',
      }}>Laden…</div>
    )
  }
  const ownChunks = outgoing.own_chunks || []
  const usedIn = outgoing.used_in_bundles || []

  return (
    <div>
      <div style={{
        marginBottom: 12,
        fontSize: 12.5,
        color: 'var(--neutral-500, #737373)',
        lineHeight: 1.5,
      }}>
        Hoe vaak wordt dit record (zijn chunks) opgehaald als bron in andere RAG-bundles?
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 8,
        marginBottom: 14,
        padding: '12px 14px',
        background: 'var(--paper-2, #fafaf8)',
        border: '1px solid var(--border-soft, #efece5)',
        borderRadius: 10,
      }}>
        <Stat label="Eigen chunks" value={outgoing.n_own_chunks || 0} sub="in chunks-tabel" />
        <Stat label="Bundle-uses" value={outgoing.n_uses || 0} sub="andere records" />
      </div>

      {ownChunks.length > 0 ? (
        <Section title="Eigen chunks van dit record">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ownChunks.map((c, i) => (
              <div key={i} style={{
                padding: '10px 12px',
                background: 'var(--paper, #fff)',
                border: '1px solid var(--border-soft, #efece5)',
                borderLeft: '3px solid var(--neutral-400, #a6a6a6)',
                borderRadius: 10,
              }}>
                <div style={{
                  fontSize: 11,
                  color: 'var(--neutral-500, #737373)',
                  marginBottom: 4,
                  fontFamily: 'var(--font-mono, "Geist", monospace)',
                }}>
                  {c.chunk_type} · <code style={{ fontSize: 10 }}>{c.chunk_id?.slice(0, 8)}…</code>
                  {c.created_at && <> · gechunkt {fmtDate(c.created_at)}</>}
                </div>
                <div style={{
                  fontSize: 12.5,
                  color: 'var(--neutral-700, #404040)',
                  lineHeight: 1.5,
                }}>{c.preview || '—'}</div>
              </div>
            ))}
          </div>
        </Section>
      ) : (
        <div style={{
          padding: '12px 14px',
          background: 'linear-gradient(180deg, #fffaf2, #fff5e8)',
          border: '1px solid #f0d4c5',
          borderRadius: 10,
          fontSize: 13,
          color: 'var(--orange-deep, #8b4628)',
          marginBottom: 12,
          lineHeight: 1.5,
        }}>
          {recordType === 'agent_proposal'
            ? <>Voorstellen worden niet zelf gechunkt — alleen mails, meetings en HubSpot-records komen in de chunks-tabel. Outgoing-usage is dus altijd 0 voor proposals.</>
            : <>Dit record heeft nog geen chunks in de chunks-tabel. Mogelijk is de chunker nog niet door deze mail heen, of is hij gefilterd.</>
          }
        </div>
      )}

      {usedIn.length > 0 ? (
        <Section title={`Gebruikt in ${usedIn.length} bundle(s)`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {usedIn.map((b, i) => (
              <div key={i} style={{
                padding: '10px 12px',
                background: 'var(--success-subtle, #eaf5ee)',
                border: '1px solid #d6ecdf',
                borderLeft: '3px solid #1d6b3a',
                borderRadius: 10,
                fontSize: 12.5,
              }}>
                <div style={{
                  fontWeight: 600,
                  color: '#1d6b3a',
                  marginBottom: 2,
                }}>
                  intent: {b.intent} {b.audience && <span style={{ opacity: 0.7 }}>· {b.audience}</span>}
                </div>
                <div style={{
                  color: 'var(--neutral-700, #404040)',
                  fontSize: 11.5,
                  fontFamily: 'var(--font-mono, "Geist", monospace)',
                }}>
                  trigger: {b.trigger_type || '?'}
                  {b.trigger_ref_id && <> ({b.trigger_ref_id.slice(0, 12)}…)</>}
                  {b.rag_built_at && <> · {fmtDate(b.rag_built_at)}</>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : ownChunks.length > 0 && (
        <div style={{
          padding: '12px 14px',
          background: 'var(--paper-3, #f5f4f0)',
          border: '1px solid var(--border-soft, #efece5)',
          borderRadius: 10,
          fontSize: 12.5,
          color: 'var(--neutral-500, #737373)',
          lineHeight: 1.5,
        }}>
          Nog niet opgehaald als RAG-bron in een andere bundle. Zal pas verschijnen wanneer een skill (auto-draft, daily-admin, etc.) dit record's chunks ophaalt voor context.
        </div>
      )}

      {outgoing.note && (
        <div style={{
          marginTop: 12,
          fontSize: 11,
          color: 'var(--neutral-500, #737373)',
          fontStyle: 'italic',
          fontFamily: 'var(--font-mono, "Geist", monospace)',
        }}>
          {outgoing.note}
        </div>
      )}
    </div>
  )
}
