import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAgenda } from './useAgenda'
import { useTasks } from './useTasks'
import { greetingFor, dateLabel, timeLabel, truncate } from '../lib/now'

/**
 * useDashboard — view-model voor de Maestro-cockpit (NowView, herbouw
 * 2026-05-27). Bundelt drie databronnen tot één afgeleide structuur:
 *
 *   • useAgenda()  → events (timeline vandaag, morgen, volgende meeting)
 *   • useTasks()   → tasks (open-queue, taken-vandaag-afgevinkt, aankomend)
 *   • badges-prop  → adminPending (open admin-voorstellen)
 *   • supplement   → postvak open-count + done-today aggregaten + previews
 *                    (eigen lichte queries, 2-min poll)
 *
 * "Done today" gebruikt geverifieerde kolommen: tasks.completed_at,
 * agent_proposals.executed_at, autodraft_decisions.executed_at. Elke query
 * is afgevangen; bij falen telt 'ie als 0 (geen kapot scherm).
 */
const POLL_MS = 2 * 60 * 1000
const OPEN_STATUSES = ['open', 'snoozed', 'blocked']
const ACCENT_AGENT = new Set(['daily-admin', 'daily-admin-execute', 'daily-admin-future'])

function startOfTodayIso() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString()
}

function priorityMeta(priority) {
  const p = String(priority || '').toLowerCase()
  if (['hoog', 'high', 'urgent', 'critical', '1'].includes(p)) return { cls: 'hi', label: 'Hoog' }
  if (['middel', 'medium', 'normal', 'normaal', '2'].includes(p)) return { cls: 'md', label: 'Middel' }
  return { cls: 'lo', label: 'Laag' }
}

// Relatieve datum-chip voor aankomende taken (verlopen / vandaag / morgen /
// weekdag / "D mmm"). Werkt op lokale dagen.
const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
function dayDiff(dateStr, todayMid) {
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - todayMid) / 86400000)
}
function dateChip(dateStr, todayMid) {
  if (!dateStr) return { label: '—', sub: '', cls: '' }
  const d = new Date(dateStr)
  const diff = dayDiff(dateStr, todayMid)
  const small = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
  if (diff < 0) return { label: 'verlopen', sub: small, cls: 'overdue' }
  if (diff === 0) return { label: 'vandaag', sub: small, cls: 'today' }
  if (diff === 1) return { label: 'morgen', sub: small, cls: '' }
  if (diff <= 6) return { label: DAYS[d.getDay()], sub: small, cls: '' }
  return { label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, sub: DAYS[d.getDay()], cls: '' }
}

function hm(iso) {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

export function useDashboard({ badges = {} } = {}) {
  const { events } = useAgenda()
  const { tasks: allTasks, projects } = useTasks()

  const [now, setNow] = useState(() => new Date())
  const [supp, setSupp] = useState({
    postvakOpen: null,
    adminDoneToday: 0,
    mailsDoneToday: 0,
    adminNext: null,
    postvakNext: null,
  })

  // Klok-tick voor greeting + "over X min" relatieve labels.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])

  const fetchSupp = useCallback(async () => {
    const todayIso = startOfTodayIso()
    const safe = (q, fallback) => Promise.resolve(q).then(r => r).catch(() => fallback)
    const [open, adminDone, mailsDone, adminNext, postvakNext] = await Promise.all([
      safe(supabase.from('autodraft_mails').select('id', { count: 'exact', head: true }).in('status', ['pending', 'amended']), { count: null }),
      safe(supabase.from('agent_proposals').select('id', { count: 'exact', head: true }).gte('executed_at', todayIso), { count: 0 }),
      safe(supabase.from('autodraft_decisions').select('id', { count: 'exact', head: true }).gte('executed_at', todayIso), { count: 0 }),
      safe(supabase.from('agent_proposals').select('*').in('status', ['pending', 'amended']).order('created_at', { ascending: false }).limit(1), { data: [] }),
      safe(supabase.from('autodraft_mails').select('*').in('status', ['pending', 'amended']).order('received_at', { ascending: false }).limit(1), { data: [] }),
    ])
    setSupp({
      postvakOpen: open.count ?? null,
      adminDoneToday: adminDone.count ?? 0,
      mailsDoneToday: mailsDone.count ?? 0,
      adminNext: (adminNext.data || [])[0] || null,
      postvakNext: (postvakNext.data || [])[0] || null,
    })
  }, [])

  useEffect(() => {
    fetchSupp()
    const id = setInterval(fetchSupp, POLL_MS)
    return () => clearInterval(id)
  }, [fetchSupp])

  return useMemo(() => {
    const nowMs = now.getTime()
    const todayMid = new Date(now); todayMid.setHours(0, 0, 0, 0)
    const todayMidMs = todayMid.getTime()
    const tomorrowMidMs = todayMidMs + 86400000
    const dayEndMs = todayMidMs + 86400000

    const projName = (id) => projects.find(p => p.id === id)?.name || ''

    // ── Tasks ──
    const openTasks = (allTasks || []).filter(t => OPEN_STATUSES.includes(t.status) && !t.in_backlog)
    const tasksDoneToday = (allTasks || []).filter(
      t => t.status === 'done' && t.completed_at && new Date(t.completed_at).getTime() >= todayMidMs
    ).length
    const tasksOverdue = openTasks.filter(t => t.deadline && new Date(t.deadline).getTime() < todayMidMs).length

    const upcomingTasks = [...openTasks]
      .map(t => ({ t, when: t.deadline || t.do_date }))
      .sort((a, b) => {
        if (!a.when) return 1
        if (!b.when) return -1
        return new Date(a.when).getTime() - new Date(b.when).getTime()
      })
      .slice(0, 5)
      .map(({ t, when }) => {
        const chip = dateChip(when, todayMidMs)
        const prio = priorityMeta(t.priority)
        const proj = projName(t.project_id)
        return {
          id: t.id,
          title: t.title || '(taak zonder titel)',
          dateLabel: chip.label, dateSub: chip.sub, dateCls: chip.cls,
          prioCls: prio.cls,
          meta: [prio.label, proj].filter(Boolean).join(' · '),
        }
      })

    // ── Agenda: vandaag + morgen ──
    const todayEvents = (events || [])
      .filter(e => !e.is_all_day && !e.is_cancelled)
      .filter(e => {
        const s = new Date(e.start_time).getTime()
        return s >= todayMidMs && s < dayEndMs
      })
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))

    // Forward: events die nog niet voorbij zijn (eind >= nu).
    const forwardEvents = todayEvents.filter(e => {
      const end = e.end_time ? new Date(e.end_time).getTime() : new Date(e.start_time).getTime() + 30 * 60000
      return end >= nowMs
    })

    const timeline = forwardEvents.map((e, i) => {
      const start = new Date(e.start_time).getTime()
      const end = e.end_time ? new Date(e.end_time).getTime() : start + 30 * 60000
      const durMin = Math.max(Math.round((end - start) / 60000), 0)
      const online = !!e.online_meeting_url
      const isNow = start <= nowMs && nowMs <= end ? true : i === 0
      return {
        id: e.id,
        time: hm(e.start_time),
        dur: durMin >= 60 ? `${Math.round(durMin / 60)} uur` : `${durMin} min`,
        title: e.subject || '(geen titel)',
        location: e.location_text || '',
        online,
        isNow,
      }
    })

    const tomorrowEvents = (events || [])
      .filter(e => !e.is_all_day && !e.is_cancelled)
      .filter(e => {
        const s = new Date(e.start_time).getTime()
        return s >= tomorrowMidMs && s < tomorrowMidMs + 86400000
      })
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
      .map(e => ({ id: e.id, time: hm(e.start_time), label: e.subject || '(geen titel)', location: e.location_text || '' }))

    const tomorrowDate = new Date(tomorrowMidMs)
    const tomorrowLabel = `${DAYS[tomorrowDate.getDay()]} ${tomorrowDate.getDate()} ${MONTHS[tomorrowDate.getMonth()]}`

    // ── Volgende meeting (NU-kaart) ──
    const nextEv = forwardEvents[0] || null
    let nu = null
    if (nextEv) {
      const start = new Date(nextEv.start_time).getTime()
      const end = nextEv.end_time ? new Date(nextEv.end_time).getTime() : start + 30 * 60000
      const minsUntil = Math.round((start - nowMs) / 60000)
      let eyebrow
      if (start <= nowMs && nowMs <= end) eyebrow = 'BEZIG · NU'
      else if (minsUntil <= 90) eyebrow = `NU · over ${minsUntil} min`
      else eyebrow = `VANDAAG · ${hm(nextEv.start_time)}`
      const subParts = []
      if (nextEv.online_meeting_url) subParts.push('Online meeting')
      else if (nextEv.location_text) subParts.push(truncate(nextEv.location_text, 40))
      nu = {
        eventId: nextEv.id,
        eyebrow,
        title: `${hm(nextEv.start_time)} — ${truncate(nextEv.subject || '(geen titel)', 48)}`,
        sub: subParts.join(' · '),
        onlineUrl: nextEv.online_meeting_url || null,
      }
    }

    // ── Queues ──
    const adminOpen = badges.adminPending || 0
    const postvakOpen = supp.postvakOpen
    const taskOpenCount = openTasks.length

    const ring = (done, open) => {
      const total = done + open
      return total > 0 ? Math.round((done / total) * 100) : 0
    }

    const adminNextLine = supp.adminNext
      ? truncate(supp.adminNext.title || supp.adminNext.subject || supp.adminNext.payload?.title || 'Voorstel klaar voor review', 46)
      : null
    const postvakNextLine = supp.postvakNext
      ? truncate(supp.postvakNext.subject || supp.postvakNext.from_name || supp.postvakNext.sender || 'Mail wacht op beslissing', 46)
      : null
    const nextOpenTask = upcomingTasks[0] || null

    const queues = [
      {
        key: 'admin', tone: 'accent', href: '/administratie',
        eyebrow: 'Administratie',
        title: `${adminOpen} voorstel${adminOpen === 1 ? '' : 'len'} open`,
        done: supp.adminDoneToday, open: adminOpen,
        pct: ring(supp.adminDoneToday, adminOpen),
        doneLabel: 'verwerkt vandaag', openLabel: 'nog open',
        previewLine: adminNextLine,
        previewSub: adminNextLine ? 'wacht op je review' : 'geen openstaande voorstellen',
        cta: 'Beoordeel volgende',
        icon: 'admin',
      },
      {
        key: 'taken', tone: 'err', href: '/taken',
        eyebrow: 'Taken',
        title: tasksOverdue > 0 ? `${taskOpenCount} open · ${tasksOverdue} verlopen` : `${taskOpenCount} taken open`,
        done: tasksDoneToday, open: taskOpenCount,
        pct: ring(tasksDoneToday, taskOpenCount),
        doneLabel: 'afgevinkt vandaag', openLabel: 'nog open',
        previewLine: nextOpenTask ? nextOpenTask.title : null,
        previewSub: nextOpenTask ? nextOpenTask.meta : 'geen openstaande taken',
        cta: 'Open takenlijst',
        icon: 'taken',
      },
      {
        key: 'postvak', tone: 'info', href: '/postvak',
        eyebrow: 'Postvak',
        title: postvakOpen == null ? 'Postvak' : `${postvakOpen} mail${postvakOpen === 1 ? '' : 's'} open`,
        done: supp.mailsDoneToday, open: postvakOpen || 0,
        pct: ring(supp.mailsDoneToday, postvakOpen || 0),
        doneLabel: 'afgehandeld vandaag', openLabel: 'nog open',
        previewLine: postvakNextLine,
        previewSub: postvakNextLine ? 'wacht op beslissing' : 'geen open mails',
        cta: 'Open postvak',
        icon: 'postvak',
      },
    ]

    const totalDone = supp.adminDoneToday + supp.mailsDoneToday + tasksDoneToday
    const totalOpen = adminOpen + taskOpenCount + (postvakOpen || 0)
    const itemsToGo = timeline.length

    // Hero subtitle — dynamisch op echte cijfers.
    const meetingsLeft = timeline.length
    const heroSub = (() => {
      const bits = []
      if (totalOpen > 0) bits.push(`${totalOpen} open ${totalOpen === 1 ? 'post' : 'posten'}`)
      if (meetingsLeft > 0) bits.push(`${meetingsLeft} ${meetingsLeft === 1 ? 'item' : 'items'} op de agenda voor sluit`)
      if (bits.length === 0) return 'Alles is verwerkt — niets vraagt nu om je aandacht.'
      return `Lekker bezig. Nog ${bits.join(' en ')}.`
    })()

    return {
      // hero
      greeting: greetingFor(now),
      dateLabel: dateLabel(now),
      clock: timeLabel(now),
      doneTotal: totalDone,
      doneBreakdown: [
        { n: supp.adminDoneToday, label: 'admin-voorstellen' },
        { n: supp.mailsDoneToday, label: 'mails afgehandeld' },
        { n: tasksDoneToday, label: 'taken afgevinkt' },
      ],
      itemsToGo,
      heroSub,
      // sections
      nu,
      queues,
      totalOpen,
      timeline,
      upcomingTasks,
      openTaskTotal: taskOpenCount,
      tomorrow: { label: tomorrowLabel, events: tomorrowEvents },
    }
  }, [now, allTasks, projects, events, badges.adminPending, supp])
}
