import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const STORAGE_KEY = 'lm-dashboard-notif-enabled'
const IGNORE_AGENTS = new Set(['orchestrator', 'auto-draft'])

/**
 * In-app notificaties via de Notifications API.
 *
 * Luistert realtime naar nieuwe rijen in `agent_runs` en geeft een desktop/
 * home-screen notificatie als:
 *   - User toestemming heeft gegeven (prompt via enable())
 *   - Agent niet op de ignore-list staat (orchestrator + auto-draft zijn te
 *     frequent; die spamt anders)
 *
 * Let op: dit werkt alleen als het dashboard open is (tab of PWA op
 * homescreen op iOS). Echte push-notifications met dicht-app vergen een
 * service worker + VAPID + server trigger.
 */
export function useNotifications() {
  const [permission, setPermission] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  )
  const [enabled, setEnabled] = useState(() => {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(STORAGE_KEY) === 'true'
  })
  const mountedAtRef = useRef(Date.now())

  const supported = typeof Notification !== 'undefined'

  const enable = useCallback(async () => {
    if (!supported) return false
    let perm = Notification.permission
    if (perm === 'default') {
      perm = await Notification.requestPermission()
      setPermission(perm)
    }
    if (perm === 'granted') {
      localStorage.setItem(STORAGE_KEY, 'true')
      setEnabled(true)
      // Bevestiging zodat user weet dat het werkt
      new Notification('Meldingen staan aan', {
        body: 'Je krijgt voortaan een melding als een agent een run afsluit.',
        tag: 'lm-enable-confirm',
      })
      return true
    }
    return false
  }, [supported])

  const disable = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'false')
    setEnabled(false)
  }, [])

  // Realtime subscribe op nieuwe agent_runs
  useEffect(() => {
    if (!supported || !enabled || permission !== 'granted') return

    const channel = supabase
      .channel('agent-run-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'agent_runs' },
        (payload) => {
          const row = payload.new
          if (!row) return
          if (IGNORE_AGENTS.has(row.agent_name)) return
          // Alleen meldingen voor runs die na mount zijn gestart (geen backlog dumpen)
          if (new Date(row.started_at).getTime() < mountedAtRef.current - 60_000) return

          const emoji = row.status === 'error' ? '❌'
                      : row.status === 'warning' ? '⚠️'
                      : row.status === 'success' ? '✅' : '·'
          const title = `${emoji} ${formatAgentName(row.agent_name)}`
          const body = (row.summary || '').slice(0, 140)
          try {
            new Notification(title, {
              body,
              tag: `lm-run-${row.id || row.agent_name}-${Date.now()}`,
              icon: '/icon-192.png',   // optioneel — lege path is OK
            })
          } catch {
            // iOS soms strict over notification params; negeer fouten
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [enabled, permission, supported])

  return {
    supported,
    permission,
    enabled,
    enable,
    disable,
  }
}

function formatAgentName(name) {
  const MAP = {
    'hubspot-daily-sync':   'HubSpot Daily',
    'sales-on-road':        'Road Notes',
    'sales-todos':          'Daily Tasks',
    'linkedin-connect':     'LinkedIn Connect',
    'kilometerregistratie': 'Kilometerregistratie',
  }
  return MAP[name] || name
}
