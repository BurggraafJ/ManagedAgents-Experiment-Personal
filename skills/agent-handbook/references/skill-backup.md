# Skill Backup — naar GitHub

Hoe je alle persoonlijke skills uit de Claude app data haalt en als versiebeheer opslaat in GitHub.

## Wanneer gebruiken

- Skills zijn alleen opgeslagen in de lokale Claude-installatie; bij herinstallatie of toestelwisseling zijn ze weg
- Je wilt wijzigingshistorie bijhouden via git
- Je wilt skills reviewen buiten Claude om

## Locatie van skills op Windows

Skills worden door de Claude-app opgeslagen in sessiemappen onder:

```
C:\Users\<naam>\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\
```

Binnen die map zijn meerdere sessie-UUIDs. Elke UUID-map bevat een `skills/`-submap. Gebruik de sessie met de meeste skills als primaire bron.

```bash
# Vind alle sessies en hun skill-aantallen
for dir in "C:/Users/LM/AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/"*/*/skills/; do
  count=$(ls "$dir" 2>/dev/null | wc -l)
  echo "$count  $dir"
done | sort -rn
```

## Wat zijn "persoonlijke" skills?

Generieke Anthropic-skills hebben een `LICENSE.txt` in hun map. Die hoef je niet te backuppen — ze komen terug via claude.ai. Persoonlijke skills bevatten alleen een `SKILL.md` en optioneel `references/` en `scripts/`.

Generieke skills om weg te laten: `docx`, `xlsx`, `pptx`, `pdf`, `skill-creator`, `schedule`, `setup-cowork`, `consolidate-memory`.

## Backup-stappenplan

```bash
# 1. Definieer bronnen (pas UUIDs aan op je eigen installatie)
S1="C:/Users/LM/AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/<uuid1>/<uuid2>/skills"
S2="C:/Users/LM/AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/<uuid3>/<uuid4>/skills"
LOCAL="C:/Users/LM/.claude/skills"
DEST="C:/pad/naar/je/repo/skills"

# 2. Kopieer unieke skills (S2 = meest complete bron, dan S1, dan local)
mkdir -p "$DEST"
ALL_SKILLS=$( { ls "$S1" 2>/dev/null; ls "$S2" 2>/dev/null; ls "$LOCAL" 2>/dev/null; } | sort -u )

GENERIEK="docx xlsx pptx pdf skill-creator schedule setup-cowork consolidate-memory"

for skill in $ALL_SKILLS; do
  # Sla generieke skills over
  echo "$GENERIEK" | grep -qw "$skill" && continue

  if [ -d "$S2/$skill" ]; then
    cp -r "$S2/$skill" "$DEST/$skill"
  elif [ -d "$S1/$skill" ]; then
    cp -r "$S1/$skill" "$DEST/$skill"
  elif [ -d "$LOCAL/$skill" ]; then
    cp -r "$LOCAL/$skill" "$DEST/$skill"
  fi
done

echo "Skills gekopieerd: $(ls "$DEST" | wc -l)"
```

```bash
# 3. Commit en push
cd /pad/naar/je/repo
git add skills/
git commit -m "Backup personal skills $(date +%Y-%m-%d)"
git push origin main
```

## Huidig resultaat (Legal Mind)

Repository: `BurggraafJ/ManagedAgents-Experiment-Personal` — map `skills/`  
Laatste backup: 2026-05-01  
Aantal persoonlijke skills: 31

## Tips

- Herhaal dit na elke nieuwe of gewijzigde skill
- De `~/.claude/skills/` map bevat soms nieuwere versies van skills die je lokaal hebt bewerkt — die overschrijven de app-data versie niet automatisch, vandaar de prioriteitsvolgorde S2 → S1 → local
- Bij een nieuwe Claude-installatie: upload de `.skill`-bestanden opnieuw via claude.ai of gebruik de build-scripts in `Dashboard/build-skills.ps1`
