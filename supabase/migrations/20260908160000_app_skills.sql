-- =============================================================================
-- app_skills — werkwijzen in de app, met progressive disclosure  (v1.156, 04 PR-B)
-- =============================================================================
-- `org_skills` (v1.134) is één trap: elke actieve regel gaat integraal mee in de
-- system-prompt van élke vraag. Dat werkt voor twee korte definities en werkt
-- niet voor een werkwijze van 5.000 tekens — die zou je bij iedere vraag
-- betalen, ook bij de 99 % waarvoor hij niet relevant is.
--
-- `app_skills` is dezelfde soort in-app kennis, maar in DRIE trappen
-- (Agent-Skills-standaard, zie docs/agent/SKILLS.md):
--
--   1. title        ≤   120 tekens  — altijd, op élke route  (~35 tokens/skill)
--   2. description  ≤   500 tekens  — alleen waar `skill_open` bestaat (agentic)
--   3. body         ≤ 20.000 tekens — alléén ná `skill_open(slug)`
--
-- Trap 2 staat bewust NIET op semantic/structured/sweep: daar bestaat geen tool
-- om trap 3 te bereiken, dus een volledige beschrijving is daar een belofte die
-- niet kan worden ingelost. Een titellijst kan dat wél ("daar hebben we een
-- werkwijze voor") en is precies wat de bank op dit punt vraagt.
--
-- ── Waarom een tweede tabel en niet drie kolommen op org_skills ──────────────
--
-- `org_skills` heeft geen scope-as: elke regel is org-breed en gaat bij iedereen
-- mee. Zodra er een tweede gebruiker is, is dat geen detail meer maar een
-- ontwerpkeuze die je niet stil kunt uitbreiden — een `scope`-kolom erbij zetten
-- zou van elke bestaande rij een impliciete 'org'-rij maken en van de leesregel
-- van de chat (service-role, RLS vuurt nooit) een stille aanname. De trappen
-- vragen bovendien andere caps en een `version`, en de editor een ander
-- formulier. Twee tabellen, twee levens; `org_skills` blijft ongewijzigd.
--
-- ── De ACL: RLS is voor de EDITOR, de RPC is voor de CHAT ────────────────────
--
-- ⛔ Dit is het punt waar het misgaat als je het niet expliciet maakt.
-- `rag-chat/index.ts` bouwt zijn eigen client met de SERVICE-ROLE-key. Op dat pad
-- vuurt RLS **nooit**. Een tabel met keurige policies is dus volledig
-- onbeschermd op het moment dat de chat hem leest — precies de constructie
-- waarom de Confluence-ACL in `match_chunks` zit en niet in een policy
-- (migratie 20260905140000).
--
-- Daarom twee lagen met twee doelen:
--   • RLS op de tabel      → beschermt de editor (browser, `authenticated`).
--   • SECURITY DEFINER-RPC → beschermt de chat (`app_skills_visible`,
--     `app_skill_open`, `app_skills_etag`).
--
-- Vijf regels die geen van beide mag overtreden:
--   1. ÉÉN predicaat. `app_skill_open` en `app_skills_etag` selecteren UIT
--      `app_skills_visible(...)`, niet uit een gekopieerde `where`. Twee
--      predicaten die uit elkaar lopen maken een slug tot een leesprimitief.
--   2. De browser mag nooit namens een ander vragen: voor `authenticated` én
--      `anon` is `auth.uid()` de enige waarheid en wordt `p_caller_user_id`
--      genegeerd. Alleen server-to-server (service_role, pg_cron, psql) mag
--      namens iemand anders vragen — die heeft de service-key toch al.
--   3. Fail-closed. Een aanroeper zonder identiteit (cron, evalrunner zonder
--      persona) krijgt **alleen** `scope='org'`. Een onbekende scope-waarde valt
--      op `else false`. Een lege uitkomst is normaal en géén RLS-bug.
--   4. "Bestaat niet" ≡ "niet van jou". `app_skill_open` op een onzichtbare slug
--      geeft exact dezelfde uitkomst (0 rijen) als op een niet-bestaande slug.
--      Ook een wéigering lekt: "die mag je niet lezen" bevestigt het bestaan.
--   5. `current_user_role()` staat hier NIET in. Die functie is
--      `coalesce((select app_role from user_roles where user_id = auth.uid()),
--      'member')` — met een lege `auth.uid()`, dus op precies het
--      service-role-pad van de chat, geeft hij `'member'` terug. Een
--      `scope='role'`-skill voor `member` zou daarmee zichtbaar worden voor élke
--      identiteitsloze aanroeper: fail-open, en stil. De rol komt hier
--      rechtstreeks uit `user_roles` op de caller-uid, met `uid is not null` als
--      voorwaarde.
--
-- ⚠ En de grants: een kale `CREATE FUNCTION` geeft **PUBLIC** execute
-- (geheugen `drop-function-verliest-proacl`). Gemeten op dit project:
-- `confluence_allowed_spaces` en `confluence_acl_debug` dragen vandaag
-- `=X/postgres` in hun `proacl` en zijn dus met de anon-key aan te roepen — en
-- juist voor `anon` neemt het confluence-patroon `p_user` wél over. Hier daarom
-- expliciet `revoke execute … from public` vóór de grants, én `anon` in regel 2.
--
-- ── Twee assen, niet mengen (les uit v1.145) ─────────────────────────────────
-- `p_caller_user_id` = wie stelt de vraag. `p_owner_user_id` = wiens mail mag
-- meedoen. `app_skills` hangt uitsluitend aan de eerste.
--
-- ── Puur additief ────────────────────────────────────────────────────────────
-- Deze migratie handhaaft niets en verandert niets aan bestaand gedrag: zolang
-- de tabel leeg is levert `app_skills_visible()` een lege set en injecteert de
-- chat geen enkel teken. Er is dus geen uitrol-volgorde die stil kan omvallen.
-- =============================================================================

-- ─── 1. De tabel ─────────────────────────────────────────────────────────────
create table if not exists public.app_skills (
  id            uuid        primary key default gen_random_uuid(),
  slug          text        not null unique,
  -- Één rij per slug; `version` gaat +1 zodra `description` of `body` wijzigt
  -- (trigger hieronder). Geen versierijen: er is geen gevraagde historie, wél
  -- een gevraagde cache-observatie — zie app_skills_etag().
  version       integer     not null default 1,
  title         text        not null,
  description   text        not null default '',
  body          text        not null default '',
  -- Fase 2 (samen met spoor 05): aangemaakt en NIET gelezen. Bestaat nu omdat
  -- een kolom later toevoegen aan een tabel met inhoud duurder is dan nu.
  resources     jsonb       not null default '[]'::jsonb,
  -- Expliciete routeer-hints voor de deterministische route-override (D04-7),
  -- die achter agent_config('rag-chat','skill_route_override') zit en UIT staat.
  -- Dit is een ROUTEER-hint die Jelle schrijft; `description` blijft de
  -- model-facing trigger van de Agent-Skills-standaard. Geen fuzzy match: een
  -- expliciete lijst is auditeerbaar, een embedding-match niet.
  triggers      text[]      not null default '{}'::text[],
  scope         text        not null default 'org',
  scope_user_id uuid        references auth.users(id) on delete cascade,
  scope_role    text,
  tool_binding  text,
  active        boolean     not null default true,
  sort_order    integer     not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  constraint app_skills_slug_chk        check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  constraint app_skills_title_chk       check (length(btrim(title)) between 1 and 120),
  constraint app_skills_description_chk check (length(description) <= 500),
  constraint app_skills_body_chk        check (length(body) <= 20000),
  constraint app_skills_version_chk     check (version >= 1),
  constraint app_skills_resources_chk   check (jsonb_typeof(resources) = 'array'),
  constraint app_skills_triggers_chk    check (cardinality(triggers) <= 12),
  constraint app_skills_scope_chk       check (scope in ('org', 'user', 'role')),
  -- Spiegelt user_roles_app_role_check. Een FK naar een CHECK bestaat niet, dus
  -- de twee waarden staan hier letterlijk; komt er een rol bij, dan komt hij
  -- hier ook bij (en dat is precies het moment waarop je erover nadenkt).
  constraint app_skills_scope_role_chk  check (scope_role is null or scope_role in ('owner', 'member')),
  -- ⛔ Zonder deze CHECK is een halfgevulde rij een stille lek-kandidaat:
  -- scope='user' zonder scope_user_id zou in `app_skills_visible` op
  -- `s.scope_user_id = <uid>` = NULL uitkomen — onzichtbaar voor iedereen, dus
  -- niet gevaarlijk — maar scope='org' MÉT een scope_user_id is een regel die
  -- als persoonlijk is bedoeld en org-breed uitkomt. Dat is de gevaarlijke helft.
  constraint app_skills_scope_shape_chk check (
    (scope = 'org'  and scope_user_id is null     and scope_role is null) or
    (scope = 'user' and scope_user_id is not null and scope_role is null) or
    (scope = 'role' and scope_role   is not null  and scope_user_id is null)
  )
);

comment on table public.app_skills is
  'Werkwijzen/checklists die rag-chat in drie trappen aanbiedt: titel altijd, description op de agent-route, body alleen na skill_open(). Scope org|user|role. CRUD in Organisatie > Skills, tabblad Werkwijzen. De chat leest UITSLUITEND via app_skills_visible()/app_skill_open() — service-role omzeilt RLS.';
comment on column public.app_skills.description is
  'Trap 2, max 500 tekens: WANNEER moet het model deze skill openen? Gaat alleen mee op routes waar skill_open bestaat (agentic).';
comment on column public.app_skills.body is
  'Trap 3, max 20.000 tekens: de werkwijze zelf. Komt alleen bij het model na een expliciete skill_open(slug).';
comment on column public.app_skills.version is
  'Gaat +1 zodra description of body wijzigt (trigger app_skills_bump). Voedt app_skills_etag(); niet zelf te zetten.';
comment on column public.app_skills.triggers is
  'Routeer-hints voor de route-override (agent_config rag-chat/skill_route_override, default false). Werkt alleen op de ZICHTBARE set, anders verraadt het gedrag het bestaan van een skill die de vrager niet mag zien.';
comment on column public.app_skills.scope is
  'org = iedereen (staat in de gedeelde prompt-prefix) · user = één gebruiker · role = één app_role. user/role staan ACHTER het cache-breekpunt: een identiteitsvrije prefix kan per constructie geen ACL-lek dragen.';
comment on column public.app_skills.resources is
  'Fase 2 (met spoor 05): aangemaakt, nog niet gelezen door rag-chat.';

create index if not exists app_skills_active_idx     on public.app_skills (active, sort_order);
create index if not exists app_skills_scope_user_idx on public.app_skills (scope_user_id) where scope_user_id is not null;
create index if not exists app_skills_scope_role_idx on public.app_skills (scope_role)    where scope_role    is not null;
create index if not exists app_skills_binding_idx    on public.app_skills (tool_binding)  where tool_binding  is not null;

drop trigger if exists app_skills_touch on public.app_skills;
create trigger app_skills_touch
  before update on public.app_skills
  for each row execute function public.set_updated_at();

-- ─── 2. version: afgeleid, niet gegeven ──────────────────────────────────────
-- Alleen een wijziging van de tekst die bij het model komt telt. Een `active`-
-- vlag omzetten of de sortering verschuiven wijzigt de zichtbare SET (en dus de
-- etag, want die is over de zichtbare set) zonder dat de inhoud van een skill
-- veranderde — dan hoort `version` gelijk te blijven.
create or replace function public.app_skills_bump_version()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
BEGIN
  IF NEW.description IS DISTINCT FROM OLD.description
     OR NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.version := OLD.version + 1;
  ELSE
    -- Ook de tegenhanger: een client die zelf een version meestuurt wordt
    -- overschreven. `version` is afgeleid of hij is niets.
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END $function$;

comment on function public.app_skills_bump_version() is
  'BEFORE UPDATE op app_skills: version +1 bij een wijziging van description of body, anders ongewijzigd. Maakt version afgeleid in plaats van door de client te zetten.';

drop trigger if exists app_skills_bump on public.app_skills;
create trigger app_skills_bump
  before update on public.app_skills
  for each row execute function public.app_skills_bump_version();

-- ─── 3. Het ENIGE zichtbaarheids-predicaat ───────────────────────────────────
create or replace function public.app_skills_visible(p_caller_user_id uuid default null)
returns table (
  slug         text,
  version      integer,
  title        text,
  description  text,
  tool_binding text,
  scope        text,
  triggers     text[],
  sort_order   integer
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with caller as (
    -- Regel 2. `anon` staat er expliciet bij naast `authenticated`: voor een
    -- anon-request is auth.role() 'anon', en zónder deze tak zou de else-arm
    -- p_caller_user_id overnemen — dan kan iedereen met de publieke anon-key de
    -- persoonlijke skills van een uuid opvragen. De grants sluiten dat pad ook
    -- af (revoke from public); dit is de tweede sluiting van dezelfde deur.
    select case
      when coalesce(auth.role(), '') in ('authenticated', 'anon') then auth.uid()
      else coalesce(p_caller_user_id, auth.uid())
    end as uid
  ),
  -- Regel 5. Rechtstreeks uit user_roles op de caller-uid — NOOIT via
  -- current_user_role(), die bij een lege auth.uid() 'member' teruggeeft.
  caller_role as (
    select r.app_role
      from public.user_roles r
     where (select uid from caller) is not null
       and r.user_id = (select uid from caller)
  )
  select s.slug, s.version, s.title, s.description, s.tool_binding, s.scope, s.triggers, s.sort_order
    from public.app_skills s
   where s.active = true
     and case s.scope
           when 'org'  then true
           when 'user' then (select uid from caller) is not null
                          and s.scope_user_id = (select uid from caller)
           when 'role' then exists (select 1 from caller_role cr where cr.app_role = s.scope_role)
           -- Regel 3, tweede helft: een scope-waarde die deze functie niet kent
           -- is onzichtbaar, niet zichtbaar.
           else false
         end
   order by s.sort_order, s.slug;
$function$;

comment on function public.app_skills_visible(uuid) is
  'Welke app_skills mag deze aanroeper zien? Het ENIGE zichtbaarheids-predicaat: app_skill_open() en app_skills_etag() selecteren hieruit. Fail-closed: geen identiteit = alleen scope=org. Negeert p_caller_user_id voor authenticated/anon (dan is auth.uid() de waarheid). Rol komt uit user_roles op de caller-uid, niet uit current_user_role().';

-- ─── 4. Trap 3: de body, achter hetzelfde predicaat ──────────────────────────
create or replace function public.app_skill_open(p_slug text, p_caller_user_id uuid default null)
returns table (slug text, version integer, title text, body text)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  -- Regel 1 en regel 4 in één query: de JOIN op app_skills_visible() IS de
  -- toegangscontrole, en een onzichtbare slug geeft daardoor 0 rijen —
  -- ononderscheidbaar van een slug die niet bestaat. Er staat hier bewust geen
  -- `where scope` en geen tweede caller-CTE.
  select s.slug, s.version, s.title, s.body
    from public.app_skills s
    join public.app_skills_visible(p_caller_user_id) v on v.slug = s.slug
   where s.slug = btrim(coalesce(p_slug, ''))
   limit 1;
$function$;

comment on function public.app_skill_open(text, uuid) is
  'Trap 3: de volledige body van EEN app_skill, maar alleen als app_skills_visible() hem voor deze aanroeper oplevert. Een onzichtbare slug geeft exact dezelfde uitkomst als een onbestaande (0 rijen) — het bestaan van een skill is zelf informatie.';

-- ─── 5. De set-etag: een cache-miss moet uitlegbaar zijn ─────────────────────
-- md5 over `slug:version` van de ZICHTBARE set. Verschilt hij tussen twee runs,
-- dan is er een skill bewerkt, toegevoegd, uitgezet of verschoven — in plaats
-- van dat een cache-miss een raadsel is. Selecteert uit hetzelfde predicaat.
create or replace function public.app_skills_etag(p_caller_user_id uuid default null)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(md5(string_agg(v.slug || ':' || v.version, ',' order by v.slug)), 'empty')
    from public.app_skills_visible(p_caller_user_id) v;
$function$;

comment on function public.app_skills_etag(uuid) is
  'md5 over slug:version van de voor deze aanroeper zichtbare set; ''empty'' als die set leeg is. Gaat mee in debug_pipeline.app_skills_etag en in agent_chat_run_state.';

-- ─── 6. RLS: voor de editor ──────────────────────────────────────────────────
alter table public.app_skills enable row level security;

-- Lezen: een beheerder ziet ALLES (hij moet ook de skill van een collega kunnen
-- bewerken), een gewone gebruiker precies wat er bij hém in de prompt komt —
-- via hetzelfde predicaat, zodat editor en chat niet uit elkaar kunnen lopen.
drop policy if exists app_skills_read on public.app_skills;
create policy app_skills_read on public.app_skills
  for select to authenticated
  using (
    (select public.is_admin_or_higher())
    or slug in (select v.slug from public.app_skills_visible() v)
  );

-- Schrijven: alleen admin/owner mét geldige MFA-sessie (is_admin_or_higher()).
drop policy if exists app_skills_admin_write on public.app_skills;
create policy app_skills_admin_write on public.app_skills
  for all to authenticated
  using ((select public.is_admin_or_higher()))
  with check ((select public.is_admin_or_higher()));

drop policy if exists app_skills_service on public.app_skills;
create policy app_skills_service on public.app_skills
  for all to service_role
  using (true) with check (true);

-- ─── 7. Grants: eerst PUBLIC eraf ────────────────────────────────────────────
-- Een kale CREATE FUNCTION geeft PUBLIC execute; zonder deze revokes zou de
-- anon-key `app_skills_visible('<uuid>')` mogen aanroepen. Zie de kop.
revoke execute on function public.app_skills_visible(uuid)          from public;
revoke execute on function public.app_skill_open(text, uuid)        from public;
revoke execute on function public.app_skills_etag(uuid)             from public;
revoke execute on function public.app_skills_bump_version()         from public;

grant execute on function public.app_skills_visible(uuid)   to authenticated, service_role;
grant execute on function public.app_skill_open(text, uuid) to authenticated, service_role;
grant execute on function public.app_skills_etag(uuid)      to authenticated, service_role;

-- ─── 8. De route-override staat UIT ──────────────────────────────────────────
-- D04-7: `triggers` + deze vlag maken een skill bereikbaar op de semantische
-- route (waar `skill_open` niet bestaat) door de route naar agentic te duwen.
-- Het patroon bestaat al (MAILBOX_RE, 06a WP4b) en is in één regel terug te
-- draaien. Hij staat UIT omdat de override vragen naar de duurste route schuift
-- (semantic p50 ~ $0,005 tegen agentic p50 ~ $0,05): aanzetten is een eigen
-- meting met de skills-categorie, expect_route en kosten-p50 per route erbij.
insert into public.agent_config (agent_name, config_key, config_value)
select 'rag-chat', 'skill_route_override', 'false'::jsonb
where not exists (
  select 1 from public.agent_config
   where agent_name = 'rag-chat' and config_key = 'skill_route_override'
);
