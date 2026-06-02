-- RAG v2 F.2 (F.5 MetaRAG) — view die mail_messages + mail_enrichment joint voor de chunker.
-- chunkMail leest de 5 enrichment-assen → MetaRAG-leader vooraan content (meegeembed) +
-- denormalisatie naar chunks.metadata (F.8-filterbaar). LEFT JOIN LATERAL (nieuwste enrichment-rij
-- per mail) zodat mails zonder enrichment gewoon blijven chunken.
CREATE OR REPLACE VIEW v_mail_chunk_source AS
SELECT
  m.id, m.subject, m.body_preview, m.body_text, m.body_html,
  m.from_email, m.from_name, m.folder_path, m.conversation_id, m.received_at,
  e.party_type,
  COALESCE(e.party_lifecycle_at_moment, e.party_lifecycle_now) AS party_lifecycle,
  e.topics, e.speech_act, e.sentiment, e.asks_response, e.urgency, e.cycle_stage_signal
FROM mail_messages m
LEFT JOIN LATERAL (
  SELECT me.party_type, me.party_lifecycle_at_moment, me.party_lifecycle_now,
         me.topics, me.speech_act, me.sentiment, me.asks_response, me.urgency, me.cycle_stage_signal
  FROM mail_enrichment me
  WHERE me.mail_id = m.id
  ORDER BY me.enriched_at DESC NULLS LAST
  LIMIT 1
) e ON true;
COMMENT ON VIEW v_mail_chunk_source IS 'RAG v2 F.2: mail + mail_enrichment (5 assen) bron voor chunker MetaRAG-prefix + chunks.metadata-denormalisatie.';
