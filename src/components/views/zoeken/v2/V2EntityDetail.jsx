import { useMemo, useState } from 'react'
import s from './zoeken-v2.module.css'
import { Ico } from './V2Icons'
import { relTime } from '../../../../lib/rag'
import V2TimelineItem, { V2TimelineLegend } from './V2TimelineItem'

// Entity-detail panel: hero + property-tiles + legenda + timeline.
// Werkt voor zowel company als contact (kind='company'|'contact').
// Items komen van useRagV2Timeline (parent), als platte lijst — deze component
// groepeert per dag-bucket en delegeert item-rendering naar V2TimelineItem.
export default function V2EntityDetail({ entity, timeline = [], loadingTimeline = false, timelineCounts }) {
  const [openKeys, setOpenKeys] = useState(() => new Set())
  const toggleOpen = (key) => {
    setOpenKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const isCompany = entity.kind === 'company'
  const initials = getInitials(isCompany ? entity.name : (entity.display_naam || `${entity.voornaam || ''} ${entity.achternaam || ''}`.trim()))

  const grouped = useMemo(() => groupTimeline(timeline), [timeline])

  return (
    <>
      <div className={s.entHero}>
        <div className={s.entHeroTop}>
          <div className={`${s.entMono} ${isCompany ? s.entMonoCompany : s.entMonoContact}`}>{initials}</div>
          <div className={s.entHeroId}>
            <div className={`${s.entHeroType} ${isCompany ? s.entHeroTypeCompany : s.entHeroTypeContact}`}>
              {isCompany ? Ico.building : Ico.user}
              {isCompany ? 'Bedrijf' : 'Contact'}
            </div>
            <h2 className={s.entHeroTitle}>
              {isCompany
                ? entity.name || '—'
                : (entity.display_naam || `${entity.voornaam || ''} ${entity.achternaam || ''}`.trim() || '—')}
            </h2>
            <div className={s.entHeroSub}>{subText(entity, isCompany)}</div>
          </div>
          <div className={s.entHeroActions}>
            <button type="button" className={s.entHeroAction}>{Ico.mail}Mail</button>
            <button type="button" className={s.entHeroAction}>{Ico.calendar}Plan</button>
          </div>
        </div>
        <div className={s.entProps}>
          {propTiles(entity, isCompany, timeline).map((t, i) => (
            <div key={i} className={s.entProp}>
              <div className={s.entPropLbl}>{t.label}</div>
              <div className={`${s.entPropV} ${t.num ? s.entPropVNum : ''}`}>
                {t.value}
                {t.sub && <small>{t.sub}</small>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={s.entTl}>
        <div className={s.entTlHead}>
          <div className={s.entTlTitle}>
            Activity {isCompany ? '— laatste activiteit' : '— 1-op-1'} · <strong>{timeline.length} {timeline.length === 1 ? 'item' : 'items'}</strong>
          </div>
        </div>
        {loadingTimeline && <div className={s.entTlEmpty}>Bezig met laden…</div>}
        {!loadingTimeline && timeline.length === 0 && (
          <div className={s.entTlEmpty}>Geen historie gevonden in mail / meetings / events / Jira.</div>
        )}
        {!loadingTimeline && grouped.length > 0 && (
          <>
            {timelineCounts && <V2TimelineLegend counts={timelineCounts} />}
            <div className={s.tl}>
              {grouped.map(([day, items]) => (
                <div key={day}>
                  <div className={s.tlDay}>{day}</div>
                  {items.map((it) => (
                    <V2TimelineItem
                      key={it.key || `${day}-${it.ts}`}
                      item={it}
                      expanded={openKeys.has(it.key)}
                      onToggle={toggleOpen}
                    />
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}

function subText(entity, isCompany) {
  if (isCompany) {
    const parts = []
    if (entity.domain) parts.push(entity.domain)
    if (entity.industry) parts.push(entity.industry)
    if (entity.city) parts.push(entity.city)
    if (entity.lifecyclestage) parts.push(entity.lifecyclestage)
    return parts.join(' · ') || '—'
  }
  const parts = []
  if (entity.firm_naam) parts.push(entity.firm_naam)
  if (entity.contact_type) parts.push(entity.contact_type)
  if (entity.email) parts.push(entity.email)
  return parts.join(' · ') || '—'
}

function propTiles(entity, isCompany, timeline) {
  if (isCompany) {
    const mails = timeline.filter(t => t.kind === 'mail' || t.kind === 'engagement').length
    const meetings = timeline.filter(t => t.kind === 'meeting' || t.kind === 'event' || t.kind === 'agenda').length
    return [
      { label: 'Activiteit', value: timeline.length, sub: 'laatste 90 dgn', num: true },
      { label: 'Mails',      value: mails,           num: true },
      { label: 'Meetings',   value: meetings,        num: true },
      { label: 'Laatste',    value: timeline[0]?.ts ? relTime(timeline[0].ts) : '—' },
    ]
  }
  return [
    { label: 'Mails',       value: timeline.filter(t => t.kind === 'mail').length, num: true },
    { label: 'Meetings',    value: timeline.filter(t => t.kind === 'meeting').length, num: true },
    { label: 'Laatste',     value: timeline[0]?.ts ? relTime(timeline[0].ts) : '—' },
    { label: 'In DB',       value: entity.email_count ?? '—' },
  ]
}

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function groupTimeline(items) {
  const buckets = new Map()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekAgo = new Date(today.getTime() - 7 * 86400000)
  const monthAgo = new Date(today.getTime() - 30 * 86400000)
  for (const it of items) {
    if (!it.ts) continue
    const d = new Date(it.ts)
    let bucket
    if (d > now) bucket = 'Komende'
    else if (d >= today) bucket = 'Vandaag'
    else if (d >= weekAgo) bucket = 'Deze week'
    else if (d >= monthAgo) bucket = 'Deze maand'
    else bucket = d.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })
    if (!buckets.has(bucket)) buckets.set(bucket, [])
    buckets.get(bucket).push(it)
  }
  const order = ['Komende', 'Vandaag', 'Deze week', 'Deze maand']
  return [...buckets.entries()].sort((a, b) => {
    const ai = order.indexOf(a[0]); const bi = order.indexOf(b[0])
    if (ai >= 0 && bi >= 0) return ai - bi
    if (ai >= 0) return -1
    if (bi >= 0) return 1
    return 0
  })
}
