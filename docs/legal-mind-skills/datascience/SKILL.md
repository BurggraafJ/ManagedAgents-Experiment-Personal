# Legal Mind Data Science Skill

**Domain:** RAG pipeline, chunking, embeddings, vector search, knowledge base (kb-*), and semantic retrieval.

## Scope

Use this skill when working on:
- **RAG pipeline**: Chunker, context-build, autodraft-rag-prefill, mail-enricher
- **Chunks**: Document chunking strategy, chunk metadata, chunk_documents table
- **Embeddings**: Vector embeddings (OpenAI, Anthropic), embedding models, embedding refresh
- **Vector search**: pgvector queries, similarity thresholds, reranking
- **Knowledge base (kb-*)**: kb-curator, kb-article-embed, kb-knowledge-extractor, kb-compose
- **RAG data sources**: Fireflies meetings, mail threads, documents, CRM data
- **Semantic retrieval**: RAG chat, entity search, company/deal context

## Core principles

1. **Live data first:** Always query Supabase project `ezxihctobrqoklufawim` for current RAG state:
   - `chunk_documents` (chunks awaiting processing)
   - `chunks` (processed chunks with embeddings)
   - `kb_articles`, `kb_raw_sources` (knowledge base data)
   - Edge function logs for chunker/kb-* status

2. **Hand off to other skills:**
   - **RAG cron scheduling** (chunker staleness, health checks) → read `agent-manager/SKILL.md`
   - **Schema changes** (new RAG tables, indexes, RPCs) → read `database-manager/SKILL.md`
   - **Edge function deployment** (chunker, kb-*, verify_jwt) → read `agent-handbook/SKILL.md`

3. **RAG cron Edge Functions:** All RAG pipeline functions called by pg_cron **must** use `verify_jwt: false`. See `/workspace/CLAUDE.md` "RAG-cron Edge Functions = verify_jwt:false" for the full list:
   - `chunker`, `context-build`, `chunker-meeting-v2`, `fireflies-categorize`
   - `autodraft-rag-prefill`, `mail-enricher`, `*-sync-etl`, reconciles
   - `kb-curator`, `kb-article-embed`, `kb-knowledge-extractor`
   - **Exception:** `kb-compose` uses `verify_jwt: true` (browser-called, not cron)

4. **Chunker staleness monitoring:** The `rag_pipeline_staleness_check()` function (cron `rag-chunker-staleness-guard`, */15 6-22) alerts via `security_findings` if the chunker is silent while work waits. If you change chunker or chunk_documents schema, verify this check still works.

5. **Anthropic wrapper:** All Anthropic calls (e.g., for embeddings, RAG chat) from edge functions **must** use `callAnthropic()` from `_shared/anthropic-fetch.ts`. Never call the API directly. See `/workspace/CLAUDE.md` "Anthropic-calls via centrale wrapper".

6. **Hard-rules apply:** Before any commit, validate against `/workspace/CLAUDE.md` hard-rules:
   - Realtime channels via `createRealtimeChannel()` helper
   - Version bump for visible changes
   - Pre-flight checklist (build, grep checks, audit-anthropic-calls.cjs)

## Reference documentation

See `references/` directory for:
- RAG pipeline architecture and data flow
- Chunking strategy and chunk metadata schema
- Embedding model selection and refresh procedures
- Vector search query patterns and reranking
- Knowledge base (kb-*) function reference
- RAG chat implementation and context-building
- Staleness check and health monitoring

*(Note: `references/` files are populated by the team; consult them before making changes.)*

## Project metadata

- **Live DB:** `ezxihctobrqoklufawim`
- **Vercel project:** `legal-mind-dashboard`
- **Live URL:** https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app

## Cross-skill workflow example

**Task:** "Add a new data source to the RAG pipeline with chunking and embeddings"

1. Read this skill (`datascience/SKILL.md`) for chunking strategy and embedding config
2. Read `database-manager/SKILL.md` for new tables (source data, chunks, metadata)
3. Read `agent-manager/SKILL.md` for cron schedule to populate the source
4. Read `agent-handbook/SKILL.md` for edge function deployment (chunker update, verify_jwt: false)
5. Update chunker edge function to handle new source type
6. Deploy with `deploy_edge_function` MCP (read repo file verbatim)
7. Verify `verify_jwt: false` flag after deploy
8. Test with one behavioral call (not just 200-check)
9. Validate all changes against `/workspace/CLAUDE.md` pre-flight checklist

## See also

- `/workspace/.cursor/rules/legal-mind-dev.mdc` — skill routing logic
- `/workspace/AGENTS.md` — skill system overview
- `/workspace/CLAUDE.md` — project hard-rules (RAG cron verify_jwt, anthropic wrapper, edge-deploy 1:1)
