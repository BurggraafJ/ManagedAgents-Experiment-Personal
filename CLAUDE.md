# Legal Mind dashboard — projectregels voor Claude

Deze file wordt automatisch geladen aan het begin van elke Claude-sessie in deze repo.
Hier staan **hard-rules** die geborgd moeten zijn boven memory of incidentele opmerkingen.

## Stack

- Vite + React 18 (JavaScript, geen TypeScript)
- Supabase (client-side via anon key, RLS)
- React Router v6
- Hosting: Vercel auto-deploy bij push naar `main`
- Live URL: `https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app`

## ⛔ HARD-RULE: Supabase realtime channels

**Gebruik NOOIT `supabase.channel('vaste-naam')` direct.** Altijd via de helper:

```js
import { supabase, createRealtimeChannel } from '../lib/supabase'

useEffect(() => {
  const channel = createRealtimeChannel('shell-live')   // <- helper, GEEN supabase.channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_runs' }, cb)
    .subscribe()
  return () => supabase.removeChannel(channel)
}, [scheduleRefetch])
```

**Waarom:** Supabase weigert callbacks toe te voegen aan een al-subscribed channel met dezelfde naam. Als de hook 2× gemount wordt (door dubbel-aanroep in component-tree OF React StrictMode in dev), crasht de pagina met:

```
cannot add `postgres_changes` callbacks for realtime:<naam> after `subscribe()`
```

**Geleerd uit incidenten:**
- Sessie 12 (2026-05-09) — `useNavBadges` 'nav-badges-live' crashte na NowView ook de hook gebruikte
- Sessie 15 (2026-05-10) — `useDashboardShell` 'shell-live' crashte na NowView's nieuwe topbar de hook gebruikte

`createRealtimeChannel(prefix)` voegt automatisch een random suffix toe — geen kans op botsing.

**Pre-flight check vóór elke commit:**
```bash
grep -rn "\.channel(" src/ | grep -v "createRealtimeChannel" | grep -v "lib/supabase.js"
```
Output moet leeg zijn. Output ≠ leeg = blocker, fix vóór push.

## ⛔ HARD-RULE: Design-migratie — oude code is leidend

Bij design-migratie van een view: **OUDE CODE IS LEIDEND. Mockup levert ALLEEN nieuwe styling.**

- Geen functie / knop / state / variant verwijderen zonder Jelle's expliciet groen licht per item.
- Voorkeurs-aanpak: **CSS-overlay** (nieuwe `<view>-maestro.css` scoped onder `.theme-maestro .<view-app>`). Oude JSX/classes/state blijft 100% staan.
- Container-rewrite is uitsluitend toegestaan als elke oude functie expliciet in nieuwe layout terugkomt OF Jelle per item akkoord heeft gegeven.
- Mockup-elementen die niet in oude code staan = NIEUWE FEATURES. Vragen of die erbij komen, niet of de oude eraf gaat.

Volledige skill-doc: `C:\Users\LM\.claude\skills\design-migratie\SKILL.md`. Project-pagina: Confluence id `434929680`.

## Lokaal draaien

```bash
cd C:\Users\LM\Downloads\Dashboard\dashboard-react
npm install
npm run dev   # Vite dev-server op http://localhost:5173
```

Of via preview: `.claude/launch.json` heeft `dashboard-dev` config.

## Belangrijke conventies

- **CSS:** geen inline `style={{}}` behalve voor data-driven dimensies (klok-positie, percentage-bars). Gebruik CSS-modules of utility-classes uit `src/index.css`.
- **Bestandscap:** hard cap < 400 LOC per file. Splits in sub-files als groter.
- **Hooks scheiden van UI:** data-fetching in `src/hooks/`, render in `src/components/`.
- **Geen FooNew / FooV2 files:** refactor in-place, geen schaduw-versies.
- **Modals:** gebruik base `<Modal>` uit `src/components/ui/Modal.jsx` (Refactor 03/04).

## ⛔ HARD-RULE: Anthropic-calls via centrale wrapper

**Vanuit Edge Functions: NOOIT direct `fetch('https://api.anthropic.com/v1/messages')`.** Altijd via:

```typescript
import { callAnthropic } from "../_shared/anthropic-fetch.ts";

const r = await callAnthropic({
  supabase,         // service-role client (logging)
  apiKey,           // Vault skill:anthropic:api_key
  model,
  max_tokens,
  messages,
  attribution: { runId, edgeFunction: "<name>", skillName: "<name>" },
});
```

**Waarom:** elke call wordt gelogd in `claude_api_calls` voor cost-attributie, loop-detectie en replay. Direct fetch() omzeilt de telemetrie. Zie Confluence id `450101261`.

**Pre-flight check vóór elke commit:**
```bash
node scripts/audit-anthropic-calls.cjs
```
Exit 0 = OK. Exit 1 = directe call-site buiten wrapper — fix vóór push.

Voor Claude Code-sessies (skills): orchestrator parsed jsonl achteraf via `scripts/parse-claude-session.cjs` — geen runtime-wrapper nodig.

## ⛔ HARD-RULE: Versiebeheer

**Bron van waarheid: `src/version.js` → `APP_VERSION`.** Voedt de versie-badge
in sidebar + login én `version.json` (via vite.config) dat de ReloadPrompt-
popup ophaalt.

- Formaat: `MAJOR.MINOR` met 2-cijferige minor → `1.01`, `1.02` … `1.10` …
- **Elke deploy met een zichtbare wijziging: minor +1.** Bump `APP_VERSION`
  in dezelfde commit als de wijziging.
- **MAJOR bump (`2.0`, `3.0`) = GROTE release en ALLEEN op expliciet aangeven
  van Jelle.** Nooit zelf een major doen.
- Toon altijd als `v{APP_VERSION}` (de "v" staat in de markup, niet in de const).

## ⛔ HARD-RULE: RAG-cron Edge Functions = verify_jwt:false

**RAG-pijplijn Edge Functions die door pg_cron of server-to-server worden aangeroepen**
(`chunker`, `context-build`, `chunker-meeting-v2`, `fireflies-categorize`,
`autodraft-rag-prefill`, `mail-enricher`, alle `*-sync-etl`, reconciles, de cron-kb-functies
`kb-curator` + `kb-article-embed` + `kb-knowledge-extractor`) = **ALTIJD `verify_jwt:false`**. Ze doen hun eigen interne
auth (cron_secret OR service_role, of server-to-server). Deploy je er één op `verify_jwt:true`,
dan weigert de gateway de cron-bearer met **HTTP 401 vóór de functie-body** en valt die functie
stil — onzichtbaar, want stilte geeft geen error.

**Uitzondering — `kb-compose` = `verify_jwt:true`.** Dit is de enige kb-functie die door de
**browser** (ingelogde Jelle) wordt aangeroepen, niet door cron. Hij hoort dus op
`verify_jwt:true` (gateway-JWT-check beschermt de kostende Claude/OpenAI-calls). NIET "fixen"
naar false. De `kb-*`-vuistregel slaat alleen op de cron-kb-functies hierboven.

**Geleerd uit P0 (2026-06-02):** `chunker` stond na een redeploy per ongeluk op
`verify_jwt:true` → cron kreeg 11 dagen 401 → RAG-index bevroren, niemand zag het.
Borging: `rag_pipeline_staleness_check()` (cron `rag-chunker-staleness-guard`, */15 6-22)
alarmeert nu via `security_findings` als de chunker stilvalt terwijl er werk wacht.

**Pre-flight bij elke RAG-cron edge-deploy:** zet expliciet `verify_jwt:false` in de
deploy-call én verifieer ná deploy de flag (`get_edge_function` → `verify_jwt`) + één
testcall (verwacht 200, geen 401/500). User-callable functies (browser-JWT) mogen `true`.

## ⛔ HARD-RULE: Edge-deploy via MCP-paste = repo-file 1:1

Bij `deploy_edge_function` (MCP) met inline source: **Read de repo-file(s) volledig en
plak de inhoud letterlijk** — NOOIT de deploy-payload uit het geheugen of eerdere pastes
reconstrueren. **Geleerd uit incident (2026-07-16):** een handmatig gereconstrueerde
rag-chat-paste verloor stilzwijgend de `calendar_search`/`notes_search` tool-schemas;
de agent meldde "agenda-bron niet als tool beschikbaar" en gaf twee runs lang fout
antwoord terwijl repo + esbuild groen waren. Na elke deploy: één gedrags-testcall die
de gewijzigde functionaliteit raakt (niet alleen een 200-check).

## Pre-flight checklist vóór `git push`

1. `npm run build` groen
2. `grep -rn "\.channel(" src/ | grep -v createRealtimeChannel | grep -v lib/supabase.js` — leeg
3. `node scripts/audit-anthropic-calls.cjs` — exit 0
4. Geen `useSomeHook()` in 2 componenten in dezelfde tree (alleen via prop doorgeven)
5. Bij design-migratie: alle oude functies geverifieerd aanwezig in nieuwe render
6. Zichtbare wijziging? Bump `APP_VERSION` (minor +1) in `src/version.js` — major alleen op Jelle's aangeven
7. RAG-cron Edge Function gedeployd? `verify_jwt:false` (zie hard-rule) — verifieer flag + testcall (200) ná deploy
