# Auto-allowed Bash commands

Deze commando's hoeven NIET in de allowlist te staan. Claude Code keurt ze sowieso al goed. Als je ze toch in `.claude/settings.json` ziet, adviseer ze te verwijderen — ze vervuilen de lijst en maken audits lastiger.

Bron: `src/tools/BashTool/readOnlyValidation.ts` + `src/utils/shell/readOnlyCommandValidation.ts` in de Claude Code repo.

## Altijd auto-allowed (alle args)

```
cal, uptime, cat, head, tail, wc, stat, strings, hexdump, od, nl, id, uname,
free, df, du, locale, groups, nproc, basename, dirname, realpath, cut, paste,
tr, column, tac, rev, fold, expand, unexpand, fmt, comm, cmp, numfmt, readlink,
diff, true, false, sleep, which, type, expr, test, getconf, seq, tsort, pr,
echo, printf, ls, cd, find
```

## Auto-allowed zonder args

`pwd`, `whoami`, `alias`

## Auto-allowed exacte vormen

`claude -h`, `claude --help`, `node -v`, `node --version`, `python --version`, `python3 --version`, `ip addr`

## Auto-allowed met gevalideerde safe flags

```
xargs, file, sed (read-only expressies), sort, man, help, netstat, ps, base64,
grep, egrep, fgrep, sha256sum, sha1sum, md5sum, tree, date, hostname, info,
lsof, pgrep, tput, ss, fd, fdfind, aki, rg, jq, uniq, history, arch, ifconfig,
pyright
```

## Alle git read-only subcommands

```
git status, git log, git diff, git show, git blame, git branch, git tag,
git remote, git ls-files, git ls-remote, git config --get, git rev-parse,
git describe, git stash list, git reflog, git shortlog, git cat-file,
git for-each-ref, git worktree list
```

## Alle gh read-only subcommands

```
gh pr view, gh pr list, gh pr diff, gh pr checks, gh pr status,
gh issue view, gh issue list, gh issue status,
gh run view, gh run list,
gh workflow list, gh workflow view,
gh repo view, gh release view, gh release list,
gh api (GET), gh auth status
```

## Docker read-only subcommands

`docker ps`, `docker images`, `docker logs`, `docker inspect`

## Cleanup-advies

Als een audit een van bovenstaande in `.claude/settings.json` vindt, meld:

> **Info:** `Bash(ls *)`, `Bash(git status *)`, `Bash(cat *)` staan in de allowlist maar zijn al auto-allowed door Claude. Veilig om weg te halen — scheelt ruis.
