# Authentication — single source of truth

> **Bij elke API-call die een skill of Edge Function doet, lees deze file eerst.** Dit is de canonical bron voor: hoe je je aanmeldt, welke fallback je neemt, hoe je een nieuw secret in de Vault zet, hoe je een verse machine bootstrapt, en welke termen we gebruiken. Vervangt alle losse auth-blokken in skills (die straks alleen nog een 1-regel pointer hierheen bevatten).
>
> Deze file leeft op twee plekken: `dashboard-react/skills/agent-handbook/references/authentication.md` (canonical, ook gebruikt door VM-scheduled-skills) en `~/.claude/skills/agent-handbook/references/authentication.md` (snapshot voor lokale Claude Code sessies). **Update beide tegelijk** tot er een sync-script is.

---

## 0. Welke skills hebben auth nodig? — alle skills, niet alleen Composio

Misverstand wegnemen: dit project gaat NIET alleen over Composio (Outlook/HubSpot/Fireflies). **Élke skill die ook maar iets met de buitenwereld of met onze eigen DB doet heeft auth nodig.** Hieronder per skill-type:

| Skill-type | Wat doet hij | Welke auth heeft hij nodig | Welk kanaal |
|---|---|---|---|
| **Composio-skills** (auto-draft-execute, daily-admin, sales-on-road, sales-followups) | Outlook/HubSpot/Fireflies aanroepen | Composio API key + connection_id | **B** — Composio MCP→REST |
| **DB-only skills** (auto-draft scan, jellemind, task-organizer, security-monitor, legal-ai-research, agenda) | Schrijven naar `autodraft_mails`, `jellemind_lessons`, `tasks`, `security_findings`, `legal_ai_findings`, etc. | Supabase service-role (Edge Function) of Supabase MCP / cron_secret-via-proxy (Claude-sessie) | **C** — Cloud-MCP (Supabase) of intern Edge Function pad |
| **Vault-leesskills** (legal-ai-write, vercel-control, dashboard-refresh) | Eigen tokens uitlezen (Grok, Vercel, GitHub PAT) | Vault-key onder `skill:<>:<>` | **A** — Vault |
| **Multi-kanaal skills** (de meeste) | Combinatie van bovenstaande | Combinatie | A + B + C |

**Geen enkele skill is "auth-vrij".** Zelfs een "lees uit DB-mirror"-skill heeft Supabase-auth nodig — alleen de auth-route is anders dan Composio.

### Hoe komt een skill aan auth voor Supabase DB-writes?

Drie scenario's, identiek aan Vault-leesroutes (sectie 2.3):

| Skill draait als | Auth voor DB-toegang | Voorbeeld-skills |
|---|---|---|
| **Edge Function** (server-side, Supabase platform) | `SUPABASE_SERVICE_ROLE_KEY` automatisch in env | mail-sync-etl-v2, hubspot-sync-etl, jira-sync-etl, jellemind-embed, task-organizer-fireflies, vault-read-proxy zelf |
| **Claude-sessie met Supabase MCP geladen** | `mcp__7a90b865-…__execute_sql` voor SELECT/INSERT/UPDATE | agent-manager interactief, ad-hoc skill-runs |
| **Claude-sessie zonder Supabase MCP** (bv. scheduled task op VM) | service_role-key uit `process.env.LM_SUPABASE_SERVICE_ROLE_KEY` of via `vault-read-proxy` (`skill:global:supabase_service_role_key` als die in Vault gezet wordt) | scheduled skill-runs op VM zonder MCP |

**Belangrijk:** de orchestrator bemiddelt **geen** auth voor de skills. Hij is een scheduler — hij triggert "skill X moet nu draaien" maar levert zelf geen tokens. De skill regelt zelf zijn auth via één van bovenstaande paden. Dit is bewust ontwerp: skills zijn losstaand, de orchestrator hoeft de auth-stack niet te kennen.

### "Maar mijn skill schrijft alleen naar DB, geen Composio — dan toch auth nodig?"

Ja. Ook dan. `INSERT INTO autodraft_mails` faalt zonder auth. Het is geen Composio-call, maar wél een API-call naar Supabase die een geldig pasje vereist.

Het verschil: Composio-skills hebben **twee** auth-stappen (Composio API key + DB-toegang voor logging), DB-only-skills hebben **één** (alleen DB-toegang). Beide vallen in dit document.

---

---

## 1. Decision-tree — welk kanaal voor welke service?

```
Wat moet je doen?
│
├─ Een eigen secret/token uitlezen of zetten ─────────────► KANAAL A (Vault)
│  (OpenAI, Grok, GitHub PAT, Vercel token, cron_secret,
│   Composio API key, Supabase Management PAT, etc.)
│
├─ Outlook / HubSpot / Fireflies / Gmail / LinkedIn aanroepen
│  │
│  ├─ Read-only (search, get, list) ──────────────────────► KANAAL B (Composio)
│  │     of, voor Outlook-search specifiek: KANAAL C (MS365 Remote MCP)
│  │
│  ├─ Write zonder associations ──────────────────────────► KANAAL B v3 (tools/execute)
│  │
│  └─ Write MET associations (HubSpot note→deal, task→deal,
│     contact→deal, etc.) ────────────────────────────────► KANAAL B v2 (actions/proxy)
│                                                            ⚠ NIET v3 — known bug
│
├─ Slack / Atlassian (Jira/Confluence) / Vercel / Supabase
│  / MS365 search / Accommodations ──────────────────────► KANAAL C (Cloud-bound MCP)
│
└─ Onze eigen DB-mirror (hubspot_*, mail_messages, jira_issues,
   fireflies_meetings, calendar_events) ──────────────── Eerste keuze altijd
                                                          (sneller, geen API-cost)
                                                          Pas live MCP/REST als
                                                          sync_health_all() zegt
                                                          dat de mirror te oud is.
```

**Service-mapping tabel:**

| Service | Kanaal | Primary | Fallback |
|---|---|---|---|
| OpenAI / Grok / Anthropic API | A | Vault `skill:global:openai_api_key` etc. | — |
| GitHub PAT (git push) | A | Vault `skill:dashboard-refresh:github_token` | — |
| Vercel token | A | Vault `skill:dashboard-refresh:vercel_token` | — |
| Supabase service-role | A | Edge Function env-var `SUPABASE_SERVICE_ROLE_KEY` | — |
| Supabase Management PAT | A | Vault `skill:global:supabase_management_token` | Eerste sessie verse machine: Jelle plakt 'm in chat |
| Composio API key | A | Vault `skill:global:composio_api_key` | — |
| Outlook (write: draft, move, update) | B | Composio MCP `OUTLOOK_*` | Composio REST v3/tools/execute |
| Outlook (search/read) | C | MS365 Remote MCP `outlook_email_search` / `outlook_calendar_search` | — (anders: Composio v3 OUTLOOK_QUERY_EMAILS) |
| HubSpot (read: deals, companies, contacts) | B | DB-mirror eerst; daarna Composio MCP `HUBSPOT_*` | Composio REST v3/tools/execute |
| HubSpot (write met associations: notes, tasks) | B | **Composio REST v2/actions/proxy** | — geen primary MCP, want tool-bug |
| Fireflies | B | Composio MCP `FIREFLIES_*` | Composio REST v3/tools/execute |
| Slack | C | Slack MCP UUID `37030035-...` | Slack Web API als MCP weg |
| Jira / Confluence | C | Atlassian MCP UUID `8236b0dc-...` | Atlassian REST API met user-OAuth |
| Vercel | C | Vercel MCP UUID `2cf4ced6-...` | Vercel REST + token uit Vault |
| Supabase Postgres / Edge Functions deploy | C | Supabase MCP UUID `7a90b865-...` | Management API met PAT (kanaal A) |

---

## 2. Kanaal A — Vault (eigen secrets)

### 2.1 Naming-conventie

```
skill:<skill_name>:<secret_name>
```

* `<skill_name>` = `global` voor cross-skill secrets, anders de exacte slug van een skill.
* `<secret_name>` = lowercase, underscores, beschrijvend.

Voorbeelden: `skill:global:composio_api_key`, `skill:global:cron_secret`, `skill:global:supabase_management_token`, `skill:openai:embedding_key`, `skill:dashboard-refresh:github_token`, `skill:legal-ai-research:grok_api_key`.

### 2.2 Schrijven — drie paden

**Pad 1: dashboard UI (gewoonste route).** Settings → Tokens → API Keys → "Bewerk" op de rij. Roept `set_skill_secret(p_skill_name, p_secret_name, p_plaintext, p_description, p_updated_by)` RPC aan met JWT (`require_dashboard_auth`). Schrijft naar `vault.secrets`, upsert naar `skill_secrets_registry`, en `mark_secret_rotated` synct `secrets_inventory`. Realtime subscription ververst de tabel naar 🟢 Veilig.

**Pad 2: migration (postgres role, geen JWT).**

```sql
SELECT vault.create_secret(
  'sk-xxx...',
  'skill:mijn-skill:mijn_api_key',
  'Beschrijving — wanneer ingesteld, waarvoor'
);

INSERT INTO skill_secrets_registry
  (skill_name, secret_name, last_4, vault_secret_id, description, updated_by)
VALUES
  ('mijn-skill', 'mijn_api_key', 'xxxx', '<uuid van create_secret>',
   'Beschrijving', 'bootstrap')
ON CONFLICT (skill_name, secret_name) DO UPDATE SET
  vault_secret_id = EXCLUDED.vault_secret_id,
  last_4 = EXCLUDED.last_4,
  updated_at = now(),
  updated_by = 'bootstrap';
```

Zie `migrations/vault_migration_2026_05_02.sql` voor een live-getest voorbeeld dat 12 secrets in één pass migreerde.

**Pad 3: skill in een Claude-sessie.** Vraag Jelle om in dashboard te plakken (Pad 1). Een skill schrijft niet zelf naar Vault — dat is een mens-met-JWT-actie. Uitzondering: bootstrap-flow (sectie 5).

### 2.3 Lezen — vier paden, in volgorde van voorkeur

**Pad 1: Edge Function (Deno, service_role).**

```typescript
async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  // Probeer Vault eerst (encrypted, audit-logged)
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: agentName,
    p_secret_name: key,
  });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;

  // Fallback voor non-secret config (project IDs, watermerken, settings)
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}
```

`get_skill_secret_service` is service-role-only (anon → 42501 permission denied). Werkende referentie: `supabase/functions/mail-sync-etl-v2/index.ts:25-79`.

**Pad 2: Skill in Claude-sessie, met Supabase MCP geladen.**

```sql
-- Via execute_sql tool
SELECT decrypted_secret
FROM vault.decrypted_secrets
WHERE name = 'skill:global:composio_api_key';
```

**Pad 3: Skill in Claude-sessie, GEEN Supabase MCP.**

```bash
curl -s -X POST \
  "https://api.supabase.com/v1/projects/ezxihctobrqoklufawim/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '\''skill:global:composio_api_key'\''"}'
```

`SUPABASE_MANAGEMENT_TOKEN` zelf zit in Vault (`skill:global:supabase_management_token`). Op verse machine: bootstrap (sectie 5).

**Pad 4: `vault-read-proxy` Edge Function (aanbevolen voor Claude-sessies).**

Sinds 2026-05-03 is er een dedicated Edge Function `vault-read-proxy` die elk Claude-sessie of skill-runtime kan aanroepen, zonder Supabase MCP en zonder Management PAT. De skill heeft alleen het `cron_secret` nodig (in `process.env.LM_CRON_SECRET` of geplakt door Jelle in een verse sessie).

```bash
curl -s -X POST "https://ezxihctobrqoklufawim.supabase.co/functions/v1/vault-read-proxy" \
  -H "Authorization: Bearer $LM_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -H "x-caller-id: my-skill-name" \
  -d '{"skill_name":"global","secret_name":"composio_api_key"}'
# Response: {"ok":true,"value":"...","last_4":"...","skill_name":"global","secret_name":"composio_api_key"}
```

**Validatie aan de proxy-kant:**
* Auth: `Authorization: Bearer <cron_secret>` of `<service_role>`. Onjuist → `401`.
* Whitelist: `(skill_name, secret_name)` moet bestaan in `skill_secrets_registry`. Niet bekend → `404 secret_not_in_registry`. Geen wildcard-reads.
* Audit: elke call (success of fail) wordt gelogd in `agent_runs` met `agent_name='vault-read-proxy'`, met de gevraagde naam + `last_4` (NOOIT plaintext).

**Wanneer kies je Pad 4?**
* Verse Claude-sessie zonder Supabase MCP en zonder Management PAT — dit is de schoonste route.
* Skill heeft alleen `cron_secret` nodig (low-permission, kan alleen Vault-read via deze proxy doen). Lekkage = beperkte blast-radius vs. Management PAT.
* Edge Functions zelf (Deno service_role) gebruiken Pad 1, niet Pad 4 — die hebben al directe toegang.

**Bootstrap chicken-and-egg voor `cron_secret`:**
* Eerste sessie: Jelle plakt `cron_secret` 1× in chat OF zet 'm in `~/.claude/settings.local.json` als env-var `LM_CRON_SECRET`. Daarna lezen alle volgende sessies 'm via `process.env`.
* `cron_secret` is geen Management PAT — bij lekkage kun je 'm gewoon roteren via dashboard ApiKeysPage zonder de hele auth-stack te raken.

Code-locatie: `dashboard-react/supabase/functions/vault-read-proxy/index.ts`. Deploy via Management API (zie `agent-handbook/references/platform.md` § Edge Function deploy).

### 2.4 Wat NIET in Vault hoort

Niet-secrete config (project-IDs, watermerken, instellingen) blijft in `agent_config`:

```sql
-- OK in agent_config (niet-secret)
agent_config(global, vercel_project_id) = '"prj_xxx"'
agent_config(daily-admin, last_processed_at) = '"2026-05-03T..."'
agent_config(dashboard-refresh, vercel_live_url) = '"https://...vercel.app"'

-- NIET in agent_config (verhuis naar Vault)
agent_config(<>, *_token | *_key | *_secret | *_password)
```

Sinds 2026-05-02: `agent_config.is_secret = true` rijen bestaan niet meer. De kolom `is_secret` is een legacy-kolom die naar `false` blijft.

---

## 3. Kanaal B — Composio (Outlook, HubSpot, Fireflies, Gmail, LinkedIn)

### 3.1 Het mentale model

Composio levert twee paden naar dezelfde service. **Tool-namen zijn identiek**, alleen het transport verschilt:

| Pad | Wanneer | Auth |
|---|---|---|
| **MCP** | Wanneer Composio MCP geladen is in de sessie (UUID `82f94de2-e5ca-4223-ae7e-dc4513165411`, alias `legal-mind`) | Per-sessie OAuth, beheerd door Composio |
| **REST v3 — `tools/execute`** | Reads + writes zonder associations | Header `x-api-key` uit Vault |
| **REST v2 — `actions/proxy`** | **Uitsluitend voor HubSpot writes met associations** (note→deal, task→deal). De v3-tool heeft een bekende bug: `to__id` wordt niet vertaald naar `{"to": {"id": "..."}}` waardoor je `400 [to] required` krijgt. v2/proxy stuurt body direct door — geen abstractie, geen bug. | Body `connectedAccountId`, header `x-api-key` |

**Probeer-volgorde voor een skill:** MCP eerst (sneller, geen extra hop). Bij elke MCP-fout (`unknown tool`, `401`, `403`, `connection expired`): **niet stoppen, niet skippen, niet "volgende run"**. Schakel direct naar REST. Voor HubSpot association-writes: kies meteen v2/proxy.

### 3.2 De drie waarden die je nodig hebt

| Waarde | Bron | Default-fallback |
|---|---|---|
| `api_key` | Vault `skill:global:composio_api_key` | — |
| `connected_account_id` | `agent_config(<jouw-skill>, composio_connection_id)` | `agent_config(global, composio_connection_id_outlook)` / `_hubspot` / `_fireflies` |
| `user_id` | `agent_config(<jouw-skill>, composio_user_id)` → `agent_config(global, composio_user_id)` | `"user-jelle"` |

**Forever-reference connection IDs** (geverifieerd 2026-05-02):

* HubSpot: `2b6b451f-775e-4faa-ab90-d36372efc66c`  
  user: `pg-test-b9f9eca3-6438-4c72-9694-902a8bc7bba2`  
  endpoint hint: `agent_config(global, hubspot_proxy_endpoint) = "https://backend.composio.dev/api/v2/actions/proxy"`

### 3.3 Code-template — REST v3 tools/execute (reads + non-association writes)

Canonical implementatie in `supabase/functions/mail-sync-etl-v2/index.ts:25-79`:

```typescript
const COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3";

interface ComposioContext { apiKey: string; userId: string; connectionId: string; }

async function buildCtx(supabase: SupabaseClient): Promise<ComposioContext> {
  const apiKey = await getCfg(supabase, "global", "composio_api_key");
  if (!apiKey) throw new Error("composio_api_key_missing");
  const userId = (await getCfg(supabase, "<jouw-skill>", "composio_user_id"))
    ?? (await getCfg(supabase, "global", "composio_user_id")) ?? "user-jelle";
  const connectionId = await getCfg(supabase, "<jouw-skill>", "composio_connection_id");
  if (!connectionId) throw new Error("composio_connection_id_missing");
  return { apiKey, userId, connectionId };
}

async function execTool(ctx: ComposioContext, toolName: string,
                        toolArgs: Record<string, unknown>, retry = 0): Promise<ToolResult> {
  const res = await fetch(`${COMPOSIO_API_BASE}/tools/execute/${encodeURIComponent(toolName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ctx.apiKey },
    body: JSON.stringify({
      user_id: ctx.userId,
      connected_account_id: ctx.connectionId,
      arguments: toolArgs,
    }),
  });
  if (res.status === 429 && retry < 3) {
    const delays = [5000, 15000, 45000];
    await new Promise((r) => setTimeout(r, delays[retry]));
    return execTool(ctx, toolName, toolArgs, retry + 1);
  }
  const text = await res.text();
  let body: ToolResult;
  try { body = JSON.parse(text); }
  catch { throw new Error(`composio_non_json_${toolName}: ${res.status} ${text.slice(0,200)}`); }
  if (!res.ok) throw new Error(`composio_http_${res.status}_${toolName}`);
  return body;
}
```

Response-shape: `{ data: { response_data: { value: [...], "@odata.nextLink": "..." } } }`. Tool-namen zijn UPPER_SNAKE_CASE en identiek aan MCP-namen.

### 3.4 Code-template — REST v2 actions/proxy (HubSpot association-writes)

```typescript
const HUBSPOT_PROXY = "https://backend.composio.dev/api/v2/actions/proxy";

async function hubspotWrite(ctx: ComposioContext, endpoint: string, method: "POST" | "PATCH" | "PUT",
                             body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(HUBSPOT_PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ctx.apiKey },
    body: JSON.stringify({
      connectedAccountId: ctx.connectionId, // let op: camelCase, anders dan v3
      endpoint,                             // bv. "/crm/v3/objects/notes"
      method,                               // "POST" voor create, "PATCH" voor update
      body,                                 // direct doorgestuurd naar HubSpot
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(`hubspot_proxy_failed: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

// Voorbeeld: note op deal aanmaken met association
await hubspotWrite(ctx, "/crm/v3/objects/notes", "POST", {
  properties: {
    hs_note_body: noteBody,
    hs_timestamp: new Date().toISOString(),
    hubspot_owner_id: "83019371", // Jelle
  },
  associations: [{
    to: { id: dealId },
    types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 }] // 214 = Note→Deal
  }]
});
```

**Association type IDs (forever):** Note→Deal = `214`, Task→Deal = `216`. Beide `HUBSPOT_DEFINED`. Bevestigd werkend 2026-05-02.

### 3.5 Probeer-volgorde — pseudo-code

```
TRY:
  1. Composio MCP-tool aanroepen (mcp__82f94de2-...__<TOOL_NAME>)
CATCH MCP-fout (unknown_tool / 401 / 403 / connection_expired):
  2. Lees apiKey + connectionId + userId (zie 3.2)
  3. Kies REST-pad:
     - HubSpot write met associations? → v2/actions/proxy (sectie 3.4)
     - Anders → v3/tools/execute (sectie 3.3)
  4. Bij 429: backoff [5s, 15s, 45s]
  5. Bij 200 met `data.response_data` (v3) of `data.id` (v2): success
  6. Voeg "composio_mcp_down_used_rest_fallback" toe aan stats.warnings[]
     (en bij v2-gebruik óók "composio_v2_proxy_used")

NIET DOEN:
  - Skill skippen "tot volgende run" — volgende run heeft hetzelfde probleem
  - composio_auth_failed in errors[] schrijven zonder REST geprobeerd te hebben
  - Output beschrijven als "minder volledig" — REST geeft identieke data
```

### 3.6 Wanneer wel hard-fail (errors[] in plaats van warnings[])

Schrijf hard error met status `error` ALLEEN als óók de REST-route faalt:

| Symptoom | Code voor `errors[]` |
|---|---|
| Vault leeg (composio_api_key niet gezet) | `composio_api_key_missing` |
| connected_account_id niet vindbaar | `composio_connection_id_missing` |
| Composio backend 500/503/timeout op zowel MCP als REST | `composio_backend_down` |
| Tool bestaat niet in v3 EN v2 (404 op beide) | `composio_tool_not_found` |
| HubSpot v2/proxy 401 met geldige api_key (= connection revoked) | `composio_connection_revoked` |

Bij elke andere fout (waaronder MCP-down, single 500, transient 429): warning + REST-fallback.

---

## 4. Kanaal C — Cloud-bound MCP (Slack/Atlassian/Vercel/MS365/Supabase)

### 4.1 Per-service tabel

| Service | MCP UUID prefix | Detectie | Fallback bij missing | Fallback-auth |
|---|---|---|---|---|
| Atlassian (Jira/Confluence) | `mcp__8236b0dc-...__*` | ToolSearch `+searchConfluenceUsingCql` | Atlassian REST (`https://bg-intelligence.atlassian.net/wiki/rest/api/...` of `/rest/api/3/...`) | User-OAuth — vraag Jelle bij elke fresh sessie |
| Slack | `mcp__37030035-...__*` | ToolSearch `+slack_send_message` | Slack Web API (`https://slack.com/api/chat.postMessage`) | Bot-token uit Vault (`skill:global:slack_bot_token`) |
| Vercel | `mcp__2cf4ced6-...__*` | ToolSearch `+deploy_to_vercel` | Vercel REST (`https://api.vercel.com/v13/...`) | Token uit Vault (`skill:dashboard-refresh:vercel_token`) |
| MS365 (Outlook search/Teams) | `mcp__31714316-...__*` | ToolSearch `+outlook_email_search` | Geen directe — gebruik Composio v3 `OUTLOOK_QUERY_EMAILS` als alternatief read-pad | n/a |
| Supabase Postgres + Edge Functions | `mcp__7a90b865-...__*` | ToolSearch `+execute_sql` (faalt → not loaded) | Management API (`https://api.supabase.com/v1/projects/.../database/query`) | PAT uit Vault (kanaal A pad 3) |
| Composio (zie kanaal B) | `mcp__82f94de2-...__*` | ToolSearch `+OUTLOOK_LIST_FOLDERS` | Composio REST v3 of v2 | x-api-key (kanaal B) |
| Accommodations | `mcp__34c826a9-...__*` | ToolSearch `+accommodations_search` | Geen — uitzondering | n/a |

### 4.2 MCP-detectie — hoe weet ik of een MCP geladen is?

Niet pingen. **Probeer gewoon de tool aan te roepen.** Bij `unknown_tool` of een specifieke tool-naam-fout: MCP is niet geladen. De prijs is één failed call van ~50ms — niet de moeite waard om te detecteren.

Voor expliciete detectie (alleen bij debugging) kun je in een Claude-sessie ToolSearch gebruiken:

```
ToolSearch query="+OUTLOOK_LIST_FOLDERS" → 0 hits = Composio MCP niet geladen
ToolSearch query="+outlook_email_search" → 1 hit = MS365 Remote MCP wel geladen
```

### 4.3 Twee-deuren-regel voor Outlook

Outlook is bewust toegankelijk via twee kanalen:

| Operatie | Kanaal | Waarom |
|---|---|---|
| `OUTLOOK_CREATE_DRAFT_IN_FOLDER` (write) | B (Composio) | Composio levert write-tools die MS365 MCP niet heeft |
| `OUTLOOK_MOVE_MESSAGE` / `UPDATE_EMAIL` (write) | B (Composio) | Idem |
| `outlook_email_search` (read) | C (MS365) | Sneller, betere search-syntax (KQL) |
| `outlook_calendar_search` (read) | C (MS365) | Idem |
| `OUTLOOK_QUERY_EMAILS` (read, fallback) | B (Composio) | Alleen als MS365 MCP niet geladen is |

---

## 5. Bootstrap — verse machine, zonder Management PAT

Chicken-and-egg: de Management API PAT zit in Vault, maar je kunt Vault niet lezen zonder de PAT. Eerste sessie op een nieuwe machine:

1. Jelle plakt de PAT in chat (eenmalig). Bron: https://supabase.com/dashboard/account/tokens.
2. Skill (of Claude-sessie) test 'm met een 1-call query:
   ```bash
   curl -s -X POST "https://api.supabase.com/v1/projects/ezxihctobrqoklufawim/database/query" \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"query":"SELECT 1"}'
   ```
3. Werkt? Sla 'm direct op naar Vault via dashboard ApiKeysPage (UI-route — Settings → Tokens → API Keys → rij `supabase_management_token` → Bewerk). Niet via curl-write naar Vault — set_skill_secret vereist JWT.
4. Daarna: alle volgende sessies lezen 'm via Pad 3 (sectie 2.3).

**Niet doen:** PAT in `~/.bashrc`, `.env`, of `agent_config` plaatsen. Alleen de Vault.

---

## 6. Logging — wat zet je in agent_runs.stats?

Verplicht in `stats.warnings[]` (string-array, elke fallback één keer):

| Warning-string | Wanneer |
|---|---|
| `composio_mcp_down_used_rest_fallback` | Composio MCP gaf fout → REST overgenomen |
| `composio_v2_proxy_used` | HubSpot association-write via v2/proxy (i.p.v. v3 die zou falen) |
| `vault_unreachable_used_agent_config` | Vault leesfout → fallback naar agent_config (alleen voor non-secrete config!) |
| `mcp_missing_<service>` | Een Cloud-MCP (Slack/Atlassian/Vercel) was niet geladen — REST overgenomen |

In `stats.counts.composio_rest_calls` (number) hoeveel REST-calls de fallback maakte. Health-page pikt dit op zodat MCP-reconnect zichtbaar wordt zonder dat de skill faalt.

In `errors[]` (jsonb array van `{severity, code, message, context}`) **alleen** de hard-fails uit sectie 3.6.

---

## 7. Anti-patterns — wat NIET doen

| Anti-pattern | Waarom fout | Wat wel |
|---|---|---|
| HubSpot PAT direct gebruiken voor writes | PAT heeft alleen read-scopes, geeft 401 op note/task aanmaken | Composio v2/proxy |
| `HUBSPOT_CREATE_CRM_OBJECT_WITH_PROPERTIES` met `to__id` parameter | Tool-bug: vertaalt niet naar `{"to":{"id":...}}` — geeft `400 [to] required` | Composio v2/proxy direct |
| `agent_config(<>, *_token)` of `*_key` | Sinds 2026-05-02 staat dat in Vault, agent_config kan null teruggeven | Vault via `getCfg` (sectie 2.3) |
| Skill skippen "tot volgende run" bij MCP-down | Volgende run heeft hetzelfde probleem | Direct REST-fallback |
| `composio_auth_failed` in errors[] zonder REST geprobeerd | Status=error blokkeert skill terwijl REST gewoon werkt | Eerst REST proberen, dan pas hard-fail |
| Token in `.bashrc` of `.env` (op verse machine) | Lekkage bij screen-share / commit | Vault via dashboard |
| `Bearer $token` als plaintext in een SKILL.md voorbeeld | Risico: example wordt copy-pasted met echte waarde | Voorbeelden gebruiken altijd `<token>` of `$TOKEN` als placeholder |
| Skill schrijft zelf naar Vault zonder JWT | `set_skill_secret` vereist `require_dashboard_auth` | Vraag Jelle om in dashboard te plakken (UI-route) |
| Auth-check vóór succes-check ("auth lijkt OK, dus markeer als done") | Auth slagen ≠ remote API slaagde | Pas markeren als de remote response een `id` (of equivalente success-marker) bevat |

---

## 8. Glossary — terminologie

| Term | Betekenis |
|---|---|
| **Vault** | `vault.secrets` tabel in Supabase Postgres + bijbehorende `vault.decrypted_secrets` view. Encrypted-at-rest, audit-logged. |
| **Vault-key** | De rijnaam in `vault.secrets`, formaat `skill:<skill>:<secret>` |
| **Vault-secret** | De plaintext-waarde achter een Vault-key (alleen leesbaar via service_role of postgres-rol) |
| **`skill_secrets_registry`** | Index-tabel: per Vault-key de `last_4`, `vault_secret_id` (uuid), beschrijving, updated-at |
| **`secrets_inventory`** | Display-tabel: rijke metadata (display_name, purpose, category, rotation_url, status) — gebruikt door dashboard ApiKeysPage |
| **dashboard API Keys** | De UI-pagina (Settings → Tokens → API Keys) waar Jelle waardes invult |
| **service-role key** | Server-side Supabase key, mag Vault lezen via `get_skill_secret_service`. Zit in Edge Function env, NIET als VITE_-var |
| **Supabase Management API PAT** | Personal Access Token uit https://supabase.com/dashboard/account/tokens — Vault-key `skill:global:supabase_management_token` |
| **Composio MCP** | De tool-route via `mcp__82f94de2-...__*` — alias `legal-mind` |
| **Composio MCP-alias** | De named binding op Composio's kant (`legal-mind`) — kan verlopen, dan moet je Reconnect |
| **Composio API key** | x-api-key voor REST-calls — Vault-key `skill:global:composio_api_key` |
| **`connected_account_id` / `connectedAccountId`** | Composio's identifier voor één geauthenticeerde service (één Outlook-account, één HubSpot-portal). v3 gebruikt snake_case, v2 camelCase |
| **`composio_v3_tools_execute`** | REST endpoint `https://backend.composio.dev/api/v3/tools/execute/<TOOL>` voor reads + non-association writes |
| **`composio_v2_actions_proxy`** | REST endpoint `https://backend.composio.dev/api/v2/actions/proxy` voor HubSpot association-writes |
| **MS365 Remote MCP** | De Outlook-search/calendar/Teams-search MCP-server (UUID `31714316-...`) — leest, schrijft niet |
| **Cloud-MCP** | Verzamelnaam voor MCP-servers die door Claude's Cloud-omgeving worden geladen (Slack, Atlassian, Vercel, MS365, Composio, Supabase, Accommodations) |

---

## 9. Checklist voor nieuwe skill

Voordat je een externe API-call schrijft in een nieuwe skill, beantwoord deze 4 vragen:

1. **Welk kanaal?** A (Vault), B (Composio), of C (Cloud-MCP)? Zie decision-tree in sectie 1.
2. **Welke Vault-keys lees je?** Lijst ze als `skill:global:X` of `skill:<jouw-skill>:X`. Verifieer dat ze bestaan in `skill_secrets_registry` of zet nieuwe in via dashboard ApiKeysPage.
3. **Welke fallback?** Voor kanaal B: REST v3 of v2 (afhankelijk van HubSpot association-writes). Voor kanaal C: zie tabel sectie 4.1.
4. **Welke logging?** Welke warning-strings in `stats.warnings[]` bij fallback? Welke `errors[]`-codes bij hard-fail (sectie 3.6)?

In je SKILL.md schrijf je dan **één regel**:

```markdown
## Voorwaarden
- Voor authenticatie en MCP-fallback: zie
  agent-handbook/references/authentication.md (kanaal B — Composio).
```

Niet meer dan dat. Alle details staan hier.

---

## 10. Wijzigingen aan deze file

Update alleen via PR / explicit edit. Bij elke wijziging:

1. Vermeld in commit-bericht of versionMessage **welk kanaal** geraakt is.
2. Update beide kopieën tegelijk (`dashboard-react/skills/...` én `~/.claude/skills/...`).
3. Bij fundamentele wijziging (bv. nieuwe vendor-API, nieuwe naming-conventie): trigger ook `agent-handbook/SKILL.md` routing-tabel update.
4. Verifieer dat de skill-creator template nog naar deze file pointer (F.5).

---

_Laatst bijgewerkt: 2026-05-03 (initial). Vervangt: `composio-rest-fallback.md` (deprecated, 1 maand stub) + auth-blokken in 8+ skills (zie F.4 roll-out)._
