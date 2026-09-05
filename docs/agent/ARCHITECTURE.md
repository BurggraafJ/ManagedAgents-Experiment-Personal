# De Maestro-chat — hoe hij werkt

Stand: **v1.146**, 2026-09-05. Bijwerken hoort bij het werkpakket dat de lus
verandert, niet erna. `TOOLS.md` ernaast is gegenereerd; dit bestand is met de
hand geschreven en beschrijft wat een tabel niet kan zeggen.

De volledige analyse achter deze architectuur staat in
`/workspace/security/AGENT-REBUILD-RESEARCH.md`; wat er in september 2026
daadwerkelijk van gebouwd is, in `/workspace/security/AGENT-REBUILD.md`.

---

## 1. De vraag door het systeem

```
browser (useRagChat, SSE)
   │
   ▼
rag-chat            verify_jwt: TRUE  ← callerSub() leest de `sub`; die bepaalt
   │                                    welke Confluence-spaces zichtbaar zijn
   ├── loadMirrorCtx()      heeft deze gebruiker een gespiegelde mailbox?
   ├── loadOrgSkills()      organisatieregels achter de system-prompt
   ├── classifyRoute()      gpt-5.4-mini, 8 s — kiest één van vier
   │     ├── structured →  één analytics_*-RPC          50-570 ms, deterministisch
   │     ├── sweep      →  mail-voorfilter + verdicts    1,3-5,4 s
   │     ├── agentic    →  tool-lus (gpt-5.5)            ≤10 calls, ≤150 s, ≤$0,50
   │     └── semantic   →  entity + context-build + rerank
   │
   ├── zelfheling: < 3 bruikbare fragmenten → alsnog de agent
   ├── envelop bouwen (§3)
   └── antwoord: Grok 4.3, streaming
          │
          ▼
   rag_chat_query_log   elke vraag, met kosten, dekking en reden
```

`context-build` (verify_jwt: **false**, server-to-server) is de retrieval-laag.
Hij kent negen-plus recepten; welk recept een chatvraag krijgt staat in
`TOOLS.md` §4.

## 2. De drie budgetten die ertoe doen

| grens | waarde | waar |
|---|---|---|
| `CONTEXT_BUILD_TIMEOUT_MS` | 6.000 ms | `rag-chat/index.ts` |
| agent-lus | 10 calls / 150 s / $0,50 | `rag-chat/agentic.ts` |
| `semantic_search` als agent-tool | 30 s, max 3× | `rag-chat/agentic.ts` |

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
            "by_vendor": { "openai_embed_tokens": 31, "cohere_searches": 1, "grok_in": …, "grok_out": … } }
}
```

Waarom dit de spil is: de UI kan er een tabel en een downloadknop op bouwen, de
evalharnas kan asserten zonder reguliere expressies over proza te leggen, en het
antwoord draagt zichtbaar zijn eigen dekking.

**`coverage.reason` is een gesloten verzameling.** Uitbreiden mag alleen samen
met `COVERAGE_SENTENCE` in `rag-chat/index.ts`, `CoverageNote.jsx` en de
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
| alarm | `agent_chat_health_check()`, cron `agent-chat-health-guard` (25 7-22) |
| retrieval-budget vóór/ná een wijziging | `scripts/agent_retrieval_bench.cjs` |
| gedragstest na een deploy | `scripts/agent_chat_smoke.cjs` |
| artefactpad | `scripts/agent_artifact_smoke.cjs` |
| Confluence-ACL | `scripts/confluence_acl_eval.cjs` |

**Tokens zijn feiten, tarieven zijn beleid.** `meta.usage` in
`rag_chat_query_log` bewaart de ruwe tokens per leverancier; `est_cost_usd` is
daarvan afgeleid met de prijstabel in `rag-chat/index.ts`. Verandert een tarief,
dan is de hele historie herrekenbaar.

## 6. Waar dit heen gaat

WP5 t/m WP10 uit het onderzoek staan nog open. De twee die de architectuur echt
veranderen:

- **WP6 — de vraag wordt een run.** `agent_chat_runs` met een toestandsmachine,
  een budget en self-chaining (het patroon dat `rag-eval-cron` v2.4 al draait).
  Dieper denken wordt dan een budgetkeuze in plaats van een race tegen de
  400-secondengrens van één HTTP-call.
- **WP7 — één model dat denkt én antwoordt.** Nu draaien er drie leveranciers
  per vraag en schrijft Grok het eindantwoord op basis van een samengeperste
  conclusie van de agent. Dat kost geld, latency, en het is de plek waar het
  antwoord van de bevindingen af kan drijven zonder dat iemand het merkt.
  Blokkade die eerst weg moet: `_shared/anthropic-fetch.ts` kan geen `tools`,
  `thinking`, `output_config` of streaming.
