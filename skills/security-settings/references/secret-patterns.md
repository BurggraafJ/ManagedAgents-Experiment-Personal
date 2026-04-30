# Secret patterns

Regex-patronen om secrets te herkennen in `.claude/settings.json`, `.claude/settings.local.json`, env-vars of losse tekst. Gebruik deze bij een audit of update om te voorkomen dat een token in de allowlist-string belandt.

## High-confidence patterns

| Secret type | Regex | Voorbeeld |
|---|---|---|
| Anthropic API key | `sk-ant-[A-Za-z0-9_-]{20,}` | `sk-ant-api03-...` |
| OpenAI API key | `sk-(?:proj-)?[A-Za-z0-9_-]{20,}` | `sk-proj-abc...` |
| Vercel token | `vcp_[A-Za-z0-9]{20,}` | `vcp_3MANB0wp...` |
| Vercel OAuth | `vercel_[A-Za-z0-9_-]{20,}` | |
| Supabase anon/service | `eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}` | JWT format |
| GitHub PAT (classic) | `ghp_[A-Za-z0-9]{36}` | |
| GitHub fine-grained | `github_pat_[A-Za-z0-9_]{80,}` | |
| GitHub OAuth | `gho_[A-Za-z0-9]{36}` | |
| GitHub app server | `ghs_[A-Za-z0-9]{36}` | |
| Slack bot token | `xoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+` | |
| Slack user token | `xoxp-[0-9]+-[0-9]+-[0-9]+-[A-Za-z0-9]+` | |
| Google API key | `AIza[0-9A-Za-z_-]{35}` | |
| AWS access key | `AKIA[0-9A-Z]{16}` | |
| AWS secret | `(?i)aws(.{0,20})?(secret|key)[^A-Za-z0-9]{0,3}[A-Za-z0-9/+=]{40}` | context-gebonden |
| Stripe live | `sk_live_[A-Za-z0-9]{24,}` | |
| Stripe test | `sk_test_[A-Za-z0-9]{24,}` | minder kritiek maar flag |
| HubSpot PAT | `pat-(?:na|eu)[0-9]-[A-Za-z0-9-]+` | |
| Atlassian API token | 24-char base64-ish in context `atlassian` of `api.atlassian.com` | zwakker patroon |

## Context-based flags (geen strikte regex, maar altijd flaggen)

- String begint met `Authorization: Bearer ` gevolgd door iets dat op een token lijkt (>= 20 chars alphanumeric/-/_)
- `export ` gevolgd door `_TOKEN=`, `_KEY=`, `_SECRET=`, `_PASSWORD=` met een value langer dan 10 tekens
- `password=`, `api_key=`, `apikey=`, `secret=` in querystring-vorm
- Base64-achtige strings langer dan 40 chars zonder duidelijke andere uitleg

## Response bij detectie

Wanneer je een match vindt, zeg het direct en concreet:

> **Kritiek:** `.claude/settings.local.json:9` bevat een Vercel token (`vcp_…`). Actie:
> 1. Verwijder de regel uit het allowlist-pattern.
> 2. Roteer de token op https://vercel.com/account/tokens (oude is gecompromitteerd zodra hij in een file stond — ook al is de file niet gecommit).
> 3. Zet de nieuwe token als env-var in je shell-profile (`.bashrc`/`.zshrc`) of via `vercel login`, niet in settings.json.

Belangrijk: **ook als de file niet in git staat** moet een token die in plaintext in een settings-file heeft gestaan als gelekt worden beschouwd. Claude-sessie-logs, backups, clipboard-history — er zijn te veel manieren waarop de waarde uit die file weglekt.

## Wat NIET als secret flaggen

- URLs die "token" of "key" in het pad hebben maar geen echte waarde (e.g. `https://api.vercel.com/v2/user`)
- Placeholders: `<<VERCEL_TOKEN>>`, `${VERCEL_TOKEN}`, `***`
- Commentregels die over tokens praten zonder er een te bevatten
- Env-var *namen* zonder waarde: `VERCEL_TOKEN`, `ANTHROPIC_API_KEY` als losse identifier
