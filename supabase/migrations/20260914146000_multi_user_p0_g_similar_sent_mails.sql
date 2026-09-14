-- =============================================================================
-- Multi-user P0 · GAP-2d — find_similar_sent_mails                   (v1.190)
-- =============================================================================
-- Gevonden door de nieuwe poort `scripts/multi_user_acl_eval.cjs` (M2), niet
-- door de inventaris die eraan voorafging. Het verschil zit in wat je een poort
-- noemt.
--
-- `find_similar_sent_mails(p_query_embedding, p_top_k, p_user_id)` geeft
-- `subject` en `body_text` van verzonden mails terug. Zijn enige filter is:
--
--     (public.rag_owner_scope_ids(p_user_id) IS NULL
--      OR m.user_id = ANY(public.rag_owner_scope_ids(p_user_id)))
--
-- Dat lijkt een scope-controle en is er geen: `rag_owner_scope_ids()` kijkt niet
-- naar wie er belt. Met `p_user_id = NULL` valt hij terug op de org-mailbox —
-- dus op Jelle — en met een expliciete uuid richt de aanroeper hem gewoon op
-- wie hij wil. Elke ingelogde member kon zo de verzonden mail van de owner
-- doorzoeken op inhoud. Dezelfde vorm van schijnveiligheid als
-- `require_dashboard_auth()` in migratie b: een helper met een geruststellende
-- naam die de aanroeper nooit vraagt wie hij is.
--
-- De enige aanroeper is `supabase/functions/mail-verbeteraar/index.ts`, en die
-- belt met de service-role key (regel 63-70: `apikey: serviceKey`). Intrekken
-- raakt dat pad dus niet.
--
-- Twee functies blijven met opzet staan en gaan op de uitzonderingslijst van
-- M2, omdat ze geen data teruggeven en in invoker-context nodig zijn:
--   • `rag_owner_scope_ids(uuid)`   — levert een scope-filter; match_chunks en
--     match_chunks_for_entity zijn SECURITY INVOKER en roepen hem aan
--   • `mail_scope_single_user_id()` — levert één uuid; zit in vier
--     security_invoker-views (v_postvak_health, v_truth_of_sources,
--     v_company_data_quality, v_mail_enrichment_progress)
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
--   grant execute on function public.find_similar_sent_mails(halfvec, integer, uuid) to authenticated;
-- =============================================================================

begin;

revoke execute on function public.find_similar_sent_mails(halfvec, integer, uuid)
  from authenticated, anon, public;

comment on function public.find_similar_sent_mails(halfvec, integer, uuid) is
  'Zoekt in de body van verzonden mail. Alleen service_role: de scope-parameter p_user_id wordt vertrouwd en rag_owner_scope_ids() kijkt niet naar de aanroeper, dus met EXECUTE voor authenticated kon elke member de verzonden mail van de owner doorzoeken. Aanroeper is mail-verbeteraar met de service-role key. Multi-user P0 GAP-2, gevonden door M2.';

comment on function public.mail_scope_single_user_id() is
  'BEWUSTE SECURITY DEFINER zonder rolpoort: geeft één uuid terug, geen data. Zit in vier security_invoker-views die authenticated leest (v_postvak_health, v_truth_of_sources, v_company_data_quality, v_mail_enrichment_progress); intrekken maakt die views onleesbaar. Uitzonderingslijst M2.';

commit;

-- ── Verificatie ─────────────────────────────────────────────────────────────
-- select has_function_privilege('authenticated','public.find_similar_sent_mails(halfvec,integer,uuid)','EXECUTE');
-- → false. En daarna node scripts/multi_user_acl_eval.cjs → M2 groen.
