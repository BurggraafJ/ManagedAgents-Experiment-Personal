# Security playbook (architect-niveau)

> **Voor secret-storage** (Vault, agent_config, vault-read-proxy, naming, schrijven, lezen, fallback, bootstrap, rotatie van keys): zie [`authentication.md`](authentication.md). Dit is de single source of truth sinds 2026-05-03.
>
> **Voor automatische monitoring** (RLS, exposed secrets, code scan, dagelijkse DB-checks): gebruik `security-monitor` skill (draait dagelijks 07:00).

Dit playbook gaat **alleen** over architectuur-keuzes rond:
1. Allowlist-patterns voor `.claude/settings.json` (welk type Bash-commando wel/niet, welke MCP wel/niet)
2. RLS-architectuur en SECURITY DEFINER-aanpak
3. Sandbox-bootstrap (verse VM, niet token-bootstrap)
4. Bekende pitfalls die niet in authentication.md horen

Voor secret-rotatie, Vault-flows en token-locaties: read [`authentication.md`](authentication.md). Dit playbook verwijst alleen.

---

## Allowlist-design voor Jelle's setup

Jelle draait Claude Code in een VM-sandbox op Windows 11. Dat geeft ruimte om **breed te approven** voor productiviteit, mits:

1. **Geen arbitrary code execution wildcards.** Patronen verboden:
   - `Bash(python *)`, `Bash(node *)`, `Bash(bun *)`, `Bash(deno *)`
   - `Bash(bash *)`, `Bash(sh *)`, `Bash(eval *)`, `Bash(exec *)`
   - `Bash(npx *)`, `Bash(bunx *)`, `Bash(uvx *)`, `Bash(uv run *)`
   - `Bash(npm run *)`, `Bash(bun run *)`, `Bash(make *)`
   - **Reden:** sandbox beschermt niet tegen exfiltratie via netwerk. Een typefout in arbitrary-exec = catastrofaal.

2. **Geen privilege escalation.** `Bash(sudo *)`, `Bash(ssh *)`, `Bash(scp *)`.

3. **Geen MCP arbitrary-exec.** `mcp__Claude_in_Chrome__javascript_tool`, `mcp__Claude_in_Chrome__computer`, `mcp__Claude_Preview__preview_eval` blijven uit.

4. **MCP write-tools genereus aan**: Slack send, Jira create, Vercel deploy, Supabase apply_migration, HubSpot manage_crm_objects. Sandbox beschermt niet tegen externe mutaties — maar zonder deze tools werken de agents niet. Bewuste afweging.

5. **Specifiek-gebonden bash writes oké**: `Bash(bun run typecheck)` mag, `Bash(bun run *)` niet. Het verschil: één commando vs alle commando's onder bun.

Voor wijzigingen aan `.claude/settings.json` of `.claude/settings.local.json`: gebruik de Anthropic skill `update-config` (settings-mutaties) of `fewer-permission-prompts` (allowlist-suggesties uit transcripts).

---

## RLS-architectuur en SECURITY DEFINER-aanpak

Drie hardening-rondes klaar (2026-05-02):
* **Ronde 1 — public/anon → authenticated:** 39 policies van wijdopen-roles naar JWT-only
* **Ronde 2 — SECURITY DEFINER views:** 7 views moeten `WITH (security_invoker = on)` hebben — anders bypassen ze RLS
* **Ronde 3 — function search_path:** 18 functies kregen `SET search_path = public, pg_catalog` toegevoegd, voorkomt sql-injection via search_path-manipulatie

**Vuistregels voor nieuwe tabellen / views / functies:**

| Pattern | Doe dit | Niet dit |
|---|---|---|
| Nieuwe tabel | `ENABLE ROW LEVEL SECURITY;` + minstens één policy voor `authenticated` | `ENABLE RLS` zonder policies (= alles geblokkeerd, ook service_role-flows) |
| Nieuwe view die meerdere tabellen aggregeert | `WITH (security_invoker = on)` zodat caller's RLS geldt | `SECURITY DEFINER` zonder reden (bypassed RLS van caller) |
| Nieuwe RPC | `SECURITY DEFINER SET search_path = public, pg_catalog` | `SECURITY DEFINER` zonder search_path-pin (sql-injection-risk) |
| Anon access voor publieke data | Specifieke policy `FOR SELECT TO anon USING (...)` | `GRANT ... TO anon` op tabel-niveau |

`security-monitor` controleert dit dagelijks (Check 3) en flagt afwijkingen automatisch.

---

## Sandbox-bootstrap (verse VM)

Bij een nieuwe machine:

1. **Allowlist** — start met een minimale `.claude/settings.json` die de Bash-wildcards uit sectie hierboven verbiedt. Anthropic skills `update-config` of `fewer-permission-prompts` kunnen helpen breiden.
2. **Git credential.helper** — zie `platform.md`
3. **Token-bootstrap** (Management PAT, cron_secret) — zie [`authentication.md`](authentication.md) § 5
4. **Supabase env-vars** — anon-key voor browser, service-role alleen in Edge Function secrets
5. **Test-deploy** — round-trip-check op een Edge Function

---

## Wanneer escaleren naar welke skill

| Vraag | Naar |
|---|---|
| "draai een security-check op de DB" | `security-monitor` (live RLS + secrets check, dagelijks) |
| "deze secret hoort in Vault — hoe zet ik 'm?" | [`authentication.md`](authentication.md) § 2.2 |
| "PAT roteren — hoe?" | [`authentication.md`](authentication.md) § 2 (per-key flow via dashboard ApiKeysPage) |
| "RLS-policy schrijven" | `database.md` (patterns) + dit playbook (architectuur) |
| "settings.json aanpassen" | Anthropic `update-config` skill (settings-mutaties) |
| "minder permission-prompts" | Anthropic `fewer-permission-prompts` skill |

---

## Pitfalls die we al kennen

| Probleem | Voorkomen |
|---|---|
| PAT in `.git/config` na `git remote set-url` | `credential.helper=store` met aparte `~/.git-credentials` file (zie `platform.md`) |
| Service-role key in VITE_-var | Anon-key voor browser, service-role alleen in Edge Function secrets |
| Secrets in commit-message of code-comment | Weekly scan vangt dit; pre-commit hook kan helpen |
| Vergeten oude key te revoken na rotatie | Setpoint: revoke binnen 24u na succesvolle nieuwe key in Vault |
| `.claude/settings.local.json` in git committed | `.gitignore` regel — check bij elke nieuwe project-init |
| Hardcoded fallback-tokens in migration scripts | Code-review op `Bearer ` patterns; weekly scan vangt dit |
| RLS enabled = false op nieuwe tabellen | `security-monitor` Check 3 vangt dit dagelijks |
| `SECURITY DEFINER` views zonder `security_invoker = on` | Altijd `WITH (security_invoker = on)` bij CREATE — anders bypass je RLS |
| Function search_path mutable | `CREATE FUNCTION ... SET search_path = public, pg_catalog` |
| `agent_config(<>, *_token)` rij | Sinds 2026-05-02 niet meer toegestaan — die hoort in Vault. `security-monitor` flagt dit. |

---

## Cross-skill verwijzingen

- Live security-monitoring (DB): `security-monitor` (dagelijkse checks)
- Allowlist-niveau permission-prompts verminderen: `fewer-permission-prompts` (Anthropic skill)
- Hooks instellen voor PostToolUse-checks: `update-config` (Anthropic skill)
- Token-cost monitoring (los onderwerp): zie Token Cost Counter project
- **Secret-storage zelf**: [`authentication.md`](authentication.md) — bron-van-waarheid

---

_Bijgewerkt 2026-05-03: secret-storage volledig verhuisd naar `authentication.md`. `security-settings` skill is verwijderd uit ecosysteem (gebruik `update-config` van Anthropic-skills). Dit playbook focust op allowlist + RLS-architectuur. Drie RLS-hardening rondes klaar (2026-05-02): 39 policies + 7 SECURITY DEFINER views + 18 functions search_path._
