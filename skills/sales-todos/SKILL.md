---
name: sales-todos
description: >
  [GEDEPRECATEERD 2026-04-28] Vervangen door sales-followups (zelfde functie,
  nieuwere implementatie die uit hubspot_deals mirror leest ipv direct HubSpot).
  Niet triggeren — gebruik sales-followups skill in plaats daarvan.
  Trigger NIET via deze skill. Verwijderen mag zodra ≥4 weken stabiel
  (sales-followups draait sinds 2026-04-28; verwijderen kan vanaf 2026-05-26).
---

# Sales TODOs — DEPRECATED

> **Deze skill is vervangen door [`sales-followups`](../sales-followups/SKILL.md)** sinds 2026-04-28. Niet meer triggeren.

## Waarom vervangen

`sales-followups` (display-naam "Sales Follow-ups", interne naam dezelfde) doet hetzelfde werk maar:

* Leest deals uit `hubspot_deals` mirror (door hubspot-sync-etl gevuld) ipv direct HubSpot — sneller, geen API-cost
* Composio MCP/REST-fallback netjes geregeld via auth-pointer naar [`agent-handbook/references/authentication.md`](../agent-handbook/references/authentication.md)
* Schrijft naar zelfde tabel `sales_todos`, dus dashboard-Inbox-flow blijft hetzelfde

## Migratie-status

* `sales-followups` skill: live sinds 2026-04-28, scheduled task in `agent_schedules` (werkochtend 08:00)
* `sales-todos` (deze file): scheduled task verwijderd, alleen file blijft staan voor history
* Verwijderen van deze file: pas vanaf 2026-05-26 (≥4 weken stabiel) — wacht tot sales-followups bewezen heeft een rond patroon te hebben

## Voor auth, MCP-fallback, Composio v2/proxy

Zie [`sales-followups/SKILL.md`](../sales-followups/SKILL.md) Stap 1 (auth-pointer) en [`agent-handbook/references/authentication.md`](../agent-handbook/references/authentication.md).
