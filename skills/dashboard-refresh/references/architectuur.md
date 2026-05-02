# Dashboard-architectuur — file-tree, secties, design-tokens, regels

> Hoe Agent Command Center v4 in elkaar zit. Lees voordat je een wijziging maakt
> aan layout, sectie-structuur of styling.

## File-tree

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
        ├── views/              ← page-views (Tasks, AutoDraft, Sales, Settings, etc.)
        └── sections/
            ├── ActionRail.jsx     ← id="actie"    — urgente vragen + feedback + overdue
            ├── LiveNow.jsx        ← id="nu"       — wat draait + volgende run + klok
            ├── TodayTimeline.jsx  ← id="vandaag"  — horizontal timeline 06:00–22:00
            ├── KpiStrip.jsx       ← id="week"     — 4 KPI's met week-trend
            ├── Agents.jsx         ← id="agents"   — dynamisch uit agent_schedules
            ├── Inbox.jsx          ← id="inbox"    — vragen + feedback
            ├── Schedules.jsx      ← id="schedules"
            ├── LinkedInProgress.jsx ← id="linkedin" (alleen als data)
            ├── SkillSecrets.jsx   ← Vault-managed secrets (Settings)
            ├── SecretsInventory.jsx ← Fase 8: rood/groen rotation status (Settings)
            └── Config.jsx         ← id="config"
```

## Sectie-volgorde (top-to-bottom)

1. **Actie** — wat vraagt NU aandacht (sorted op urgentie)
2. **Live nu** — running agent + next run + orchestrator heartbeat + klok
3. **Vandaag** — timeline met dots per run, now-line
4. **Week** — KPI's + trend vs. vorige week
5. **Agents** — grid, dynamisch uit `agent_schedules`
6. **Inbox** — alle open vragen + feedback (open + verwerkt)
7. **Schedules** — cron-tabel
8. **LinkedIn** — voortgang per kantoor (alleen als er rijen zijn)
9. **Systeem** — metadata

## Welk bestand voor welke wijziging

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

## Design tokens

Alle styling loopt via CSS custom properties in `src/index.css :root`. Bij wijzigingen:
raak die aan, niet de individuele componenten.

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

## Known issues & caveats

- **Auto-deploy CANCELED** gebeurt regelmatig (ook buiten first-deploy).
  Oplossing: handmatig triggeren via `/v13/deployments` + `gitSource`
  + `forceNew=1`. Zie `references/deploy-rollback.md`.
- **Windows Git Bash Node-PATH:** `export PATH="/c/Program Files/nodejs:$PATH"`
  vóór elke npm/node-call. Claude Preview MCP start subprocess zonder deze
  PATH → preview_start faalt. Workaround: bouw en check live op Vercel.
- **LF/CRLF warnings** bij git add — harmless, gaan vanzelf bij commit.
- **Custom domein** `dashboard.legal-mind.nl`: nog niet ingesteld. Zou via
  Vercel domain + CNAME kunnen.
- **Bundle size** ~370 kB JS (~105 kB gzipped). Grootste post: Supabase client.
  Als groter wordt: overweeg dynamic import voor LinkedIn-section.
