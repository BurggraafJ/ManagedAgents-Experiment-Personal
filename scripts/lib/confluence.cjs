// =============================================================================
// lib/confluence.cjs — Confluence-REST met Basic auth uit de Vault  (spoor 07)
// =============================================================================
// Het transport dat bewezen werkt (geheugen `confluence-rest-via-vault`): geen
// Atlassian-MCP, geen Composio, geen OAuth-prompt. Twee geheimen uit de DB:
//
//   agent_config('global','atlassian_email')            → burggraaf@legal-mind.nl
//   get_skill_secret_service('global','atlassian_api_token')  → Vault
//
// ⚠ De token-RPC is `postgres|service_role`-only. Onder `read_only: true`
//   draait `/database/query` als `supabase_read_only_user` en geeft
//   `permission denied for function get_skill_secret_service`. Daarom leest
//   ALLEEN `credentials()` zonder die vlag; elke andere query hoort read-only
//   te blijven (`sql()` in de aanroeper).
//
// ⚠ De body moet storage-XHTML zijn (`representation: "storage"`). De MCP-tool
//   slikt markdown, de REST-API niet — die zet het letterlijk op de pagina.
//   Zie `esc()`/`p()` hieronder en controleer met `renderedBody()`.
// =============================================================================
const fs = require('fs');

const BASE = process.env.CONFLUENCE_BASE || 'https://bg-intelligence.atlassian.net/wiki/rest/api';
const SPACE = process.env.CONFLUENCE_SPACE || 'LM';
const UA = 'legal-mind-dashboard-claude/1.0';
const REF = process.env.SUPABASE_REF || 'ezxihctobrqoklufawim';

const SBT = process.env.SBT || (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/supabase-mcp.json', 'utf8'))
      .mcpServers.supabase.headers.Authorization.split(' ')[1];
  } catch { return null; }
})() || process.env.SUPABASE_ACCESS_TOKEN || null;

// ── SQL via de Management-API ────────────────────────────────────────────────
// `readOnly` staat standaard aan; alleen de Vault-lezing zet hem uit.
async function sql(query, readOnly = true) {
  if (!SBT) throw new Error('geen management-token: zet SBT= of leg ~/.claude/supabase-mcp.json neer');
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(readOnly ? { query, read_only: true } : { query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`sql ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

// ── Credentials ─────────────────────────────────────────────────────────────
let _auth = null;
async function credentials() {
  if (_auth) return _auth;
  let email = process.env.ATLASSIAN_EMAIL || null;
  let token = process.env.ATLASSIAN_API_TOKEN || null;
  if (!email || !token) {
    const row = (await sql(`select
        (select config_value #>> '{}' from public.agent_config
          where agent_name='global' and config_key='atlassian_email') as email,
        public.get_skill_secret_service('global','atlassian_api_token') as token`, false))[0];
    email = email || (row && row.email);
    token = token || (row && row.token);
  }
  if (!email || !token) throw new Error('geen Atlassian-credentials (agent_config atlassian_email / Vault skill:global:atlassian_api_token)');
  _auth = { email, header: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64') };
  return _auth;
}

async function api(pathAndQuery, init = {}) {
  const { header } = await credentials();
  const r = await fetch(`${BASE}${pathAndQuery}`, {
    ...init,
    headers: { Authorization: header, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA, ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`confluence ${init.method || 'GET'} ${pathAndQuery.split('?')[0]} → ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

// ── Storage-XHTML bouwstenen ────────────────────────────────────────────────
// Alleen `& < >` hoeven te ontsnappen; de accenten en het kastlijntje mogen als
// UTF-8 door (de bestaande auditreeks doet het met entities, beide renderen).
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p = (s) => `<p>${s}</p>`;
const code = (s) => `<code>${esc(s)}</code>`;
const h = (n, s) => `<h${n}>${s}</h${n}>`;
const ul = (items) => (items.length ? `<ul>${items.map((i) => `<li><p>${i}</p></li>`).join('')}</ul>` : '');

// Cellen krijgen een <p> zoals de bestaande auditpagina's; zonder <p> rendert
// Confluence de cel wel, maar de editor herschrijft hem bij de eerste bewerking
// en dan verschuift de diff van de volgende run.
function table(headers, rows) {
  const th = headers.map((x) => `<th><p>${x}</p></th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((x) => `<td><p>${x == null || x === '' ? '&ndash;' : x}</p></td>`).join('')}</tr>`).join('');
  return `<table data-layout="default"><tbody><tr>${th}</tr>${tr}</tbody></table>`;
}

// ── Pagina's ────────────────────────────────────────────────────────────────
// Titel-zoeken gaat via de kinderlijst, niet via CQL: de titels bevatten een
// kastlijntje en CQL-escaping daarvan is een tweede faalmodus voor niets.
async function findChildByTitle(parentId, title) {
  const out = [];
  for (let start = 0; ; start += 100) {
    const r = await api(`/content/${parentId}/child/page?limit=100&start=${start}&expand=version`);
    out.push(...(r.results || []));
    if (!r.results || r.results.length < 100) break;
  }
  return out.find((x) => x.title === title) || null;
}

// Eén pagina per titel: bestaat hij, dan wordt hij overschreven (D07-2 — een
// `(inhaalronde <datum>)`-suffix maakt de reeks stuk; de datum hoort in de body).
async function upsertPage({ parentId, title, body, space = SPACE }) {
  const existing = await findChildByTitle(parentId, title);
  const payload = {
    type: 'page', title, space: { key: space },
    ancestors: [{ id: String(parentId) }],
    body: { storage: { value: body, representation: 'storage' } },
  };
  if (existing) {
    const res = await api(`/content/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...payload, id: existing.id, version: { number: existing.version.number + 1 } }),
    });
    return { id: res.id, version: res.version.number, created: false, url: pageUrl(res) };
  }
  const res = await api('/content', { method: 'POST', body: JSON.stringify(payload) });
  return { id: res.id, version: res.version.number, created: true, url: pageUrl(res) };
}

const pageUrl = (res) => `https://bg-intelligence.atlassian.net/wiki${(res._links && res._links.webui) || `/spaces/${SPACE}/pages/${res.id}`}`;

// Na elke schrijfactie: rendert de pagina echt? `body.view` is wat de lezer
// ziet — losse entities en achtergebleven `${` vallen daar op, in storage niet.
async function renderedBody(id) {
  const r = await api(`/content/${id}?expand=body.view,version,title`);
  return { title: r.title, version: r.version.number, view: (r.body && r.body.view && r.body.view.value) || '' };
}

module.exports = { sql, credentials, api, esc, p, code, h, ul, table, findChildByTitle, upsertPage, renderedBody, BASE, SPACE, SBT };
