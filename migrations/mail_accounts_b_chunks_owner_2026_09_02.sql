-- =============================================================================
-- Migratie B — chunks.owner_user_id + owner-filter in retrieval + RLS
-- Per-user Outlook, fase 1 · MAIL-PIPELINE.md §3.6 punt 1 (blokkade B6)
-- =============================================================================
-- Waarom dit de enige NIET-uitstelbare blokkade is:
--   `chunks` had geen eigenaar. RLS was `chunks_authenticated_read =
--   is_admin_or_higher()` en `match_chunks` / `match_chunks_for_entity` /
--   `v_mail_chunk_source` filterden nergens op user. Zodra mailbox #2 gechunkt
--   wordt, kan de mailinhoud van mailbox #2 in het rag-chat-antwoord van
--   mailbox #1 opduiken. De andere blokkades degraderen data; deze lekt inhoud.
--
-- Model:
--   owner_user_id IS NULL  = org/gedeeld corpus (hubspot, jira, deals, meetings,
--                            events, lessons, kb_article, action)
--   owner_user_id = <uuid> = privé corpus van die app-user (source='mail')
--
-- Default-scope zonder expliciete caller-identiteit (`p_owner_user_id IS NULL`):
--   • registry leeg  → géén owner-restrictie. Dat is het één-mailbox-tijdperk
--     en exact het gedrag van vóór deze migratie.
--   • registry gevuld → gedeeld + de mailbox(en) met scope='org'.
--   Zo blijven de org-agents (daily-admin, auto-draft, jellemind, draft-style,
--   churn-analytics, klantbase, meeting-briefing) Jelle's mail zien, terwijl een
--   nieuwe scope='personal'-mailbox er standaard buiten valt. Wie de mailbox van
--   een user wél wil, geeft `p_owner_user_id` mee en krijgt gedeeld + die user.
--
-- Wat NIET verandert: alle scores, RRF-gewichten, recency-formules en LIMIT's
-- van match_chunks blijven byte-identiek. Er komt precies één WHERE-conditie bij
-- (in beide CTE's) en één parameter aan het eind.
--
-- Idempotent: add column if not exists, drop function if exists (oude signatuur)
-- + create or replace (nieuwe signatuur), drop policy if exists.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. De eigenaarskolom
-- -----------------------------------------------------------------------------
alter table public.chunks
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

comment on column public.chunks.owner_user_id is
  'NULL = org/gedeeld corpus (zichtbaar voor iedereen die chunks mag lezen). '
  'Gevuld = privé corpus van die app-user; nu alleen source=''mail''. '
  'Gezet door de chunker uit v_mail_chunk_source.user_id.';

-- Partieel: alleen privé-chunks staan erin, dus de index blijft klein.
create index if not exists idx_chunks_owner_user
  on public.chunks (owner_user_id, source)
  where owner_user_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Backfill van de bestaande mail-chunks uit mail_messages.user_id
--    trg_chunks_fts vuurt op UPDATE OF content, content_with_context — deze
--    UPDATE raakt die kolommen niet, dus geen herberekening van fts_vector.
-- -----------------------------------------------------------------------------
update public.chunks c
   set owner_user_id = m.user_id
  from public.mail_messages m
 where c.source = 'mail'
   and c.source_id = m.id
   and c.owner_user_id is distinct from m.user_id;

-- -----------------------------------------------------------------------------
-- 3. v_mail_chunk_source geeft user_id door, zodat de chunker de eigenaar kent.
--    Kolom achteraan toegevoegd (create or replace view eist dat de bestaande
--    kolommen op positie/naam/type gelijk blijven).
-- -----------------------------------------------------------------------------
create or replace view public.v_mail_chunk_source
with (security_invoker = on) as
 SELECT m.id,
    m.subject,
    m.body_preview,
    m.body_text,
    m.body_html,
    m.from_email,
    m.from_name,
    m.folder_path,
    m.conversation_id,
    m.received_at,
    e.party_type,
    COALESCE(e.party_lifecycle_at_moment, e.party_lifecycle_now) AS party_lifecycle,
    e.topics,
    e.speech_act,
    e.sentiment,
    e.asks_response,
    e.urgency,
    e.cycle_stage_signal,
    m.user_id
   FROM mail_messages m
     LEFT JOIN LATERAL ( SELECT me.party_type,
            me.party_lifecycle_at_moment,
            me.party_lifecycle_now,
            me.topics,
            me.speech_act,
            me.sentiment,
            me.asks_response,
            me.urgency,
            me.cycle_stage_signal
           FROM mail_enrichment me
          WHERE me.mail_id = m.id
          ORDER BY me.enriched_at DESC NULLS LAST
         LIMIT 1) e ON true;

-- -----------------------------------------------------------------------------
-- 4. De scope-helper. Eén plek waar "welke owners mag deze retrieval zien"
--    staat, zodat match_chunks / match_chunks_for_entity / find_similar_sent_mails
--    niet elk hun eigen interpretatie krijgen.
--    NULL-return = geen restrictie.
-- -----------------------------------------------------------------------------
create or replace function public.rag_owner_scope_ids(p_owner_user_id uuid default null)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  SELECT CASE
    -- Expliciete caller: gedeeld + eigen corpus.
    WHEN p_owner_user_id IS NOT NULL THEN ARRAY[p_owner_user_id]
    -- Nog geen registry = één-mailbox-tijdperk: geen restrictie (gedrag van vandaag).
    WHEN NOT EXISTS (SELECT 1 FROM public.mail_accounts) THEN NULL::uuid[]
    -- Registry bestaat: default-scope is gedeeld + de org-mailbox(en).
    ELSE COALESCE(
      (SELECT array_agg(a.user_id) FROM public.mail_accounts a WHERE a.scope = 'org'),
      ARRAY[]::uuid[]
    )
  END;
$function$;

comment on function public.rag_owner_scope_ids(uuid) is
  'Owner-scope voor RAG-retrieval. NULL-return = geen owner-restrictie (registry leeg). '
  'Zonder p_owner_user_id: alleen de org-mailbox(en). Filter erboven is altijd '
  '(owner_user_id IS NULL OR owner_user_id = ANY(scope)).';

revoke all on function public.rag_owner_scope_ids(uuid) from public;
grant execute on function public.rag_owner_scope_ids(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. match_chunks — owner-filter erbij.
--    DROP + CREATE (niet OR REPLACE): een extra parameter maakt anders een
--    tweede overload, en dan kan PostgREST niet meer kiezen ("Could not choose
--    the best candidate function"). Alle callers gebruiken named args, dus na
--    drop+create resolven ze ongewijzigd.
-- -----------------------------------------------------------------------------
drop function if exists public.match_chunks(
  halfvec, text, integer, text[], timestamptz, text, double precision,
  double precision, double precision, text[], text[], text[], text[], boolean
);

create or replace function public.match_chunks(
  query_embedding halfvec,
  query_text text default null::text,
  top_k integer default 5,
  filter_sources text[] default null::text[],
  filter_after timestamp with time zone default null::timestamp with time zone,
  filter_entity_id text default null::text,
  min_similarity double precision default 0.3,
  recency_weight double precision default 0.15,
  recency_decay_days double precision default 90.0,
  filter_audience text[] default null::text[],
  filter_meeting_category text[] default null::text[],
  filter_party_type text[] default null::text[],
  filter_sentiment text[] default null::text[],
  filter_asks_response boolean default null::boolean,
  p_owner_user_id uuid default null::uuid
)
returns table(
  out_chunk_id uuid, out_source text, out_source_id text, out_chunk_type text,
  out_content text, out_content_with_context text,
  out_occurred_at timestamp with time zone, out_entity_ids text[], out_metadata jsonb,
  out_vector_score double precision, out_bm25_score double precision,
  out_recency_score double precision, out_combined_score double precision
)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  WITH tsq AS (
    SELECT to_tsquery('dutch', NULLIF(regexp_replace(plainto_tsquery('dutch', CASE WHEN length(query_text) > 500 THEN NULL ELSE query_text END)::text, ' & ', ' | ', 'g'), '')) AS q
  ),
  -- Eén keer geëvalueerd (uncorrelated InitPlan), niet per rij.
  owner_scope AS (
    SELECT public.rag_owner_scope_ids(p_owner_user_id) AS ids
  ),
  vector_hits AS (
    SELECT c.chunk_id, row_number() OVER (ORDER BY c.embedding <=> query_embedding) AS rk
    FROM chunks c
    WHERE c.embedding IS NOT NULL
      AND ((SELECT ids FROM owner_scope) IS NULL OR c.owner_user_id IS NULL OR c.owner_user_id = ANY(coalesce((SELECT ids FROM owner_scope), ARRAY[]::uuid[])))
      AND (filter_sources IS NULL OR c.source = ANY(filter_sources))
      AND (filter_sources IS NOT NULL OR c.source <> 'action')
      AND (filter_after IS NULL OR c.occurred_at >= filter_after)
      AND (filter_entity_id IS NULL OR filter_entity_id = ANY(c.entity_ids) OR c.primary_entity_id = filter_entity_id)
      AND (filter_audience IS NULL OR c.source != 'meeting' OR (c.metadata->>'audience') = ANY(filter_audience))
      AND (filter_meeting_category IS NULL OR c.source != 'meeting' OR (c.metadata->>'meeting_category') = ANY(filter_meeting_category))
      AND (filter_party_type IS NULL OR c.source <> 'mail' OR (c.metadata->>'party_type') = ANY(filter_party_type))
      AND (filter_sentiment IS NULL OR c.source <> 'mail' OR (c.metadata->>'sentiment') = ANY(filter_sentiment))
      AND (filter_asks_response IS NULL OR c.source <> 'mail' OR (c.metadata->>'asks_response') = CASE WHEN filter_asks_response THEN 'true' ELSE 'false' END)
    ORDER BY c.embedding <=> query_embedding
    LIMIT (top_k * 10)
  ),
  bm25_hits AS (
    SELECT c.chunk_id, row_number() OVER (ORDER BY ts_rank_cd(c.fts_vector, (SELECT q FROM tsq)) DESC) AS rk
    FROM chunks c
    WHERE query_text IS NOT NULL AND length(query_text) > 1
      AND (SELECT q FROM tsq) IS NOT NULL AND c.fts_vector @@ (SELECT q FROM tsq)
      AND ((SELECT ids FROM owner_scope) IS NULL OR c.owner_user_id IS NULL OR c.owner_user_id = ANY(coalesce((SELECT ids FROM owner_scope), ARRAY[]::uuid[])))
      AND (filter_sources IS NULL OR c.source = ANY(filter_sources))
      AND (filter_sources IS NOT NULL OR c.source <> 'action')
      AND (filter_after IS NULL OR c.occurred_at >= filter_after)
      AND (filter_entity_id IS NULL OR filter_entity_id = ANY(c.entity_ids) OR c.primary_entity_id = filter_entity_id)
      AND (filter_audience IS NULL OR c.source != 'meeting' OR (c.metadata->>'audience') = ANY(filter_audience))
      AND (filter_meeting_category IS NULL OR c.source != 'meeting' OR (c.metadata->>'meeting_category') = ANY(filter_meeting_category))
      AND (filter_party_type IS NULL OR c.source <> 'mail' OR (c.metadata->>'party_type') = ANY(filter_party_type))
      AND (filter_sentiment IS NULL OR c.source <> 'mail' OR (c.metadata->>'sentiment') = ANY(filter_sentiment))
      AND (filter_asks_response IS NULL OR c.source <> 'mail' OR (c.metadata->>'asks_response') = CASE WHEN filter_asks_response THEN 'true' ELSE 'false' END)
    ORDER BY ts_rank_cd(c.fts_vector, (SELECT q FROM tsq)) DESC
    LIMIT (top_k * 10)
  ),
  candidates AS (
    SELECT chunk_id, rk AS vec_rk, NULL::bigint AS bm_rk FROM vector_hits
    UNION ALL SELECT chunk_id, NULL::bigint AS vec_rk, rk AS bm_rk FROM bm25_hits
  ),
  fused_ranks AS (SELECT chunk_id, min(vec_rk) AS vec_rk, min(bm_rk) AS bm_rk FROM candidates GROUP BY chunk_id),
  enriched AS (
    SELECT c.chunk_id, c.source, c.source_id, c.chunk_type, c.content, c.content_with_context, c.occurred_at, c.entity_ids, c.metadata,
           (1 - (c.embedding <=> query_embedding))::double precision AS vector_score,
           CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND c.fts_vector @@ (SELECT q FROM tsq) THEN ts_rank_cd(c.fts_vector, (SELECT q FROM tsq))::double precision ELSE 0::double precision END AS bm25_raw,
           f.vec_rk, f.bm_rk,
           ((1.0 / (60.0 + coalesce(f.vec_rk, 9999::bigint))) + (1.0 / (60.0 + coalesce(f.bm_rk, 9999::bigint))))::double precision AS rrf_score
    FROM fused_ranks f JOIN chunks c ON c.chunk_id = f.chunk_id
  ),
  filtered AS (SELECT * FROM enriched WHERE vector_score >= min_similarity OR bm25_raw > 0),
  scored AS (SELECT f.*, greatest(max(f.bm25_raw) OVER (), 0.05) AS bm25_norm_div FROM filtered f)
  SELECT s.chunk_id, s.source, s.source_id, s.chunk_type, s.content, s.content_with_context, s.occurred_at, s.entity_ids, s.metadata,
         s.vector_score,
         CASE WHEN s.bm25_raw = 0 THEN 0 ELSE least(s.bm25_raw / s.bm25_norm_div, 1.0) END::double precision AS bm25_score,
         least(exp(-(extract(epoch from (now() - s.occurred_at)) / 86400.0) / recency_decay_days), 1.0)::double precision AS recency_score,
         ((1 - recency_weight) * s.rrf_score + recency_weight * least(exp(-(extract(epoch from (now() - s.occurred_at)) / 86400.0) / recency_decay_days), 1.0))::double precision AS combined_score
  FROM scored s ORDER BY combined_score DESC LIMIT top_k;
$function$;

revoke all on function public.match_chunks(
  halfvec, text, integer, text[], timestamptz, text, double precision,
  double precision, double precision, text[], text[], text[], text[], boolean, uuid
) from public;
grant execute on function public.match_chunks(
  halfvec, text, integer, text[], timestamptz, text, double precision,
  double precision, double precision, text[], text[], text[], text[], boolean, uuid
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. match_chunks_for_entity — de 15-arg variant (die context-build gebruikt)
--    krijgt p_owner_user_id; de legacy 13-arg variant krijgt de default-scope
--    zonder signatuurwijziging (hij heeft geen caller die een user meegeeft).
-- -----------------------------------------------------------------------------
drop function if exists public.match_chunks_for_entity(
  text, text, halfvec, text, integer, integer, text[], timestamptz,
  double precision, double precision, double precision, integer, integer, text[], text[]
);

create or replace function public.match_chunks_for_entity(
  p_entity_type text,
  p_entity_id text,
  p_query_embedding halfvec,
  p_query_text text default null::text,
  p_top_k integer default 5,
  p_hop_depth integer default 1,
  p_filter_sources text[] default null::text[],
  p_filter_after timestamp with time zone default null::timestamp with time zone,
  p_min_similarity double precision default 0.3,
  p_recency_weight double precision default 0.15,
  p_recency_decay_days double precision default 90.0,
  p_max_edges integer default 300,
  p_max_per_source integer default 3,
  p_filter_audience text[] default null::text[],
  p_filter_meeting_category text[] default null::text[],
  p_owner_user_id uuid default null::uuid
)
returns table(
  out_chunk_id uuid, out_source text, out_source_id text, out_chunk_type text,
  out_content text, out_content_with_context text,
  out_occurred_at timestamp with time zone, out_entity_path jsonb, out_metadata jsonb,
  out_vector_score double precision, out_bm25_score double precision,
  out_recency_score double precision, out_combined_score double precision
)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  WITH tsq AS (
    SELECT to_tsquery('dutch',
      NULLIF(regexp_replace(plainto_tsquery('dutch', CASE WHEN length(p_query_text) > 500 THEN NULL ELSE p_query_text END)::text, ' & ', ' | ', 'g'), '')
    ) AS q
  ),
  owner_scope AS (
    SELECT public.rag_owner_scope_ids(p_owner_user_id) AS ids
  ),
  expanded_forward AS (
    SELECT e.dst_type AS type, e.dst_id AS id, e.edge_type AS via_edge, e.confidence
      FROM v_entity_edges_full e
     WHERE e.src_type = p_entity_type AND e.src_id = p_entity_id
     ORDER BY e.confidence DESC NULLS LAST, e.edge_type DESC
     LIMIT p_max_edges
  ),
  expanded_backward AS (
    SELECT e.src_type AS type, e.src_id AS id, e.edge_type AS via_edge, e.confidence
      FROM v_entity_edges_full e
     WHERE e.dst_type = p_entity_type AND e.dst_id = p_entity_id
     ORDER BY e.confidence DESC NULLS LAST, e.edge_type DESC
     LIMIT p_max_edges
  ),
  expanded AS (
    SELECT p_entity_type AS type, p_entity_id AS id, 'self'::text AS via_edge, 1.0::numeric AS confidence
    UNION ALL SELECT * FROM expanded_forward
    UNION ALL SELECT * FROM expanded_backward
  ),
  candidate_chunks AS (
    SELECT DISTINCT ON (c.chunk_id)
           c.chunk_id, c.source, c.source_id, c.chunk_type,
           c.content, c.content_with_context,
           c.occurred_at, c.metadata, c.embedding, c.fts_vector,
           jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id, 'via_edge', e.via_edge, 'confidence', e.confidence) AS entity_path
      FROM chunks c
      JOIN expanded e ON e.type = c.source AND e.id = c.source_id
     WHERE c.embedding IS NOT NULL
       AND ((SELECT ids FROM owner_scope) IS NULL OR c.owner_user_id IS NULL OR c.owner_user_id = ANY(coalesce((SELECT ids FROM owner_scope), ARRAY[]::uuid[])))
       AND (p_filter_sources IS NULL OR c.source = ANY(p_filter_sources))
       AND (p_filter_after IS NULL OR c.occurred_at >= p_filter_after)
       AND (p_filter_audience IS NULL
            OR c.source != 'meeting'
            OR (c.metadata->>'audience') = ANY(p_filter_audience))
       AND (p_filter_meeting_category IS NULL
            OR c.source != 'meeting'
            OR (c.metadata->>'meeting_category') = ANY(p_filter_meeting_category))
  ),
  vector_hits AS (
    SELECT chunk_id, row_number() OVER (ORDER BY embedding <=> p_query_embedding) AS rk
      FROM candidate_chunks
     ORDER BY embedding <=> p_query_embedding
     LIMIT (p_top_k * 10)
  ),
  bm25_hits AS (
    SELECT chunk_id, row_number() OVER (ORDER BY ts_rank_cd(fts_vector, (SELECT q FROM tsq)) DESC) AS rk
      FROM candidate_chunks
     WHERE p_query_text IS NOT NULL AND length(p_query_text) > 1
       AND (SELECT q FROM tsq) IS NOT NULL
       AND fts_vector @@ (SELECT q FROM tsq)
     ORDER BY ts_rank_cd(fts_vector, (SELECT q FROM tsq)) DESC
     LIMIT (p_top_k * 10)
  ),
  candidates AS (
    SELECT chunk_id, rk AS vec_rk, NULL::bigint AS bm_rk FROM vector_hits
    UNION ALL
    SELECT chunk_id, NULL::bigint AS vec_rk, rk AS bm_rk FROM bm25_hits
  ),
  fused_ranks AS (
    SELECT chunk_id, min(vec_rk) AS vec_rk, min(bm_rk) AS bm_rk FROM candidates GROUP BY chunk_id
  ),
  enriched AS (
    SELECT cc.chunk_id, cc.source, cc.source_id, cc.chunk_type,
           cc.content, cc.content_with_context, cc.occurred_at, cc.entity_path, cc.metadata,
           (1 - (cc.embedding <=> p_query_embedding))::double precision AS vector_score,
           CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND cc.fts_vector @@ (SELECT q FROM tsq)
                THEN ts_rank_cd(cc.fts_vector, (SELECT q FROM tsq))::double precision
                ELSE 0::double precision END AS bm25_raw,
           f.vec_rk, f.bm_rk,
           ((1.0 / (60.0 + coalesce(f.vec_rk, 9999::bigint)))
          + (1.0 / (60.0 + coalesce(f.bm_rk, 9999::bigint))))::double precision AS rrf_score
      FROM fused_ranks f
      JOIN candidate_chunks cc ON cc.chunk_id = f.chunk_id
  ),
  filtered AS (
    SELECT * FROM enriched WHERE vector_score >= p_min_similarity OR bm25_raw > 0
  ),
  scored AS (
    SELECT f.*, greatest(max(f.bm25_raw) OVER (), 0.05) AS bm25_norm_div,
           least(exp(-(extract(epoch from (now() - f.occurred_at)) / 86400.0) / p_recency_decay_days), 1.0)::double precision AS recency_score
      FROM filtered f
  ),
  with_combined AS (
    SELECT s.*,
           CASE WHEN s.bm25_raw = 0 THEN 0 ELSE least(s.bm25_raw / s.bm25_norm_div, 1.0) END::double precision AS bm25_score,
           ((1 - p_recency_weight) * s.rrf_score + p_recency_weight * s.recency_score)::double precision AS combined_score
      FROM scored s
  ),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY source ORDER BY combined_score DESC) AS rn_per_source
      FROM with_combined
  )
  SELECT chunk_id, source, source_id, chunk_type, content, content_with_context,
         occurred_at, entity_path, metadata, vector_score, bm25_score, recency_score, combined_score
    FROM ranked
   WHERE rn_per_source <= p_max_per_source
   ORDER BY combined_score DESC
   LIMIT p_top_k;
$function$;

revoke all on function public.match_chunks_for_entity(
  text, text, halfvec, text, integer, integer, text[], timestamptz,
  double precision, double precision, double precision, integer, integer, text[], text[], uuid
) from public;
grant execute on function public.match_chunks_for_entity(
  text, text, halfvec, text, integer, integer, text[], timestamptz,
  double precision, double precision, double precision, integer, integer, text[], text[], uuid
) to authenticated, service_role;

-- Legacy 13-arg overload: zelfde signatuur, alleen de owner-conditie erbij op
-- de default-scope. Geen caller in de repo geeft hier een user aan mee.
create or replace function public.match_chunks_for_entity(
  p_entity_type text,
  p_entity_id text,
  p_query_embedding halfvec,
  p_query_text text default null::text,
  p_top_k integer default 5,
  p_hop_depth integer default 1,
  p_filter_sources text[] default null::text[],
  p_filter_after timestamp with time zone default null::timestamp with time zone,
  p_min_similarity double precision default 0.3,
  p_recency_weight double precision default 0.15,
  p_recency_decay_days double precision default 90.0,
  p_max_edges integer default 300,
  p_max_per_source integer default 3
)
returns table(
  out_chunk_id uuid, out_source text, out_source_id text, out_chunk_type text,
  out_content text, out_content_with_context text,
  out_occurred_at timestamp with time zone, out_entity_path jsonb, out_metadata jsonb,
  out_vector_score double precision, out_bm25_score double precision,
  out_recency_score double precision, out_combined_score double precision
)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  SELECT * FROM public.match_chunks_for_entity(
    p_entity_type, p_entity_id, p_query_embedding, p_query_text, p_top_k, p_hop_depth,
    p_filter_sources, p_filter_after, p_min_similarity, p_recency_weight,
    p_recency_decay_days, p_max_edges, p_max_per_source, NULL::text[], NULL::text[], NULL::uuid
  );
$function$;

revoke all on function public.match_chunks_for_entity(
  text, text, halfvec, text, integer, integer, text[], timestamptz,
  double precision, double precision, double precision, integer, integer
) from public;
grant execute on function public.match_chunks_for_entity(
  text, text, halfvec, text, integer, integer, text[], timestamptz,
  double precision, double precision, double precision, integer, integer
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. find_similar_sent_mails — de stijl-retrieval over Sent Items. SECURITY
--    DEFINER en zonder user-filter: met mailbox #2 zou het stijlprofiel van
--    Jelle voorbeelden uit een andere mailbox krijgen.
-- -----------------------------------------------------------------------------
drop function if exists public.find_similar_sent_mails(halfvec, integer);

create or replace function public.find_similar_sent_mails(
  p_query_embedding halfvec,
  p_top_k integer default 5,
  p_user_id uuid default null::uuid
)
returns table(
  subject text, body_text text, received_at timestamp with time zone, similarity double precision
)
language sql
security definer
set search_path to 'public', 'extensions'
as $function$
  SELECT
    m.subject,
    coalesce(m.body_text, m.body_preview) AS body_text,
    m.received_at,
    1 - (c.embedding <=> p_query_embedding)::float AS similarity
  FROM public.chunks c
  JOIN public.mail_messages m ON m.id = c.source_id
  WHERE c.source = 'mail'
    AND m.is_from_me = true
    AND coalesce(m.body_text, m.body_preview, '') <> ''
    AND c.embedding IS NOT NULL
    AND (public.rag_owner_scope_ids(p_user_id) IS NULL
         OR m.user_id = ANY(public.rag_owner_scope_ids(p_user_id)))
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT greatest(1, least(coalesce(p_top_k, 5), 10));
$function$;

revoke all on function public.find_similar_sent_mails(halfvec, integer, uuid) from public;
grant execute on function public.find_similar_sent_mails(halfvec, integer, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. RLS op chunks — admin blijft nodig (niet verruimen!), maar een admin mag
--    niet meer de mail-chunks van een ándere user lezen.
--    Vandaag: alle chunks zijn NULL of van Jelle, en Jelle is admin → geen
--    zichtbaar verschil. Bij user #2 sluit dit de wederzijdse inzage.
-- -----------------------------------------------------------------------------
drop policy if exists chunks_authenticated_read on public.chunks;
create policy chunks_authenticated_read
  on public.chunks for select to authenticated
  using (
    (select public.is_admin_or_higher())
    and (owner_user_id is null or owner_user_id = (select auth.uid()))
  );

commit;

-- PostgREST moet de nieuwe signatuur van match_chunks / match_chunks_for_entity /
-- find_similar_sent_mails kennen; de DDL-event-trigger doet dit normaal zelf,
-- deze NOTIFY is de gordel bij de bretels.
notify pgrst, 'reload schema';

-- =============================================================================
-- Verificatie (los uitvoeren):
--   select owner_user_id is null as shared, source, count(*)
--     from public.chunks group by 1,2 order by 2,1;
--   select public.rag_owner_scope_ids(null);
--   select count(*) from public.match_chunks(
--     (select embedding from public.chunks where embedding is not null limit 1),
--     'test', 5);
-- =============================================================================
