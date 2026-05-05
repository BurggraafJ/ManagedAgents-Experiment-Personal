---
name: security-monitor
description: >
  Security monitoring skill voor het Legal Mind ecosysteem.
  Twee modi: 'daily_monitor' (ma-do, snelle DB-checks, geen code-lezen, stil als alles OK)
  en 'weekly_scan' (vrijdag, leest ook code, altijd rapporteert).
  Schrijft bevindingen naar security_findings tabel. Slack-alert bij critical/high.
  Trigger bij: "security check", "security scan", "security monitor",
  "draai security", "check RLS", of automatisch via orchestrator elke werkdag 07:00.
---

# Security Monitor — Legal Mind

Geautomatiseerde security-bewaking van het Legal Mind ecosysteem.
Twee modi in één skill — de modus wordt bepaald door de dag van de week.

**Database:** Supabase project `ezxihctobrqoklufawim` (EU-West-1)
**MCP prefix:** `mcp__7a90b865-a649-4156-8646-6c3475a8118b__`
**Fallback:** zie sectie "Auth & MCP-fallback" onderaan.
**Schedule:** dagelijks 07:00 werkdagen via orchestrator (`security-monitor` in agent_schedules).

---

## Architectuur — twee modi

| Modus | Wanneer | Wat | Rapportage |
|---|---|---|---|
| `daily_monitor` | ma t/m do | 4 DB-checks, geen code lezen | Stil als OK; Slack + DB bij bevinding |
| `weekly_scan` | vrijdag | DB-checks + code scan | Altijd rapporteert (ook als alles OK) |

---

## Stap 0 — Modus bepalen

Kijk naar de huidige dag (Europe/Amsterdam):

```python
from datetime import datetime
import pytz
dag = datetime.now(pytz.timezone('Europe/Amsterdam')).weekday()
# 0=ma, 1=di, 2=wo, 3=do, 4=vr
modus = 'weekly_scan' if dag == 4 else 'daily_monitor'
```

Als de skill handmatig wordt aangeroepen met een expliciete modus-aanduiding
("doe een weekly scan", "full scan") → forceer `weekly_scan`.

---

## Modus A — Daily Monitor (ma t/m do, ≤5 min)

Vier checks. Geen code bestanden lezen. Stil als alles OK.

### Check 1 — RLS: public/anon policies aanwezig?

```sql
SELECT schemaname, tablename, policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND (roles @> ARRAY['public'::name] OR roles @> ARRAY['anon'::name])
ORDER BY tablename, policyname;
```

**Bevinding als:** rijen teruggekomen (public/anon policy bestaat).
**Severity:** `critical` als `cmd` in ('INSERT','UPDATE','DELETE','ALL'), anders `high`.
**Categorie:** `rls`
**Affected object:** `tablename`

Toegestane uitzonderingen (geen bevinding loggen):
- Geen (na de RLS-hardening van 2026-05-02 zouden er 0 public/anon policies moeten zijn)

### Check 2 — Secrets: agent_config exposed?

```sql
SELECT agent_name, config_key, updated_at
FROM agent_config
WHERE is_secret = false
  AND (
    config_key ILIKE '%token%' OR config_key ILIKE '%key%'
    OR config_key ILIKE '%secret%' OR config_key ILIKE '%password%'
    OR config_key ILIKE '%api%' OR config_key ILIKE '%pat%'
    OR config_key ILIKE '%webhook%'
  )
ORDER BY agent_name, config_key;
```

**Bevinding als:** rijen teruggekomen.
**Severity:** `critical`
**Categorie:** `secrets`
**Affected object:** `agent_config.<agent_name>.<config_key>`

### Check 3 — RLS: tabellen zonder beveiliging?

```sql
SELECT t.table_name
FROM information_schema.tables t
JOIN pg_class c ON c.relname = t.table_name
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND c.relrowsecurity = false
ORDER BY t.table_name;
```

**Bevinding als:** rijen teruggekomen.
**Severity:** `high`
**Categorie:** `rls`
**Affected object:** `table:<table_name>`

### Check 4 — Config: nieuwe tabellen gisteren aangemaakt?

```sql
SELECT table_name, create_date::date
FROM information_schema.tables t
JOIN pg_class c ON c.relname = t.table_name
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
JOIN pg_stat_user_tables s ON s.relname = t.table_name
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND c.relrowsecurity = false
  -- alleen nieuwe tafels (aangemaakt laatste 48 uur) — pg_class heeft geen created_at
  -- gebruik alternatief: check relfilenode timestamp via stats
  ;
```

> Check 4 (nieuwe tabellen) is lastig via pure SQL. Gebruik dit alternatief:
>
> ```sql
> SELECT relname, relrowsecurity
> FROM pg_class
> WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
>   AND relkind = 'r'
>   AND relrowsecurity = false
>   AND NOT relname LIKE 'pg_%'
>   AND NOT relname LIKE 'sql_%'
> ORDER BY relname;
> ```
>
> Vergelijk de output met de bekende lijst. Als er een onbekende tabel zonder RLS bij staat → `high` bevinding.

### Beslissing na daily_monitor

| Resultaat | Actie |
|---|---|
| 0 bevindingen | Stil — geen Slack, geen DB-insert (behalve agent_runs heartbeat) |
| ≥1 bevinding, geen critical | Log naar `security_findings`, GEEN Slack |
| ≥1 critical bevinding | Log naar `security_findings` + Slack-alert (zie Stap 3) |

---

## Modus B — Weekly Deep Scan (vrijdag, ≤15 min)

Voert eerst alle 4 daily checks uit. Daarna aanvullende code-lees-checks.
**Altijd rapporteert**, ook als er niets gevonden is.

### Check 5 — Edge functions: hardcoded credentials?

Lees alle bestanden in `supabase/functions/` in de repository:

```
Pad: C:\Users\LM\Downloads\Dashboard\supabase\functions\
```

Zoek in elk bestand naar patronen die op credentials wijzen:

| Patroon | Wat het is | Severity |
|---|---|---|
| `sbp_[a-f0-9]{40}` | Supabase PAT | critical |
| `sbat_[a-zA-Z0-9]{40,}` | Supabase access token | critical |
| `sk-[a-zA-Z0-9]{40,}` | OpenAI API key | critical |
| `vcp_[a-zA-Z0-9]{30,}` | Vercel token | critical |
| `Bearer [A-Za-z0-9+/]{40,}` | Generic bearer token | high |
| `eyJhbGciO` | Raw JWT (hardcoded) | high |
| `xoxb-` of `xoxp-` | Slack token | critical |
| Env var direct inlined: `= "sk-` | Hardcoded in code | critical |

**Uitzonderingen:** strings in commentaar `//` of `#` die er als voorbeeld uitzien
(bijv. `# example: sbp_xxx`) → skip, log als `info`.

### Check 6 — SKILL.md bestanden: credentials?

Scan alle SKILL.md bestanden in de sessie op dezelfde patronen als Check 5.
Pad: zoek via `find` of Glob naar `*/SKILL.md` in `/sessions/`.

**Severity:** `critical` als echte token-waarde (niet placeholder).

### Check 7 — Vault volledigheid

```sql
SELECT secret_name, skill_name, created_at, last_updated_at
FROM skill_secrets_registry
ORDER BY skill_name, secret_name;
```

Vergelijk met bekende vereiste secrets (uit agent_config entries met `is_secret=true`):

```sql
SELECT agent_name, config_key
FROM agent_config
WHERE is_secret = true
ORDER BY agent_name, config_key;
```

**Bevinding als:** een `is_secret=true` entry in `agent_config` NIET voorkomt in
`skill_secrets_registry`. Dat betekent de waarde staat direct in agent_config
in plaats van in de Vault.

**Severity:** `medium`
**Categorie:** `secrets`

### Check 8 — RLS policies volledigheidsaudit

```sql
SELECT
  t.table_name,
  COUNT(p.policyname) AS policy_count,
  bool_or(c.relrowsecurity) AS rls_enabled
FROM information_schema.tables t
JOIN pg_class c ON c.relname = t.table_name
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
LEFT JOIN pg_policies p ON p.tablename = t.table_name AND p.schemaname = 'public'
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
GROUP BY t.table_name
ORDER BY t.table_name;
```

Rapporteer tabellen met `rls_enabled = true` maar `policy_count = 0`
(RLS aan, maar geen enkele policy → alles geblokkeerd, ook service_role?).

**Severity:** `medium` (kan legitiem zijn voor interne tabellen)

### Weekly scan rapport-formaat

```
🔍 Security Weekly Scan — [datum]
━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Check 1 RLS public/anon: 0 policies gevonden
✅ Check 2 agent_config exposed: 0 rijen
✅ Check 3 tabellen zonder RLS: 0
✅ Check 4 nieuwe objecten: geen onbekende
✅ Check 5 edge functions: geen credentials gevonden (X bestanden)
✅ Check 6 SKILL.md bestanden: geen credentials (Y bestanden)
⚠️  Check 7 Vault: 2 secrets staan in agent_config ipv Vault
✅ Check 8 RLS audit: alle tabellen hebben ≥1 policy

Bevindingen: 2 (0 critical, 0 high, 2 medium)
→ Zie security_findings tabel voor details
```

Stuur dit naar Slack-kanaal `feedback` (of `security` als dat bestaat).

---

## Stap 3 — Schrijf naar security_findings

Log elke bevinding:

```sql
INSERT INTO security_findings
  (scan_type, severity, category, title, detail, affected_object)
VALUES
  ('[daily_monitor|weekly_scan]',
   '[critical|high|medium|low|info]',
   '[rls|secrets|auth|code|config|network]',
   '[korte titel]',
   '[volledige uitleg]',
   '[tabel/bestand/config-key]');
```

Bij duplicaten (zelfde title + affected_object al open): GEEN nieuwe insert.
Check eerst:

```sql
SELECT id FROM security_findings
WHERE title = '[titel]'
  AND affected_object = '[object]'
  AND status = 'open'
LIMIT 1;
```

Alleen nieuwe insert als niets gevonden.

---

## Stap 4 — Slack alert bij critical/high (alleen daily_monitor)

Bij `severity = 'critical'` of `severity = 'high'` in daily_monitor:

```
🚨 Security Alert — [datum]
Bevinding: [title]
Ernst: CRITICAL
Object: [affected_object]
Detail: [eerste 150 tekens van detail]
→ security_findings tabel voor volledig rapport
```

Stuur naar `feedback` kanaal via Slack MCP.
Weekly scan stuurt altijd zijn rapport (zie Check 8 rapport-formaat hierboven).

---

## Stap 5 — agent_runs schrijven (verplicht, ook als alles OK)

```sql
INSERT INTO agent_runs
  (agent_name, status, summary, stats, started_at, completed_at, slack_channel)
VALUES (
  'security-monitor',
  '[success|warning|error]',
  '[daily_monitor: X checks OK, Y bevindingen | weekly_scan: X checks, Y bevindingen (Z critical)]',
  jsonb_build_object(
    'schema_version', '1',
    'skill_version',  'security-monitor-v1',
    'mode',           '[daily_monitor|weekly_scan]',
    'triggered_by',   '[orchestrator|manual]',
    'triggered_at',   '[start-ISO]',
    'passes',         jsonb_build_array(
      jsonb_build_object('name', 'checks', 'status', '[ok|findings]')
    ),
    'warnings',       '[]'::jsonb,
    'counts', jsonb_build_object(
      'checks_run',       [N],
      'findings_new',     [N],
      'findings_critical',[N],
      'findings_high',    [N]
    ),
    'extra', jsonb_build_object(
      'modus', '[daily_monitor|weekly_scan]'
    )
  ),
  '[start-ISO]'::timestamptz,
  now(),
  'feedback'
);
```

Status:
- `success` — 0 bevindingen of alleen `low`/`info`
- `warning` — ≥1 `medium` of `high` bevinding
- `error` — ≥1 `critical` bevinding of DB niet bereikbaar

---

## Bootstrap — eerste keer draaien

Als `security_findings` tabel nog niet bestaat:

```sql
-- Voer migrations/security_findings_table_2026_05_02.sql uit
```

Als `agent_schedules` entry voor `security-monitor` nog niet bestaat:
de migration hierboven voegt hem toe via INSERT ON CONFLICT.

---

## Auth & MCP-fallback

Voor élke Supabase-call (DB-toegang voor scan-queries, schrijven naar `security_findings`, secrets-checks): zie [`agent-handbook/references/authentication.md`](../agent-handbook/references/authentication.md). Daar staan alle 4 lees-paden voor Vault, Supabase MCP-fallback (Management API), bootstrap voor verse machine en de naming-conventie. Skill-specifiek: scan-queries gaan via MCP `execute_sql`; bij MCP-uitval Management API met PAT uit Vault (`skill:global:supabase_management_token`).

---

## Referenties

- Confluence: [Pijler 2 — Security Monitoring](https://bg-intelligence.atlassian.net/wiki/spaces/LM/pages/413368323)
- Confluence: [Project — Security Operations](https://bg-intelligence.atlassian.net/wiki/spaces/LM/pages/412057603)
- DB-tabel: `security_findings` (zie `migrations/security_findings_table_2026_05_02.sql`)
- Agent handbook: `agent-handbook/references/security.md`
- Supabase project: `ezxihctobrqoklufawim`
