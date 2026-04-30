---
name: security-settings
description: Audit, log and advise on Claude Code permission settings for Jelle at Legal Mind. Use this skill whenever the user mentions his Claude allowlist, permissions, settings.json or settings.local.json, wants a security check on what Claude is allowed to do, sets up a fresh sandbox or VM and needs sensible starting permissions, worries about leaked API tokens or credentials in Claude settings, asks about tightening or loosening permissions, or says anything like "audit mijn settings", "check mijn permissions", "nieuwe sandbox opzetten", "veilige allowlist", "risky permissions", "geef me minder prompts", "token staat in mijn settings", "bootstrap permissions". Also trigger when the user edits .claude/settings.json directly and wants the change reviewed, or when they want to migrate their allowlist between machines. Works in Dutch and English — mirror the language the user writes in. Do NOT trigger for unrelated coding tasks, even if they touch a file called settings.json that is not a Claude Code settings file.
---

# Claude Security Settings

Audit, log en advies op Claude Code permission-settings. Werkt voor Jelle (Legal Mind, Windows, werkt in een VM-sandbox, wil snel door maar niet onveilig).

Deze skill heeft drie modes. Bepaal bij aanroep welke past op basis van wat de gebruiker vraagt:

| Mode | Trigger | Output |
|---|---|---|
| **Audit** | "check mijn settings", "is dit veilig", "audit" | Risico-rapport + concrete fixes |
| **Update** | "voeg X toe", "maak minder prompts", "geef meer rechten" | Wijziging + log-entry + risico-diff |
| **Bootstrap** | "nieuwe sandbox", "verse VM", "begin met lege allowlist" | Kant-en-klare `settings.json` + uitleg |

## Bestanden die deze skill beheert

- **`.claude/settings.json`** — project-allowlist (committeerbaar, gedeeld)
- **`.claude/settings.local.json`** — persoonlijke/machine-specifieke overrides (NIET committeren, bevat vaak secrets)
- **`.claude/security-audit.log`** — append-only audit-log van wijzigingen (deze skill schrijft hier)
- **`~/.claude/settings.json`** — user-level default (als die bestaat)

Lees altijd alle drie de settings-files (als ze er zijn) vóór je advies geeft. De user ziet de som van de regels, dus risico's kunnen in een andere file staan dan waar de user naar kijkt.

## Risk catalog — wat je moet flaggen

Loop bij een audit altijd deze categorieën langs. Elke match = concrete vermelding in het rapport.

### Kritiek (rood — adviseer direct actie)

1. **Secrets in plaintext Claude-settings files.** Patronen: `Bearer [A-Za-z0-9_-]{20,}`, `vcp_[A-Za-z0-9]+` (Vercel), `sk-ant-[A-Za-z0-9-]+` (Anthropic), `sk-[A-Za-z0-9]{20,}` (OpenAI), `xoxb-`/`xoxp-` (Slack), `ghp_`/`gho_`/`ghs_`/`github_pat_` (GitHub), `AIza[0-9A-Za-z_-]{35}` (Google), `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.` (JWT). Elke allow-entry of env-var met zo'n waarde direct eruit de file. **Rotatie-advies alleen bij werkelijke externe lek** — git-commit, Slack-post, screenshot, pastebin. Als de token elders veilig opgeslagen staat (Supabase `agent_config` met `is_secret=true` + RLS, Vercel env-vars, 1Password) én de settings-file niet in git zit, is verwijderen uit de settings-file voldoende. Rapporteer dan als "opruimen OK, rotatie niet nodig". Jelle is rotatie-moe — doe hem geen false alarm.
2. **Arbitrary code execution via wildcard.** Verboden in de allowlist: `Bash(python *)`, `Bash(python3 *)`, `Bash(node *)`, `Bash(bun *)`, `Bash(deno *)`, `Bash(ruby *)`, `Bash(perl *)`, `Bash(php *)`, `Bash(bash *)`, `Bash(sh *)`, `Bash(zsh *)`, `Bash(fish *)`, `Bash(eval *)`, `Bash(exec *)`, `Bash(npx *)`, `Bash(bunx *)`, `Bash(uvx *)`, `Bash(uv run *)`, `Bash(npm run *)`, `Bash(yarn run *)`, `Bash(pnpm run *)`, `Bash(bun run *)`, `Bash(make *)`, `Bash(just *)`, `Bash(cargo run *)`, `Bash(go run *)`. Reden: één wildcard = alles kunnen draaien. Exacte vormen zoals `Bash(bun run typecheck)` zijn WEL oké.
3. **Privilege escalation / netwerk-hop.** `Bash(sudo *)`, `Bash(ssh *)`, `Bash(scp *)`, `Bash(rsync *remote*)`. Deze breken uit de sandbox.
4. **Destructieve wildcards zonder grenzen.** `Bash(rm -rf *)` ongebonden, `Bash(git push --force*)` naar main, `Bash(git reset --hard *)`. Adviseer smallere patronen.

### Medium (geel — overweeg aan te scherpen)

5. **Brede mutatie-wildcards.** `Bash(curl *)`, `Bash(wget *)` — kan POSTen naar alles. In een vertrouwde sandbox is het prima; buiten de sandbox kun je beter specifieke hosts whitelisten: `Bash(curl * https://api.vercel.com/*)`.
6. **Schrijf-MCP tools zonder scope.** `slack_send_message`, `createJiraIssue`, `deploy_to_vercel`, `apply_migration`, `manage_crm_objects`. Leg uit dat deze de buitenwereld raken — geen "sandbox" beschermt daar tegen.
7. **`npm install *` / `npm ci *`** — draait install-scripts van willekeurige packages. Medium risico: supply-chain-aanval.
8. **Duplicate rules** tussen `settings.json` en `settings.local.json`. Leg uit waar elk hoort: committeerbaar + tokenloos in `settings.json`, machine-specifiek en secrets in `settings.local.json`.
9. **Ontbrekende `.gitignore`-regel** voor `.claude/settings.local.json` als `.git` bestaat. Adviseer de regel toe te voegen.

### Laag (groen — info, geen actie nodig)

10. Auto-allowed commands die toch in de lijst staan (`Bash(ls *)`, `Bash(cat *)`, `Bash(git status *)` etc.). Deze zijn harmloos maar vervuilen het overzicht — kun je weghalen.

Referentie van wat Claude al auto-allowt staat in `references/auto-allowed-commands.md`.

## Jelle's voorkeuren (altijd toepassen)

Deze sectie is dè reden dat deze skill bestaat in plaats van alleen de generieke `less-permission-prompts`. Gebruik deze voorkeuren als default voor elke Audit/Update/Bootstrap-run. De user hoeft ze dus niet elke keer te herhalen.

**Werkomgeving**
- OS: Windows 11, Git Bash als shell.
- Draait Claude Code in een VM-sandbox. Lokale schrijfacties zijn snel herstelbaar.
- Geen Node, Python of Bun op de host geïnstalleerd — niet aannemen dat die er zijn.
- Werkt in Dutch; antwoord in Nederlands tenzij hij expliciet Engels schrijft.

**Wat hij wil**
- Zo min mogelijk permission-prompts tijdens dagelijks werk. "Liever één keer genereus approven dan elke sessie 30x klikken."
- Schrijfacties op files, git, gh, vercel, npm — gewoon aan.
- MCP write-tools (Slack send, Jira create, Vercel deploy, Supabase apply_migration, HubSpot manage_crm_objects) — aan, want hij gebruikt die actief via andere skills (auto-draft, hubspot-daily-sync, linkedin-connect, etc.).
- Claude Preview + Chrome MCP's — aan voor browser-automation, maar `javascript_tool` / `computer` / `preview_eval` zijn de arbitrary-exec uitzonderingen (zie hieronder).
- Bij bootstrap: genereuze startset direct, geen vraag per tool.

**Wat hij NIET wil (harde rodelijnen, ook in sandbox)**
- Arbitrary code execution via wildcards: `Bash(python *)`, `Bash(node *)`, `Bash(bun *)`, `Bash(deno *)`, `Bash(bash *)`, `Bash(sh *)`, `Bash(eval *)`, `Bash(exec *)`, `Bash(npx *)`, `Bash(bunx *)`, `Bash(uvx *)`, `Bash(uv run *)`, `Bash(npm run *)`, `Bash(bun run *)`, `Bash(make *)`, `Bash(cargo run *)`, `Bash(go run *)`. Redenering: sandbox beschermt niet tegen exfiltratie via netwerk; een typefout in een arbitrary-exec-regel is catastrofaal. Exacte vormen als `Bash(bun run typecheck)` mogen wel.
- Privilege escalation: `Bash(sudo *)`, `Bash(ssh *)`.
- MCP arbitrary-exec: `mcp__Claude_in_Chrome__javascript_tool`, `mcp__Claude_in_Chrome__computer`, `mcp__Claude_Preview__preview_eval`.
- Secrets in plaintext in welk settings-bestand dan ook. Altijd flaggen + rotatie adviseren.

**Integraties die hij actief gebruikt** (default aan in bootstrap):
- Vercel (MCP server id `2cf4ced6-4106-4c43-a798-b435244eb721`)
- Supabase (`7a90b865-a649-4156-8646-6c3475a8118b`)
- Slack (`37030035-4322-4e41-980f-53e1bd45be11`)
- Atlassian / Jira / Confluence (`8236b0dc-13ae-4d89-a7a8-4498b08d9228`)
- HubSpot (`82f94de2-e5ca-4223-ae7e-dc4513165411`)
- Microsoft 365 / Outlook / SharePoint (`31714316-115f-4b2f-966e-14175bd871ea`)
- Claude Preview, Claude in Chrome, scheduled-tasks, mcp-registry

**Bijzonderheden**
- **Tokens-opslag:** canonical store is Supabase `agent_config` (rows met `is_secret=true`, RLS aan, alleen service_role leest). Vercel env-vars voor frontend-secrets. Nóóit in `.claude/settings.json` of `.claude/settings.local.json` — dat zijn plaintext files en geen geheimzinnige kluis. Als je daar toch een token tegenkomt: verwijder hem, check of hij al in `agent_config` staat → zo ja: klaar, geen rotatie. Zo nee: eerst in `agent_config` zetten, dan uit de settings-file.
- `.claude/settings.json` is het committeerbare, reviewbare, tokenloze bestand.
- `.claude/settings.local.json` is voor machine-specifieke overrides (paths, preview-ports). Committeer niet. Géén tokens.
- Audit-log leeft per project op `.claude/security-audit.log`.

## Audit-workflow

1. Lees alle relevante settings-files.
2. Loop de risk catalog langs. Noteer match + locatie (file + regelnummer).
3. Schrijf een rapport in de taal van de user (default Nederlands voor Jelle). Template:

```
## Audit [YYYY-MM-DD HH:MM]

**Files gescand:** <lijst>
**Totaal entries:** N (M in settings.json, K in settings.local.json)

### Kritiek
- [file:line] Beschrijving → concrete fix

### Medium
- [file:line] Beschrijving → overweging

### Info
- <niet-actionable observaties>

### Advies
1. <belangrijkste actie>
2. <tweede actie>
```

4. Append een regel naar `.claude/security-audit.log` (zie "Audit log").
5. Vraag of de user fixes wil toepassen — doe ze NIET ongevraagd.

## Update-workflow

Wanneer de user vraagt om iets toe te voegen of te verwijderen:

1. Lees huidige state.
2. Valideer de voorgestelde wijziging tegen de risk catalog. **Blokkeer automatisch** de kritieke patronen (categorie 1–4). Als de user echt erop staat, weiger vriendelijk en leg het specifieke risico uit. Deze regel houdt ook bij expliciete toestemming stand — sandbox beschermt niet tegen exfiltratie via netwerk.
3. Waarschuw (maar voer uit) bij medium-risico met uitleg.
4. Pas de wijziging toe. Dedupliceer. Respecteer bestaande entries.
5. Append naar audit-log.
6. Rapporteer: wat toegevoegd, wat overgeslagen + waarom.

## Bootstrap-workflow (verse sandbox/VM)

Wanneer de user een nieuwe sandbox heeft of vraagt om een startpunt:

1. Check of `.claude/` bestaat. Zo niet, maak aan.
2. Vraag de user welke integraties hij gebruikt (of detecteer uit context): Vercel, Supabase, Slack, HubSpot, Atlassian, MS 365, etc. Voor Jelle default: alle van die + Claude Preview + Chrome.
3. Genereer `.claude/settings.json` op basis van `references/safe-baseline.md`. Dat bestand bevat Jelle's voorkeursset: genereus voor read-only MCP + safe bash writes + git/gh/vercel/npm schrijfacties, maar zonder arbitrary exec.
4. Genereer `.claude/settings.local.json` als template met placeholders (`<<VERCEL_TOKEN>>`, `<<OPENAI_KEY>>`) — nooit echte tokens.
5. Controleer of `.gitignore` bestaat en voeg `.claude/settings.local.json` toe als die ontbreekt.
6. Schrijf initial entry in `.claude/security-audit.log`.
7. Vertel de user: welke rechten staan aan, welke zijn bewust uitgesloten, waar hij zijn tokens moet zetten.

## Audit log format

`.claude/security-audit.log` is een plain-text append-only log. Elke regel:

```
[ISO-timestamp] [mode] [actor] summary
```

Voorbeeld:
```
[2026-04-19T21:15:00+02:00] UPDATE Jelle Added 18 bash-write patterns + 43 MCP write-tools (slack send, jira create, vercel deploy). Declined: python/node/bun wildcards (arbitrary exec).
[2026-04-19T22:02:00+02:00] AUDIT Jelle 3 kritiek (Vercel token in local:8-9), 2 medium (curl *, npm install *), rotated token.
[2026-04-20T09:00:00+02:00] BOOTSTRAP Jelle Fresh sandbox init — generated safe-baseline (180 entries), gitignore-updated.
```

Als het logbestand nog niet bestaat, maak het aan met een korte header:
```
# Claude security audit log
# Skill: claude-security-settings
# Format: [timestamp] [mode] [actor] summary
```

## Taal en toon

- Jelle schrijft Nederlands? Antwoord Nederlands. Engels? Engels. Mix? Volg zijn laatste zin.
- Direct en concreet. Geen jargon-dump. Wel: "die vcp_-token moet nu eruit en rotaten".
- Bij weigeringen altijd *waarom* uitleggen — niet "dat mag niet", maar "als deze wildcard erin staat kan een runaway script via curl je Vercel-token bij je HubSpot-CRM krijgen."

## Wanneer ook de `update-config` skill gebruiken

Als de user expliciet iets aan hooks, env-vars of andere Claude-harness instellingen wil veranderen (niet puur permissions), verwijs naar/roep `update-config`. Deze skill dekt alleen `permissions.allow/deny/ask` + secret-hygiëne.

## Bijbehorende bestanden

- `references/auto-allowed-commands.md` — welke bash-commands Claude al zonder allowlist goedkeurt (leeft bij in-repo source of truth: `src/tools/BashTool/readOnlyValidation.ts`)
- `references/safe-baseline.md` — Jelle's genereuze-maar-veilige startset voor bootstrap
- `references/secret-patterns.md` — regex-patronen om API-keys en tokens te herkennen
