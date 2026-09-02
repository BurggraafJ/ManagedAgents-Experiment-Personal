// Supabase Edge Function: transcribe (v4 — Vault-first key lookup)
// POST multipart/form-data met field 'audio' (audio/webm of audio/mp4)
// Returnt { text: string } via OpenAI Whisper API.
//
// verify_jwt=TRUE (v5, 2026-09-02 · security review F-07). Deze functie wordt
// vanuit de browser door de ingelogde gebruiker aangeroepen
// (useVoiceInput → supabase.functions.invoke stuurt de sessie-JWT mee), dus de
// gateway hoort de JWT-check te doen — zelfde model als kb-compose/invite-user.
//
// Wat hier stond: `headerKey.includes(anonKey.slice(0, 20))`. De anon-key staat
// in de publieke browser-bundle, dus dat was bezit van een openbare waarde en
// geen authenticatie — effectief een open transcriptie-proxy (15 MB per call)
// op Jelle's OpenAI Whisper-key. De prefix-`includes` was daarbij ook nog een
// niet-constante, gedeeltelijke vergelijking.
//
// De Whisper-key zelf komt uit Vault via service_role en komt
// nooit in de browser bundle.
//
// v4 (2026-05-03): key uit Vault (skill:openai:whisper_key) — agent_config
// werd op 2026-05-02 gecleared maar deze function las daar nog. Bug-fix.
// Fallback naar agent_config(openai, whisper_key) blijft voor noodgeval.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Auth. `verify_jwt = true` alleen is niet genoeg: de gateway controleert
  // of de JWT geldig ondertekend is, en de publieke anon-key ís een geldige JWT.
  // Gemeten op productie 2026-09-02: een call met alleen de anon-key kwam
  // ongehinderd in deze body. Dus hier de tweede helft van F-07: er moet een
  // echte ingelogde gebruiker achter de token zitten.
  const authHeader = req.headers.get('Authorization') || ''
  const callerToken = authHeader.replace(/^Bearer\s+/i, '').trim()
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { auth: { persistSession: false } },
  )
  const { data: caller, error: callerErr } = await anonClient.auth.getUser(callerToken)
  if (callerErr || !caller?.user?.id) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const form = await req.formData()
    const audio = form.get('audio')
    if (!(audio instanceof Blob)) {
      return new Response(JSON.stringify({ error: 'missing_audio_field' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (audio.size > 15 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'audio_too_large' }), {
        status: 413, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, serviceKey)

    // Vault-first lookup; fallback naar agent_config voor noodgevallen
    let apiKey = ''
    const { data: vaultValue } = await sb.rpc('get_skill_secret_service', {
      p_skill_name: 'openai',
      p_secret_name: 'whisper_key',
    })
    if (typeof vaultValue === 'string' && vaultValue.length > 0) {
      apiKey = vaultValue
    } else {
      const { data: row } = await sb
        .from('agent_config')
        .select('config_value')
        .eq('agent_name', 'openai')
        .eq('config_key', 'whisper_key')
        .maybeSingle()
      if (row?.config_value) {
        apiKey = String(row.config_value).replace(/^"|"$/g, '')
      }
    }

    if (!apiKey || apiKey.length < 20) {
      return new Response(JSON.stringify({ error: 'key_not_configured', detail: 'Vault skill:openai:whisper_key niet gevuld en agent_config-fallback ook leeg' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const oaiForm = new FormData()
    const ext = audio.type.includes('mp4') ? 'mp4'
              : audio.type.includes('ogg') ? 'ogg'
              : 'webm'
    oaiForm.append('file', audio, `input.${ext}`)
    oaiForm.append('model', 'whisper-1')
    oaiForm.append('language', 'nl')
    oaiForm.append('response_format', 'json')

    const oaiRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: oaiForm,
    })

    if (!oaiRes.ok) {
      const msg = await oaiRes.text()
      return new Response(JSON.stringify({ error: 'openai_error', status: oaiRes.status, detail: msg.slice(0, 300) }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const json = await oaiRes.json() as { text?: string }
    return new Response(JSON.stringify({ text: json.text ?? '' }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'unexpected', detail: String(e).slice(0, 300) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
