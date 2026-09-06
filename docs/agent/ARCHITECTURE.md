# De Maestro-chat — hoe hij werkt

Stand: **v1.149**, 2026-09-06 (spoor 02 I1 + retrieval-laag 06f-α, backend-only, zelfde dag).
Bijwerken hoort bij het werkpakket dat de lus verandert, niet erna. `TOOLS.md` ernaast is gegenereerd; dit bestand is met de
hand geschreven en beschrijft wat een tabel niet kan zeggen.

De volledige analyse achter deze architectuur staat in
`/workspace/security/AGENT-REBUILD-RESEARCH.md`; wat er in september 2026
daadwerkelijk van gebouwd is, in `/workspace/security/AGENT-REBUILD.md` en per spoor
in `/workspace/security/maestro-agent-architecture/`.

---

## 1. De vraag door het systeem

Sinds v1.149 (spoor 02, rag-chat v6.0) is een vraag een **run**: een rij in
`agent_chat_runs` die in hops wordt afgewerkt. De browser-hook die de rij via
realtime volgt komt in I2; tot dan gebruiken browser, smoke en evalrunner het
compat-pad (`stream:true|false`), dat óók een run-rij maakt en de hops inline draait.

```
browser (useRagChat) · smoke · rag-eval-cron
   │  POST rag-chat  {run:true}            → 200 {run_id} binnen ~0,3 s, hop 1 in waitUntil
   │                 {stream:true|false}   → compat: run-rij + hops inline (≤ 140 s), v5.8-contract
   ▼
rag-chat  verify_jwt: TRUE  ← callerSub() leest de `sub`: eigenaar (RLS) én ACL-identiteit
   │
   ├── index.ts    body-modes, auth ({_run_id,_hop} alleen service-key), compat-antwoorden
   ├── run.ts      createRun → agent_chat_runs + agent_chat_run_state
   │               runHop: claim (lease) → stages → spawnNext / done
   │                 planning    classifyRoute() gpt-5.4-mini, 8 s → route + effort + budget
   │                 researching structured → één analytics_*-RPC
   │                             sweep      → mail-voorfilter + verdicts (luna)
   │                             agentic    → tool-lus (gpt-5.6-sol), hervatbaar per beurt
   │                             semantic   → entity + context-build + rerank (+ zelfheling → agent)
   │                 composing   compose.ts: Grok 4.3 streamt → answer_partial (≤ 400 ms) → answer_md
   │               elke stap: steps[] + phase_label in de rij; elke UPDATE eist hop_lease = <token>
   └── hop-grens   geen nieuwe agent-beurt na 60 s, hard 170 s → lease vrij → fetch(self, {_run_id,_hop})
          │
          ▼
   agent_chat_runs      toestand, budget, spent, steps, hops, answer, envelope (realtime, owner-only)
   agent_chat_run_state lus-berichten, evidence, compose-payload (service-only)
   rag_chat_query_log   elke vraag, met run_id, kosten, dekking en reden
```

`context-build` (verify_jwt: **false**, server-to-server) is de retrieval-laag.
Hij kent negen-plus recepten; welk recept een chatvraag krijgt staat in
`TOOLS.md` §4.

**Onder `context-build` zit `match_chunks`** (en het entity-pad
`match_chunks_for_entity`), gedeeld met autodraft, daily-admin en
meeting-briefing. Sinds 06f-α (2026-09-06) zet die functie zijn eigen knoppen:
`hnsw.ef_search=80`, en bij een hard filter (bron, tijdvenster, entity,
enrichment) de iteratieve HNSW-scan met een grens van 4.000 tuples — zonder die
scan gaf een tijdvenster op mail 1 van 40 fragmenten en een bronfilter op
meeting 0, omdat HNSW eerst 40 buren kiest en dán pas filtert. De recepten
(`context_intents`) dragen de caps: `max_per_record` (hoogstens N chunks van één
record), `max_per_source` en `source_overrides`; `search_fast` staat op 2 / 12.
Een datum in de toekomst telt met zijn afstand tot nu (`event` uitgezonderd).
Waarom en gemeten: `DECISIONS.md` 2026-09-06 (06f-α).

## 2. Budgetten: per effort, uit `agent_config`, niet uit drie constanten

| effort | tool_calls | wall_ms | usd | hops_max | wanneer |
|---|---:|---:|---:|---:|---|
| `low` | 2 | 30.000 | 0,05 | 2 | structured, sweep |
| `medium` | 6 | 90.000 | 0,15 | 3 | semantic |
| `high` | 12 | 240.000 | 0,50 | 5 | agentic (default), zelfheling naar de agent |
| `xhigh` | 20 | 180.000 | 1,00 | 6 | agentic met "grondig / rapport / per klant"; of `effort` in de body |
| `max` | 40 | 600.000 | 2,00 | 10 | alleen expliciet (`effort: "max"`) |

Bron: `agent_config('rag-chat','run_budgets')` (RESEARCH 02 §3.4, startwaarden = AANNAME
tot de categorieën `kosten`/`robuustheid` ze vervangen); de constanten in `run.ts` zijn de
fallback. Een expliciet `effort` in de body wint; anders kiest de route. Uitputting staat in
`envelope.budget.exhausted_by` (`tool_calls | usd | wall_ms | hops_max`), niet in
`coverage.reason`.

De hop-grenzen zijn geen productkeuze maar afgeleid van de slechtste beurt (60 s OpenAI-call
+ 30 s `semantic_search`): `HOP_SOFT_MS` 60 s, `HOP_HARD_MS` 170 s — onder de 400 s van het
Pro-plan en los van de 150 s idle-time-out van de gateway, omdat een hop nooit op een client
wacht. Het compat-pad kapt het run-budget op `COMPAT_WALL_MS` 140 s (de gateway geeft een
niet-streamende call na 150 s zonder byte een 504).

| grens | waarde | waar |
|---|---|---|
| `CONTEXT_BUILD_TIMEOUT_MS` | 6.000 ms | `rag-chat/run.ts` |
| `semantic_search` als agent-tool | 30 s, max 3× | `rag-chat/agentic.ts` |
| Grok-stream per hop | ≤ 120 s, nooit over de hop-deadline | `rag-chat/compose.ts` |

De 6-secondengrens was tot v1.146 een guillotine: het `search`-recept deed p50
13,3 s, dus negen van de tien semantische vragen kwamen leeg binnen. Sinds
v1.146 gaat de chatvraag naar `search_fast` (p50 2,4 s) en is de grens een
vangnet in plaats van een zeef. Zie `DECISIONS.md`, 2026-09-05.

## 3. Het antwoordcontract

Naast de vrije markdown draagt elk antwoord een `envelope`:

```jsonc
{
  "version": 1,
  "answer_md": "…",
  "claim":      "31 van 102 klanten gescand; 7 voldoen aan het criterium.",
  "definition": "Lopende Customer Base-deals met licentieprijs per gebruiker = …",
  "route":      "structured",
  "sources":    [{ "n": 1, "type": "mail", "id": "…", "date": "2026-08-14", "title": "…" }],
  "rows": [...], "columns": [...],
  "artifacts_available": ["xlsx", "csv"],
  "coverage": {
    "searched":     ["mail", "meeting", "deal"],
    "not_searched": ["agenda"],
    "reason":       null,          // of: timeout | acl_filtered | below_threshold | truly_empty | not_tracked
    "chunk_count":  24
  },
  "cost": { "usd": 0.0109, "tokens_in": 18422, "tokens_out": 1180, "tools": 0,
            "by_vendor": { "openai_embed_tokens": 31, "cohere_searches": 1, "grok_in": …, "grok_out": … } },
  "budget": { "effort": "high", "limits": { "tool_calls": 12, "wall_ms": 240000, "usd": 0.5, "hops_max": 5 },
              "spent": { "usd": 0.163, "wall_ms": 79950, "tool_calls": 19, "hops": 2, "tokens": { … } },
              "exhausted_by": null, "hops": 2 }      // v6.0, additief
}
```

Waarom dit de spil is: de UI kan er een tabel en een downloadknop op bouwen, de
evalharnas kan asserten zonder reguliere expressies over proza te leggen, en het
antwoord draagt zichtbaar zijn eigen dekking. Sinds v6.0 staat dezelfde envelop in
`agent_chat_runs.envelope` — het antwoord bestaat dus ook zonder open tab.

**`coverage.reason` is een gesloten verzameling.** Uitbreiden mag alleen samen
met `COVERAGE_SENTENCE` in `rag-chat/compose.ts`, `CoverageNote.jsx` en de
`expect_coverage_reason`-asserts in de vragenbank. Alle vier, of geen.

## 4. Identiteit — twee assen, nooit één

| as | vraag | bron |
|---|---|---|
| `p_owner_user_id` | wiens mail mag meedoen? | `rag_owner_scope_ids()` |
| `p_caller_user_id` | welke Confluence-spaces mag deze persoon lezen? | `confluence_allowed_spaces()` |

Ze hergebruiken zou betekenen dat het repareren van de space-ACL stilzwijgend
het mailbereik van elke chatvraag verandert. Fail-closed: geen `caller_user_id`
= alleen `org_baseline`. Elke nieuwe tool erft die keten; **een tool die
`caller_user_id` niet doorgeeft is een omweg om de ACL heen.**

De run-rij voegt een derde, aparte as toe: `owner_id` (= `auth.uid()` van de vrager) is de
**RLS-as** — wie mag de rij lezen. `caller_user_id` blijft de ACL-as en gaat als
`caller_user_id` mee naar `context-build` en de agent-tools, óók in latere hops (uit de rij,
niet uit een request). Service/cron-runs hebben `owner_id = NULL` en zijn voor niemand zichtbaar.

Bewaakt door `scripts/confluence_acl_eval.cjs` (17 asserties). G1 daarin is de
positieve controle: iemand die Management mág lezen moet MT-fragmenten
terugkrijgen. Een A/B-test die alleen controleert dat een verboden space nooit
opduikt, slaagt ook als de identiteit nooit wordt geraadpleegd — dan meet je
niets.

## 5. Meten

| wat | waar |
|---|---|
| dagcijfers: leeg-ratio, kosten, latency | `v_agent_chat_health` |
| per route en per recept | `v_agent_chat_by_route` |
| waarom was het leeg | `v_agent_chat_coverage` |
| **runs**: done/failed per code, hops, p95 t.o.v. budget, kosten, open > 30 min | `v_agent_chat_runs_health` (per dag × verkeer: browser/eval/smoke/api) |
| alarm | `agent_chat_health_check()`, cron `agent-chat-health-guard` (25 7-22) · `agent_chat_runs_watchdog()`, cron `agent-chat-runs-watchdog` (elke minuut, `WHERE EXISTS`) |
| retrieval-budget vóór/ná een wijziging | `scripts/agent_retrieval_bench.cjs` |
| index-hygiëne (wezen, race-dubbelen, gearchiveerd, geannuleerd) | `rag_chunks_reconcile()`, cron `rag-chunks-reconcile-daily` (03:50 UTC) → `agent_runs` `rag-chunks-reconcile`; vangnet > 25 % per bron |
| gedragstest na een deploy | `scripts/agent_chat_smoke.cjs` |
| artefactpad | `scripts/agent_artifact_smoke.cjs` |
| Confluence-ACL | `scripts/confluence_acl_eval.cjs` |
| **evalbank** (435 items: 364 bank + 71 legacy, 22 `is_core`), beide lanes, als echte gebruiker | `rag-eval-cron` v3.1 · `scripts/agent_eval_run.cjs` (kick/poll/compare/`--gate`) · `scripts/agent_eval_load.cjs` (laden, `--check`) |
| rookronde per PR op de chatketen (36 p0, ≤ $3, < 15 min) | `agent_eval_run.cjs --suite rook-p0 --gate` — CLAUDE.md pre-flight punt 8 |
| poorten G1–G7 per run, per categorie | RPC `rag_eval_compare(after, before)` → `rag_eval_runs.gates`; `v_agent_eval_by_category`, `v_agent_eval_core_trend`, `v_agent_eval_runs` |
| persona's en identiteitsborging | `rag_eval_personas` + `rag_eval_persona_check` (→ `invalid_persona`) + `caller_identified` per rij (`n_identity_unreliable` hoort 0 te zijn) |
| wekelijkse volledige ronde / pomp | cron `rag-eval-weekly` (zo 04:30 CEST, suite `full`) · `rag-eval-pump` (elke minuut 06–23) · nachtelijk uit (`agent_config` `nightly_enabled`) |

Evalverkeer draagt `meta.eval_run_id` in `rag_chat_query_log` en `eval_run_id` in
`agent_chat_runs`; de gezondheidsviews sluiten het uit of tellen het apart, anders meet
de dagteller de rookronde in plaats van de gebruiker (gemeten: 86 van 88 rijen in 30
dagen waren testverkeer).

**Tokens zijn feiten, tarieven zijn beleid.** `meta.usage` in `rag_chat_query_log` en
`spent.tokens` in `agent_chat_runs` bewaren de ruwe tokens per leverancier; `est_cost_usd`
(= `spent.usd`) is daarvan afgeleid met één prijstabel: `agent_config('rag-chat','pricing')`,
met de constanten in `compose.ts`/`agentic.ts`/`analytics.ts` als fallback. Verandert een
tarief, dan is de hele historie herrekenbaar.

## 6. Waar dit heen gaat

- **Spoor 02 I2 — de browser volgt de rij.** `useRunFollow` op
  `createRealtimeChannel('agent-run')` (hard-rule: nooit `supabase.channel`), poll-fallback
  elke 5 s, opnieuw aanhechten na reload, annuleerknop (`agent_chat_run_cancel`),
  `needs_input` als tekst + antwoordveld; smoke S7–S11 (disconnect 3/3, realtime-RLS met
  persona 2 én positieve controle); `rag-eval-cron` v3.1 leest de run-rij (dan verdwijnt de
  170 s-clamp en wordt `expect_effort_at_least` meetbaar). Daarna gaan de compat-paden weg (V7).
- **Spoor 03 — één model dat denkt én antwoordt.** Nu draaien er drie leveranciers per vraag
  en schrijft Grok het eindantwoord op basis van een samengeperste conclusie van de agent
  (S3b stap 2 zet daar Terra/Sol voor in; de composer zit sinds v6.0 op één plek:
  `compose.ts`). Blokkade voor Anthropic: `_shared/anthropic-fetch.ts` kan geen `tools`,
  `thinking`, `output_config` of streaming. `claude_api_calls.chat_run_id` wacht op die wrapper.

## 7. De run — toestanden, hops, rechten, watchdog

```
queued ──► planning ──► researching ──► composing ──► done
              │             │  ▲            │
              │             │  └─ needs_input (RPC answer_input → researching → {_run_id, resume:true})
              └─────────────┴───────────────┴──► failed {provider_error | hop_lost | budget_wall | internal}
                                                 cancelled (RPC cancel, eigenaar)
```

- **Wie schrijft.** Alleen de motor (service_role) zet toestanden. De browser leest owner-only
  en schrijft uitsluitend via twee `SECURITY DEFINER`-RPC's met eigenaarscheck
  (`agent_chat_run_cancel`, `agent_chat_run_answer_input`). `agent_chat_run_state` heeft geen
  policies: service-only.
- **De lease.** `agent_chat_run_claim_hop` zet `hop + 1`, een nieuw `hop_lease`-token en
  `hop_claimed_at`; een lease ouder dan 5 minuten is opnieuw claimbaar. Elke UPDATE van de hop
  eist `hop_lease = <eigen token>`: verliest een hop de race (pomp, annulering, watchdog), dan
  schrijft hij niets meer. Aan het einde geeft de hop de lease vrij en start pas dán de volgende.
- **Hervatten.** De agent-lus bewaart na élke beurt zijn berichtenlijst, evidence, trace en
  tellers in `agent_chat_run_state`; de volgende hop gaat exact daar verder (prompt-cache helpt:
  58 % cache-hits gemeten). Na de research staat de compose-payload klaar in de state-rij, zodat
  een verse hop het antwoord kan schrijven zonder de retrieval te herhalen.
- **Realtime.** `agent_chat_runs` staat in `supabase_realtime`; RLS geldt per abonnee, maar
  `session_mfa_ok()` evalueert onder realtime als true — daar telt alleen de eigenaarscheck,
  identiek aan `tasks`/`agent_proposals` vandaag (V8, observatie voor security-monitor). REST
  eist wél een MFA-sessie.
- **Watchdog** (`agent_chat_runs_watchdog`, elke minuut mét `WHERE EXISTS`): geen write en geen
  levende lease in `stall_minutes` (5) → `failed{hop_lost}`; `deadline_at` (= start +
  `budget.wall_ms` + 60 s) verstreken → `failed{budget_wall}`; state-rijen 7 dagen na terminaal
  weg, runs na 90 dagen, `needs_input` zonder antwoord na 7 dagen → `cancelled`;
  `security_findings` medium bij ≥ 1 `hop_lost` per 24 u, high bij een run > 30 min open.
- **Compat (tot I2).** `stream:true|false` maakt óók een run-rij en draait alle hops in
  dezelfde invocatie; het antwoordcontract is byte-gelijk aan v5.8, plus `run_id` in `meta`
  en het `done`-event. Zo heeft sinds v6.0 100 % van de vragen een run-rij (poort T1).
