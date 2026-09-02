import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// useOutlookConnector — de eigen Outlook-koppeling van de ingelogde gebruiker.
//
// Alles loopt via de Edge Function `connectors-outlook`: die praat met Composio
// en houdt `user_connectors` bij. De browser ziet daarom nooit een token — hij
// krijgt hooguit de consent-URL van Microsoft/Composio. Bewust GEEN directe
// tabel-query en niets in localStorage.
//
// v1.136: nieuw (Instellingen › Connectors, desktop + mobiel).

const FN = 'connectors-outlook'
// Na terugkeer uit de OAuth-flow staat de connectie soms nog even op
// 'pending' bij Composio. Kort doorpollen tot 'ie omslaat.
const POLL_MS = 2500
const POLL_MAX = 8

async function callFn(action) {
  const { data, error } = await supabase.functions.invoke(FN, { body: { action } })
  if (error) {
    // Edge Functions geven de body mee in context; die bevat onze eigen
    // foutcode en is bruikbaarder dan "Edge Function returned a non-2xx".
    let detail = error.message || String(error)
    try {
      const j = await error.context?.json?.()
      if (j?.error) detail = j.detail ? `${j.error}: ${j.detail}` : j.error
    } catch { /* geen JSON-body */ }
    throw new Error(detail)
  }
  if (data && data.ok === false) throw new Error(data.detail || data.error || 'onbekende fout')
  return data || {}
}

export function useOutlookConnector() {
  const [status, setStatus] = useState('loading')   // loading|disconnected|pending|connected|error
  const [accountEmail, setAccountEmail] = useState(null)
  const [connectedAt, setConnectedAt] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const pollsLeft = useRef(0)
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false }, [])

  const apply = useCallback((res) => {
    if (!alive.current) return
    setStatus(res.status || 'disconnected')
    setAccountEmail(res.account_email ?? null)
    setConnectedAt(res.connected_at ?? null)
  }, [])

  const refresh = useCallback(async () => {
    try {
      apply(await callFn('status'))
      setError(null)
    } catch (e) {
      if (!alive.current) return
      setStatus('error')
      setError(e.message)
    }
  }, [apply])

  useEffect(() => { refresh() }, [refresh])

  // Doorpollen zolang Composio nog op consent wacht.
  useEffect(() => {
    if (status !== 'pending' || pollsLeft.current <= 0) return
    const t = setTimeout(() => { pollsLeft.current -= 1; refresh() }, POLL_MS)
    return () => clearTimeout(t)
  }, [status, refresh])

  // Terug uit de OAuth-flow (tab kreeg weer focus): meteen verversen.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [refresh])

  const connect = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const res = await callFn('connect')
      if (!res.redirect_url) throw new Error('geen consent-URL ontvangen')
      pollsLeft.current = POLL_MAX
      setStatus('pending')
      // Zelfde tab: de Microsoft-consent verwerpt vaak een popup, en Composio
      // stuurt na afloop terug naar /instellingen/connectors.
      window.location.assign(res.redirect_url)
    } catch (e) {
      if (!alive.current) return
      setError(e.message); setStatus('error')
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      apply(await callFn('disconnect'))
    } catch (e) {
      if (alive.current) setError(e.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [apply])

  return { status, accountEmail, connectedAt, error, busy, connect, disconnect, refresh }
}
