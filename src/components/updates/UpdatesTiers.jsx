import { useState } from 'react'
import { Icon } from './updatesIcons'
import {
  TAG_LABEL,
  tagFromMessage,
  trimFeaturePrefix,
  moduleForCommit,
  majorVisualClass,
  shortDate,
  dayMonthLong,
} from './updatesProcessing'
import { splitMessage, prettyLabel } from './updatesHumanize'

// UpdatesTiers — de drie render-tiers van de changelog: Hero, Major card,
// Stream (ModuleBlock + StreamItem) en de collapsible TinyBlock. Puur
// presentational; alle data komt voorgekauwd uit processData.

export const GITHUB_REPO_BASE = 'https://github.com/BurggraafJ/ManagedAgents-Experiment-Personal'

function Tag({ kind, children }) {
  return (
    <span className={`win-tag is-${kind}`}>
      {(kind === 'new' || kind === 'imp' || kind === 'fix' || kind === 'beta' || kind === 'module') && <span className="dot" />}
      {children}
    </span>
  )
}

export function HeroCard({ hero }) {
  const latest = hero.items[0]
  const modName = hero.module.name
  const split = splitMessage(latest.message, modName)
  const title = hero.isSingleton ? split.head : prettyLabel(hero.key, modName)
  const lede = hero.isSingleton
    ? (split.sub || `${latest.author || 'onbekend'}${latest.area === 'admin' ? ' · admin-area' : ''}`)
    : `${hero.items.length} samenhangende wijzigingen. Recentste: ${split.head.toLowerCase()}`

  const chips = hero.isSingleton
    ? []
    : hero.items.slice(0, 3).map(c => {
      const trimmed = trimFeaturePrefix(c.message, hero.key)
      const s = splitMessage(trimmed, modName)
      return { text: s.head, sha: c.sha }
    })

  return (
    <article className="win-hero" data-aud={hero.adminOnly ? 'admin' : 'platform'}>
      <div className="win-hero__rail" aria-hidden="true">
        <div className="win-hero__rail-stamp">Hoofd-<br />release</div>
        <div className="win-hero__rail-ver">{hero.items.length}×</div>
        <div className="win-hero__rail-date">{shortDate(hero.latestDate)}</div>
      </div>
      <div className="win-hero__main">
        <div className="win-hero__cat-row">
          <span className="win-hero__cat"><span className="dot" />{hero.module.name}</span>
          <span>{dayMonthLong(hero.latestDate)}{hero.author ? ` · ${hero.author}` : ''}</span>
        </div>
        <h2 className="win-hero__title">{title}</h2>
        <p className="win-hero__lede">{lede}</p>
        {chips.length > 0 && (
          <div className="win-hero__chips">
            {chips.map(c => (
              <span className="win-hero__chip" key={c.sha}>
                <Icon name="sparkles" />
                <strong>{c.text}</strong>
              </span>
            ))}
          </div>
        )}
      </div>
      <a className="win-hero__cta" href={`${GITHUB_REPO_BASE}/commit/${latest.sha}`} target="_blank" rel="noopener noreferrer">
        Bekijk commit
        <Icon name="arrow" />
      </a>
    </article>
  )
}

export function MajorCard({ feature, idx }) {
  const latest = feature.items[0]
  const modName = feature.module.name
  const split = splitMessage(latest.message, modName)
  const visualClass = majorVisualClass(idx, feature.tag)
  const isMulti = feature.items.length > 1
  const title = isMulti ? prettyLabel(feature.key, modName) : split.head
  const description = isMulti
    ? `${feature.items.length} samenhangende wijzigingen. Recentste: ${split.head.toLowerCase()}.`
    : (split.sub || `${feature.author || 'onbekend'} · ${modName}`)

  return (
    <article className={`win-major ${visualClass}`} data-aud={feature.adminOnly ? 'admin' : 'platform'}>
      <div className="win-major__visual">
        <div className="win-major__icon-bg">
          <Icon name={feature.module.icon} />
        </div>
      </div>
      <div className="win-major__body">
        <div className="win-major__tag-row">
          <Tag kind={feature.tag}>{TAG_LABEL[feature.tag]}</Tag>
          <Tag kind="module">{feature.module.name}</Tag>
          {feature.adminOnly && <Tag kind="admin">Admin</Tag>}
          <span className="win-major__date">{shortDate(feature.latestDate)}</span>
        </div>
        <h3 className="win-major__title">{title}</h3>
        <p className="win-major__desc">{description}</p>
        {isMulti && (
          <ul className="win-major__bullets">
            {feature.items.slice(0, 4).map(c => {
              const trimmed = trimFeaturePrefix(c.message, feature.key)
              const s = splitMessage(trimmed, modName)
              return <li key={c.sha}>{s.head}</li>
            })}
            {feature.items.length > 4 && <li>… en {feature.items.length - 4} meer</li>}
          </ul>
        )}
        <div className="win-major__foot">
          <a href={`${GITHUB_REPO_BASE}/commit/${latest.sha}`} target="_blank" rel="noopener noreferrer">
            Bekijk laatste commit
            <Icon name="arrow" />
          </a>
          <span className="meta">{feature.items.length} commit{feature.items.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </article>
  )
}

function StreamItem({ commit, moduleName }) {
  const tag = tagFromMessage(commit.message)
  const split = splitMessage(commit.message, moduleName)
  const isAdmin = commit.area === 'admin'
  return (
    <div className={`win-item ${isAdmin ? 'is-admin' : ''}`} data-aud={isAdmin ? 'admin' : 'platform'}>
      <span className="win-item__date">{shortDate(commit.release_date)}</span>
      <span className="win-item__tag">
        {isAdmin ? <Tag kind="admin">Admin</Tag> : <Tag kind={tag}>{TAG_LABEL[tag]}</Tag>}
      </span>
      <span className="win-item__txt">
        <strong>{split.head}</strong>
        {split.sub && <span className="sub">{split.sub}</span>}
      </span>
      <a className="win-item__sha" href={`${GITHUB_REPO_BASE}/commit/${commit.sha}`} target="_blank" rel="noopener noreferrer">
        {commit.sha?.slice(0, 7)}
      </a>
    </div>
  )
}

export function ModuleBlock({ mod }) {
  const { name, icon, items, tagCounts } = mod
  const bar = []
  if (tagCounts.new) bar.push({ k: 'b-new', n: tagCounts.new, lbl: 'nieuw' })
  if (tagCounts.imp) bar.push({ k: 'b-imp', n: tagCounts.imp, lbl: 'verbeterd' })
  if (tagCounts.fix) bar.push({ k: 'b-fix', n: tagCounts.fix, lbl: 'opgelost' })
  if (tagCounts.admin) bar.push({ k: 'b-admin', n: tagCounts.admin, lbl: 'admin' })

  return (
    <div className="win-mod">
      <div className="win-mod__head">
        <span className="win-mod__ic"><Icon name={icon} /></span>
        <span className="win-mod__name">{name}</span>
        <span className="win-mod__count">{items.length} wijziging{items.length === 1 ? '' : 'en'}</span>
        <span className="win-mod__bar">
          {bar.map(b => (
            <span key={b.k} className={b.k}><i />{b.n} {b.lbl}</span>
          ))}
        </span>
      </div>
      {items.map(c => <StreamItem key={c.sha} commit={c} moduleName={name} />)}
    </div>
  )
}

export function TinyBlock({ items, periodId }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  const adminCount = items.filter(c => c.area === 'admin').length
  return (
    <div className="win-tiny">
      <button
        type="button"
        className={`win-tiny__toggle ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <Icon name="chevron" className="chev" />
        <span className="lbl">
          <b>{items.length}</b>&nbsp; nog kleinere wijzigingen ·{' '}
          <span style={{ color: 'var(--neutral-400)' }}>copy, typo&apos;s, mini-fixes</span>
        </span>
        <span className="hint">{adminCount > 0 ? `${adminCount} admin` : 'onderhoud'}</span>
      </button>
      <div className={`win-tiny__body ${open ? 'is-open' : ''}`} id={`tiny-${periodId}`}>
        <div className="win-tiny__inner">
          {items.map(c => {
            const tag = c.area === 'admin' ? 'admin' : tagFromMessage(c.message)
            const split = splitMessage(c.message, moduleForCommit(c).name)
            const isAdmin = c.area === 'admin'
            return (
              <div key={c.sha} className={`win-tiny-row ${isAdmin ? 'is-admin' : ''}`} data-aud={isAdmin ? 'admin' : 'platform'}>
                <span className="win-tiny-row__date">{shortDate(c.release_date)}</span>
                <span className={`win-tiny-row__dot is-${tag}`} />
                <span className="win-tiny-row__txt"><strong>{split.head}</strong></span>
                <a className="win-tiny-row__sha" href={`${GITHUB_REPO_BASE}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer">
                  {c.sha?.slice(0, 7)}
                </a>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
