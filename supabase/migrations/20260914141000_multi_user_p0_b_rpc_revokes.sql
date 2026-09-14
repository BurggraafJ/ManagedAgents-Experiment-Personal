-- =============================================================================
-- Multi-user P0 · GAP-2a — de poort terug in de DEFINER-RPC's        (v1.190)
-- =============================================================================
-- Onderzoek: RESEARCH-MULTI-USER.md §2 GAP-2 · hermeten 2026-09-14 op prod.
--
-- 202 SECURITY DEFINER-functies (geen triggers) waar `authenticated` EXECUTE op
-- heeft. SECURITY DEFINER draait als `postgres`, en `postgres` heeft
-- `rolbypassrls` — RLS beschermt daar dus niets. Gemeten als member:
--
--   list_external_parties(null)      200 · 210 rijen
--   confluence_space_page_counts()   200 ·   8 rijen
--   search_contacts('a', 3)          200 ·   3 rijen
--   agent_chat_health_check()        403          ← de poort die er wél is
--
-- De 202 vallen in vier hopen. Deze migratie doet hoop 1 en 2; hoop 3 zit in
-- migratie c; hoop 4 blijft bewust staan en wordt hieronder verantwoord.
--
--   88  hebben al een eigen poort (auth.uid(), rol, MFA, guard-helper)
--   49  roepen `require_dashboard_auth()` aan        ← hoop 1
--   54  hebben geen poort én geen browserpad         ← hoop 2
--   11  hebben geen poort en worden wél door de browser aangeroepen ← hoop 3/4
--
-- ── Hoop 1 · één helper, negenenveertig functies ────────────────────────────
-- `require_dashboard_auth()` heet als een poort maar is er geen:
--
--     IF auth.role() NOT IN ('authenticated', 'service_role') THEN raise ...
--
-- Dat is "ben je ingelogd", niet "mag je dit". Elke member passeert hem. Omdat
-- negenenveertig functies hem als eerste regel aanroepen — autodraft-besluiten,
-- kb-voorstellen, agent-instructies, secrets, templates, externe partijen — is
-- het aanscherpen van díé ene functie de goedkoopste echte afsluiting die er in
-- dit dossier te vinden is. Eén CREATE OR REPLACE, negenenveertig gaten dicht,
-- geen enkele functiebody aangeraakt.
--
-- `can_manage_dashboard()` is de bestaande, bewezen variant en houdt de drie
-- callers heel die er moeten blijven:
--   1. interne callers (pg_cron, migraties, psql) — session_user <> authenticator
--   2. server-to-server met de service-role key
--   3. de owner in de browser (is_admin_or_higher = owner + tweede factor)
--
-- ⚠ Dit is de enige regel in deze PR die bestaand gedrag verandert voor een
-- ingelogde gebruiker. Voor Jelle verandert er niets: hij is owner en zijn
-- browsersessie heeft een `user_session_mfa`-rij. Voor een member verandert
-- alles — en dat is precies de bedoeling vóór de eerste uitnodiging.
--
-- ⚠ Zodra members een eigen mailbox krijgen (beslissing 4, 2026-09-14) moeten
-- deze zeven hun eigen per-user-tak krijgen in plaats van de owner-poort; ze
-- werken op `autodraft_mails`/`mail_messages`, die een `user_id` dragen:
--   submit_autodraft_decision · bulk_skip_autodraft_mails ·
--   reset_autodraft_mail_to_pending · set_autodraft_mail_category ·
--   set_autodraft_variant · set_autodraft_target_folder · autodraft_rewrite_request
-- Ze staan in P0-IMPL-NOTES.md onder "restrisico / vervolg".
--
-- ── Hoop 2 · intrekken wat de browser nooit aanroept ────────────────────────
-- Vierenvijftig functies zijn pijplijn: de chunker, de kb-curator, de
-- mail-enrichment, de snapshots, de claim/fetch-lussen. Gemeten met een grep op
-- `rpc('<naam>')` over src/ : nul treffers. Wie ze wél aanroept — de Edge
-- Functions — doet dat met de service-role key (`SUPABASE_SERVICE_ROLE_KEY`,
-- geverifieerd in context-build, chunker, rag-search, kb-compose), en
-- service_role houdt zijn EXECUTE.
--
-- Intrekken is hier beter dan een guard toevoegen: geen functiebody wijzigt,
-- dus geen kans om er onderweg iets in te breken, en geen ACL die verloren gaat
-- (we doen geen DROP — zie het geheugen `drop-function-verliest-proacl`).
--
-- Twee functies die er ongeguard uitzien en toch blijven staan:
--   • `rag_owner_scope_ids(p_owner_user_id)` — wordt aangeroepen ván binnenuit
--     `match_chunks()` en `match_chunks_for_entity()`, en die zijn SECURITY
--     **INVOKER**. Intrekken zou retrieval breken voor elke authenticated
--     aanroeper. De functie vertrouwt weliswaar zijn parameter, maar wat ze
--     teruggeeft is een *filter* dat de scope versmalt, geen data: de RLS op
--     `chunks` blijft er onverkort naast staan. Bewuste DEFINER, zie comment.
--   • `confluence_allowed_spaces(p_user)` — heeft zijn eigen `auth.role()`-tak
--     en is de bron van de space-ACL. Alleen de anon-grant gaat eraf.
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
--   grant execute on function public.<naam>(<args>) to authenticated;
-- en de oude require_dashboard_auth terug (auth.role() NOT IN (...)).
-- =============================================================================

begin;

-- ── 1. De helper die geen poort was ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.require_dashboard_auth()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Was tot 2026-09-14: auth.role() IN ('authenticated','service_role') — dus
  -- "ben je ingelogd". Elke member passeerde dat. can_manage_dashboard() laat
  -- dezelfde interne en server-to-server callers door, maar eist in de browser
  -- de owner-rol mét tweede factor. Zie multi-user P0, GAP-2.
  IF NOT public.can_manage_dashboard() THEN
    RAISE EXCEPTION 'forbidden: deze actie vereist de owner-rol'
      USING ERRCODE = 'insufficient_privilege',
            HINT    = 'log in als owner van het dashboard';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.require_dashboard_auth() IS
  'Poort voor dashboard-mutaties: interne callers en service_role door, in de browser alleen de owner mét tweede factor. Negenenveertig SECURITY DEFINER-RPC''s hangen hieraan. Tot 2026-09-14 controleerde deze functie alleen of er überhaupt iemand was ingelogd. Multi-user P0 GAP-2.';

-- ── 2. Intrekken: vierenvijftig functies zonder browserpad ──────────────────
revoke execute on function public.agent_runs_cleanup_dryrun(p_tier text) from authenticated, anon;
revoke execute on function public.analyze_sent_style_corpus(p_user_id uuid, p_window_days integer, p_min_cell_size integer, p_samples_per_cell integer) from authenticated, anon;
revoke execute on function public.archive_chat_session(p_session_id uuid) from authenticated, anon;
revoke execute on function public.archive_contactpersonen_from_hubspot() from authenticated, anon;
revoke execute on function public.autodraft_match_ignore_rules(p_user_id uuid, p_sender_email text, p_subject text) from authenticated, anon;
revoke execute on function public.autodraft_resolve_pending_bucket(p_user_id uuid, p_sender_email text) from authenticated, anon;
revoke execute on function public.build_draft_style_bundle(p_mail_id text, p_target_tone text) from authenticated, anon;
revoke execute on function public.claim_autodraft_decision(p_decision_id uuid) from authenticated, anon;
revoke execute on function public.claim_next_backfill_bucket() from authenticated, anon;
revoke execute on function public.claim_next_mail_account(p_purpose text) from authenticated, anon;
revoke execute on function public.confluence_recompute_grants() from authenticated, anon;
revoke execute on function public.confluence_space_page_counts() from authenticated, anon;
revoke execute on function public.edge_functions_base_url() from authenticated, anon;
revoke execute on function public.edit_jellemind_lesson(p_lesson_id uuid, p_lesson_text text, p_applies_to text[], p_evidence_summary text) from authenticated, anon;
revoke execute on function public.expire_stale_appointment_proposals() from authenticated, anon;
revoke execute on function public.fetch_unchunked_source_ids(p_source text, p_limit integer) from authenticated, anon;
revoke execute on function public.finalize_autodraft_decision_now(p_decision_id uuid, p_outcome text, p_error text, p_draft_outlook_id text) from authenticated, anon;
revoke execute on function public.find_agenda_slots_for_request(p_range_start date, p_range_end date, p_duration_minutes integer, p_n_slots integer, p_skip_wednesday boolean, p_earliest_hour integer, p_latest_hour integer, p_exclude_lunch boolean) from authenticated, anon;
revoke execute on function public.finish_mail_account_claim(p_account_id uuid, p_error text) from authenticated, anon;
revoke execute on function public.get_action_distribution_for_domain(p_domain text, p_user_id uuid) from authenticated, anon;
revoke execute on function public.get_recent_actions_by_folder_pattern(p_pattern text, p_limit integer, p_user_id uuid) from authenticated, anon;
revoke execute on function public.get_recent_actions_for_sender(p_from_email text, p_limit integer, p_user_id uuid) from authenticated, anon;
revoke execute on function public.get_thread_messages(p_conversation_id text, p_subject text, p_match_email text, p_anchor_date timestamp with time zone, p_user_id uuid) from authenticated, anon;
revoke execute on function public.hs_engagement_company_domain_refresh() from authenticated, anon;
revoke execute on function public.hs_engagement_mail_duplicates_refresh() from authenticated, anon;
revoke execute on function public.infer_target_folder(p_emails text[]) from authenticated, anon;
revoke execute on function public.kb_articles_fetch_dirty(p_limit integer) from authenticated, anon;
revoke execute on function public.kb_curator_fetch_amends(p_user_id uuid, p_limit integer) from authenticated, anon;
revoke execute on function public.kb_curator_fetch_batch(p_user_id uuid, p_category text, p_limit integer) from authenticated, anon;
revoke execute on function public.kb_extraction_fetch_batch(p_user_id uuid, p_limit integer, p_extractor_version text) from authenticated, anon;
revoke execute on function public.kb_match_articles(p_embedding halfvec, p_top integer) from authenticated, anon;
revoke execute on function public.kb_match_proposals(p_embedding halfvec, p_top integer, p_exclude uuid) from authenticated, anon;
revoke execute on function public.kb_match_topic(p_user_id uuid, p_embedding halfvec, p_category text, p_top integer) from authenticated, anon;
revoke execute on function public.kb_proposals_to_score(p_user_id uuid, p_limit integer, p_category text, p_ids uuid[]) from authenticated, anon;
revoke execute on function public.kb_proposals_to_topicize(p_user_id uuid, p_category text, p_audience text, p_limit integer) from authenticated, anon;
revoke execute on function public.kb_proposals_to_triage(p_user_id uuid, p_limit integer, p_category text, p_ids uuid[]) from authenticated, anon;
revoke execute on function public.mail_enrichment_pre_filter(p_mail_id text) from authenticated, anon;
revoke execute on function public.mail_enrichment_trigger_backfill_batch() from authenticated, anon;
revoke execute on function public.mark_autodraft_stale_for_deleted_mails(p_mail_ids text[]) from authenticated, anon;
revoke execute on function public.propagate_meeting_entities(p_meeting_id uuid) from authenticated, anon;
revoke execute on function public.rag_resolve_entity(p_query text) from authenticated, anon;
revoke execute on function public.release_autodraft_decision(p_decision_id uuid) from authenticated, anon;
revoke execute on function public.resolve_party_at_moment(p_mail_id text) from authenticated, anon;
revoke execute on function public.retire_jellemind_lesson(p_lesson_id uuid, p_reason text) from authenticated, anon;
revoke execute on function public.search_contacts(p_query text, p_limit integer) from authenticated, anon;
revoke execute on function public.seed_mail_backfill_buckets(p_user_id uuid, p_since date, p_folder_ids text[]) from authenticated, anon;
revoke execute on function public.single_mail_owner_user_id() from authenticated, anon;
revoke execute on function public.snap_deal_dag_run(p_datum date) from authenticated, anon;
revoke execute on function public.snap_hygiene_dag_run(p_datum date) from authenticated, anon;
revoke execute on function public.suggest_task_project(p_title text, p_notes text, p_top_n integer) from authenticated, anon;
revoke execute on function public.trigger_draft_style_run(p_user_id uuid) from authenticated, anon;
revoke execute on function public.trigger_jellemind_run() from authenticated, anon;
revoke execute on function public.unarchive_chat_session(p_session_id uuid) from authenticated, anon;
revoke execute on function public.validate_views() from authenticated, anon;

-- ── 3. anon-opruiming ───────────────────────────────────────────────────────
-- Geheugen `bare-create-function-grants-public`: een kale CREATE FUNCTION geeft
-- PUBLIC execute, en `anon` erft dat. Zes app-functies stonden zo open voor een
-- niet-ingelogde bezoeker. Vier zijn hierboven al ingetrokken; deze twee houden
-- hun EXECUTE voor `authenticated` (ze zitten in het retrieval-pad) maar niet
-- voor `anon`. De pgvector-operatoren blijven met rust — die horen open.
revoke execute on function public.confluence_allowed_spaces(uuid) from anon;
revoke execute on function public.confluence_acl_debug(uuid)      from anon;

-- ── 4. Bewuste DEFINER's, vastgelegd ────────────────────────────────────────
COMMENT ON FUNCTION public.rag_owner_scope_ids(uuid) IS
  'BEWUSTE SECURITY DEFINER zonder rolpoort. Wordt aangeroepen vanuit match_chunks() en match_chunks_for_entity(), beide SECURITY INVOKER: intrekken breekt retrieval voor elke authenticated aanroeper. De functie vertrouwt p_owner_user_id, maar levert een scope-filter en geen data — de RLS op chunks staat er onverkort naast. Multi-user P0, uitzonderingslijst M2.';

COMMENT ON FUNCTION public.confluence_allowed_spaces(uuid) IS
  'SECURITY DEFINER met eigen poort: een browsersessie (auth.role() = authenticated) mag nooit namens een ander vragen, p_user wordt daar genegeerd. Bron van de per-user space-ACL. Multi-user P0, uitzonderingslijst M2.';

commit;

-- ── Verificatie (draai deze ná de migratie) ─────────────────────────────────
-- 1) Tel wat er nog open staat:
--    select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.prosecdef and p.prorettype<>'trigger'::regtype
--       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
--       and p.prosrc !~* 'auth\.uid\(\)|auth\.role\(\)|is_admin_or_higher|can_manage_dashboard|current_user_role|session_mfa_ok|require_dashboard_auth|confluence_allowed_spaces|app_skills_visible|mail_scope_user_ids|has_capability';
--    → verwacht 1: rag_owner_scope_ids (uitzonderingslijst).
--
-- 2) Positieve controle, en die telt zwaarder: Jelle moet ná deze migratie nog
--    steeds een agent kunnen starten en een autodraft-besluit kunnen indienen.
--    scripts/multi_user_acl_eval.cjs M5/M6, en één echte klik in het dashboard.
