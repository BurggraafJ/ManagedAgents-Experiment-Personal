#!/usr/bin/env node
// =============================================================================
// parse-claude-session.cjs — sessie-log → claude_api_calls inserts
// =============================================================================
// Doel: Claude Code logt elke skill-run als JSONL in ~/.claude/projects/<encoded>/
// <session-uuid>.jsonl. Elke `assistant`-event bevat de Anthropic API response
// (model, usage, content). Deze parser extraheert die rijen en inserts ze in
// claude_api_calls — voor cost-tracking, loop-detectie en replay.
//
// Aanroep:
//   node scripts/parse-claude-session.cjs <session-uuid> [--run-id <uuid>] [--skill <name>]
//   node scripts/parse-claude-session.cjs --all-since <iso-timestamp>
//   node scripts/parse-claude-session.cjs --dry-run <session-uuid>   # alleen tonen
//
// Dedup: claude_api_calls.message_uuid is UNIQUE — herhaalde parser-runs
// inserteren geen dubbele rijen.
//
// ENV vereist:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (voor de service-role insert)
//
// Zie Confluence: Project — Token Cost Counter & Helicone-traces (450101261) v3.
// =============================================================================

const { readFileSync, readdirSync, statSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const os = require('node:os');

// -----------------------------------------------------------------------------
// CLI parsing
// -----------------------------------------------------------------------------

const args = process.argv.slice(2);
const opts = { dryRun: false, runId: null, skill: null, sessionUuid: null, allSince: null };

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dry-run')   opts.dryRun = true;
  else if (a === '--run-id')    opts.runId   = args[++i];
  else if (a === '--skill')     opts.skill   = args[++i];
  else if (a === '--all-since') opts.allSince = args[++i];
  else if (!opts.sessionUuid && !a.startsWith('--')) opts.sessionUuid = a;
}

if (!opts.sessionUuid && !opts.allSince) {
  console.error('Usage: node parse-claude-session.cjs <session-uuid> [--run-id <uuid>] [--skill <name>] [--dry-run]');
  console.error('   or: node parse-claude-session.cjs --all-since <iso-timestamp>');
  process.exit(2);
}

// -----------------------------------------------------------------------------
// Session-file discovery
// -----------------------------------------------------------------------------

const PROJECTS_DIR = join(os.homedir(), '.claude', 'projects');

function findSessionFile(uuid) {
  if (!existsSync(PROJECTS_DIR)) return null;
  for (const project of readdirSync(PROJECTS_DIR)) {
    const projDir = join(PROJECTS_DIR, project);
    // Top-level session
    const top = join(projDir, `${uuid}.jsonl`);
    if (existsSync(top)) return top;
    // Subagent session — gespawnd door orchestrator. UUID's daar beginnen met "agent-"
    // (bv. agent-a01dfd64a943cabb0.jsonl). Loop alle parent-session-folders door.
    let parents; try { parents = readdirSync(projDir); } catch { continue; }
    for (const parent of parents) {
      const subDir = join(projDir, parent, 'subagents');
      if (!existsSync(subDir)) continue;
      const sub = join(subDir, `${uuid}.jsonl`);
      if (existsSync(sub)) return sub;
    }
  }
  return null;
}

function listSessionsSince(isoTimestamp) {
  const cutoff = new Date(isoTimestamp).getTime();
  const found = [];
  if (!existsSync(PROJECTS_DIR)) return found;

  function scanDir(dir) {
    let entries; try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        // Recurse into subagents/ folders, skip other subdirs
        if (e === 'subagents') scanDir(p);
      } else if (e.endsWith('.jsonl') && st.mtimeMs >= cutoff) {
        found.push({ uuid: e.replace(/\.jsonl$/, ''), file: p });
      }
    }
  }

  for (const project of readdirSync(PROJECTS_DIR)) {
    const projDir = join(PROJECTS_DIR, project);
    let entries; try { entries = readdirSync(projDir); } catch { continue; }
    for (const e of entries) {
      const p = join(projDir, e);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        // Walk parent-session folder for subagents/
        const subDir = join(p, 'subagents');
        if (existsSync(subDir)) scanDir(subDir);
      } else if (e.endsWith('.jsonl') && st.mtimeMs >= cutoff) {
        found.push({ uuid: e.replace(/\.jsonl$/, ''), file: p });
      }
    }
  }
  return found;
}

// -----------------------------------------------------------------------------
// JSONL → claude_api_calls rows
// -----------------------------------------------------------------------------

function sha256Hex16(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

function extractCallsFromSession(sessionFile, sessionUuid) {
  const rows = [];
  let text;
  try { text = readFileSync(sessionFile, 'utf8'); } catch (e) {
    console.warn(`Failed to read ${sessionFile}: ${e.message}`);
    return rows;
  }

  // Track last user message per turn for prompt-preview / hash
  let lastUserPreview = '';

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    // Capture user-side content for prompt-preview attribution
    if (obj.type === 'user' && obj.message?.content) {
      const c = obj.message.content;
      lastUserPreview = typeof c === 'string'
        ? c.slice(0, 500)
        : JSON.stringify(c).slice(0, 500);
    }

    // Only assistant-events have the Anthropic API response we want to log
    if (obj.type !== 'assistant' || !obj.message) continue;
    const m = obj.message;
    if (!m.usage || !m.model) continue;

    const content = Array.isArray(m.content)
      ? m.content.map(c => c.text ?? c.input ?? JSON.stringify(c)).join('\n').slice(0, 500)
      : String(m.content ?? '').slice(0, 500);

    rows.push({
      run_id:                       opts.runId ?? null,
      source:                       'claude_code_session',
      source_session_uuid:          sessionUuid,
      source_edge_function:         null,
      skill_name:                   opts.skill ?? null,
      agent_name:                   null,
      model:                        m.model,
      input_tokens:                 m.usage.input_tokens                 ?? 0,
      cache_read_input_tokens:      m.usage.cache_read_input_tokens      ?? 0,
      cache_creation_input_tokens:  m.usage.cache_creation_input_tokens  ?? 0,
      output_tokens:                m.usage.output_tokens                ?? 0,
      latency_ms:                   null,             // niet beschikbaar in jsonl
      status:                       m.stop_reason === 'error' ? 'error' : 'ok',
      error_text:                   null,
      message_uuid:                 m.id ?? null,
      prompt_hash:                  lastUserPreview ? sha256Hex16(lastUserPreview) : null,
      prompt_preview:               lastUserPreview || null,
      response_preview:             content,
    });
  }

  return rows;
}

// -----------------------------------------------------------------------------
// Supabase insert (chunked, met dedup via UNIQUE message_uuid)
//
// Twee modes — auto-detect via env-vars:
//   1. REST-pad (default): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   2. Management API-pad: SBT (Supabase Management PAT) + PROJECT_REF
// -----------------------------------------------------------------------------

const PROJECT_REF_DEFAULT = 'ezxihctobrqoklufawim';

async function insertRows(rows) {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };

  const sbt = process.env.SBT;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (sbt) {
    return insertViaManagementAPI(rows, sbt, process.env.SUPABASE_PROJECT_REF || PROJECT_REF_DEFAULT);
  }
  if (url && key) {
    return insertViaRest(rows, url, key);
  }
  throw new Error('Geef ofwel SBT (Management PAT) ofwel SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY mee');
}

async function insertViaRest(rows, url, key) {
  let inserted = 0;
  let skipped = 0;
  const CHUNK = 200;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res = await fetch(`${url}/rest/v1/claude_api_calls?on_conflict=message_uuid`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`REST insert failed (${res.status}): ${txt.slice(0, 500)}`);
    }
    const inserted_rows = await res.json();
    inserted += inserted_rows.length;
    skipped  += chunk.length - inserted_rows.length;
  }

  return { inserted, skipped };
}

function sqlLit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function insertViaManagementAPI(rows, sbt, projectRef) {
  const api = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  let inserted = 0;
  let skipped = 0;
  const CHUNK = 100;
  const COLS = [
    'run_id','source','source_session_uuid','source_edge_function','skill_name','agent_name',
    'model','input_tokens','cache_read_input_tokens','cache_creation_input_tokens','output_tokens',
    'latency_ms','status','error_text','message_uuid','prompt_hash','prompt_preview','response_preview',
  ];

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const valuesSql = chunk.map(r => {
      return '(' + COLS.map(c => sqlLit(r[c])).join(', ') + ')';
    }).join(',\n');

    const sql = `
      WITH ins AS (
        INSERT INTO public.claude_api_calls (${COLS.join(', ')})
        VALUES
${valuesSql}
        ON CONFLICT (message_uuid) WHERE message_uuid IS NOT NULL DO NOTHING
        RETURNING id
      )
      SELECT count(*)::int AS inserted FROM ins;
    `;

    const res = await fetch(api, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sbt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`MA insert failed (${res.status}): ${txt.slice(0, 500)}`);
    }
    const out = await res.json();
    const ins = Array.isArray(out) && out[0] && typeof out[0].inserted === 'number' ? out[0].inserted : 0;
    inserted += ins;
    skipped  += chunk.length - ins;
  }

  return { inserted, skipped };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

(async () => {
  let allRows = [];

  if (opts.allSince) {
    const sessions = listSessionsSince(opts.allSince);
    console.log(`Found ${sessions.length} session file(s) modified since ${opts.allSince}`);
    for (const s of sessions) {
      const rows = extractCallsFromSession(s.file, s.uuid);
      allRows.push(...rows);
    }
  } else {
    const file = findSessionFile(opts.sessionUuid);
    if (!file) {
      console.error(`Session file not found for uuid: ${opts.sessionUuid}`);
      process.exit(2);
    }
    allRows = extractCallsFromSession(file, opts.sessionUuid);
  }

  console.log(`Extracted ${allRows.length} claude_api_calls row(s)`);

  if (opts.dryRun) {
    for (const r of allRows.slice(0, 5)) {
      console.log(JSON.stringify({
        model: r.model, in: r.input_tokens, cached: r.cache_read_input_tokens,
        out: r.output_tokens, msg: r.message_uuid,
      }));
    }
    if (allRows.length > 5) console.log(`... and ${allRows.length - 5} more`);
    return;
  }

  const { inserted, skipped } = await insertRows(allRows);
  console.log(`Inserted ${inserted} new row(s), skipped ${skipped} duplicate(s)`);
})().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
