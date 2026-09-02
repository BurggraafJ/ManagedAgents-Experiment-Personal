-- =============================================================================
-- Triage van public.security_findings — F-10
-- Security review 2026-09-02, na het toepassen van migratie A t/m E
-- =============================================================================
-- F-10 was geen technische bevinding maar een procesbevinding: 6 open critical
-- en 9 open high, de oudste sinds 2026-06-01, terwijl de detectie het werk al
-- maanden goed deed. Nieuwe scans voegen niets toe zolang de wachtrij niet
-- leeggemaakt wordt. Dit bestand sluit de lus voor alles wat deze ronde écht
-- gefixt is, markeert de vier bekende false positives als zodanig, en zet de
-- dingen die tijdens het hardenen bovenkwamen erin — inclusief het ene stuk dat
-- open blijft.
--
-- Bewust NIET aangeraakt (echt, maar buiten deze opdracht):
--   • Hardcoded Management PAT in een lokaal helper-script op Jelle's machine
--     (2026-07-17) — staat niet in deze repo; git-historie is schoon.
--   • Management PAT in Vault ongeldig (2026-08-26), Vercel-token verlopen
--     (2026-08-25), changelog-recorder.token nog in agent_config (2026-06-12).
--   • De Composio-storingen en de agent_runs-observatie.
--
-- Idempotent: alle updates zijn where-status-gefilterd, de inserts zijn
-- not-exists-gefilterd.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Wat deze ronde gefixt is → resolved
-- -----------------------------------------------------------------------------
update public.security_findings set
  status = 'resolved',
  resolved_at = now(),
  notes = coalesce(notes || E'\n', '') ||
    '2026-09-02 security review: migratie A (REVOKE EXECUTE van anon én PUBLIC op '
    'alle eigen functies in public) + migratie C (assert_can_manage_dashboard() als '
    'eerste statement in 45 schrijvende SECURITY DEFINER-RPCs, set_secret_value vooraan). '
    'Geverifieerd op prod: anon krijgt 42501 op set_secret_value, member krijgt 403, '
    'owner en service_role komen door.'
where affected_object = 'rpc:anon_secret_writers'
  and coalesce(status, 'open') not in ('resolved', 'false_positive');

update public.security_findings set
  status = 'resolved',
  resolved_at = now(),
  notes = coalesce(notes || E'\n', '') ||
    '2026-09-02 security review: migratie A (REVOKE EXECUTE ON ALL FUNCTIONS FROM anon, '
    'plus REVOKE van PUBLIC — anon erfde het recht via de PUBLIC-grant, dus alleen '
    'revoken van anon had niets gedaan) + ALTER DEFAULT PRIVILEGES zodat nieuwe functies '
    'dicht starten. Geverifieerd op prod: 0 SECURITY DEFINER-functies zijn nog '
    'anon-uitvoerbaar (was 169).'
where affected_object = 'rpc:anon_security_definer_functions'
  and coalesce(status, 'open') not in ('resolved', 'false_positive');

update public.security_findings set
  status = 'resolved',
  resolved_at = now(),
  notes = coalesce(notes || E'\n', '') ||
    '2026-09-02 security review: migratie A zet security_invoker = on op alle 49 views '
    'in public (was 2). Views volgen nu de RLS van de caller in plaats van die van '
    'postgres (rolbypassrls). Daarbij is anon''s SELECT-grant op alle tabellen en views '
    'ingetrokken. Geverifieerd op prod: 49/49 en anon leest 0 relaties.'
where affected_object like 'views:security_definer%'
  and coalesce(status, 'open') not in ('resolved', 'false_positive');

update public.security_findings set
  status = 'resolved',
  resolved_at = now(),
  notes = coalesce(notes || E'\n', '') ||
    '2026-09-02 security review: migratie B dropt de anon-SELECT-policy en zet de read '
    'op is_admin_or_higher(); de UPDATE op meeting_briefing_config is daarmee ook '
    'owner-only. Geverifieerd op prod: 0 anon-policies in public.'
where (affected_object like 'meeting_briefing%' or affected_object like '%briefings anon read%'
       or affected_object like '%briefing cfg anon read%')
  and coalesce(status, 'open') not in ('resolved', 'false_positive');

update public.security_findings set
  status = 'resolved',
  resolved_at = now(),
  notes = coalesce(notes || E'\n', '') ||
    '2026-09-02 security review: password_hibp_enabled = true gezet via de Management API, '
    'op Development en productie.'
where affected_object = 'auth:leaked_password_protection'
  and coalesce(status, 'open') not in ('resolved', 'false_positive');

update public.security_findings set
  status = 'resolved',
  resolved_at = now(),
  notes = coalesce(notes || E'\n', '') ||
    '2026-09-02 security review: entity_resolution heeft RLS aan en één policy — '
    'entity_resolution_authenticated_read met is_admin_or_higher() (was blanket '
    'USING (true), omgezet in migratie B). Daarmee is de aanvaarde restrisico weg.'
where affected_object = 'table:entity_resolution'
  and coalesce(status, 'open') not in ('resolved', 'false_positive');

-- -----------------------------------------------------------------------------
-- 2. De vier false positives → false_positive
--    Dit zijn metadata-velden van 12 tekens, geen credentials. Ze drukten de
--    twee echte criticals weg (alert-fatigue is zelf een risico).
-- -----------------------------------------------------------------------------
update public.security_findings set
  status = 'false_positive',
  resolved_at = now(),
  notes = coalesce(notes || E'\n', '') ||
    '2026-09-02 security review: false positive. Dit is begeleidende metadata '
    '(een timestamp of een naam), geen secret-waarde. security-monitor Check 2 negeert '
    'sinds vandaag %_created_at, %_expires_at, %_name, %expiry%, %_updated_at en '
    '%_rotated_at, en kijkt naar de waarde-lengte in plaats van alleen de sleutelnaam.'
where affected_object ~ 'agent_config\..*(_created_at|_expires_at|_name)$'
  and coalesce(status, 'open') not in ('resolved', 'false_positive');

-- -----------------------------------------------------------------------------
-- 3. Wat tijdens het hardenen zelf bovenkwam
-- -----------------------------------------------------------------------------
insert into public.security_findings
  (scan_type, severity, category, title, detail, affected_object, status, resolved_at, notes)
select * from (values
  ('weekly_scan', 'high', 'auth',
   'mail-enricher was een onbeschermd endpoint met service-role en betaalde LLM-calls',
   'Van de tien Edge Functions zonder git-source (F-14) bleek mail-enricher de enige '
   'zonder auth-check: verify_jwt=false, geen cron_secret- of service-role-gate, draait '
   'met service-role en stookt per call OpenAI nano+mini over mailinhoud. De source is '
   'byte-exact teruggehaald uit de eszip-sourcemap en v10 heeft dezelfde gate als de '
   'andere cron-functies. Geverifieerd op prod: 401 zonder credential, 200 met de '
   'service-key. De andere negen hadden hun gate al of staan op verify_jwt=true.',
   'edge_function:mail-enricher', 'resolved', now(),
   'Gefixt in dezelfde ronde als de vondst.'),

  ('weekly_scan', 'medium', 'auth',
   'mail_enrichment_trigger_backfill_batch() stuurde geen credential mee',
   'De RPC las vault-secret ''service_role_key'', die op dit project niet bestaat. '
   '''Bearer '' || NULL is NULL, dus de vier POSTs naar mail-enricher gingen zonder '
   'Authorization-header de deur uit. Dat viel niet op omdat mail-enricher geen '
   'auth-check had. Met de nieuwe gate zou de mail-verrijking stil zijn stilgevallen. '
   'Migratie E laat de RPC skill:global:cron_secret lezen en luid falen als die mist.',
   'rpc:mail_enrichment_trigger_backfill_batch', 'resolved', now(),
   'Gevonden tijdens het hardenen van F-14; gefixt in migratie E.'),

  ('weekly_scan', 'medium', 'secrets',
   'cron_secret stond als letterlijke waarde in twee cron.job-commands',
   'chunker-meeting-v2-poll (jobid 23) en fireflies-categorize-poll (jobid 22) hadden de '
   'cron_secret inline in cron.job.command in plaats van de vault.decrypted_secrets-lookup '
   'die alle andere jobs gebruiken. Die command-tekst is leesbaar voor elke rol die '
   'cron.job mag lezen, inclusief de read-only rol van de security-scan. Migratie E zet ze '
   'op het Vault-patroon; beide zijn daarna met een echte call getest (HTTP 200, werk '
   'uitgevoerd). Rotatie van de cron_secret blijft een keuze voor Jelle — de waarde is '
   'niet publiek geweest, alleen breder leesbaar dan nodig.',
   'cron.job:22,23', 'resolved', now(),
   'Gevonden tijdens het hardenen; gefixt in migratie E.'),

  ('weekly_scan', 'medium', 'auth',
   'verify_jwt=true is geen gebruikersauthenticatie — de anon-key is een geldige JWT',
   'Gemeten op productie 2026-09-02: een call naar transcribe met uitsluitend de publieke '
   'anon-key kwam ongehinderd door de gateway, want die controleert alleen of de JWT '
   'geldig ondertekend is. transcribe doet daarom sinds v5 zelf een auth.getUser()-check '
   'en geeft 401 als er geen echte gebruiker achter de token zit. '
   'LET OP: dezelfde constructie geldt voor de andere browser-functies die alleen op '
   'verify_jwt=true leunen (kb-compose, outlook-live, taalcheck-v2, rag-chat, rag-search, '
   'auto-draft-spelcheck, mail-verbeteraar, mail-taalcheck). invite-user doet het al goed '
   '(auth.getUser + owner-check). Dit blijft OPEN als aparte ronde.',
   'edge_functions:verify_jwt_only', 'open', null,
   'transcribe is gefixt; de overige browser-functies nog niet — bewust buiten scope gehouden.'),

  ('weekly_scan', 'medium', 'code',
   'cleanup-nightly heeft geen achterhaalbare source; interne auth onbekend',
   'De Management API geeft voor cleanup-nightly een lege body (1 byte), dus er is niets '
   'te extraheren — ook niet uit de eszip-sourcemap. De function staat live op '
   'verify_jwt=false met service-role en draait dagelijks 03:33 via cron met een '
   'cron_secret-bearer. Of ze die bearer ook controleert is niet vast te stellen. Dit is '
   'het enige onderdeel van F-14 dat open blijft. Nodig: de source uit een lokale kopie of '
   'uit de Supabase-console (Functions > cleanup-nightly > Code), daarna dezelfde gate als '
   'de andere cron-functies.',
   'edge_function:cleanup-nightly', 'open', null,
   'Zie supabase/functions/cleanup-nightly/README.md in de repo.')
) as v(scan_type, severity, category, title, detail, affected_object, status, resolved_at, notes)
where not exists (
  select 1 from public.security_findings f
  where f.affected_object = v.affected_object
    and f.title = v.title
);

-- -----------------------------------------------------------------------------
-- 4. Rapportje in de notice-log
-- -----------------------------------------------------------------------------
do $triage$
declare
  n_open_crit int;
  n_open_high int;
begin
  select count(*) into n_open_crit from public.security_findings
   where severity = 'critical' and coalesce(status,'open') not in ('resolved','false_positive','dismissed','closed');
  select count(*) into n_open_high from public.security_findings
   where severity = 'high' and coalesce(status,'open') not in ('resolved','false_positive','dismissed','closed');
  raise notice 'Triage klaar: % open critical, % open high', n_open_crit, n_open_high;
end;
$triage$;

commit;
