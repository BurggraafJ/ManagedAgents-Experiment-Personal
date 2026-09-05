-- =============================================================================
-- RLS: de tabel-lees-paden mee onder de space-ACL       (v1.145, 2026-09-05)
-- =============================================================================
-- `match_chunks` is het pad dat de chat gebruikt, maar een ingelogde gebruiker
-- kan `chunks` en `confluence_pages` ook rechtstreeks via PostgREST opvragen
-- (`/rest/v1/chunks?source=eq.confluence&select=content`). Zonder deze twee
-- policies zou de ACL de chat dichtzetten en de tabel open laten staan — dan is
-- het geen ACL maar een gordijn.
--
-- Landt SAMEN met 20260905140500 (de match_chunks-patch) en dus NA de eerste
-- confluence-acl-sync-ronde. Zie de staart van 20260905140000 voor waarom die
-- volgorde niet omgedraaid mag worden.
--
-- `confluence_allowed_spaces(null)`: in een policy is de aanroeper altijd
-- `authenticated`, en dan negeert de resolver zijn parameter en gebruikt
-- `auth.uid()`. De null is hier dus geen slordigheid maar het punt.
-- =============================================================================

-- ─── 0. De 13-argument-overload van match_chunks_for_entity opruimen ─────────
-- Die signatuur heeft GEEN `p_owner_user_id` en kan dus per definitie niet
-- ACL-gefilterd worden: wie hem met de service-role-key aanroept krijgt elke
-- gespiegelde space terug, MT incluis. Een fail-OPEN pad naast een fail-closed
-- pad is geen ACL.
--
-- Geverifieerd dat hij dood is vóór het droppen: geen enkele edge function
-- noemt hem (alle aanroepen in context-build geven alle 16 argumenten met naam
-- mee), geen andere functie-body in `pg_proc` noemt hem, en geen view-definitie
-- noemt hem. De 16-argument-versie blijft en die is in 20260905140500 gepatcht.
drop function if exists public.match_chunks_for_entity(
  text, text, halfvec, text, integer, integer, text[], timestamptz,
  double precision, double precision, double precision, integer, integer
);

-- Bestaand: `using ((select public.is_admin_or_higher()))` — elke owner zag elke
-- gespiegelde space, MT incluis.
drop policy if exists confluence_pages_read on public.confluence_pages;
create policy confluence_pages_read on public.confluence_pages
  for select to authenticated
  using (
    (select public.is_admin_or_higher())
    and space_key = ANY (public.confluence_allowed_spaces(null))
  );

-- Bestaand: is_admin_or_higher() + owner_user_id-scope. Confluence-chunks hebben
-- owner_user_id NULL (org-breed, zie 20260904091000) en glipten daar dus altijd
-- door. De derde tak repareert precies dat, en laat de andere bronnen ongemoeid.
drop policy if exists chunks_authenticated_read on public.chunks;
create policy chunks_authenticated_read on public.chunks
  for select to authenticated
  using (
    (select public.is_admin_or_higher())
    and (owner_user_id is null or owner_user_id = (select auth.uid()))
    and (
      source <> 'confluence'
      or source_id in (
        select p.page_id from public.confluence_pages p
         where p.is_archived = false
           and p.space_key = ANY (public.confluence_allowed_spaces(null))
      )
    )
  );
