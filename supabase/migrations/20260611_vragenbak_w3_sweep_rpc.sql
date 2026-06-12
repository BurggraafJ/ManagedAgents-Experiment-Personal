-- =============================================================================
-- Vragenbak in de breedte — W3: Motor B groeps-sweep evidence-RPC
-- =============================================================================
-- 2026-06-11. Project Confluence 471302146. Eén RPC levert kandidaten × snippets
-- voor de map-reduce sweep in rag-chat: enrichment-voorfilter (topics op
-- chunks.metadata, 5-assig live op ~13k mail-chunks) + content-keyword-regex,
-- binnen een party_type-scope. Freemail-afzenders worden per e-mailadres
-- gegroepeerd (gmail bevat zowel prospects als vendors), bedrijfsdomeinen per
-- domein. EXPLAIN ANALYZE zwaarste vorm: ~1,8s (regex over 13k chunks) — ruim
-- onder de 8s. De regex wordt edge-side opgebouwd uit gesaneerde woorden.
-- Toegang: alleen service_role (rag-chat edge).
-- =============================================================================

CREATE OR REPLACE FUNCTION analytics_sweep_evidence(
  p_topics text[] DEFAULT NULL,
  p_keywords_regex text DEFAULT NULL,
  p_scope text DEFAULT 'sales',
  p_max_candidates int DEFAULT 60,
  p_snippets_per int DEFAULT 4
)
RETURNS TABLE (
  sender_key text, company_name text, n_signals bigint, last_signal_at timestamptz,
  snippet_rank int, occurred_at timestamptz, mail_id text, snippet text,
  population int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH params AS (
    SELECT LEAST(GREATEST(coalesce(p_max_candidates, 60), 1), 80) AS max_cand,
           LEAST(GREATEST(coalesce(p_snippets_per, 4), 1), 5) AS per_cand,
           CASE coalesce(p_scope, 'sales')
             WHEN 'customers' THEN ARRAY['customer','pilot']
             WHEN 'external'  THEN ARRAY['customer','pilot','sales_lead','sales_opvolging','onbekend','partner','vendor','press','recruitment']
             ELSE ARRAY['customer','pilot','sales_lead','sales_opvolging','onbekend']
           END AS party_types
  ), freemail AS (
    SELECT ARRAY['gmail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','me.com','live.com','live.nl','protonmail.com','proton.me','ziggo.nl','kpn.nl','xs4all.nl','planet.nl','telfort.nl','online.nl','home.nl','quicknet.nl'] AS domains
  ), scope_chunks AS (
    SELECT
      CASE WHEN split_part(lower(c.metadata->>'from_email'),'@',2) = ANY(freemail.domains)
           THEN lower(c.metadata->>'from_email')
           ELSE split_part(lower(c.metadata->>'from_email'),'@',2) END AS sender_key,
      split_part(lower(c.metadata->>'from_email'),'@',2) AS dom,
      c.occurred_at, c.source_id, c.content,
      (coalesce(p_topics, '{}') <> '{}' AND c.metadata->'topics' ?| p_topics)
        OR (coalesce(p_keywords_regex,'') <> '' AND c.content ~* p_keywords_regex) AS is_signal
    FROM chunks c, params, freemail
    WHERE c.source = 'mail'
      AND c.metadata->>'party_type' = ANY(params.party_types)
      AND split_part(lower(c.metadata->>'from_email'),'@',2) NOT IN ('legal-mind.nl','test.nl','test1.nl')
      AND c.metadata->>'from_email' IS NOT NULL
  ), pop AS (
    SELECT count(DISTINCT sender_key)::int AS population FROM scope_chunks
  ), cand AS (
    SELECT sender_key, max(dom) AS dom, count(*) AS n_signals, max(occurred_at) AS last_signal_at
    FROM scope_chunks WHERE is_signal
    GROUP BY sender_key
    ORDER BY n_signals DESC, last_signal_at DESC
    LIMIT (SELECT max_cand FROM params)
  ), snip AS (
    SELECT s.sender_key, s.occurred_at, s.source_id,
           left(regexp_replace(s.content, '\s+', ' ', 'g'), 600) AS snippet,
           row_number() OVER (PARTITION BY s.sender_key ORDER BY s.occurred_at DESC) AS rnk
    FROM scope_chunks s
    JOIN cand ON cand.sender_key = s.sender_key
    WHERE s.is_signal
  )
  SELECT cand.sender_key,
         hc.name AS company_name,
         cand.n_signals, cand.last_signal_at,
         snip.rnk::int AS snippet_rank, snip.occurred_at, snip.source_id AS mail_id, snip.snippet,
         (SELECT population FROM pop)
  FROM cand
  JOIN snip ON snip.sender_key = cand.sender_key AND snip.rnk <= (SELECT per_cand FROM params)
  LEFT JOIN LATERAL (
    SELECT name FROM hubspot_companies c2
    WHERE lower(c2.domain) = cand.dom AND c2.is_archived = false
    ORDER BY c2.hs_lastmodifieddate DESC NULLS LAST LIMIT 1
  ) hc ON true
  ORDER BY cand.n_signals DESC, cand.sender_key, snip.rnk;
$$;

REVOKE ALL ON FUNCTION analytics_sweep_evidence(text[], text, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION analytics_sweep_evidence(text[], text, text, int, int) TO service_role;
