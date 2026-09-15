# Fase 4 D1 Live + Monthly UI — OUT

Versie: v1.207 | Branch: `worktree-d1-fase4-live-monthly`

## Pass A — wat is gebouwd

### Live tab (zone 2)

| Element | Bron | Component |
|---|---|---|
| Hero kennismakingen vs doel 8 | v_d1_aanvoer_kop + v_d1_aanvoer | HeroStrip (bestaand) |
| Pipeline + ICP chip | v_d1_pipeline_per_fase + v_d1_icp | D1Antwoord: MetricCard + ChipStrook |
| Waarde licenties + EUR | v_d1_waarde (fase 3) | D1Antwoord: MetricCard met vergelijking |
| Kanaal chip | v_d1_kanaal (hs_analytics_source) | D1Antwoord: ChipStrook, kanaalLabels.js |
| Beweging per week | v_d1_beweging_week | BewegingStrip (nieuw) |
| Detail sink on click | deals gefilterd op kanaal/segment | D1Detail: twee nieuwe branches |

### Monthly tab

| Element | Status |
|---|---|
| Tab hernoemd | Kwartaal -> Monthly, op beide D1View en D1Kwartaal |
| Win rate + ontleding | Bestaand, ongewijzigd |

### Hook (useD1Pipeline.js)

- Drie nieuwe views apart opgehaald na core fetch (graceful degradation)
- `kanaal` kolom toegevoegd aan v_d1_waarde selects
- Return: `kanaal, icp, beweging`

### Migratie

`supabase/migrations/20260915100000_d1_fase4_live_monthly.sql`:

- `v_d1_deals` herschreven met `kanaal` kolom (hs_analytics_source)
- `v_d1_waarde` herschreven (pikt kanaal op via d.*)
- `v_d1_kanaal` — aggregatie per acquisitiekanaal, open deals
- `v_d1_icp` — aggregatie per ICP-segment (kantoorgrootte)
- `v_d1_beweging_week` — 12-weken in/uitstroom (nieuw/gewonnen/verloren)
- Alle views: `security_invoker = on`, grant select to authenticated

### Kanaal-mapping (hs_analytics_source)

ORGANIC_SEARCH=Organisch, PAID_SEARCH=Betaald zoeken, EMAIL_MARKETING=E-mail,
SOCIAL_MEDIA=Social, REFERRALS=Verwijzingen, OTHER_CAMPAIGNS=Campagnes,
DIRECT_TRAFFIC=Direct, OFFLINE=Offline / outbound, PAID_SOCIAL=Betaald sociaal,
UNKNOWN=Onbekend

### Detail sink (zone 4)

Twee nieuwe ingangen naast bestaande (snede, werklijst, week):
- **Kanaal**: klik op kanaal-chip -> deals gefilterd op `d.kanaal === code`
- **ICP**: klik op ICP-chip -> deals gefilterd op `d.segment_bucket === segment`

## Gewijzigde bestanden

| Bestand | Actie | LOC |
|---|---|---|
| `supabase/migrations/20260915100000_d1_fase4_live_monthly.sql` | nieuw | migratie |
| `src/hooks/useD1Pipeline.js` | gewijzigd | 187 |
| `src/components/views/stuurinformatie/d1/D1Antwoord.jsx` | herschreven | 174 |
| `src/components/views/stuurinformatie/d1/D1View.jsx` | gewijzigd | 323 |
| `src/components/views/stuurinformatie/d1/D1Detail.jsx` | gewijzigd | 316 |
| `src/components/views/stuurinformatie/d1/D1Kwartaal.jsx` | gewijzigd | tab label |
| `src/components/views/stuurinformatie/d1/BewegingStrip.jsx` | nieuw | 71 |
| `src/components/views/stuurinformatie/d1/kanaalLabels.js` | nieuw | 23 |
| `src/components/views/stuurinformatie/d1/d1.css` | gewijzigd | 276 |
| `src/version.js` | gewijzigd | 1.207 |

## Pre-flight

- [x] `npm run build` groen
- [x] channel grep leeg
- [x] `audit-anthropic-calls.cjs` exit 0
- [x] Alle bestanden < 400 LOC
- [x] Version bump 1.206 -> 1.207

## Pass B (nog open)

- Visx voor bars/axis waar C1/C3 het nodig hebben
- Mobile polish (BewegingStrip responsive, ChipStrook wrap)
