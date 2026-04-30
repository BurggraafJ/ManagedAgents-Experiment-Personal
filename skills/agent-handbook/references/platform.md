# Platform & Deployment playbook

## Stack-overzicht (2026-04-28)

| Laag | Technologie | Locatie |
|---|---|---|
| Frontend | React 18 + Vite (geen TypeScript) | `C:\Users\LM\Downloads\Dashboard\dashboard-react` |
| Hosting | Vercel | project `legal-mind-dashboard` (team `jelle-burggraaf`) |
| Backend logic | Supabase Edge Functions (Deno) | `dashboard-react/supabase/functions/` |
| Backend data | Supabase Postgres + pg_cron | project `ezxihctobrqoklufawim` |
| Source control | GitHub | `BurggraafJ/ManagedAgents-Experiment-Personal` |
| CI/CD | Vercel auto-deploy bij push naar `main` | geen aparte CI |

## Git-workflow

### Credentials (zonder dialog-prompt)

```bash
# Eenmalige setup (al gedaan op deze machine):
git config --global credential.helper store
echo "https://x-access-token:<PAT>@github.com" > ~/.git-credentials
chmod 600 ~/.git-credentials
```

PAT komt uit `agent_config(dashboard-refresh, github_token)` in Supabase. **Bij rotatie**: update Supabase + regenereer `~/.git-credentials`.

Als `git push` faalt op auth: check eerst `git config --global credential.helper` — moet `store` zijn (niet `manager`).

### Standaard commit-flow

```bash
cd /c/Users/LM/Downloads/Dashboard/dashboard-react
git status
git add <specifieke files>     # nooit `git add -A` — secrets-risk
git commit -m "<bericht>"
git push                        # triggers Vercel auto-deploy
```

Commit-bericht-stijl: één regel imperative + eventuele bullets met "wat" en "waarom".

### LF/CRLF warnings

Op Windows krijg je vaak `warning: in the working copy of '<file>', LF will be replaced by CRLF` bij commit. Negeer — git handelt het correct af. Niet `core.autocrlf` aanpassen tenzij echte issues.

## Vercel deploy-flow

### Auto-deploy (default)

Push naar `main` → Vercel detecteert via GitHub-integration → build + deploy. Tijd: 1-2 min.

### Handmatige deploy via API (vercel-control Edge Function)

Als auto-deploy hangt of je wil van een specifieke commit deployen:

```sql
SELECT net.http_post(
  url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/vercel-control',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (SELECT replace(config_value::text, '"', '') FROM agent_config WHERE agent_name='global' AND config_key='cron_secret')
  ),
  body := '{"action":"redeploy","branch":"main"}'::jsonb
);
```

Andere actions: `list` (recente deploys), `promote` (specifieke deploy → production), `cancel` (running deploy stoppen), `rollback` (alias voor promote met oude id).

### Deploy verifiëren

```sql
SELECT id, status, summary, completed_at, stats->'result'
  FROM agent_runs
 WHERE agent_name='vercel-control'
 ORDER BY started_at DESC
 LIMIT 1;
```

## Vercel pitfalls

### Eerste GitHub-auto-deploy soms CANCELED

Bij eerste push na initiele setup: deploy wordt door Vercel automatisch CANCELED. Reden: race-condition met GitHub-installation timing. Fix: handmatig triggeren via `POST /v13/deployments` met gitSource. Daarna werkt elke volgende push wel.

### Build-output > 500KB chunk warning

Vite produceert `index-*.js` van ~660KB. Warning is acceptable — meer-chunks splitten lost dat op maar voegt complexiteit toe. Niet fix tenzij Lighthouse-score een issue wordt.

### Secrets in build

VITE_-prefixed env-vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) zijn **expliciet client-side**. Anon-key is publiek-veilig zolang RLS aanstaat op alle tabellen. **Nooit** service-role key als VITE_-var.

## Supabase Edge Functions

### Deploy via MCP-tool (geen CLI nodig)

```typescript
// Via Claude's deploy_edge_function MCP tool:
mcp__7a90b865-...__deploy_edge_function({
  project_id: "ezxihctobrqoklufawim",
  name: "<slug>",
  entrypoint_path: "index.ts",
  verify_jwt: false,         // true voor user-callable, false voor cron-only met cron_secret
  files: [{ name: "index.ts", content: "..." }],
});
```

### Auth-pattern (cron + service-role)

Standaard binnen Legal Mind: alle Edge Functions hebben deze auth-check:

```typescript
const presented = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
const cronSecret = await getCfg(supabase, "global", "cron_secret");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!presented || (presented !== cronSecret && presented !== serviceKey)) {
  return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
}
```

User-JWT support voor browser-aanroep (zoals `vercel-control` v2): zie patroon in die file — accepteer JWT van Supabase auth.

### Cron-trigger pattern

```sql
SELECT cron.schedule(
  '<job_name>',
  '*/N * * * *',                -- of '0 H * * *' voor uur, '0 H D * *' voor dag
  $$
  SELECT net.http_post(
    url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/<slug>',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT replace(config_value::text, '"', '') FROM agent_config WHERE agent_name='global' AND config_key='cron_secret'),
      'x-trigger-source', 'pg_cron'
    ),
    body := '{}'::jsonb
  )
  WHERE EXISTS (SELECT 1 FROM ... WHERE pending);  -- voorkomt onnodige aanroepen
  $$
);
```

**Belangrijke regel**: voeg altijd een `WHERE EXISTS` clausule toe als de Edge Function alleen werk heeft als er pending records zijn. Anders draaien lege runs en pollen onnodig.

## React/Vite build-pitfalls

| Probleem | Fix |
|---|---|
| `npm run build` faalt op missing module | `npm install` opnieuw, eventueel `rm -rf node_modules && npm install` |
| Hot-reload werkt niet | Vite cache: `rm -rf node_modules/.vite` |
| Env-var niet beschikbaar in build | Moet beginnen met `VITE_` voor client-exposure |
| TypeScript errors terwijl project geen TS heeft | `vite-env.d.ts` of stale dependency — check `package.json` voor `typescript` ghost |

## Dashboard-architectuur

```
src/
├── App.jsx                # tab-router + auth + nav-groups
├── main.jsx               # entry
├── lib/supabase.js        # supabase client (anon-key, persistSession)
├── hooks/                 # useDashboard, useTheme, useSupabaseAuth, useNotifications
└── components/
    ├── Sidebar.jsx
    ├── views/             # NowView, AutoDraftView, RagSearchView, etc.
    │   └── mobile/
    └── sections/          # Inbox, KpiStrip, Schedules, etc.
```

**Toevoegen van een nieuwe view**:
1. Maak `src/components/views/<NewView>.jsx`
2. Import in `App.jsx`
3. Voeg toe aan `VIEWS` array (id, label, title, subtitle)
4. Voeg id toe aan juiste `NAV_GROUPS` children array
5. Render-conditie: `{view === 'newview' && <NewView />}`
6. `npm run build` om te valideren
7. Commit + push

## Cross-skill verwijzingen

- Database-werk (migrations, RPCs, RLS): `database.md`
- Security-aspect van platform (PAT-rotatie, Vercel-token): `security.md`
- Skill-iteraties (cowork plugin) zelf: agent-manager skill
- Specifiek dashboard-deployment: `dashboard-refresh` skill (cowork)
