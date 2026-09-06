-- =============================================================================
-- 06a WP3 — entity_ids op mailchunks, extern-only                  (2026-09-06)
-- =============================================================================
-- `filter_entity_id` is voor mail vandaag dood: 0 van 4.060 bundels in 90 dagen
-- gebruikte hem, want geen enkele mailchunk draagt een entity_id (gemeten:
-- 14.338 mailchunks, 14.338 met entity_ids = '{}'). Alleen meeting-chunks doen
-- het (1.294). match_chunks filtert op
-- `filter_entity_id = ANY(c.entity_ids) OR c.primary_entity_id = filter_entity_id`,
-- dus vullen is genoeg — er hoeft niets aan de RPC te veranderen.
--
-- EXTERN-ONLY, en dat is het hele punt. Het koepelplafond van "60-67 %" telde
-- `mail_enrichment.related_contact/company` mee, en 8.318 van die 9.670 rijen
-- wijzen naar een INTERN contact (een collega). Zet je die erin, dan krijgt
-- `entity:contact:<collega>` 8.303 mails aan zich geknoopt en is het filter ruis
-- in plaats van signaal (dezelfde ziekte als de cap-300 op de edge-view,
-- RESEARCH §1.3). Daarom: alleen deelnemers op het bericht zelf (from + to + cc)
-- waarvan het domein NIET in mail_accounts.own_domains staat.
--
-- Gemeten plafond (prod, 2026-09-06, `coalesce(is_deleted,false)=false`):
--   afzender  → extern contact  1.287 mails ( 9,0 %)
--   afzenderdomein → company    1.582      (11,0 %)
--   to/cc     → extern contact  2.352      (16,4 %)
--   to/cc-domein → company      2.738      (19,1 %)
--   >= 1 externe entiteit       3.886      (27,1 %)   ← poort a3 rekent hierop
--   (8.895 (mail, entiteit)-paren; 3.268 mails krijgen een primary contact)
-- 64,7 % van de mail komt van het eigen domein; die blijft dus bewust leeg.
--
-- Geen re-embed: `entity_ids` staat buiten `content_with_context`, dus de
-- embedding en de HNSW-inhoud veranderen niet. De backfill maakt wél dode
-- tuples (GIN + btree op de gewijzigde kolommen sluiten een HOT-update uit),
-- daarom in batches van 2.000 — en `chunks` staat sinds 06f-α op
-- autovacuum_vacuum_threshold 200 / scale 0, dus die ruimt tussendoor op.
--
-- Twee objecten:
--   1. v_mail_chunk_source krijgt entity_ids + primary_entity_id (achteraan;
--      CREATE OR REPLACE VIEW mag alleen kolommen toevoegen). De chunker leest
--      ze en zet ze bij insert, zodat nieuwe mail meteen goed staat.
--   2. Eenmalige backfill over de bestaande 14.338 mailchunks.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_mail_chunk_source AS
 SELECT m.id,
    m.subject,
    m.body_preview,
    m.body_text,
    m.body_html,
    m.from_email,
    m.from_name,
    m.folder_path,
    m.conversation_id,
    m.received_at,
    e.party_type,
    COALESCE(e.party_lifecycle_at_moment, e.party_lifecycle_now) AS party_lifecycle,
    e.topics,
    e.speech_act,
    e.sentiment,
    e.asks_response,
    e.urgency,
    e.cycle_stage_signal,
    m.user_id,
    -- 06a WP3: externe deelnemers op dit bericht, als entity:<type>:<id>.
    COALESCE(ent.entity_ids, '{}'::text[]) AS entity_ids,
    ent.primary_entity_id
   FROM mail_messages m
     LEFT JOIN LATERAL ( SELECT me.party_type,
            me.party_lifecycle_at_moment,
            me.party_lifecycle_now,
            me.topics,
            me.speech_act,
            me.sentiment,
            me.asks_response,
            me.urgency,
            me.cycle_stage_signal
           FROM mail_enrichment me
          WHERE me.mail_id = m.id
          ORDER BY me.enriched_at DESC NULLS LAST
         LIMIT 1) e ON true
     -- Alle adressen op het bericht (from + to + cc), eigen domein eruit.
     LEFT JOIN LATERAL ( SELECT array_agg(DISTINCT a.addr) AS addrs
           FROM ( SELECT lower(m.from_email) AS addr
                  UNION
                  SELECT lower(r.rec ->> 'address')
                    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.to_recipients) = 'array' THEN m.to_recipients ELSE '[]'::jsonb END) AS r(rec)
                  UNION
                  SELECT lower(r.rec ->> 'address')
                    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.cc_recipients) = 'array' THEN m.cc_recipients ELSE '[]'::jsonb END) AS r(rec)
                ) a
          WHERE a.addr LIKE '%@%'
            AND split_part(a.addr, '@', 2) NOT IN (
                  SELECT DISTINCT lower(d) FROM mail_accounts ma, unnest(COALESCE(ma.own_domains, '{}'::text[])) d)
        ) p ON true
     -- Adres → contact, domein → company. Alleen wat entity_resolution kent.
     LEFT JOIN LATERAL ( SELECT COALESCE(array_agg(DISTINCT h.eid), '{}'::text[]) AS entity_ids,
                                min(h.eid) FILTER (WHERE h.eid LIKE 'entity:contact:%') AS primary_entity_id
           FROM ( SELECT ('entity:contact:' || er.entity_id) AS eid
                    FROM unnest(COALESCE(p.addrs, '{}'::text[])) AS ad(addr)
                    JOIN entity_resolution er
                      ON er.alias_type = 'email' AND er.entity_type = 'contact' AND er.alias_value = ad.addr
                  UNION
                  SELECT ('entity:company:' || er.entity_id)
                    FROM unnest(COALESCE(p.addrs, '{}'::text[])) AS ad(addr)
                    JOIN entity_resolution er
                      ON er.alias_type = 'email_domain' AND er.entity_type = 'company' AND er.alias_value = split_part(ad.addr, '@', 2)
                ) h
        ) ent ON true;

COMMENT ON VIEW public.v_mail_chunk_source IS
  'Bron voor chunkMail. 06a WP3 (2026-09-06): entity_ids/primary_entity_id erbij — alleen EXTERNE deelnemers (from/to/cc, domein niet in mail_accounts.own_domains) via entity_resolution. Intern zou entity:contact:<collega> aan 8.303 mails knopen en het filter tot ruis maken.';

-- ── Backfill over de bestaande mailchunks, batches van 2.000 ────────────────
DO $$
DECLARE
  v_n     int;
  v_total int := 0;
BEGIN
  CREATE TEMP TABLE _06a_mail_entities ON COMMIT DROP AS
    SELECT v.id AS source_id, v.entity_ids, v.primary_entity_id
      FROM public.v_mail_chunk_source v
     WHERE cardinality(v.entity_ids) > 0;
  CREATE INDEX ON _06a_mail_entities (source_id);

  LOOP
    WITH todo AS (
      SELECT c.chunk_id, t.entity_ids, t.primary_entity_id
        FROM public.chunks c
        JOIN _06a_mail_entities t ON t.source_id = c.source_id
       WHERE c.source = 'mail'
         AND c.entity_ids IS DISTINCT FROM t.entity_ids
       LIMIT 2000
    )
    UPDATE public.chunks c
       SET entity_ids       = todo.entity_ids,
           primary_entity_id = todo.primary_entity_id,
           updated_at       = now()
      FROM todo
     WHERE c.chunk_id = todo.chunk_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
    EXIT WHEN v_n = 0;
  END LOOP;

  RAISE NOTICE '06a WP3 backfill: % mailchunks kregen entity_ids', v_total;
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260906222000', '06a_mail_entity_ids')
ON CONFLICT (version) DO NOTHING;
