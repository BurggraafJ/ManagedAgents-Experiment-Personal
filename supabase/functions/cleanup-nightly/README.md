# cleanup-nightly

> **Gepulled uit live Supabase op 2026-09-02 als onderdeel van Fase R.1**
> (Repo-hygiëne — _Intelligence Architecture_ project, zie `skills/datascience/references/current_architecture.md`)

## Metadata bij pull

| Veld | Waarde |
|---|---|
| Slug | `cleanup-nightly` |
| Versie (Supabase) | 9 |
| Aangemaakt | 1779124136675 |
| Laatste update (live) | 1779124594994 |
| verify_jwt | false |
| import_map | false |
| entrypoint | index.ts |

## ⚠ Geen source in deze map — met opzet

De Management API gaf voor `cleanup-nightly` een **lege body** terug (1 byte).
De eszip-bundle bevat dus niets waar source uit te halen valt, ook niet via de
sourcemap (`scripts/r1-repo-hygiene/extract-eszip-sourcemap.cjs`). De
`index.ts` die de pull hier neerzette is daarom **verwijderd**: een deploy uit
deze map zou de live function overschrijven met een leeg bestand.

**Status na de security review van 2026-09-02 (F-14):**

| | |
|---|---|
| Live | ja, `verify_jwt = false`, versie 9 |
| Cron | `cleanup-nightly-cron`, `33 3 * * *`, stuurt `Bearer <cron_secret>` uit Vault |
| Interne auth | **onbekend** — niet vast te stellen zonder source |
| Actie voor Jelle | source terughalen uit een lokale kopie of de Supabase-console (Functions → cleanup-nightly → Code), dan de gate langs dezelfde lat leggen als de andere cron-functies |

Van de tien functies zonder git-source waren dit de uitkomsten: negen sources
zijn byte-exact teruggehaald uit de eszip-sourcemap; acht daarvan hadden hun
auth-gate al of staan op `verify_jwt = true`; alleen `mail-enricher` had geen
gate en heeft die in v10 gekregen. Deze is de enige die niet te controleren was.

## Wat doet deze function?

> _TODO bij Jelle's review:_ vul deze sectie in met een korte beschrijving van wat de function doet, hoe vaak ze draait, en welke tabellen ze raakt.

## Cron / triggers

> _TODO_

## Schema-impact

> _TODO_

## Source-of-truth

Deze repo is per 1779124594994 (laatste live update) de source-of-truth.
Toekomstige wijzigingen: PR + deploy via Supabase Management API
(zie `skills/agent-handbook/references/database.md` voor het deploy-pattern).
