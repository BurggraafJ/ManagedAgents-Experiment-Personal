-- =============================================================================
-- 06b WP1c, tweede slag — de domein-edge gaat in een TABEL, niet in de view
-- =============================================================================
-- Wat er gebeurde. Migratie `20260907052000` zette de arm rechtstreeks in
-- `v_entity_edges_full`: een `CROSS JOIN LATERAL unnest(...)` over
-- `hubspot_engagements` × `hubspot_companies.domain`. Functioneel goed
-- (4.250 edges, 276 companies, 3.463 engagements — exact de voorspelling), maar
-- `v_entity_edges_full` wordt door `match_chunks_for_entity` bij ELKE
-- entity-aanroep geëvalueerd, en die arm was de eerste die
-- `hubspot_engagements` binnentrok. Gemeten direct erna, op het echte pad
-- (`tools/cb-probe-06b-arms.cjs`, 6 echte vragen × 3 armen):
--
--   * 6 van de 18 aanroepen: `http_500: match_chunks_for_entity_failed:
--     canceling statement due to statement timeout` — allemaal op de arm met een
--     genoemde entity (`via = company_token_prefix`).
--   * `search_ms` p50 op de geslaagde named-entity-aanroepen 7.754-9.095 ms,
--     tegen 628-1.572 ms vóór 06b.
--   * Een losse query die alleen de twee edge-CTE's nadoet: **8.883 ms**, waar
--     `reach_from_company` vóór WP1c 1.445 ms deed.
--
-- Dat is risico R3 uit `RESEARCH.md` §5, precies zoals opgeschreven. De ACL bleef
-- wél dicht (poort b6: 17/17 ná de view-wijziging, run `a460fb3f`) — het was
-- latency, niet zichtbaarheid.
--
-- De reparatie: de afbeelding engagement → company is voor 99 % van de tijd
-- statisch (hij verandert alleen als HubSpot een nieuwe e-mail spiegelt of als een
-- bedrijfsdomein wijzigt). Die hoort dus één keer berekend en geïndexeerd, niet
-- 60 keer per minuut opnieuw. Deze migratie zet hem in een tabel van twee
-- kolommen met een index op `company_id`, en `20260907055000` laat de view-arm
-- daarop joinen.
--
-- Terugdraaien: `drop trigger`, `drop function`, `drop table`, en de view-arm terug
-- naar de vorm van `20260907052000` (of zonder arm).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.hubspot_engagement_company_domain (
  engagement_id text        NOT NULL,
  company_id    text        NOT NULL,
  matched_domain text       NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (engagement_id, company_id)
);

-- De richting die het klantpad gebruikt is `dst_id = <company>` → deze index is
-- de hele reden dat deze tabel bestaat.
CREATE INDEX IF NOT EXISTS idx_hs_eng_co_domain_company
  ON public.hubspot_engagement_company_domain (company_id);

COMMENT ON TABLE public.hubspot_engagement_company_domain IS
  '06b WP1c: gematerialiseerde afbeelding e-mail-engagement → company op het '
  'e-maildomein (from/to/cc, eigen domein uitgesloten). Voedt de arm `email_domain` '
  'van v_entity_edges_full. Bestaat omdat dezelfde berekening in de view '
  'match_chunks_for Entity liet timeouten (8,9 s tegen 1,4 s).';

-- RLS gelijk aan de mirrors waar deze rijen uit komen: `authenticated` mag lezen
-- als `is_admin_or_higher()` (dezelfde qual als `hubspot_companies_read` en
-- `hs_eng_read`), `service_role` mag alles. Beide id's zijn via die mirrors al
-- leesbaar, dus dit voegt geen zichtbaarheid toe — het maakt hem alleen niet
-- ruimer dan de bron.
ALTER TABLE public.hubspot_engagement_company_domain ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hs_eng_co_domain_read ON public.hubspot_engagement_company_domain;
CREATE POLICY hs_eng_co_domain_read ON public.hubspot_engagement_company_domain
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_higher()));

DROP POLICY IF EXISTS hs_eng_co_domain_service ON public.hubspot_engagement_company_domain;
CREATE POLICY hs_eng_co_domain_service ON public.hubspot_engagement_company_domain
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Volledige herbouw. Idempotent, en de enige plek waar de sleutel-definitie staat.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hs_engagement_company_domain_refresh()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  CREATE TEMP TABLE _hs_ecd_new ON COMMIT DROP AS
    SELECT DISTINCT e.id AS engagement_id, c.company_id,
           lower(split_part(btrim(a.addr), '@', 2)) AS matched_domain
      FROM hubspot_engagements e
      CROSS JOIN LATERAL unnest(string_to_array(concat_ws(',',
             e.type_specific->>'hs_email_from_email',
             e.type_specific->>'hs_email_to_email',
             e.type_specific->>'hs_email_cc_email'), ',')) AS a(addr)
      JOIN hubspot_companies c
        ON lower(nullif(c.domain, '')) = lower(split_part(btrim(a.addr), '@', 2))
     WHERE e.engagement_type = 'email'
       AND e.is_archived = false
       AND position('@' in a.addr) > 0
       AND lower(split_part(btrim(a.addr), '@', 2)) NOT LIKE '%legal-mind%';

  DELETE FROM hubspot_engagement_company_domain d
   WHERE NOT EXISTS (SELECT 1 FROM _hs_ecd_new n
                      WHERE n.engagement_id = d.engagement_id AND n.company_id = d.company_id);

  INSERT INTO hubspot_engagement_company_domain (engagement_id, company_id, matched_domain)
  SELECT n.engagement_id, n.company_id, min(n.matched_domain)
    FROM _hs_ecd_new n GROUP BY 1, 2
  ON CONFLICT (engagement_id, company_id) DO NOTHING;

  SELECT count(*) INTO v_n FROM hubspot_engagement_company_domain;
  RETURN v_n;
END $function$;

COMMENT ON FUNCTION public.hs_engagement_company_domain_refresh() IS
  '06b WP1c: herbouwt hubspot_engagement_company_domain volledig. Draai hem na een '
  'domeinwijziging op hubspot_companies — de per-rij-trigger dekt alleen wijzigingen '
  'aan de ENGAGEMENT-kant (zie IMPLEMENT-NOTES §3, open punt).';

-- -----------------------------------------------------------------------------
-- Bijhouden per engagement-rij. Zelfde vorm als 06d's status-trigger: AFTER
-- UPDATE OF <kolom> vuurt alleen als die kolom in de SET-lijst staat, dus de
-- HubSpot-sync houdt hem bij en niets anders raakt hem.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hs_engagement_company_domain_row_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM hubspot_engagement_company_domain WHERE engagement_id = OLD.id;
    RETURN OLD;
  END IF;

  DELETE FROM hubspot_engagement_company_domain WHERE engagement_id = NEW.id;

  IF NEW.engagement_type = 'email' AND NEW.is_archived = false THEN
    INSERT INTO hubspot_engagement_company_domain (engagement_id, company_id, matched_domain)
    SELECT DISTINCT NEW.id, c.company_id, lower(split_part(btrim(a.addr), '@', 2))
      FROM unnest(string_to_array(concat_ws(',',
             NEW.type_specific->>'hs_email_from_email',
             NEW.type_specific->>'hs_email_to_email',
             NEW.type_specific->>'hs_email_cc_email'), ',')) AS a(addr)
      JOIN hubspot_companies c
        ON lower(nullif(c.domain, '')) = lower(split_part(btrim(a.addr), '@', 2))
     WHERE position('@' in a.addr) > 0
       AND lower(split_part(btrim(a.addr), '@', 2)) NOT LIKE '%legal-mind%'
    ON CONFLICT (engagement_id, company_id) DO NOTHING;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_hs_engagement_company_domain ON public.hubspot_engagements;
CREATE TRIGGER trg_hs_engagement_company_domain
  AFTER INSERT OR DELETE OR UPDATE OF type_specific, is_archived, engagement_type
  ON public.hubspot_engagements
  FOR EACH ROW EXECUTE FUNCTION public.hs_engagement_company_domain_row_sync();

-- Eerste vulling.
SELECT public.hs_engagement_company_domain_refresh() AS n_rows;
