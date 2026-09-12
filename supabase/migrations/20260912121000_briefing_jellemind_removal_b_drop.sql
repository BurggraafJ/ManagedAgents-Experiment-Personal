-- =============================================================================
-- Briefing + JelleMind removal — deel B: DROP (onomkeerbaar)
-- =============================================================================
-- HOORT NIET TE DRAAIEN VOORDAT:
--   1. deel A (20260912120000) op hetzelfde project geslaagd is;
--   2. de backup hieronder gemaakt is;
--   3. de app-PR van deze branch gemerged en gedeployd is — de oude bundle
--      leest `jellemind_lesson_proposals` nog in useAdminCounts, en Vercel
--      serveert die bundle tot de nieuwe deploy live is.
--
-- Backup eerst (precedent: /workspace/security/km-backup.sql bij v1.135):
--
--   pg_dump "$DB_URL" \
--     --data-only --column-inserts \
--     -t public.jellemind_lessons \
--     -t public.jellemind_lesson_proposals \
--     -t public.jellemind_signals \
--     -t public.meeting_briefings \
--     -t public.meeting_briefing_config \
--     > /workspace/security/briefing-jellemind-backup.sql
--
-- Zonder shell-toegang: per tabel een
--   SELECT json_agg(t) FROM public.<tabel> t;
-- en het resultaat in dat bestand plakken. Doe het, ook als de tabellen leeg
-- lijken — `select count(*)` is in dit project geen bewijs dat er niets in zit
-- dat iemand later mist.
--
-- Volgorde: RPC's eerst, dan tabellen. Andersom laat een SECURITY DEFINER-
-- functie achter die naar een verdwenen tabel wijst; die faalt pas bij aanroep
-- en dus stil.
--
-- WAT HIER BEWUST NIET IN STAAT:
--   * get_inbox_briefing + de AutoDraft v3 "proactive briefing" — ander product,
--     blijft draaien (InboxBriefingCard in de app).
--   * accept_autodraft_lesson_proposal / reject_autodraft_lesson_proposal —
--     dat is AutoDraft's eigen lessen-laag, niet JelleMind. Naam lijkt, bron
--     verschilt.
--   * context_intents.inject_jellemind c.s. — kolommen blijven; context-build
--     leest ze voor retrieval_meta. Deel A heeft de waarden al uitgezet.
--   * chunks.source = 'lesson' — die zijn in deel A al weg.
--
-- Idempotent: alles IF EXISTS, mag twee keer draaien.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RPC's.
--    Volledige signaturen, overgenomen uit de bronmigraties
--    (rag_rpcs_documentation_2026_05_03.sql en
--    security_hardening_c_rpc_guards_2026_09_02.sql) — niet uit het hoofd.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.match_jellemind_lessons(vector, integer, text, text, double precision, text);
DROP FUNCTION IF EXISTS public.submit_jellemind_decision(uuid, text, text, text, text, text[], text);
DROP FUNCTION IF EXISTS public.finalize_jellemind_proposals(jsonb, integer, integer, numeric, numeric);
DROP FUNCTION IF EXISTS public.harvest_and_cluster_jellemind(integer, integer);
DROP FUNCTION IF EXISTS public.request_meeting_briefing(uuid);

-- -----------------------------------------------------------------------------
-- 2. Tabellen.
--    CASCADE alleen waar een policy/constraint/trigger anders in de weg staat;
--    er hangt bewust geen FK van een blijvend product aan deze vijf. Draait de
--    DROP toch op een dependency, dan is dát de melding die je wilt zien —
--    niet een stil weggevallen view.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.jellemind_lesson_proposals CASCADE;
DROP TABLE IF EXISTS public.jellemind_signals          CASCADE;
DROP TABLE IF EXISTS public.jellemind_lessons          CASCADE;
DROP TABLE IF EXISTS public.meeting_briefings          CASCADE;
DROP TABLE IF EXISTS public.meeting_briefing_config    CASCADE;

-- -----------------------------------------------------------------------------
-- 3. De schedule-rijen zelf.
--    Deel A zette ze op enabled=false; hier gaan ze weg zodat health-views en
--    de documentation-monitor ze niet blijven tellen als "stille agent".
-- -----------------------------------------------------------------------------
DELETE FROM public.agent_schedules
 WHERE agent_name IN ('jellemind', 'meeting-briefing', 'jellemind-embed');

-- -----------------------------------------------------------------------------
-- Verificatie ná afloop (apart draaien; tellen in een tweede statement —
-- geheugen same-statement-count-cannot-see-its-own-write):
--
--   SELECT to_regclass('public.jellemind_lessons'),
--          to_regclass('public.jellemind_lesson_proposals'),
--          to_regclass('public.jellemind_signals'),
--          to_regclass('public.meeting_briefings'),
--          to_regclass('public.meeting_briefing_config');
--   -- verwacht: 5× NULL
--
--   SELECT p.proname FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND (p.proname LIKE '%jellemind%' OR p.proname = 'request_meeting_briefing');
--   -- verwacht: 0 rijen
--
--   SELECT count(*) AS autodraft_intact FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'get_inbox_briefing';
--   -- verwacht: >= 1. Is dit 0, dan is er te veel weg (AutoDraft v3-dagstand).
-- =============================================================================
