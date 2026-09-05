-- =============================================================================
-- confluence_space_page_counts()                             (v1.145, 2026-09-05)
-- =============================================================================
-- `confluence-acl-sync` wil per space weten hoeveel pagina's er in de SPIEGEL
-- staan (niet hoeveel Confluence er heeft) om `confluence_spaces.page_count` te
-- vullen. Dat is een group-by, en die hoort niet als 366 losse
-- `count`-requests over PostgREST te gaan.
--
-- Waarom een RPC en geen view: de acl-sync is de enige lezer en wil één
-- resultaat in één call. Zie de snippet-vs-view-beslisboom in database-manager.
-- =============================================================================
create or replace function public.confluence_space_page_counts()
returns table(space_key text, n bigint)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select p.space_key, count(*) as n
    from public.confluence_pages p
   where p.is_archived = false
   group by p.space_key;
$function$;

grant execute on function public.confluence_space_page_counts() to service_role;
