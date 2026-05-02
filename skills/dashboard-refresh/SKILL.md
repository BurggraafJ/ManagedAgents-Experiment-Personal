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

## Reference-routing — wanneer welk bestand laden

| Voor | Lees |
| --- | --- |
| Deploy-flow / rollback / health-check / preview | `references/deploy-rollback.md` |
| File-tree / sectie-structuur / design tokens / valkuilen | `references/architectuur.md` |
| Supabase queries / RLS / Vercel/GitHub config / agent-data status | `references/data-en-vercel.md` |
| Architectuur-context (waarom is iets zo) | Confluence → `LM/AI Agent Ecosysteem → Architectuur → Dashboard` |

## Quick reference — wat Jelle zegt, wat je doet

| Jelle zegt | Actie |
|---|---|
| "update dashboard" / "pas dashboard aan" / "push" | Lees `deploy-rollback.md` → **Deploy-flow** |
| "wat is de dashboard URL" | Lees `agent_config.vercel_live_url` — geen flow nodig |
| "rollback" / "promote oude deploy" | Lees `deploy-rollback.md` → **Rollback** |
| "health check" / "hoe gaat het met het dashboard" | Lees `deploy-rollback.md` → **Health-check** |
| "lokaal draaien" / "dev server" | `npm run dev` in `dashboard-react/` |
| "redesign" / grote wijzigingen | Preview-branch route — zie `deploy-rollback.md` |
| "nieuw component / nieuwe sectie" | Lees `architectuur.md` voor file-tree + welke files te raken |
| "data klopt niet / nieuwe query" | Lees `data-en-vercel.md` voor `useDashboard.js` queries + RLS |

## Runtime-omgeving

**Windows (Jelle's eigen machine — primair):**
- Werkmap: `C:\Users\LM\Downloads\Dashboard\dashboard-react\`
- Shell: Git Bash (MINGW) met `curl`, `base64`, `git`, `sha1sum`
- Node: 24.x in `C:\Program Files\nodejs\` — **niet** default op PATH in Git Bash
- Geen `jq`, `gh` of Vercel CLI → alles via REST API + curl
- Elke build: `export PATH="/c/Program Files/nodejs:$PATH"` vóór npm

**Cowork-sandbox (secundair — voor automation):**
- Werkmap: `/sessions/[session-id]/mnt/outputs/dashboard-react/`
- Volledige toolchain, npm beschikbaar
- Allowlist-vereiste: `api.vercel.com`, `*.vercel.app`, `api.github.com`

## Architectuur — kort overzicht

**Enkele scrollbare pagina** met sidebar (desktop) of sticky top-bar (mobile). Geen tabs.

Sectie-volgorde top-to-bottom:
1. Actie · 2. Live nu · 3. Vandaag · 4. Week · 5. Agents · 6. Inbox · 7. Schedules · 8. LinkedIn · 9. Systeem

Plus aparte views (Tasks / Chat / Mail / Sales etc.) bereikbaar via sidebar-links.

Voor file-tree, designregels en design tokens: zie `references/architectuur.md`.

## Veiligheidsregels (essentieel)

1. **JSONB-velden nooit direct renderen** in JSX (`{obj}` = React error #31). Gebruik
   `renderContext()` of `JSON.stringify`.
2. **ErrorBoundary blijft rond `<App/>`.** Niet weghalen — anders crashes blanco.
3. **Schedules-filter voor Agents-grid** sluit `orchestrator` + `dashboard-refresh` uit.
4. **Build verifiëren vóór push:** `npm run build` (vangt typos).
5. **Token-handling:** GitHub PAT en Vercel token nooit in `.git/config` of in committed files.
   Tijdelijk in URL of via env-var, daarna wegmaskeren met `sed`.

## Scheduled-task status

Dashboard-refresh staat **niet** onder `agent_schedules.enabled=true` — hij draait niet
als cron-agent. De app leeft puur op Vercel en krijgt state realtime. Handmatige triggers
via Jelle's chat of dashboard "↻ Run nu" knop.

## Edge Functions in dashboard-context

Dashboard zelf is een React app op Vercel. **Edge Functions** (Supabase, Deno) zijn iets
anders — die bouwt agent-manager op via `references/new-agent.md`. Voorbeelden: `transcribe`
(voice-input), `mail-sync-etl-v2`, `jira-sync-etl`, `vercel-relay`.

Voor Edge Function deploy/rollback: gebruik agent-manager skill, niet deze.

## Workflow — typische sessie

1. Jelle vraagt "pas dashboard aan: [iets]"
2. Lees `references/architectuur.md` → bepaal welk bestand te raken
3. Maak wijziging in `src/...`
4. `npm run build` voor sanity check
5. Commit + push (zie `references/deploy-rollback.md`)
6. Verifieer Vercel-deploy ready
7. Schrijf `agent_runs` record + update `agent_config.vercel_last_deploy`
8. Meld aan Jelle: live URL + commit-sha

Voor grote wijzigingen (redesign): gebruik feature-branch + Vercel preview eerst.

## Referentiebestanden

| Bestand | Wanneer |
|---|---|
| `references/deploy-rollback.md` | Deploy/rollback/health-check/preview |
| `references/architectuur.md` | File-tree, secties, design tokens, designregels |
| `references/data-en-vercel.md` | Supabase queries, RLS, agent-status logic, Vercel + GitHub config |

Andere skills die je laadt op-vraag:
- `agent-manager` — bouwen Edge Functions, skill-edits, schedule-aanpassingen
- `xlsx`/`docx`/`pdf` — als dashboard-feature een download-flow nodig heeft

**Confluence-context (voor diepere achtergrond):**
`LM/AI Agent Ecosysteem → Architectuur → Dashboard`.
