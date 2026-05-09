import { Section, Stat, fmtDate } from './chrome'

// Toont hoe vaak het record als RAG-bron is opgehaald in andere bundles + de
// chunks die het zelf in de chunks-tabel heeft.
export default function OutgoingTab({ outgoing, recordType }) {
  if (!outgoing) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Laden…</div>
  }
  const ownChunks = outgoing.own_chunks || []
  const usedIn = outgoing.used_in_bundles || []

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 12, color: '#6b7280' }}>
        Hoe vaak wordt dit record (zijn chunks) opgehaald als bron in andere RAG-bundles?
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8,
        marginBottom: 14, padding: '10px 12px',
        background: '#f9fafb', borderRadius: 8,
      }}>
        <Stat label="Eigen chunks" value={outgoing.n_own_chunks || 0} sub="in chunks-tabel" />
        <Stat label="Bundle-uses" value={outgoing.n_uses || 0} sub="andere records" />
      </div>

      {ownChunks.length > 0 ? (
        <Section title="Eigen chunks van dit record">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ownChunks.map((c, i) => (
              <div key={i} style={{
                padding: 8, background: '#fafafa', borderRadius: 6,
                borderLeft: '3px solid #6b7280',
              }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>
                  {c.chunk_type} · <code style={{ fontSize: 10 }}>{c.chunk_id?.slice(0, 8)}…</code>
                  {c.created_at && <> · gechunkt {fmtDate(c.created_at)}</>}
                </div>
                <div style={{ fontSize: 12, color: '#374151' }}>{c.preview || '—'}</div>
              </div>
            ))}
          </div>
        </Section>
      ) : (
        <div style={{ padding: 16, background: '#fef3c7', borderRadius: 6, fontSize: 13, color: '#92400e', marginBottom: 12 }}>
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
                padding: 8, background: '#dcfce7', borderRadius: 6,
                borderLeft: '3px solid #166534', fontSize: 12,
              }}>
                <div style={{ fontWeight: 700, color: '#166534', marginBottom: 2 }}>
                  intent: {b.intent} {b.audience && <span style={{ opacity: 0.7 }}>· {b.audience}</span>}
                </div>
                <div style={{ color: '#374151', fontSize: 11 }}>
                  trigger: {b.trigger_type || '?'}
                  {b.trigger_ref_id && <> ({b.trigger_ref_id.slice(0, 12)}…)</>}
                  {b.rag_built_at && <> · {fmtDate(b.rag_built_at)}</>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : ownChunks.length > 0 && (
        <div style={{ padding: 12, background: '#f3f4f6', borderRadius: 6, fontSize: 12, color: '#6b7280' }}>
          Nog niet opgehaald als RAG-bron in een andere bundle. Zal pas verschijnen wanneer een skill (auto-draft, daily-admin, etc.) dit record's chunks ophaalt voor context.
        </div>
      )}

      {outgoing.note && (
        <div style={{ marginTop: 12, fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
          {outgoing.note}
        </div>
      )}
    </div>
  )
}
