---
name: agent-orchestrator
description: >
  Centrale orchestrator die bepaalt welke agents aan de beurt zijn en ze uitvoert.
  Leest agent_schedules uit Supabase, beheert run-locks, triggert skills op volgorde,
  en schrijft resultaten terug naar DB. Vervangt alle losse Cloud scheduled tasks door
  één centrale poller. Trigger bij: "run orchestrator", "orchestrator draaien",
  "draai de agents", "welke agents zijn aan de beurt", "check scheduled agents",
  "poll agents", of wanneer de scheduled task elke 15 minuten draait.
---

# Agent Orchestrator

Centrale poller voor het Legal Mind agent-ecosysteem. Leest `agent_schedules` uit Supabase,
bepaalt welke agents aan de beurt zijn op basis van cron-expressie en `last_run_at`,
beheert run-locks om dubbele runs te voorkomen, en voert elke verschuldigde agent sequentieel
uit door zijn SKILL.md te laden en de stappen te volgen.

**Database:** Supabase project `ezxihctobrqoklufawim` (EU-West-1)
**MCP prefix:** `mcp__7a90b865-a649-4156-8646-6c3475a8118b__`
**Fallback als MCP niet werkt:** zie sectie "Supabase MCP Fallback" onderaan.
**Schedule (Cloud task):** elke 30 minuten tussen 06:00–22:30 lokaal (nachten uit).
Cron: `0,30 6-22 * * *`. Dit is de **enige** scheduled task die nog in Cloud hoort te
staan — alle andere per-agent Cloud tasks (auto-draft-werkdagen, hubspot-daily-sync,
linkedin-connect-wekelijks, kilometerregistratie-maandelijks) zijn uitgeschakeld,
alle scheduling loopt via deze orchestrator.

---

## Architectuur — hoe het werkt

```
Cloud scheduled task (elke 15 min)
        │
        ▼
agent-orchestrator skill
        │
        ├── Leest agent_schedules uit Supabase
        ├── Bepaalt welke agents aan de beurt zijn
        ├── Reset stale locks
        │
        └── Voor elke verschuldigde agent:
              ├── Zet run-lock (is_running = true)
              ├── Laad SKILL.md van de agent
              ├── Voer de stappen uit
              ├── Schrijf resultaat naar agent_runs
              └── Reset lock + bereken next_run_at
```

**Sequentieel, niet parallel:** Agents worden één voor één uitgevoerd binnen dezelfde
sessie. Dit is bewust — het voorkomt race conditions en houdt de orchestrator eenvoudig.
Agents die langer duren dan de poll-interval worden beschermd door de run-lock.

---

## Stap 0 — Startcontext bepalen

Noteer het huidige tijdstip (lokale tijd NL, Europe/Amsterdam). Dit is de referentietijd
voor alle vergelijkingen in deze run. Gebruik het consistent — niet opnieuw ophalen
per stap, want de run duurt enige tijd.

```python
# Helper om next_run_at te berekenen — zie scripts/cron_utils.py
# python scripts/cron_utils.py "0 17 * * 1-5"
```

---

## Stap 1 — Agent schedules ophalen

```sql
SELECT
  agent_name,
  display_name,
  skill_name,
  cron_expression,
  enabled,
  last_run_at,
  next_run_at,
  is_running,
  run_lock_acquired_at,
  timeout_minutes,
  description
FROM agent_schedules
WHERE enabled = true
ORDER BY
  -- Prioriteer agents met verlopen next_run_at (eerst meest achterstallig)
  COALESCE(next_run_at, '1970-01-01'::timestamptz) ASC;
```

Als de query leeg terugkomt of Supabase niet bereikbaar is: log een fout en stop.
Geen agents betekent niets te doen — dat is geen fout op zich.

---

## Stap 2 — Stale locks detecteren en resetten

Een lock is **stale** (verlopen) als:
- `is_running = true` EN
- `now() - run_lock_acquired_at > timeout_minutes interval`

Dit betekent dat een vorige agent-run is gecrashed of de sessie is gestopt zonder
de lock vrij te geven. Reset de lock zodat de agent bij deze run opnieuw kan draaien.

```sql
UPDATE agent_schedules
SET
  is_running = false,
  run_lock_acquired_at = null,
  updated_at = now()
WHERE
  enabled = true
  AND is_running = true
  AND run_lock_acquired_at IS NOT NULL
  AND now() > run_lock_acquired_at + (timeout_minutes || ' minutes')::interval
RETURNING agent_name, timeout_minutes, run_lock_acquired_at;
```

Log elke reset als waarschuwing — een stale lock wijst op een vorige crash.
Voeg indien zinvol een `agent_runs` record toe met `status = 'error'` en
`summary = 'Run-lock stale gereset — vorige sessie mogelijk gecrasht'`.

---

## Stap 3 — Bepaal welke agents draaien

Voor elke agent uit Stap 1: controleer of die aan de beurt is.

**Een agent is aan de beurt als ALLE volgende voorwaarden gelden:**

1. `enabled = true` ✓ (al gefilterd in de query)
2. `is_running = false` (na stale-reset uit Stap 2)
3. Een van de volgende:
   - `next_run_at IS NULL` → nog nooit gerund, direct uitvoeren
   - `next_run_at <= [huidige tijd]` → geplande tijd is verstreken

**Een agent wordt overgeslagen als:**
- `is_running = true` (actieve lock, niet stale) → een andere sessie is bezig
- `next_run_at > [huidige tijd]` → nog niet aan de beurt

Maak een **te-draaien lijst** in volgorde van `next_run_at` (eerst meest achterstallig).
Log voor elke agent of hij meedraait en waarom (of waarom niet) — dit helpt bij debugging.

---

## Stap 4 — Per agent: lock zetten en uitvoeren

Voer de agents uit de te-draaien lijst **één voor één** uit. Voor elke agent:

### 4a. Lock zetten (atomisch)

```sql
UPDATE agent_schedules
SET
  is_running = true,
  run_lock_acquired_at = now(),
  updated_at = now()
WHERE agent_name = '[agent_name]'
  AND is_running = false  -- extra check: sla over als inmiddels gelocked
RETURNING agent_name, is_running;
```

Als de UPDATE niets teruggeeft (concurrent lock): sla deze agent over en ga naar de volgende.

### 4b. Skill pad bepalen

Zoek de SKILL.md van de agent op:

```bash
find /sessions -name "SKILL.md" -path "*[skill_name]*" 2>/dev/null \
  | grep -v "agent-orchestrator" | head -1
```

Als het pad niet gevonden wordt: sla de agent over, reset de lock, log een fout.

### 4c. SKILL.md laden en uitvoeren

Lees de gevonden SKILL.md. Voer de instructies daarin uit alsof Jelle de skill
handmatig heeft getriggerd — met één verschil: je bent de **orchestrator**, niet Jelle.
Dit betekent:

- Geen bevestiging vragen aan Jelle tenzij de skill dat expliciet vereist
- Bij vragen die normaliter naar Jelle gaan: controleer eerst `open_questions` in Supabase
  of de vraag al gesteld is. Als dat zo is, sla de actie over. Zo niet, voeg een record
  toe aan `open_questions` en ga verder met de `default_action`.
- Slack-berichten die de skill verstuurt: stuur ze gewoon (de skill weet wat hij moet doen)

Noteer de starttijd voor de `agent_runs` record.

### 4d. Resultaat vastleggen — door de agent zelf

> **Fase 4 — agents schrijven zelf naar Supabase.**
> De orchestrator schrijft GEEN `agent_runs` record meer. Elke agent voegt aan het
> einde van zijn eigen SKILL.md een Supabase-schrijfstap toe (zie per-agent SKILL.md).
> Dit zorgt ervoor dat ook on-demand runs (buiten de orchestrator om) worden vastgelegd.
>
> Als een agent crasht vóór zijn eigen schrijfstap, voeg dan een fallback `agent_runs`
> record toe met `status = 'error'` en `summary = 'Agent gecrasht — geen eigen run-record'`.

```sql
-- Alleen als de agent zelf GEEN agent_runs record heeft geschreven (crash-fallback):
INSERT INTO agent_runs
  (agent_name, status, summary, stats, started_at, completed_at, slack_channel)
VALUES
  ('[agent_name]',
   'error',
   'Agent gecrasht — geen eigen run-record geschreven',
   '{}'::jsonb,
   '[starttijd ISO]'::timestamptz,
   now(),
   '[slack_channel van de agent]')
ON CONFLICT DO NOTHING;
```

### 4e. Lock vrijgeven + next_run_at berekenen

```bash
# Bereken volgende run op basis van cron-expressie
python /sessions/[session]/agent-orchestrator/scripts/cron_utils.py "[cron_expression]"
# Output: ISO timestamp van volgende run
```

```sql
UPDATE agent_schedules
SET
  is_running = false,
  run_lock_acquired_at = null,
  last_run_at = now(),
  next_run_at = '[berekende next_run_at]'::timestamptz,
  updated_at = now()
WHERE agent_name = '[agent_name]';
```

**Belangrijk:** Reset de lock altijd, ook bij een fout. Een niet-gereset lock blokkeert
toekomstige runs tot de timeout verloopt.

---

## Stap 5 — Samenvatting + eigen run-record (verplicht)

Na het doorlopen van alle agents: log een beknopte samenvatting in de chat.

Formaat:
```
🤖 Orchestrator run — [tijdstip]
✅ [agent]: [korte actie]
⏭ [agent]: niet aan de beurt (next: [tijdstip])
⚠️ [agent]: overgeslagen — lock actief
```

Geen Slack-bericht nodig voor de orchestrator zelf. Elke individuele agent communiceert
via zijn eigen kanaal als de skill dat doet.

### Verplicht: eigen agent_runs record (heartbeat + audit)

Aan het einde van elke poll — ook als er niets te doen was — schrijf je ÉÉN record
naar `agent_runs` voor `agent_name='orchestrator'`. Dit voedt de heartbeat in het
dashboard en geeft een volledige audit-trail: **welke skill is getriggerd, waarom,
en met welk resultaat**. Overslaan maakt de orchestrator onzichtbaar.

```sql
INSERT INTO agent_runs
  (agent_name, status, summary, stats, started_at, completed_at, slack_channel)
VALUES (
  'orchestrator',
  '[success|warning|error]',       -- warning als stale-lock gereset of 1 agent faalde; error bij DB-fout of >50% crashes
  '[Poll — X polled, Y triggered (namen), Z skipped, S stale-locks]',
  jsonb_build_object(
    'polled',            [N],
    'triggered',         [
      {"agent": "auto-draft",          "skill": "auto-draft",
       "reason": "next_run_at 2026-04-21 06:00 was verlopen",
       "cron": "0 8,10,12,14,16,18,20 * * 1-5",
       "outcome": "success",           -- success | error | timeout
       "run_id": "[uuid van de agent_runs rij die de agent zelf schreef, indien bekend]"}
    ],
    'skipped',           [
      {"agent": "linkedin-connect",    "reason": "next_run_at 2026-04-27 nog in toekomst"},
      {"agent": "kilometerregistratie","reason": "next_run_at 2026-05-02 nog in toekomst"},
      {"agent": "dashboard-refresh",   "reason": "enabled = false (handmatig)"}
    ],
    'stale_locks_reset', [
      {"agent": "hubspot-daily-sync", "lock_age_min": 73}
    ],
    'poll_duration_ms',  [ms]
  ),
  '[start-ISO]'::timestamptz,
  now(),
  'feedback'
);

-- Ook last_run_at + next_run_at van orchestrator zelf bijwerken
UPDATE agent_schedules
SET last_run_at = now(),
    next_run_at = '[bereken via cron_utils.py op 0,30 6-22 * * *]'::timestamptz,
    updated_at  = now()
WHERE agent_name = 'orchestrator';
```

Status-regels voor de eigen run:
- `success` — geen stale locks, geen DB-fouten, triggers verliepen normaal (ook als er 0 triggers waren)
- `warning` — stale lock(s) gereset (iets is eerder gecrasht) of een individuele agent faalde
- `error` — DB niet bereikbaar, schedule niet leesbaar, of meer dan 50% van de agents crashte

### Convention: elke getriggerde agent schrijft `stats.triggered_by`

Wanneer de orchestrator een agent triggert: zorg dat de agent — in zijn eigen
`agent_runs` insert — het volgende veld meeneemt in `stats`:

```json
{
  "triggered_by": "orchestrator",
  "triggered_at": "2026-04-20T17:30:00+02:00",
  "...agent-specifieke metrics"
}
```

Handmatige triggers (Slack-mention, directe skill-aanroep door Jelle) gebruiken
`"triggered_by": "manual"`. Slack-event-triggers gebruiken `"triggered_by": "slack"`.

Zo is per run achterhaalbaar of hij door de orchestrator of buiten-om is gestart,
en kan het dashboard "door orchestrator" versus "handmatig" onderscheiden.

---

## Foutafhandeling

| Situatie | Actie |
|---|---|
| MCP-tools geven fout / unavailable | **Niet stoppen** — schakel over naar REST API-fallback (zie sectie hieronder) |
| Supabase volledig onbereikbaar (ook REST) | Stop, log fout in chat |
| SKILL.md niet gevonden | Sla agent over, reset lock, log fout |
| Skill crasht tijdens uitvoering | Reset lock, schrijf crash-fallback `agent_runs` met `status='error'` als agent zelf geen record schreef |
| Lock niet verkregen (concurrent) | Sla over, geen fout — normaal gedrag |
| Stale lock gevonden | Reset + log waarschuwing, daarna normaal uitvoeren |
| Alle agents overgeslagen | Normaal — log "Niets te doen bij deze poll" |

---

## Agent-specifieke aandachtspunten

### auto-draft
- Heeft twee cron-patronen: werkdagen `0 8,10,12,14,16,18,20 * * 1-5` en
  weekend `0 11,17 * * 0,6`. Sla het weekend-patroon op als aparte config in `agent_config`:
  ```sql
  SELECT config_value FROM agent_config
  WHERE agent_name = 'auto-draft' AND config_key = 'weekend_cron';
  ```
  Als de huidige dag zaterdag of zondag is: gebruik het weekend-patroon voor de check.

### dashboard-refresh
- `enabled = false` in `agent_schedules` — orchestrator slaat hem over.
  Draait alleen op afroep via directe skill-aanroep.

### kilometerregistratie
- Draait op de 2e van de maand. Bij een missed run (bijv. server was down):
  niet inhalen — wacht op volgende maand. Voeg noot toe aan `agent_config` als
  de run gemist is.

---

## Supabase — sleuteltabellen

| Tabel | Gebruik in orchestrator |
|---|---|
| `agent_schedules` | Lezen: config + status · Schrijven: locks + timestamps |
| `agent_runs` | Schrijven: run-resultaat per agent per run |
| `open_questions` | Lezen: heeft agent al een vraag gesteld? |
| `agent_config` | Lezen: weekendcron auto-draft, overige agent-config |

---

## Supabase MCP Fallback

Gebruik deze sectie wanneer de MCP-tools (`mcp__7a90b865-…__execute_sql` etc.) niet beschikbaar zijn of fouten geven. **Schakel niet zomaar over** — probeer MCP-tools altijd eerst. Geef je een fout als "unknown tool" of "tool not available"? Dan is de connector losgeraakt en gebruik je de REST API.

### Token ophalen

Het token staat in `agent_config(global, supabase_management_token)`.
Omdat je dat zonder MCP niet kunt lezen: Jelle heeft het token ingevuld via het dashboard (Configuratie → Skill-credentials). Vraag het eenmalig aan Jelle in het chatvenster voor je doorgaat.

Zodra je het token hebt, sla het op als variabele voor de rest van de sessie — niet herhalen elke query.

### SQL uitvoeren via Management API

```bash
curl -s -X POST \
  "https://api.supabase.com/v1/projects/ezxihctobrqoklufawim/database/query" \
  -H "Authorization: Bearer {SUPABASE_MANAGEMENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT agent_name, next_run_at, is_running FROM agent_schedules WHERE enabled = true ORDER BY next_run_at ASC"}'
```

Antwoord is een JSON-array van rijen. Dezelfde aanpak werkt voor alle queries — SELECT, UPDATE, INSERT.

### Voorbeeld: lock zetten via REST

```bash
curl -s -X POST \
  "https://api.supabase.com/v1/projects/ezxihctobrqoklufawim/database/query" \
  -H "Authorization: Bearer {SUPABASE_MANAGEMENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "UPDATE agent_schedules SET is_running = true, run_lock_acquired_at = now(), updated_at = now() WHERE agent_name = '\''auto-draft'\'' AND is_running = false RETURNING agent_name, is_running"}'
```

### Terugschakelen naar MCP

Na een REST-fallback run: meld in de samenvatting `⚠️ MCP unavailable — run via REST API`. Zo blijft het zichtbaar dat de connector aandacht nodig heeft. De orchestrator functioneert volledig via REST; kwaliteitsverlies is minimaal.

---

## Referenties

- Registry: `/sessions/[id]/mnt/.claude/skills/agent-manager/references/registry.md`
- Cron helper: `scripts/cron_utils.py` (in deze skill map)
- Supabase project: `ezxihctobrqoklufawim`
- Slack kanalen: zie `slack-communication` skill
