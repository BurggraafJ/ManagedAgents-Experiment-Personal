-- =============================================================================
-- 06d WP1 — de kennisbank-chunk volgt de status van zijn artikel   (2026-09-07)
-- =============================================================================
-- RESEARCH.md §1.3 (Q3, kb-bleed). De embed-pijplijn is één richting:
--
--   kb_articles_fetch_dirty : status IN ('gevalideerd','gepubliceerd')
--                             AND (embedded_at IS NULL OR embedded_at < updated_at)
--   kb-article-embed v3     : per dirty artikel DELETE + INSERT van één chunk
--   trg_kb_article_embed_on_insert : AFTER INSERT, http-post bij validatie
--
-- Er is dus geen enkel pad dat de chunk wéghaalt als een artikel naar
-- gearchiveerd / verworpen / needs_review / concept gaat: `fetch_dirty` kent
-- alleen de "erheen"-richting en de enige trigger staat op INSERT. Gemeten: het
-- ene gearchiveerde artikel (status gewisseld 2026-06-11) hield zijn chunk tot
-- de 06f-α-reconcile van 2026-09-06 17:48 UTC hem als `kb_article_not_validated`
-- opruimde — bijna drie maanden waarin een ingetrokken artikel gewoon
-- vindbaar bleef. Het vangnet `rag_chunks_reconcile()` draait dagelijks 03:50
-- UTC, dus zonder deze trigger is de bleed maximaal 24 uur.
--
-- Deze migratie zet de "weg"-richting erbij, als trigger en niet als cron:
--
--   status ∉ {gevalideerd, gepubliceerd}  → chunk direct weg (zelfde WHERE als
--                                           de embedder: source + source_id)
--   status ∈ {…} terwijl OLD ∉ {…}        → embedded_at op NULL (het artikel is
--                                           dirty) + dezelfde http-post als de
--                                           insert-trigger, zodat concept →
--                                           gevalideerd niet tot vier uur op
--                                           `kb-article-embed-4h` wacht
--
-- Geen lus met de embedder (risico R4): `kb-article-embed` schrijft alleen
-- embedding / embedded_at / embedding_model terug (index.ts regel 106) en raakt
-- `status` nooit — en een trigger `AFTER UPDATE OF status` vuurt uitsluitend als
-- `status` in de SET-lijst staat. De twee takken zijn bovendien disjunct
-- (∉ versus ∈), en de embedder embedt per definitie alleen ∈. De reconcile
-- blijft staan als vangnet voor rijen die buiten een status-UPDATE om scheef
-- raken (directe chunk-inserts, restores).
--
-- `net.http_post` van pg_net schrijft in `net.http_request_queue` en is dus
-- transactioneel: in de rollback-test hieronder verdwijnt ook de wachtrij-rij.
--
-- Terugdraaien:
--   DROP TRIGGER IF EXISTS trg_kb_article_chunks_follow_status ON public.kb_articles;
--   DROP FUNCTION IF EXISTS public.kb_article_chunks_follow_status();
--
-- Rollback-test (patroon ACL-G7, uitgevoerd op prod vóór het commit-punt):
--   begin;
--     update kb_articles set status='gearchiveerd' where id = <een gevalideerd artikel>;
--     select count(*) from chunks where source='kb_article' and source_id = <id>::text;  -- 0
--   rollback;
-- =============================================================================

CREATE OR REPLACE FUNCTION public.kb_article_chunks_follow_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Zelfde tweetal als kb_articles_fetch_dirty en kb_article_trigger_embed.
  -- De status-CHECK op kb_articles kent zes waarden; de andere vier zijn
  -- allemaal "niet in de index".
  v_live constant text[] := ARRAY['gevalideerd','gepubliceerd'];
BEGIN
  IF NOT (NEW.status = ANY (v_live)) THEN
    -- Ingetrokken, afgekeurd, terug naar concept of in review: weg uit de index.
    -- Onvoorwaardelijk op NEW (niet op de overgang), zodat een chunk die om wat
    -- voor reden ook bij een niet-gevalideerd artikel staat bij de eerste
    -- status-UPDATE alsnog opruimt. Zonder chunk is dit een no-op.
    DELETE FROM public.chunks
     WHERE source = 'kb_article'
       AND source_id = NEW.id::text;

  ELSIF NOT (OLD.status = ANY (v_live)) THEN
    -- Terug (of voor het eerst) in de index. embedded_at op NULL maakt het
    -- artikel dirty voor kb_articles_fetch_dirty — nodig, want een artikel dat
    -- eerder gevalideerd was, heeft een embedded_at dat nieuwer kan zijn dan
    -- updated_at en zou anders door de embedder worden overgeslagen. Deze
    -- geneste UPDATE zet `status` niet en vuurt deze trigger dus niet opnieuw.
    UPDATE public.kb_articles
       SET embedded_at = NULL
     WHERE id = NEW.id
       AND embedded_at IS NOT NULL;

    PERFORM net.http_post(
      url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/kb-article-embed',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='skill:global:cron_secret'),
        'x-trigger-source','kb_article_status_to_live'
      ),
      body := '{}'::jsonb
    );
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.kb_article_chunks_follow_status() IS
  '06d WP1 (2026-09-07): houdt chunks.source=kb_article gelijk met kb_articles.status. Weg van gevalideerd/gepubliceerd = chunk direct weg; terug = embedded_at NULL + http-post naar kb-article-embed. rag_chunks_reconcile blijft het vangnet.';

DROP TRIGGER IF EXISTS trg_kb_article_chunks_follow_status ON public.kb_articles;
CREATE TRIGGER trg_kb_article_chunks_follow_status
  AFTER UPDATE OF status ON public.kb_articles
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.kb_article_chunks_follow_status();
