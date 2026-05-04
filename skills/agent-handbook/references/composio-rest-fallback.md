# Composio REST-fallback — DEPRECATED

> **Verhuisd per 2026-05-03** naar [`authentication.md`](authentication.md) — sectie 3 "Kanaal B — Composio".
>
> Deze stub blijft 1 maand staan zodat verwijzingen vanuit oude SKILL.md-files nog landen. **Mag verwijderd worden vanaf 2026-06-03**, zodra alle skills gemigreerd zijn naar de pointer-regel uit het project "Authenticatie als single source of truth" (Confluence id 422707202).

## Wat veranderd is

Alle inhoud van deze file is opgenomen in `authentication.md`, plus drie aanvullingen die hier niet stonden:

1. **HubSpot v2/actions/proxy-route** voor association-writes (notes, tasks). Tool-bug in v3/tools/execute met `to__id` is permanent — gebruik altijd v2/proxy voor HubSpot writes.
2. **Twee-deuren-regel voor Outlook** (Composio voor write, MS365 Remote MCP voor read).
3. **Glossary + checklist** voor nieuwe skills.

## Quick-jump

Als je via een oude link hier kwam — pak je vraag op in:

| Vraag | Sectie in authentication.md |
|---|---|
| "Hoe werkt MCP→REST fallback?" | § 3.1, § 3.5 |
| "Welke 3 waarden heb ik nodig?" | § 3.2 |
| "Code-template voor v3/tools/execute" | § 3.3 |
| "Code-template voor v2/actions/proxy" (HubSpot writes) | § 3.4 |
| "Wanneer hard-fail vs warning?" | § 3.6 |
| "Welke logging-strings?" | § 6 |
