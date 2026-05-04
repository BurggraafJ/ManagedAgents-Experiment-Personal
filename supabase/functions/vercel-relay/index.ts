// vercel-relay — DEPRECATED 2026-04-28.
// Vervangen door 'vercel-control' (list/redeploy/promote/rollback/cancel met
// token uit agent_config('dashboard-refresh','vercel_token') i.p.v. hardcoded).
// Deze stub returnt 410 Gone zodat eventuele oude callers een nette fout
// krijgen i.p.v. een silent succes met een verlopen token.

Deno.serve(() =>
  new Response(
    JSON.stringify({
      ok: false,
      error: 'gone',
      message: 'vercel-relay is uitgefaseerd. Gebruik /functions/v1/vercel-control met action=list|redeploy|promote|rollback|cancel.',
      replacement: 'vercel-control',
      deprecated_at: '2026-04-28',
    }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  )
);
