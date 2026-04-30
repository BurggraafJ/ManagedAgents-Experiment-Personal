# Safe baseline allowlist voor Jelle's sandbox

Genereuze startset voor nieuwe Claude Code sandbox. Balans: weinig prompts voor dagelijks werk, harde lijn tegen arbitrary code execution.

Schrijf dit naar `.claude/settings.json` bij bootstrap. Houd `.claude/settings.local.json` apart voor machine-specifieke dingen en tokens.

## Filosofie

- **Read-only MCP**: alles aan. Get/list/search/read kunnen nooit iets breken.
- **Write-MCP voor connected integraties**: aan (Slack send, Jira create, Vercel deploy, Supabase apply_migration). Reden: Jelle heeft deze integraties bewust gekoppeld en wil snelheid.
- **Bash writes op files**: aan (`mkdir`, `cp`, `mv`, `touch`, `rm`, `chmod`, `tar`, `zip`). Sandbox = lokaal herstelbaar.
- **Git/gh/vercel/npm writes**: aan, behalve wildcards die arbitrary code draaien (`npm run *`, `git hook`).
- **Arbitrary code execution via wildcard**: UIT. `python *`, `node *`, `bun *`, `bash -c *`, `eval`, `npx *`, `bunx *`, `ssh`, `sudo`. Reden: sandbox beschermt niet tegen netwerk-uitbraak, en typefouten in arbitrary-exec rules zijn onvergeeflijk. Exacte vormen mogen wel (`Bash(bun run typecheck)`).
- **Brede curl/wget**: aan voor sandbox-gemak. In productie-machine zou je dit specificeren.

## Template

```json
{
  "permissions": {
    "allow": [
      "Bash(command -v *)",
      "Bash(where *)",
      "Bash(mkdir *)",
      "Bash(cp *)",
      "Bash(mv *)",
      "Bash(touch *)",
      "Bash(ln -s *)",
      "Bash(rmdir *)",
      "Bash(rm *)",
      "Bash(chmod *)",
      "Bash(tar *)",
      "Bash(unzip *)",
      "Bash(zip *)",
      "Bash(curl *)",
      "Bash(wget *)",

      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(git push *)",
      "Bash(git pull *)",
      "Bash(git fetch *)",
      "Bash(git checkout *)",
      "Bash(git switch *)",
      "Bash(git merge *)",
      "Bash(git rebase *)",
      "Bash(git reset *)",
      "Bash(git restore *)",
      "Bash(git stash *)",
      "Bash(git tag *)",
      "Bash(git clone *)",
      "Bash(git init *)",
      "Bash(git mv *)",
      "Bash(git rm *)",
      "Bash(git cherry-pick *)",
      "Bash(git revert *)",

      "Bash(gh pr create *)",
      "Bash(gh pr comment *)",
      "Bash(gh pr edit *)",
      "Bash(gh pr review *)",
      "Bash(gh pr merge *)",
      "Bash(gh pr close *)",
      "Bash(gh pr reopen *)",
      "Bash(gh pr ready *)",
      "Bash(gh issue create *)",
      "Bash(gh issue comment *)",
      "Bash(gh issue edit *)",
      "Bash(gh issue close *)",
      "Bash(gh issue reopen *)",
      "Bash(gh release create *)",
      "Bash(gh release edit *)",
      "Bash(gh repo create *)",
      "Bash(gh repo clone *)",
      "Bash(gh workflow run *)",
      "Bash(gh run rerun *)",

      "Bash(vercel --version)",
      "Bash(vercel whoami)",
      "Bash(vercel ls *)",
      "Bash(vercel inspect *)",
      "Bash(vercel logs *)",
      "Bash(vercel env ls *)",
      "Bash(vercel env add *)",
      "Bash(vercel env rm *)",
      "Bash(vercel env pull *)",
      "Bash(vercel domains ls *)",
      "Bash(vercel domains add *)",
      "Bash(vercel deploy *)",
      "Bash(vercel build *)",
      "Bash(vercel link *)",
      "Bash(vercel pull *)",
      "Bash(vercel promote *)",
      "Bash(vercel alias *)",
      "Bash(vercel rollback *)",

      "Bash(npm ls *)",
      "Bash(npm view *)",
      "Bash(npm info *)",
      "Bash(npm outdated *)",
      "Bash(npm whoami)",
      "Bash(npm install *)",
      "Bash(npm uninstall *)",
      "Bash(npm update *)",
      "Bash(npm ci *)",

      "mcp__2cf4ced6-4106-4c43-a798-b435244eb721__*",
      "mcp__7a90b865-a649-4156-8646-6c3475a8118b__*",
      "mcp__37030035-4322-4e41-980f-53e1bd45be11__*",
      "mcp__8236b0dc-13ae-4d89-a7a8-4498b08d9228__*",
      "mcp__82f94de2-e5ca-4223-ae7e-dc4513165411__*",
      "mcp__31714316-115f-4b2f-966e-14175bd871ea__*",
      "mcp__Claude_Preview__*",
      "mcp__Claude_in_Chrome__*",
      "mcp__scheduled-tasks__*",
      "mcp__mcp-registry__*"
    ]
  }
}
```

**Let op:** de `mcp__<server>__*` wildcards zijn niet voor alle servers ideaal. `mcp__Claude_in_Chrome__*` dekt ook `javascript_tool` en `computer` — dat is arbitrary exec in de browser. Als je paranoid bent, schrijf de tools per stuk uit (zie de uitgebreide allowlist in het huidige Dashboard project voor het voorbeeld). Default hier: wildcard voor snelheid, maar noem deze afweging expliciet aan de user bij bootstrap.

## settings.local.json template

Nooit echte tokens hierin bij bootstrap — alleen placeholders en notities:

```json
{
  "permissions": {
    "allow": []
  },
  "_note": "Zet hier machine-specifieke permissions en tokens. Zorg dat .gitignore deze file uitsluit."
}
```

## Checklist voor elke nieuwe sandbox

1. `.claude/settings.json` — van template hierboven
2. `.claude/settings.local.json` — leeg template
3. `.gitignore` bevat `.claude/settings.local.json`
4. `.claude/security-audit.log` — header aangemaakt
5. User is verteld: welke integraties ingeschakeld, welke tokens hij nog moet invullen via env-vars (nooit in settings), en wat bewust NIET is gealloweerd
