# Voor lane ∥A (shell) — wat de product-removal bij jullie laat liggen

**Van:** lane ∥B, branch `remove/briefing-jellemind-v1` (APP 1.158)
**Datum:** 2026-09-12
**Waarom deze file:** ∥B mag de shell-chrome niet aanraken. Onderstaande regels
zijn de enige plekken waar `nu` / Briefing / JelleMind ná deze PR nog in de
shell staan. Ze zijn alle drie **niet stuk** — ze wijzen alleen naar iets dat er
niet meer is. Pak ze mee in de shell-lane, niet in een losse fix.

---

## 1. `src/components/shell/MobileBar.jsx:30` — fallback naar view-id `nu`

```jsx
onClick={() => onSelect(activeView === 'settings' ? 'nu' : 'settings')}
```

`nu` bestaat niet meer in `VIEWS` / `VIEW_PATHS`. `pathFor('nu')` valt terug op
`'/'`, dus de knop gaat naar Home — functioneel goed, semantisch fout.
**Voorstel:** `'zoeken'` in plaats van `'nu'` (dat ís Home op `/`).

## 2. `src/components/shell/SidebarIcons.jsx:16` — icoon `jellemind`

Ongebruikt sinds het nav-item weg is. Geen render-pad meer.
**Voorstel:** de `jellemind:`-entry schrappen. Losstaand van de admin-sidebar,
die had zijn eigen `ICONS.jellemind` — dat exemplaar is in deze PR al weg
(`src/components/views/admin/AdminSidebar.jsx`).

## 3. `src/mobile/MobileTabBar.jsx:6-7` — verouderde comment

```
// Vragenbak (471302146): Home (vragenbak) is de eerste tab; de Briefing
// (vh "Vandaag"/Dashboard) verhuist naar de Meer-drawer.
```

De Briefing staat niet meer in de Meer-drawer (die rij is in deze PR weg).
Alleen commentaar; geen code. **Voorstel:** tweede zin schrappen.

---

## Wat ∥B wél in de shell-laag heeft aangeraakt (zodat je het niet dubbel doet)

| Bestand | Wat |
|---|---|
| `src/routes/viewRegistry.js` | view-ids `nu` en `jellemind` uit `VIEWS`, `NAV_GROUPS` en `VIEW_PATHS` |
| `src/components/shell/Dashboard.jsx` | routes: `/briefing` → `/`, `/agenda/briefing/:eventId` → `/agenda`, `/jellemind` → `/`; imports `NowView` / `MobileDashboard` / `BriefingView` weg; het dode `view === 'nu' \|\| view === 'chat'` header-blok + de lokale `OrchestratorPill`-helper weg |
| `src/mobile/MobileMoreDrawer.jsx` | de rij `{ id: 'nu', label: 'Briefing' }` uit `MOBILE_MORE_ITEMS` |
| `src/components/views/admin/AdminSidebar.jsx` | rij JelleMind + `ICONS.jellemind` |
| `src/components/views/admin/AdminShell.jsx` | route `/admin/jellemind` → redirect naar `/admin/health` |

`Sidebar.jsx` staat **niet** in de diff — die leest `NAV_GROUPS` en klopt
vanzelf.

---

## De belangrijkste openstaande vraag: de cockpit is geparkeerd, niet gesloopt

`src/components/views/NowView.jsx` en de hele map `src/components/views/now/**`
(inclusief `dash/`) staan **nog op schijf** maar hangen aan **geen enkele route
meer**. Hetzelfde geldt voor `src/mobile/screens/MobileDashboard.jsx`.

Dat is een bewuste keuze van ∥B, om drie redenen:

1. De lane-opdracht zegt letterlijk *"delete `views/briefing/`"* — niet
   `views/now/`.
2. `InboxBriefingCard` + `useInboxBriefing` staan op de KEEP-lijst (AutoDraft
   v3-dagstand, ander product) en leven alleen binnen `NowView`. Slopen van
   `NowView` zou die meenemen.
3. De hard-rule design-migratie: geen functie weghalen zonder Jelle's groen
   licht per item. In de cockpit zit meer dan Briefing — wachtrij-ringen,
   EOD-ribbon, snelle-taak-capture, Morgen-kaart.

**Voor ∥A / spoor 09 (design-v3, "Home = dashboard"):** dit is precies het
materiaal dat jullie willen hergebruiken. Twee wegen, Jelle kiest:

- **Rehome** — hang (delen van) `NowView` onder Home. Dan is deze parkeerstand
  precies goed en hoeft er niets terug uit de git-historie.
- **Alsnog slopen** — dan hoort `InboxBriefingCard` + `useInboxBriefing` eerst
  een nieuw huis te krijgen (Postvak of Home), en pas daarna mag
  `src/components/views/now/**` weg.

Zolang geen van beide gebeurd is, staat er een dode boom in de repo. Dat is
zichtbaar (deze file, `IMPLEMENT-NOTES.md` en de PR-body zeggen het) maar het is
schuld, geen eindstand.
