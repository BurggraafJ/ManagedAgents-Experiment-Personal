-- =============================================================================
-- 06c — meeting -[involves]-> company | contact | deal
-- =============================================================================
-- 2026-09-07 · spoor 06c (RESEARCH 06c/06e §2.3, vorken C1/C2).
--
-- HET PROBLEEM, DRIEMAAL ONAFHANKELIJK GEMETEN.
-- `v_entity_edges_full` had 22 edge-families en precies twee met `meeting`:
--     63  event   -[recorded_as]-> meeting
--     46  meeting -[organized_by]-> contact
-- Geen enkele arm van een meeting naar een BEDRIJF, en de organisator-arm helpt
-- niet: alle 47 meetings hebben een interne organisator (@legal-mind.nl), dus
-- die edge wijst altijd naar een collega. `match_chunks_for_entity` expandeert
-- precies één hop voor- en achteruit, dus voor ('company', X) kwam er nooit een
-- meeting-chunk mee. Bewijs (2026-09-07 08:0x UTC, runs/…-w0-p-before.json §P3
-- en …-w0-m13-entity-latency-before.json):
--     P3  8 gelinkte companies, probe = een meeting-macro-embedding →  0 / 8
--     M13 18 entities (company/contact/deal), warm                   →  0 meeting-chunks
--     via_edge-telling in 1.018 fragmenten → organized_by en recorded_as: 0×
-- Gevolg: de meeting-briefing, de agent die bestaat om te vertellen wat er
-- vorige keer besproken is, had in 9 van 61 bundels (14,8 %) een meeting-fragment.
--
-- HET MATERIAAL LAG ER AL. `fireflies_meetings.linked_entity_ids` bevat waarden
-- in de vorm `entity:<type>:<hubspot_id>`, geschreven door de categorisatie-
-- routine. Gemeten (P1): 51 distinctieve waarden, **51/51 = 100 %** lost op in
-- de mirror (22 contact, 15 deal, 14 company); als PAREN zijn het 160 rijen
-- (91 contact / 36 company / 33 deal), 0 met een onbekend type, 0 met een lege
-- id, 0 zonder `entity:`-wikkel. Dekking: 28/47 meetings → company (60 %),
-- 45/47 → contact (96 %), 24/47 → deal (51 %).
-- De alternatieve route (externe attendee-e-mail → entity_resolution) geeft 15
-- meetings → company en de UNIE met linked_entity_ids blijft 28: die arm voegt
-- NUL company-dekking toe (P2) en is daarom niet gebouwd (C1a).
--
-- WAAROM EEN TABEL EN GEEN VIEW-ARM (C2). Elke arm van `v_entity_edges_full`
-- draait bij ELKE aanroep van de RPC (memory entity-edges-view-runs-per-call).
-- 06b's eerste vorm van de engagement-arm bracht `match_chunks_for_entity` van
-- 1.445 naar 8.883 ms en liet 6 van 18 probes in de timeout lopen — terwijl de
-- ACL-golden-set 17/17 GROEN bleef. Vandaar een gematerialiseerde tabel van
-- ~160 rijen met een index, precies zoals hubspot_engagement_company_domain.
--
-- WAAROM confidence 0.95 EN NIET 0.7 (gemeten, en dit is de reden dat de arm
-- überhaupt zichtbaar is). De RPC expandeert met
--   `ORDER BY confidence DESC NULLS LAST, edge_type DESC LIMIT p_max_edges`
-- (migratie 20260906210000 r. 344/351) en p_max_edges is 300 op de agent-
-- recepten en 120 op search_fast. Gemeten backward-fan-in van de 17 gelinkte
-- companies (runs/…-w1-design.json § a/b): gemiddeld 69 edges, **max 516**, en
-- bij die drukste company 40 edges op confidence ≥ 1.0, 394 op ≥ 0.9 en 516 op
-- ≥ 0.7. Een arm op 0.7 — de waarde die 06b's engagement-arm gebruikt — zou daar
-- op positie 395+ staan en dus bij ZOWEL 120 als 300 worden afgekapt: onzichtbaar
-- op juist het bedrijf met de meeste historie. Op 0.95 staat de arm achter de 40
-- edges met confidence 1.0 en vóór de mail-arm (0.9) en de engagement-arm (0.7).
-- 0.95 en niet 1.0, want de link zelf komt van een LLM-categorisatie; de
-- id-RESOLUTIE is 100 % (P1), de semantische claim niet.
--
-- ⚠ ORDENING. Deze migratie herschrijft `v_entity_edges_full` met de VOLLEDIGE
--   live definitie, inclusief 06b's arm `engagement -[email_domain]-> company`
--   uit `hubspot_engagement_company_domain`. Die tabel staat op PROD maar de
--   migratie die hem maakt (20260907055000) zit in draft-PR #60, nog niet in
--   main — prod loopt vóór main (venster #9, memory prod-runs-ahead-of-main-v1146).
--   Zonder de guard hieronder zou een replay van main zonder #60 hier een view
--   bouwen die 4.262 engagement-edges STIL weggooit. De guard faalt liever hard.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.hubspot_engagement_company_domain') IS NULL THEN
    RAISE EXCEPTION '20260907060000_06c_meeting_entity_link verwacht 06b-migratie 20260907055000 (tabel hubspot_engagement_company_domain). Merge PR #60 vóór deze migratie, anders verliest v_entity_edges_full de engagement-email_domain-arm.';
  END IF;
END $$;

-- ─── 1. De gematerialiseerde link ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meeting_entity_link (
  meeting_id  uuid        NOT NULL REFERENCES public.fireflies_meetings(id) ON DELETE CASCADE,
  entity_type text        NOT NULL,
  entity_id   text        NOT NULL,
  source      text        NOT NULL DEFAULT 'linked_entity_ids',
  confidence  numeric     NOT NULL DEFAULT 0.95,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meeting_entity_link_pkey PRIMARY KEY (meeting_id, entity_type, entity_id),
  CONSTRAINT meeting_entity_link_type_chk CHECK (entity_type IN ('company', 'contact', 'deal'))
);

-- De RPC zoekt achteruit op (dst_type, dst_id) = (entity_type, entity_id).
CREATE INDEX IF NOT EXISTS idx_meeting_entity_link_entity
  ON public.meeting_entity_link (entity_type, entity_id);

COMMENT ON TABLE public.meeting_entity_link IS
  '06c (2026-09-07): meeting ↔ HubSpot-record, ontwikkeld uit fireflies_meetings.linked_entity_ids (vorm entity:<type>:<hubspot_id>). Alleen rijen die in de mirror resolven. Voedt de arm meeting -[involves]-> company|contact|deal in v_entity_edges_full. Gematerialiseerd omdat elke view-arm bij élke RPC-aanroep draait (06b: 1.445 → 8.883 ms). Verversing: trigger op fireflies_meetings + cron meeting-entity-link-refresh.';

-- Zelfde security-opzet als 06b's hubspot_engagement_company_domain, letterlijk:
-- die arm werkt aantoonbaar in dezelfde view en dezelfde (niet-SECURITY-DEFINER) RPC.
-- ⚠ Deze RLS filtert de VIEW niet: v_entity_edges_full heeft geen security_invoker
--   en draait dus met de rechten van de eigenaar (postgres, bypassrls). De echte
--   poort voor meeting-inhoud blijft de RLS op `chunks`
--   (chunks_authenticated_read: is_admin_or_higher() én owner_user_id), die WEL
--   geldt omdat match_chunks_for_entity geen SECURITY DEFINER is. Deze arm voegt
--   dus geen zichtbaarheid toe die de aanroeper niet al had; de RLS hieronder is
--   defence-in-depth voor wie de tabel direct bevraagt.
ALTER TABLE public.meeting_entity_link ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meeting_entity_link_read ON public.meeting_entity_link;
CREATE POLICY meeting_entity_link_read ON public.meeting_entity_link
  FOR SELECT TO authenticated USING ((SELECT public.is_admin_or_higher()));

DROP POLICY IF EXISTS meeting_entity_link_service ON public.meeting_entity_link;
CREATE POLICY meeting_entity_link_service ON public.meeting_entity_link
  FOR ALL TO service_role USING (true);

GRANT SELECT ON public.meeting_entity_link TO authenticated;
GRANT ALL    ON public.meeting_entity_link TO service_role;

-- ─── 2. Verversing: RPC + trigger + cron ─────────────────────────────────────
-- R10 uit het onderzoek: `linked_entity_ids` komt uit een GEHOSTE routine die niet
-- in git staat (memory hosted-routine-skill-copy-stale). Een volgende categorisatie-
-- ronde kan het formaat wijzigen. De refresh accepteert daarom BEIDE vormen — met
-- en zonder `entity:`-wikkel — mits het type af te leiden is, en `v_meeting_entity_link_health`
-- laat live zien hoeveel waarden niet resolven. Een view kan niet stale worden;
-- 06b's refresh-functie staat níet in pg_cron en gaat daardoor stil verouderen.
CREATE OR REPLACE FUNCTION public.meeting_entity_link_refresh()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  CREATE TEMP TABLE _mel_new ON COMMIT DROP AS
  WITH raw AS (
    SELECT m.id AS meeting_id, v AS val
      FROM fireflies_meetings m
      CROSS JOIN LATERAL unnest(coalesce(m.linked_entity_ids, ARRAY[]::text[])) AS v
     WHERE btrim(coalesce(v, '')) <> ''
  ), parsed AS (
    -- Met wikkel: entity:<type>:<id>. Zonder wikkel is het type niet af te leiden;
    -- die waarden vallen buiten de tabel en zijn zichtbaar in de health-view.
    SELECT meeting_id,
           CASE WHEN val LIKE 'entity:%' THEN split_part(val, ':', 2) ELSE NULL END AS entity_type,
           CASE WHEN val LIKE 'entity:%' THEN split_part(val, ':', 3) ELSE NULL END AS entity_id
      FROM raw
  )
  SELECT DISTINCT p.meeting_id, p.entity_type, p.entity_id
    FROM parsed p
   WHERE p.entity_type IN ('company', 'contact', 'deal')
     AND btrim(coalesce(p.entity_id, '')) <> ''
     AND (
          (p.entity_type = 'company' AND EXISTS (SELECT 1 FROM hubspot_companies c WHERE c.company_id = p.entity_id))
       OR (p.entity_type = 'contact' AND EXISTS (SELECT 1 FROM hubspot_contacts  c WHERE c.contact_id = p.entity_id))
       OR (p.entity_type = 'deal'    AND EXISTS (SELECT 1 FROM hubspot_deals     d WHERE d.deal_id    = p.entity_id))
     );

  DELETE FROM meeting_entity_link d
   WHERE d.source = 'linked_entity_ids'
     AND NOT EXISTS (SELECT 1 FROM _mel_new n
                      WHERE n.meeting_id = d.meeting_id
                        AND n.entity_type = d.entity_type
                        AND n.entity_id = d.entity_id);

  INSERT INTO meeting_entity_link (meeting_id, entity_type, entity_id, source, confidence)
  SELECT n.meeting_id, n.entity_type, n.entity_id, 'linked_entity_ids', 0.95
    FROM _mel_new n
  ON CONFLICT (meeting_id, entity_type, entity_id) DO NOTHING;

  SELECT count(*) INTO v_n FROM meeting_entity_link;
  RETURN v_n;
END $function$;

-- Bewust strakker dan 06b's refresh-functie, die `=X/postgres` (PUBLIC execute)
-- houdt: dit is een schrijfpad en hoort niet bij `anon` te liggen.
-- ⚠ REVOKE FROM PUBLIC alleen is niet genoeg: dit project heeft ALTER DEFAULT
--   PRIVILEGES dat elke nieuwe functie EXECUTE aan `authenticated` geeft (gemeten,
--   pg_default_acl: `f {…,authenticated=X/postgres,…}`). Zonder de tweede REVOKE
--   kan een ingelogde gebruiker deze herbouw aanroepen. Controleer met
--   has_function_privilege, niet met de proacl-tekst.
REVOKE ALL ON FUNCTION public.meeting_entity_link_refresh() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_entity_link_refresh() FROM authenticated;
REVOKE ALL ON FUNCTION public.meeting_entity_link_refresh() FROM anon;
GRANT EXECUTE ON FUNCTION public.meeting_entity_link_refresh() TO service_role;

COMMENT ON FUNCTION public.meeting_entity_link_refresh() IS
  '06c (2026-09-07): herbouwt meeting_entity_link uit fireflies_meetings.linked_entity_ids. Alleen rijen die in de HubSpot-mirror resolven; verwijdert rijen die dat niet meer doen. Idempotent. Aangeroepen door de trigger op fireflies_meetings (per rij) en door cron meeting-entity-link-refresh (mirror-kant).';

-- Snelle weg: één meeting wijzigt → alleen die meeting opnieuw ontwikkelen.
CREATE OR REPLACE FUNCTION public.meeting_entity_link_row_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM meeting_entity_link WHERE meeting_id = NEW.id AND source = 'linked_entity_ids';

  INSERT INTO meeting_entity_link (meeting_id, entity_type, entity_id, source, confidence)
  SELECT DISTINCT NEW.id, split_part(v, ':', 2), split_part(v, ':', 3), 'linked_entity_ids', 0.95
    FROM unnest(coalesce(NEW.linked_entity_ids, ARRAY[]::text[])) AS v
   WHERE v LIKE 'entity:%'
     AND split_part(v, ':', 2) IN ('company', 'contact', 'deal')
     AND btrim(split_part(v, ':', 3)) <> ''
     AND (
          (split_part(v, ':', 2) = 'company' AND EXISTS (SELECT 1 FROM hubspot_companies c WHERE c.company_id = split_part(v, ':', 3)))
       OR (split_part(v, ':', 2) = 'contact' AND EXISTS (SELECT 1 FROM hubspot_contacts  c WHERE c.contact_id = split_part(v, ':', 3)))
       OR (split_part(v, ':', 2) = 'deal'    AND EXISTS (SELECT 1 FROM hubspot_deals     d WHERE d.deal_id    = split_part(v, ':', 3)))
     )
  ON CONFLICT (meeting_id, entity_type, entity_id) DO NOTHING;

  RETURN NULL;
END $function$;

-- Een triggerfunctie hoort niet direct aanroepbaar te zijn door `anon`; een kale
-- CREATE geeft PUBLIC execute (gemeten op 06b's row-sync: `=X/postgres` staat er nog).
REVOKE ALL ON FUNCTION public.meeting_entity_link_row_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_entity_link_row_sync() FROM authenticated;
REVOKE ALL ON FUNCTION public.meeting_entity_link_row_sync() FROM anon;

DROP TRIGGER IF EXISTS trg_meeting_entity_link ON public.fireflies_meetings;
CREATE TRIGGER trg_meeting_entity_link
  AFTER INSERT OR UPDATE OF linked_entity_ids ON public.fireflies_meetings
  FOR EACH ROW EXECUTE FUNCTION public.meeting_entity_link_row_sync();
-- DELETE heeft geen trigger nodig: de FK staat op ON DELETE CASCADE.

-- R10-vangnet dat niet stale kan worden: hoeveel linked_entity_ids-waarden
-- vallen NIET in de tabel, en waarom. 0 verwacht (P1 = 51/51).
CREATE OR REPLACE VIEW public.v_meeting_entity_link_health AS
WITH raw AS (
  SELECT m.id AS meeting_id, v AS val
    FROM public.fireflies_meetings m
    CROSS JOIN LATERAL unnest(coalesce(m.linked_entity_ids, ARRAY[]::text[])) AS v
   WHERE btrim(coalesce(v, '')) <> ''
)
SELECT count(*)                                                                    AS n_values,
       count(*) FILTER (WHERE val NOT LIKE 'entity:%')                             AS n_without_prefix,
       count(*) FILTER (WHERE val LIKE 'entity:%'
                          AND split_part(val, ':', 2) NOT IN ('company','contact','deal')) AS n_unknown_type,
       count(*) FILTER (WHERE val LIKE 'entity:%' AND btrim(split_part(val, ':', 3)) = '') AS n_empty_id,
       count(*) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM public.meeting_entity_link l
                  WHERE l.meeting_id = raw.meeting_id
                    AND l.entity_type = split_part(raw.val, ':', 2)
                    AND l.entity_id   = split_part(raw.val, ':', 3)))              AS n_unresolved,
       (SELECT count(*) FROM public.meeting_entity_link)                           AS n_rows_in_table
  FROM raw;

GRANT SELECT ON public.v_meeting_entity_link_health TO authenticated, service_role;

COMMENT ON VIEW public.v_meeting_entity_link_health IS
  '06c (2026-09-07): live controle op R10 — linked_entity_ids komt uit een gehoste routine die niet in git staat, dus het formaat kan kantelen. n_unresolved > 0 betekent dat de vorm is gewijzigd of dat de mirror een record mist. Een view en geen cron-tabel, zodat dit signaal niet stil kan verouderen.';

-- Cron voor de MIRROR-kant: de trigger vuurt alleen als een meeting wijzigt, maar
-- een record kan aan de HubSpot-kant verdwijnen (dan hoort de rij weg) of pas ná
-- de meeting in de mirror landen (dan hoort de rij erbij). 06b's
-- hs_engagement_company_domain_refresh() staat NIET in pg_cron en verouderde
-- daardoor stil — dat gat niet herhalen. 03:40 UTC = na entity-resolution-nightly
-- (03:30) zodat een verse resolutie in dezelfde nacht meegaat.
SELECT cron.unschedule('meeting-entity-link-refresh')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meeting-entity-link-refresh');
SELECT cron.schedule('meeting-entity-link-refresh', '40 3 * * *',
  $cmd$SELECT public.meeting_entity_link_refresh();$cmd$);

-- ─── 3. Eerste vulling ───────────────────────────────────────────────────────
SELECT public.meeting_entity_link_refresh();

-- ─── 4. De arm in v_entity_edges_full ────────────────────────────────────────
-- CREATE OR REPLACE (geen DROP): de view houdt zo zijn proacl
-- {postgres,authenticated,service_role} — memory drop-function-verliest-proacl
-- geldt één op één voor views. Onderstaande tekst is de LIVE definitie van
-- 2026-09-07 08:0x UTC (pg_get_viewdef, runs/…-w0-precheck.json § c_edges_viewdef)
-- plus één nieuwe arm onderaan. De guard bovenaan deze migratie garandeert dat
-- 06b's arm hier niet uit een oudere main-stand wordt teruggedraaid.
CREATE OR REPLACE VIEW public.v_entity_edges_full AS
 SELECT e.src_type, e.src_id, e.dst_type, e.dst_id, e.edge_type,
        1.000 AS confidence, e.user_id
   FROM v_entity_edges e
UNION ALL
 SELECT 'mail'::text AS src_type, m.id AS src_id, 'contact'::text AS dst_type,
        er.entity_id AS dst_id, 'authored_by'::text AS edge_type, er.confidence, m.user_id
   FROM mail_messages m
     JOIN entity_resolution er ON er.alias_type = 'email'::text AND er.alias_value = lower(m.from_email) AND er.entity_type = 'contact'::text
  WHERE m.is_deleted = false AND m.from_email IS NOT NULL AND mail_row_in_scope(m.user_id, (SELECT mail_scope_user_ids() AS mail_scope_user_ids))
UNION ALL
 SELECT 'mail'::text AS src_type, m.id AS src_id, 'company'::text AS dst_type,
        er.entity_id AS dst_id, 'from_company'::text AS edge_type, er.confidence, m.user_id
   FROM mail_messages m
     JOIN entity_resolution er ON er.alias_type = 'email_domain'::text AND er.alias_value = lower(m.from_domain) AND er.entity_type = 'company'::text
  WHERE m.is_deleted = false AND m.from_domain IS NOT NULL AND mail_row_in_scope(m.user_id, (SELECT mail_scope_user_ids() AS mail_scope_user_ids))
UNION ALL
 SELECT 'mail'::text AS src_type, m.id AS src_id, 'deal'::text AS dst_type,
        d.deal_id AS dst_id, 'from_contact_on_deal'::text AS edge_type, 0.95 AS confidence, m.user_id
   FROM mail_messages m
     JOIN entity_resolution er ON er.alias_type = 'email'::text AND er.alias_value = lower(m.from_email) AND er.entity_type = 'contact'::text
     JOIN hubspot_deals d ON er.entity_id = ANY (d.associated_contact_ids)
  WHERE m.is_deleted = false AND m.from_email IS NOT NULL AND NOT d.is_archived AND mail_row_in_scope(m.user_id, (SELECT mail_scope_user_ids() AS mail_scope_user_ids))
UNION ALL
 SELECT 'mail'::text AS src_type, m.id AS src_id, 'deal'::text AS dst_type,
        d.deal_id AS dst_id, 'from_company_on_deal'::text AS edge_type, 0.75 AS confidence, m.user_id
   FROM mail_messages m
     JOIN entity_resolution er ON er.alias_type = 'email_domain'::text AND er.alias_value = lower(m.from_domain) AND er.entity_type = 'company'::text
     JOIN hubspot_deals d ON er.entity_id = ANY (d.associated_company_ids)
  WHERE m.is_deleted = false AND m.from_domain IS NOT NULL AND NOT d.is_archived AND mail_row_in_scope(m.user_id, (SELECT mail_scope_user_ids() AS mail_scope_user_ids))
UNION ALL
 SELECT 'event'::text AS src_type, a.calendar_event_id::text AS src_id, 'contact'::text AS dst_type,
        er.entity_id AS dst_id, 'attended_by'::text AS edge_type, er.confidence, a.user_id
   FROM calendar_attendees a
     JOIN entity_resolution er ON er.alias_type = 'email'::text AND er.alias_value = lower(a.email) AND er.entity_type = 'contact'::text
  WHERE a.email IS NOT NULL AND mail_row_in_scope(a.user_id, (SELECT mail_scope_user_ids() AS mail_scope_user_ids))
UNION ALL
 SELECT 'meeting'::text AS src_type, f.id::text AS src_id, 'contact'::text AS dst_type,
        er.entity_id AS dst_id, 'organized_by'::text AS edge_type, er.confidence, NULL::uuid AS user_id
   FROM fireflies_meetings f
     JOIN entity_resolution er ON er.alias_type = 'email'::text AND er.alias_value = lower(f.organizer_email) AND er.entity_type = 'contact'::text
  WHERE f.organizer_email IS NOT NULL
UNION ALL
 SELECT 'engagement'::text AS src_type, d.engagement_id AS src_id, 'company'::text AS dst_type,
        d.company_id AS dst_id, 'email_domain'::text AS edge_type, 0.7 AS confidence, NULL::uuid AS user_id
   FROM hubspot_engagement_company_domain d
UNION ALL
-- ── 06c: de nieuwe arm ──────────────────────────────────────────────────────
 SELECT 'meeting'::text AS src_type, l.meeting_id::text AS src_id, l.entity_type AS dst_type,
        l.entity_id AS dst_id, 'involves'::text AS edge_type, l.confidence, NULL::uuid AS user_id
   FROM meeting_entity_link l;

COMMENT ON VIEW public.v_entity_edges_full IS
  'Alle entity-edges voor match_chunks_for_entity: v_entity_edges plus de afgeleide armen. 06c (2026-09-07): arm meeting -[involves]-> company|contact|deal uit de gematerialiseerde meeting_entity_link, confidence 0.95 — hoog genoeg om de ORDER BY confidence DESC LIMIT p_max_edges (120/300) te overleven op een company met 516 backward-edges. Elke arm draait bij élke aanroep: nieuwe armen materialiseren, nooit als join-in-de-view.';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260907060000', '06c_meeting_entity_link')
ON CONFLICT (version) DO NOTHING;
