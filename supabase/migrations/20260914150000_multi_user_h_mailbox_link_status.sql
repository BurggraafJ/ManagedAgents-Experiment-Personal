-- =============================================================================
-- Multi-user · de mailbox-koppeling per persoon, zichtbaar voor de owner (v1.191)
-- =============================================================================
-- Beslissing 4 (Jelle, 2026-09-14): iedereen krijgt een eigen inbox-koppeling.
-- De rechten-matrix wil daarom per persoon tonen óf die koppeling er al is —
-- dat is de eerste vraag bij het uitnodigen van een collega, en vandaag is het
-- antwoord onzichtbaar.
--
-- ── Waarom een view en niet gewoon de tabel ─────────────────────────────────
-- `mail_accounts` heeft een nette policy:
--
--     mail_accounts_read_self_or_admin :
--       session_mfa_ok() AND (user_id = auth.uid() OR is_admin_or_higher())
--
-- maar `authenticated` heeft **geen enkele table-grant** op die tabel:
--
--     relacl = {postgres=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
--
-- De policy is dus dode letter vanuit de browser — een GRANT gaat vóór RLS, en
-- die grant is er niet. (Gemeten 2026-09-14 met has_table_privilege.) Dat is
-- geen bug om te "fixen" door de tabel open te zetten: daar staan
-- `composio_connection_id`, `composio_user_id` en de mapnamen in. Die horen
-- niet in de browser, ook niet achter RLS.
--
-- Deze view zet daarom precies vier vragen open en geen veld meer:
--   is er een koppeling · staat hij aan · is hij gepauzeerd · draaide hij nog.
-- Geen e-mailadres, geen connection-id, geen fouttekst (alleen of er één is).
--
-- ── Waarom de poort in het WHERE staat en niet in security_invoker ──────────
-- `security_invoker = on` zou de RLS van mail_accounts laten meelopen — precies
-- de goede reflex (geheugen views-bypass-rls-when-security-invoker-off). Maar
-- met invoker=on worden óók de table-grants tegen de aanroeper gecheckt, en die
-- heeft `authenticated` hier niet. De view zou dan voor iedereen falen.
--
-- Dus: invoker uit (de view draait als eigenaar) en de poort letterlijk in het
-- predicaat, hetzelfde patroon als `v_user_model_usage_month` uit migratie f en
-- `v_hubspot_future_index_acl`. Het predicaat is een kopie van de policy:
--   • owner mét tweede factor ziet iedereen — daar is het scherm voor
--   • een member ziet zijn eigen regel — zijn koppeling is zijn zaak
--   • zonder tweede factor: niets, net als de tabel eronder
--
-- Daarom staat hij op de uitzonderingslijst van M1 in
-- `scripts/multi_user_acl_eval.cjs`, mét reden.
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
--   drop view if exists public.v_mailbox_link_status;
-- =============================================================================

begin;

create or replace view public.v_mailbox_link_status as
  select a.user_id,
         (a.mailbox_email is not null)  as gekoppeld,
         a.enabled,
         a.paused,
         a.last_sync_finished_at,
         (a.last_error is not null)     as heeft_fout
    from public.mail_accounts a
   where public.session_mfa_ok()
     and (a.user_id = (select auth.uid()) or public.is_admin_or_higher());

comment on view public.v_mailbox_link_status is
  'Heeft deze persoon zijn inbox al gekoppeld? Vier vlaggen uit mail_accounts en geen veld meer — geen mailadres, geen composio-id, geen fouttekst. Bewust security_invoker=off met de poort in het WHERE-predicaat: authenticated heeft geen table-grant op mail_accounts, dus met invoker faalt de view voor iedereen. Owner mét tweede factor ziet iedereen, een member zichzelf. Beslissing 4 (2026-09-14), gelezen door de rechten-matrix.';

grant select on public.v_mailbox_link_status to authenticated;

commit;

-- ── Verificatie ─────────────────────────────────────────────────────────────
-- Owner mét tweede factor : select count(*) from v_mailbox_link_status -> 1
--   (vandaag heeft alleen de owner een mail_accounts-rij)
-- Member mét tweede factor: 0 (hij heeft er nog geen)
-- Zonder tweede factor    : 0, ook als owner
