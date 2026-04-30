---
name: dashboard-refresh
description: >
  Beheert de Legal Mind Agent Command Center — een React + Supabase + Vercel app
  die live de status van alle autonome agents toont. Dashboard draait op
  https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app met auto-deploy bij
  elke push naar main. Deze skill is eigenaar van code-wijzigingen, deploys,
  rollbacks, token-rotatie en architectuur-beslissingen.
  Trigger bij: "update dashboard", "pas dashboard aan", "deploy dashboard",
  "push naar Vercel", "nieuwe versie deployen", "rollback dashboard",
  "wat is de dashboard URL", "dashboard status/health check",
  "redesign dashboard", of wijzigingen aan files in
  `C:\Users\LM\Downloads\Dashboard\dashboard-react`.
  Trigger NIET als Jelle alleen wil KIJKEN — verwijs dan naar de live URL.
  Trigger NIET voor agent-data vragen zonder dashboard-intentie.
---

# Dashboard Refresh Skill

Volledige eigenaar van de Legal Mind Agent Command Center (v4). Weet hoe de app
is gebouwd, welke data erin zit, hoe de React-componenten structureren en hoe
wijzigingen via GitHub → Vercel live komen.

Confluence-context (voor diepere achtergrond):
*Software Development → Dashboard Agent — Technische Documentatie*.

---

## Quick reference — wat Jelle zegt, wat je doet

| Jelle zegt | Actie |
|---|---|
| "update dashboard" / "pas dashboard aan" / "push" | **Deploy-flow** (zie onder) |
| "wat is de dashboard URL" | Lees `agent_config.vercel_live_url` — geen flow nodig |
| "rollback" / "promote oude deploy" | **Rollback-flow** |
| "health check" / "hoe gaat het met het dashboard" | **Health-check** (live URL + RLS probe) |
| "lokaal draaien" / "dev server" | `npm run dev` in `dashboard-react/` |
| "redesign" / grote wijzigingen | Overweeg preview-branch route (zie Dev/prod) |

---

## Runtime-omgeving

**Windows (Jelle's eigen machine — primair):**
- Werkmap: `C:\Users\LM\Downloads\Dashboard\dashboard-react\`
- Shell: Git Bash (MINGW) met `curl`, `base64`, `git`, `sha1sum`
- Node: 24.x geïnstalleerd in `C:\Program Files\nodejs\` — **niet** default op PATH in Git Bash
- Geen `jq`, `gh` of Vercel CLI → alles via REST API + curl
- Elke build: `export PATH="/c/Program Files/nodejs:$PATH"` vóór npm

**Cowork-sandbox (secundair — voor automation):**
- Werkmap: `/sessions/[session-id]/mnt/outputs/dashboard-react/`
- Volledige toolchain, npm beschikbaar
- Allowlist-vereiste: `api.vercel.com`, `*.vercel.app`, `api.github.com`

---

## Deploy-flow — dè workflow

**99 %-route:** `edit → build sanity → commit → push → (manueel triggeren indien CANCELED) → klaar`.

```bash
export PATH="/c/Program Files/nodejs:$PATH"
cd C:/Users/LM/Downloads/Dashboard/dashboard-react

# 1. Wijzigingen maken in src/…

# 2. Sanity-build (vangt imports/typos)
npm run build

# 3. Commit
git add .
git -c user.email="burggraaf@legal-mind.nl" -c user.name="Jelle Burggraaf" \
  commit -m "<korte beschrijving>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

# 4. Push — token tijdelijk in URL (niet in .git/config)
GH_TOKEN=$(agent_config.github_token)
git push "https://BurggraafJ:${GH_TOKEN}@github.com/BurggraafJ/ManagedAgents-Experiment-Personal.git" main:main \
  | sed -E 's/github_pat_[A-Za-z0-9_]+/<redacted>/g'

# 5. Check auto-deploy status (~5 s na push)
curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=$PROJECT_ID&teamId=$TEAM_ID&limit=1"
# Verwacht: readyState = BUILDING of READY op commit SHA
```

### Als auto-deploy CANCELED raakt (komt regelmatig voor)

```bash
curl -sS -X POST "https://api.vercel.com/v13/deployments?teamId=$TEAM_ID&forceNew=1" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"name":"legal-mind-dashboard","project":"'$PROJECT_ID'",
           "target":"production",
           "gitSource":{"type":"github","repoId":1215342015,"ref":"main"}}'
```

Poll `/v13/deployments/$DEPLOY_ID` tot `readyState=READY`, dan:

```bash
curl -sS -o /dev/null -w "%{http_code}" https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app/
# Verwacht: 200
```

Schrijf deploy-record terug:

```sql
UPDATE agent_config
SET config_value = to_jsonb(now()::text), updated_at = now()
WHERE agent_name = 'dashboard-refresh' AND config_key = 'vercel_last_deploy';

INSERT INTO agent_runs (agent_name, status, summary, stats, started_at, completed_at)
VALUES ('dashboard-refresh', 'success',
  '<beschrijving van de wijziging>',
  jsonb_build_object('mode','vercel','deploy_id','<dpl_…>','commit','<sha>',
                     'trigger','<auto|manual-rest-api>'),
  now() - interval '2 minutes', now());
```

---

## Architectuur — Agent Command Center v4

**Enkele scrollbare pagina** met sidebar (desktop) of sticky top-bar (mobile). Geen tabs.

```
dashboard-react/
├── package.json           ← vite + react 18 + @supabase/supabase-js
├── vite.config.js
├── index.html
├── .env                    ← VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (niet in git)
└── src/
    ├── main.jsx            ← ErrorBoundary wrapt <App/>
    ├── App.jsx             ← shell + section-routing + jump-links
    ├── index.css           ← design tokens (CSS custom properties) + layout
    ├── lib/supabase.js
    ├── hooks/
    │   ├── useDashboard.js      ← 6 parallelle queries, realtime subscriptions, polling fallback
    │   └── useActiveSection.js  ← IntersectionObserver voor sidebar-highlight
    └── components/
        ├── ErrorBoundary.jsx   ← toont stacktrace i.p.v. zwart scherm bij crash
        ├── Sidebar.jsx         ← desktop nav + orchestrator heartbeat
        ├── MobileBar.jsx       ← mobile nav met chip-scroller
        ├── Heartbeat.jsx       ← orchestrator status-dot (pulsing)
        ├── AgentCard.jsx       ← per-agent: sparkline, summary, metric, inline open vragen
        ├── QuestionCard.jsx    ← jsonb context via `renderContext()` — NOOIT direct renderen
        ├── FeedbackCard.jsx
        ├── Sparkline.jsx       ← 7-slot status bars
        └── sections/
            ├── ActionRail.jsx     ← id="actie"    — urgente vragen + feedback + overdue
            ├── LiveNow.jsx        ← id="nu"       — wat draait + volgende run + klok
            ├── TodayTimeline.jsx  ← id="vandaag"  — horizontal timeline 06:00–22:00
            ├── KpiStrip.jsx       ← id="week"     — 4 KPI's met week-trend
            ├── Agents.jsx         ← id="agents"   — dynamisch uit agent_schedules
            ├── Inbox.jsx          ← id="inbox"    — vragen + feedback
            ├── Schedules.jsx      ← id="schedules"
            ├── LinkedInProgress.jsx ← id="linkedin" (alleen als data)
            └── Config.jsx         ← id="config"
```

### Sectie-volgorde (top-to-bottom)

1. **Actie** — wat vraagt NU aandacht (sorted op urgentie)
2. **Live nu** — running agent + next run + orchestrator heartbeat + klok
3. **Vandaag** — timeline met dots per run, now-line
4. **Week** — KPI's + trend vs. vorige week
5. **Agents** — grid, dynamisch uit `agent_schedules`
6. **Inbox** — alle open vragen + feedback (open + verwerkt)
7. **Schedules** — cron-tabel
8. **LinkedIn** — voortgang per kantoor (alleen als er rijen zijn)
9. **Systeem** — metadata

### Welk bestand voor welke wijziging

| Wijziging | Bestand |
|---|---|
| Nieuwe Supabase query | `src/hooks/useDashboard.js` |
| Agent card layout | `src/components/AgentCard.jsx` |
| Open vragen layout | `src/components/QuestionCard.jsx` |
| Sparkline | `src/components/Sparkline.jsx` |
| Live-nu panel | `src/components/sections/LiveNow.jsx` |
| Timeline | `src/components/sections/TodayTimeline.jsx` |
| KPI's | `src/components/sections/KpiStrip.jsx` |
| Inbox | `src/components/sections/Inbox.jsx` |
| Schedules-tabel | `src/components/sections/Schedules.jsx` |
| Nieuwe sectie | `src/components/sections/<Name>.jsx` + import + route-id in `App.jsx` + link in `baseLinks()` |
| Kleuren / fonts / spacing | CSS custom properties in `src/index.css` (`:root`) |

---

## Design tokens

Alle styling loopt via CSS custom properties in `src/index.css :root`. Bij wijzigingen: raak die aan, niet de individuele componenten.

```
--bg, --surface-1..4       ← achtergronden (donker)
--text, --text-dim, --text-muted, --text-faint
--accent (#E86832)          ← Legal Mind oranje
--success (#4caf50) / --warning (#e0a800) / --error (#d9534f)
--font (-apple-system, Segoe UI, ...)  / --mono (SF Mono, Consolas)
--s-1..8                    ← spacing (4..40 px)
--r-sm/md/lg/xl             ← border-radius
--sidebar-w (232px)         ← sidebar breedte
```

Mobile-first: media-query op `max-width: 900px` verbergt sidebar, toont `MobileBar`.

---

## Supabase — data-laag

### Project info

| Veld | Waarde |
|---|---|
| Project ID | `ezxihctobrqoklufawim` |
| MCP prefix | `mcp__7a90b865-a649-4156-8646-6c3475a8118b__` |
| Anon key | `agent_config.supabase_anon_key` (als publishable) of ophalen via `get_publishable_keys` — gebruikt als `VITE_SUPABASE_ANON_KEY` in Vercel |

### Queries (`useDashboard.js` draait deze zes parallel)

```sql
-- Laatste 500 runs (voor latest-per-agent + today-timeline)
SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 500;

-- Alle open vragen
SELECT * FROM open_questions ORDER BY expires_at ASC NULLS LAST;

-- Laatste 50 feedback-rijen
SELECT * FROM agent_feedback ORDER BY created_at DESC LIMIT 50;

-- Schedules
SELECT * FROM agent_schedules ORDER BY agent_name;

-- 14-daagse run-history (voor sparklines)
SELECT agent_name, status, started_at FROM agent_runs
WHERE started_at >= now() - interval '14 days'
ORDER BY started_at DESC;

-- LinkedIn voortgang (alleen dit jaar)
SELECT * FROM linkedin_progress
WHERE year = EXTRACT(YEAR FROM now())
ORDER BY week_number DESC LIMIT 30;
```

De hook leidt daaruit af: `latestRuns`, `history`, `todayRuns`, `questionsWithUrgency`,
`weekStats`, `lastWeekStats`, `orchestratorAgeMin`, `overdueSchedules`, `runningSchedules`,
`nextRun`.

### Realtime subscriptions

Gedebounced refetch bij elke change op `agent_runs`, `open_questions`,
`agent_feedback`, `agent_schedules`. Polling elke 2 min als fallback. Zie
`useDashboard.js` effect onderin.

### Row-Level Security

Frontend gebruikt de **anon key**. Elke tabel die de UI leest moet een
read-only anon-policy hebben. `agent_config` (bevat secrets) juist NIET.

```sql
-- Public-read (5 tabellen):
ALTER TABLE agent_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_questions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_feedback    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_schedules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkedin_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read" ON agent_runs FOR SELECT TO anon USING (true);
-- etc. per tabel
```

`agent_config` blijft service_role-only (is_secret rijen) + authenticated voor niet-secret.

---

## Vercel — hosting

Alle metadata leeft in Supabase `agent_config` met `agent_name='dashboard-refresh'`:

| Key | Is secret | Voorbeeld |
|---|---|---|
| `vercel_project_name` | nee | `legal-mind-dashboard` |
| `vercel_project_id` | nee | `prj_lpz5GovvE3bfXwicMbiyA5KIqjNJ` |
| `vercel_team_id` / `_slug` | nee | `team_Zoitfw8ULKvq7TUE4qGswbuT` / `jelle-burggraaf` |
| `vercel_live_url` | nee | production URL |
| `vercel_last_deploy` | nee | timestamp |
| `vercel_token` | **ja** | `vcp_…` REST API bearer |
| `vercel_token_created_at` / `_expires_at` | nee | voor expiry-check |

Lees de values on-demand, niet bij elke sessie-start.

### Project-configuratie (al ingesteld)

- Framework: `vite`, output: `dist`
- Env-vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Repo-koppeling: `BurggraafJ/ManagedAgents-Experiment-Personal` (repoId `1215342015`), branch `main`
- Deployment Protection: uitgeschakeld (publieke toegang)

---

## GitHub — repo

| Key | Is secret | Waarde |
|---|---|---|
| `github_username` | nee | `BurggraafJ` |
| `github_repo_owner` / `_name` | nee | `BurggraafJ` / `ManagedAgents-Experiment-Personal` |
| `github_token` | **ja** | `github_pat_…` fine-grained, scope = 1 repo |

Push altijd via tijdelijke token-in-URL vorm — nooit in `.git/config`:

```
git push "https://BurggraafJ:${GH_TOKEN}@github.com/<owner>/<repo>.git" main:main
```

Maskeer output: `| sed -E 's/github_pat_[A-Za-z0-9_]+/<redacted>/g'`.

---

## Dev- en productie-omgeving

**Lokaal dev** (snelste loop, elke save herlaadt):
```bash
cd dashboard-react
export PATH="/c/Program Files/nodejs:$PATH"
npm run dev
# http://localhost:5173
```

**Vercel preview** (auto, per branch die ≠ main):
Push naar feature-branch → Vercel maakt automatisch een unieke preview-URL
(bv. `legal-mind-dashboard-git-feat-xyz-jelle-burggraaf.vercel.app`).
Ideaal voor redesigns of grote wijzigingen — Jelle kan klikken vóór merge naar main.

**Productie:** push naar `main` (zie Deploy-flow). Auto-deploy duurt ~90 s;
trigger handmatig bij CANCELED.

Aanbeveling: grote wijzigingen eerst op een `feat/*`-branch, kleine fixes direct op main.

---

## Agent-data & status-regels

### Status-logica per agent-card

- **Running (pulsing accent):** `agent_schedules.is_running = true`
- **Success (groen):** laatste run `status='success'` en geen open vragen
- **Warning (oranje):** `status='warning'` OF open vragen > 0
- **Error (rood):** `status='error'` of run ouder dan verwachte interval
- **Idle (grijs):** geen run-data

### Urgency-logica per open vraag (`useDashboard.js`)

- `expired` — `expires_at < now`
- `urgent` — `expires_at` binnen 24 uur
- `warning` — 3+ dagen open
- `ok` — rest

### Verwachte run-intervallen

| Agent | Verwacht |
|---|---|
| auto-draft | werkdag 08-20 elke 15 min; weekend 11:00 en 17:00 |
| hubspot-daily-sync | werkdag 17:00 |
| linkedin-connect | maandag 09:00 |
| kilometerregistratie | 2e van de maand 08:00 |
| orchestrator | elke 15 min (heartbeat-bron) |
| dashboard-refresh zelf | on-demand, geen staleness-check |

### Orchestrator-heartbeat

Afgeleid uit `latestRuns['orchestrator'].started_at`:
- `< 20 min` → groen pulsing
- `20–60 min` → oranje
- `> 60 min` → rood
- geen data → idle-grijs

---

## Rollback

```bash
# Lijst laatste 10 deploys
curl -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=$PROJECT_ID&teamId=$TEAM_ID&limit=10"

# Promote oudere deployment naar production
curl -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v10/projects/$PROJECT_ID/promote/$DEPLOY_ID?teamId=$TEAM_ID"
```

Update `agent_config.vercel_live_url` + `vercel_last_deploy` na rollback.

---

## Health-check (op afroep, geen deploy)

```bash
curl -sS -o /dev/null -w "%{http_code}" https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app/
# Verwacht: 200
```

En RLS-sanity:

```sql
SELECT c.relname, c.relrowsecurity,
       (SELECT array_agg(p.polname) FROM pg_policy p WHERE p.polrelid = c.oid)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
  ('agent_runs','open_questions','agent_feedback','agent_schedules','linkedin_progress');
```

Alle 5: `relrowsecurity=true` + minstens 1 anon-policy. Zo niet → policy toevoegen.

---

## Designregels (valkuilen voor toekomstige wijzigingen)

Deze regels zijn het resultaat van echte bugs. Negeer ze niet.

1. **JSONB-velden nooit direct renderen.** `open_questions.context`,
   `agent_runs.stats`, `agent_feedback` metadata zijn mogelijk objecten.
   Gebruik `renderContext()` (zie `QuestionCard.jsx`) of `JSON.stringify`.
   Directe `{obj}` in JSX = React error #31 = zwart scherm.
2. **ErrorBoundary is verplicht** rond `<App/>`. Alleen zo zie je een crash
   i.p.v. een leeg document.
3. **Schedules-filter voor Agents-grid** sluit `orchestrator` én
   `dashboard-refresh` uit — die horen niet als user-facing agent.
4. **Realtime subscribe ≠ requirement.** Als publication ontbreekt, faalt
   `.subscribe()` stil; polling houdt data fresh.
5. **Polling-interval** is `POLL_MS = 2 * 60 * 1000`. Niet naar beneden
   zonder realtime te valideren — elke fetch doet 6 parallelle queries.

---

## Known issues & caveats

- **Auto-deploy CANCELED** gebeurt regelmatig (ook buiten first-deploy).
  Oplossing: handmatig triggeren via `/v13/deployments` + `gitSource`
  + `forceNew=1`. Zie Deploy-flow.
- **Windows Git Bash Node-PATH**: `export PATH="/c/Program Files/nodejs:$PATH"`
  vóór elke npm/node-call. Claude Preview MCP start subprocess zonder deze
  PATH → preview_start faalt. Workaround: bouw en check live op Vercel.
- **LF/CRLF warnings** bij git add — harmless, gaan vanzelf bij commit.
- **Custom domein** `dashboard.legal-mind.nl`: nog niet ingesteld. Zou via
  Vercel domain + CNAME kunnen.
- **Bundle size** ~370 kB JS (~105 kB gzipped). Grootste post: Supabase client.
  Als groter wordt: overweeg dynamic import voor LinkedIn-section.

---

## Scheduled-task status

Dashboard-refresh staat **niet** onder `agent_schedules.enabled=true` — hij
draait niet als cron-agent. De app leeft puur op Vercel en krijgt state
realtime. Handmatige 