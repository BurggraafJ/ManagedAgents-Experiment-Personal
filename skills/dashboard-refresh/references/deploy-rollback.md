# Deploy + rollback + health-check

> Hoofdworkflow voor dashboard-wijzigingen — push naar GitHub, Vercel auto-deployt.
> Plus rollback-flow en health-check.

## Deploy-flow — dè workflow

**99 %-route:** `edit → build sanity → commit → push → (manueel triggeren indien CANCELED) → klaar`.

```bash
export PATH="/c/Program Files/nodejs:$PATH"
cd C:/Users/LM/Downloads/Dashboard/dashboard-react

# 1. Wijzigingen maken in src/…

# 2. Sanity-build (vangt imports/typos)
npm run build

# 3. Commit
git add .
git -c user.email="burggraaf@legal-mind.nl" -c user.name="Jelle Burggraaf" \
  commit -m "<korte beschrijving>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

# 4. Push — token tijdelijk in URL (niet in .git/config)
GH_TOKEN=$(agent_config.github_token)
git push "https://BurggraafJ:${GH_TOKEN}@github.com/BurggraafJ/ManagedAgents-Experiment-Personal.git" main:main \
  | sed -E 's/github_pat_[A-Za-z0-9_]+/<redacted>/g'

# 5. Check auto-deploy status (~5 s na push)
curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=$PROJECT_ID&teamId=$TEAM_ID&limit=1"
# Verwacht: readyState = BUILDING of READY op commit SHA
```

## Als auto-deploy CANCELED raakt (komt regelmatig voor)

```bash
curl -sS -X POST "https://api.vercel.com/v13/deployments?teamId=$TEAM_ID&forceNew=1" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"name":"legal-mind-dashboard","project":"'$PROJECT_ID'",
           "target":"production",
           "gitSource":{"type":"github","repoId":1215342015,"ref":"main"}}'
```

Poll `/v13/deployments/$DEPLOY_ID` tot `readyState=READY`, dan:

```bash
curl -sS -o /dev/null -w "%{http_code}" https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app/
# Verwacht: 200
```

Schrijf deploy-record terug:

```sql
UPDATE agent_config
SET config_value = to_jsonb(now()::text), updated_at = now()
WHERE agent_name = 'dashboard-refresh' AND config_key = 'vercel_last_deploy';

INSERT INTO agent_runs (agent_name, status, summary, stats, started_at, completed_at)
VALUES ('dashboard-refresh', 'success',
  '<beschrijving van de wijziging>',
  jsonb_build_object('mode','vercel','deploy_id','<dpl_…>','commit','<sha>',
                     'trigger','<auto|manual-rest-api>'),
  now() - interval '2 minutes', now());
```

## Rollback

```bash
# Lijst laatste 10 deploys
curl -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=$PROJECT_ID&teamId=$TEAM_ID&limit=10"

# Promote oudere deployment naar production
curl -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v10/projects/$PROJECT_ID/promote/$DEPLOY_ID?teamId=$TEAM_ID"
```

Update `agent_config.vercel_live_url` + `vercel_last_deploy` na rollback.

## Health-check (op afroep, geen deploy)

```bash
curl -sS -o /dev/null -w "%{http_code}" https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app/
# Verwacht: 200
```

En RLS-sanity:

```sql
SELECT c.relname, c.relrowsecurity,
       (SELECT array_agg(p.polname) FROM pg_policy p WHERE p.polrelid = c.oid)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
  ('agent_runs','open_questions','agent_feedback','agent_schedules','linkedin_progress');
```

Alle 5: `relrowsecurity=true` + minstens 1 anon-policy. Zo niet → policy toevoegen.

## Dev- en preview-omgeving

**Lokaal dev** (snelste loop, elke save herlaadt):
```bash
cd dashboard-react
export PATH="/c/Program Files/nodejs:$PATH"
npm run dev
# http://localhost:5173
```

**Vercel preview** (auto, per branch die ≠ main):
Push naar feature-branch → Vercel maakt automatisch een unieke preview-URL
(bv. `legal-mind-dashboard-git-feat-xyz-jelle-burggraaf.vercel.app`).
Ideaal voor redesigns of grote wijzigingen — Jelle kan klikken vóór merge naar main.

**Productie:** push naar `main` → auto-deploy ~90 s; trigger handmatig bij CANCELED.

Aanbeveling: grote wijzigingen eerst op een `feat/*`-branch, kleine fixes direct op main.
