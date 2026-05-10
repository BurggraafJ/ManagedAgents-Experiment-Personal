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

## Pre-flight checklist vóór `git push`

1. `npm run build` groen
2. `grep -rn "\.channel(" src/ | grep -v createRealtimeChannel | grep -v lib/supabase.js` — leeg
3. Geen `useSomeHook()` in 2 componenten in dezelfde tree (alleen via prop doorgeven)
4. Bij design-migratie: alle oude functies geverifieerd aanwezig in nieuwe render
