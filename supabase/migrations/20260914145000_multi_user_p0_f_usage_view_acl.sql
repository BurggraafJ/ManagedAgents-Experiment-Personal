-- =============================================================================
-- Multi-user P0 · correctie — de Usage-views tellen voor de owner mee (v1.190)
-- =============================================================================
-- `v_user_model_usage_month` en `v_model_usage_dekking` stonden in migratie
-- 20260914143000 op `security_invoker = on`. Dat is de goede reflex — de RLS van
-- de tabel eronder hoort te gelden — maar hier kiest hij de verkeerde kant.
--
-- Gemeten in de positieve controle (owner mét tweede factor, 2026-09-14):
--
--     v_user_model_usage_month   1 rij      ← moet er 2 zijn
--
-- De oorzaak zit in de policy van `agent_chat_runs`:
--
--     agent_chat_runs_owner_select : session_mfa_ok() AND owner_id = auth.uid()
--
-- Geen `is_admin_or_higher()`-tak. Met invoker=on ziet de owner dus alleen zijn
-- eigen chat-runs, en een Usage-pagina die per persoon een bedrag toont zou
-- iedereen behalve Jelle op nul zetten — een leeg vakje dat leest als "deze
-- persoon gebruikt niets" terwijl het "ik mag dit niet zien" betekent. Precies
-- het onderscheid dat RESEARCH §4.2 als eis stelt.
--
-- De view wordt dus een geguarde view (security_invoker uit, poort in het
-- WHERE-predicaat), met twee armen:
--   • de owner ziet alle personen — dat is waar de pagina voor is
--   • een member ziet zijn eigen regel — zijn plafond is zijn zaak
--
-- Dat is hetzelfde patroon als `v_hubspot_future_index_acl` en als elke
-- SECURITY DEFINER-functie met een guard-helper: het predicaat is de poort.
-- Beide views staan daarom op de uitzonderingslijst van M1 mét reden.
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
-- De definities uit 20260914143000 met `with (security_invoker = on)` en zonder
-- het where-predicaat.
-- =============================================================================

begin;

drop view if exists public.v_user_model_usage_month;
create view public.v_user_model_usage_month as
  select r.caller_user_id                       as user_id,
         date_trunc('month', q.asked_at)::date  as maand,
         count(*)                               as vragen,
         round(sum(q.est_cost_usd)::numeric, 4) as cost_usd
    from public.rag_chat_query_log q
    join public.agent_chat_runs r on r.id = q.run_id
   where r.caller_user_id is not null
     and not q.meta ? 'eval_run_id'
     and (public.is_admin_or_higher() or r.caller_user_id = (select auth.uid()))
   group by 1, 2;

comment on view public.v_user_model_usage_month is
  'Model-kosten per persoon per maand, voor zover toewijsbaar. Bron: rag_chat_query_log.est_cost_usd via agent_chat_runs.caller_user_id — de enige echte koppeling tussen een model-call en een mens die dit schema vandaag heeft. Bewust security_invoker=off met de poort in het WHERE-predicaat: de policy op agent_chat_runs kent geen owner-tak, dus met invoker zag de owner alleen zijn eigen regel. Owner ziet iedereen, een member zichzelf. Lees hem NOOIT zonder v_model_usage_dekking ernaast. Multi-user P0.';

drop view if exists public.v_model_usage_dekking;
create view public.v_model_usage_dekking as
  select date_trunc('month', q.asked_at)::date                           as maand,
         count(*)                                                        as vragen_totaal,
         count(*) filter (where r.caller_user_id is not null)            as vragen_toegewezen,
         round(sum(q.est_cost_usd)::numeric, 4)                          as usd_totaal,
         round(sum(q.est_cost_usd) filter (where r.caller_user_id is not null)::numeric, 4) as usd_toegewezen
    from public.rag_chat_query_log q
    left join public.agent_chat_runs r on r.id = q.run_id
   where not q.meta ? 'eval_run_id'
     and public.is_admin_or_higher()
   group by 1;

comment on view public.v_model_usage_dekking is
  'De noemer bij v_user_model_usage_month: hoeveel van de model-kosten is überhaupt aan een persoon toe te wijzen. September 2026 gemeten: 37 van 311 vragen, $0,66 van $4,98. Owner-only, poort in het WHERE-predicaat. Zonder deze view leest een Usage-pagina als volledig terwijl ze een achtste van de kosten toont.';

grant select on public.v_user_model_usage_month, public.v_model_usage_dekking to authenticated;

commit;

-- ── Verificatie ─────────────────────────────────────────────────────────────
-- Owner mét tweede factor: select count(*) from v_user_model_usage_month -> 2
-- Member mét tweede factor: 0 (hij heeft nog geen chat-runs op zijn naam)
