import { useState, useEffect, useRef } from 'react'
import s from './zoeken-v2.module.css'
import { Ico, SOURCE_LABELS } from './V2Icons'
import { useRagV2Entity } from '../../../../hooks/useRagV2Entity'
import { useRagV2Timeline } from '../../../../hooks/useRagV2Timeline'
import V2EntityDetail from './V2EntityDetail'
import { relTime } from '../../../../lib/rag'

// Objects-mode: links lijst met companies óf contacts (toggle bovenin),
// rechts entity-detail met hero + timeline. Hergebruikt search_companies /
// search_contactpersonen RPC's + rag-search voor entity-timeline.
export default function V2ObjectsMode({ initialCompanyId }) {
  const entityHook = useRagV2Entity(initialCompanyId)
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [entityHook.type])

  const timelineState = useRagV2Timeline(entityHook.selected)

  // Auto-select eerste hit als nog niets geselecteerd.
  useEffect(() => {
    if (!entityHook.selected && entityHook.results.length > 0) {
      entityHook.select(entityHook.results[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityHook.results])

  return (
    <section className={s.objects}>
      <div className={s.oHead}>
        <div className={s.oHeadRow}>
          <label className={s.acWrap}>
            <span className={s.acSearchIcon}>{Ico.search}</span>
            <input
              ref={inputRef}
              type="search"
              value={entityHook.query}
              onChange={(e) => entityHook.setQuery(e.target.value)}
              placeholder={entityHook.type === 'company' ? 'Zoek een bedrijf — naam of domain…' : 'Zoek een contactpersoon — naam of e-mail…'}
              autoComplete="off"
            />
            {entityHook.searching && <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--neutral-400)' }}>…</span>}
          </label>
          <div className={s.oTypes} role="tablist">
            <TypeBtn
              active={entityHook.type === 'company'}
              onClick={() => { entityHook.setType('company'); entityHook.clear() }}
              icon={Ico.building}
              label="Bedrijven"
            />
            <TypeBtn
              active={entityHook.type === 'contact'}
              onClick={() => { entityHook.setType('contact'); entityHook.clear() }}
              icon={Ico.user}
              label="Personen"
            />
          </div>
        </div>
      </div>

      <div className={s.oBody}>
        <div className={s.oList}>
          {entityHook.results.length === 0 && entityHook.query.trim().length < 2 && (
            <div className={s.oEmpty} style={{ borderRight: 0 }}>
              {Ico.search}
              <div className={s.oEmptyH}>Type minstens 2 tekens</div>
              <div className={s.oEmptyS}>
                {entityHook.type === 'company'
                  ? 'Zoek een bedrijf om de tijdlijn te zien.'
                  : 'Zoek een contactpersoon om de tijdlijn te zien.'}
              </div>
            </div>
          )}
          {entityHook.results.length === 0 && entityHook.query.trim().length >= 2 && !entityHook.searching && (
            <div className={s.oEmpty} style={{ borderRight: 0 }}>
              <div className={s.oEmptyH}>Niets gevonden</div>
              <div className={s.oEmptyS}>Geen {entityHook.type === 'company' ? 'bedrijf' : 'persoon'} dat aan "{entityHook.query}" voldoet.</div>
            </div>
          )}
          {entityHook.results.length > 0 && (
            <>
              <div className={s.oListGroup}>
                {entityHook.type === 'company' ? 'Bedrijven' : 'Personen'} · {entityHook.results.length}
              </div>
              {entityHook.results.map((r) => (
                <ObjectCard
                  key={cardKey(r)}
                  entity={r}
                  active={entityHook.selected && cardKey(r) === cardKey(entityHook.selected)}
                  onClick={() => entityHook.select(r)}
                />
              ))}
            </>
          )}
        </div>

        <div className={s.oDetail}>
          {!entityHook.selected ? (
            <div className={s.oEmpty}>
              {Ico.objects}
              <div className={s.oEmptyH}>Selecteer een {entityHook.type === 'company' ? 'bedrijf' : 'persoon'}</div>
              <div className={s.oEmptyS}>De volledige tijdlijn — mails, meetings, deals, notes — verschijnt hier.</div>
            </div>
          ) : (
            <V2EntityDetail
              entity={entityHook.selected}
              timeline={timelineState.items}
              loadingTimeline={timelineState.loading}
            />
          )}
        </div>
      </div>
    </section>
  )
}

function TypeBtn({ active, onClick, icon, label }) {
  return (
    <button type="button" role="tab" aria-selected={active}
            className={`${s.oTypesBtn} ${active ? s.oTypesBtnActive : ''}`}
            onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}

function ObjectCard({ entity, active, onClick }) {
  const isCompany = entity.kind === 'company'
  const initials = getInitials(isCompany ? entity.name : (entity.display_naam || `${entity.voornaam || ''} ${entity.achternaam || ''}`.trim()))
  return (
    <div className={`${s.oCard} ${active ? s.oCardActive : ''}`} onClick={onClick}>
      <div className={`${s.oCardAv} ${isCompany ? '' : s.oCardAvContact}`}>{initials}</div>
      <div className={s.oCardMain}>
        <div className={s.oCardTitle}>
          {isCompany
            ? entity.name || entity.domain || '—'
            : (entity.display_naam || `${entity.voornaam || ''} ${entity.achternaam || ''}`.trim() || '—')}
        </div>
        <div className={s.oCardMeta}>{cardMeta(entity, isCompany)}</div>
        {cardStats(entity, isCompany)}
      </div>
      <div className={s.oCardLast}>{entity.last_touch ? relTime(entity.last_touch) : (entity.last_seen ? relTime(entity.last_seen) : '')}</div>
    </div>
  )
}

function cardKey(r) {
  return r.kind === 'company'
    ? `c-${r.company_id}`
    : `p-${r.hubspot_contact_id || r.contact_id || r.email}`
}

function cardMeta(e, isCompany) {
  if (isCompany) {
    const parts = []
    if (e.domain) parts.push(<strong key="d">{e.domain}</strong>)
    if (e.industry) parts.push(<span key="i"> · {e.industry}</span>)
    if (e.city) parts.push(<span key="c"> · {e.city}</span>)
    if (e.lifecyclestage) parts.push(<span key="l"> · {e.lifecyclestage}</span>)
    return parts.length ? parts : '—'
  }
  const parts = []
  if (e.firm_naam) parts.push(<><strong key="f">{e.firm_naam}</strong></>)
  if (e.contact_type) parts.push(<span key="t"> · {e.contact_type}</span>)
  if (e.email) parts.push(<span key="e"> · {e.email}</span>)
  return parts.length ? parts : '—'
}

function cardStats(e, isCompany) {
  if (!isCompany && e.email_count != null) {
    return (
      <div className={s.oCardStats}>
        <span>{e.email_count} {e.email_count === 1 ? 'mail' : 'mails'} in DB</span>
      </div>
    )
  }
  return null
}

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Helper voor toekomst — kan gebruikt worden in V2EntityDetail-rel chips.
export const SOURCE_LABEL_LOOKUP = SOURCE_LABELS
