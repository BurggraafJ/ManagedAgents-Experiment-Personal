import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import MIcon from '../MIcon'
import { useSheetDrag } from '../../hooks/useSheetDrag'

// =============================================================================
// MobilePostvakFolders — kies een Outlook-map (v1.205, spoor 10)
// =============================================================================
// De veegactie "Verplaats" opent dit vel. Wat erin staat is **jouw echte
// Outlook-mappenstructuur** — 58 mappen, zes niveaus diep, gespiegeld in
// `autodraft_folders` door `mail-sync-etl-v2`. Geen bedachte lijst met vijf
// suggesties: als je in Outlook een map "Klanten/BarentsKrans" hebt, staat hij
// hier ook, want anders is verplaatsen op de telefoon iets anders dan
// verplaatsen op de laptop.
//
// ── Waarom een zoekveld en geen uitklapboom ─────────────────────────────────
// Een boom van 58 mappen met 6 niveaus is op 400px vier schermen tikken voordat
// je bij "Inbox/Projecten/Old/1. DentalGenius" bent. Getypt is het drie letters.
// De boom is er wel — in de inspringing en in het grijze pad boven de naam —
// maar als *oriëntatie*, niet als navigatie.
//
// De volgorde is die van Outlook zelf (`full_path` alfabetisch), met één
// uitzondering: de mappen waar je een mail werkelijk in opbergt (Archief,
// Verwijderde items) staan bovenaan als snelknoppen. Dat is geen mening over
// jouw mappen, het is de waarneming dat 90% van elke veeg daarheen gaat.
// =============================================================================

const sheetHost = () => (typeof document === 'undefined'
  ? null
  : document.querySelector('.shell--m') || document.body)

// Snelkeuzes. De namen zijn die van de mailbox (Engels); `resolveFolderId` in
// de Edge Function vertaalt de Nederlandse varianten ook, maar hier kiezen we
// het pad dat zeker bestaat in `autodraft_folders`.
const QUICK = [
  { match: 'Archive', label: 'Archief', icon: 'book' },
  { match: 'Deleted Items', label: 'Verwijderde items', icon: 'trash' },
]

const depthOf = (path) => Math.max(0, String(path || '').split('/').length - 1)
const leafOf = (path, fallback) => String(path || '').split('/').pop() || fallback || '—'
const parentOf = (path) => {
  const parts = String(path || '').split('/')
  return parts.length > 1 ? parts.slice(0, -1).join(' › ') : ''
}

export default function MobilePostvakFolders({ open, folders, mail, busy, onPick, onClose }) {
  const [q, setQ] = useState('')
  useEffect(() => { if (open) setQ('') }, [open])
  useEffect(() => {
    if (!open) return undefined
    const root = document.documentElement
    root.classList.add('m-modal-open')
    return () => root.classList.remove('m-modal-open')
  }, [open])

  const drag = useSheetDrag({ onClose, enabled: open })

  const all = useMemo(() => {
    const rows = (folders || [])
      .filter(f => f && (f.full_path || f.display_name))
      .map(f => ({
        key: f.folder_id || f.id || f.full_path,
        // `full_path` is wat de Edge Function het betrouwbaarst herkent
        // (exacte match vóór losse naam) — dus dát sturen we mee, niet de
        // weergavenaam die twee keer kan voorkomen ("Marketing" en
        // "Afdelingen/Marketing" bestaan allebei in deze mailbox).
        target: f.full_path || f.display_name,
        path: f.full_path || f.display_name,
        name: f.display_name || leafOf(f.full_path),
        count: Number.isFinite(f.item_count) ? f.item_count : null,
      }))
    rows.sort((a, b) => a.path.localeCompare(b.path, 'nl'))
    return rows
  }, [folders])

  const quick = useMemo(
    () => QUICK.map(k => ({ ...k, row: all.find(r => r.path === k.match) })).filter(k => k.row),
    [all])

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return all
    return all.filter(r => r.path.toLowerCase().includes(needle))
  }, [all, q])

  const host = open ? sheetHost() : null
  if (!open || !host) return null

  return createPortal(
    <>
      <div className="m-scrim" onClick={onClose} aria-hidden />
      <div className={`m-sheet m-folders ${drag.dragging ? 'is-dragging' : ''}`} style={drag.dragStyle}
           role="dialog" aria-label="Verplaats naar map">
        <div className="m-sheet__drag" {...drag.handleProps}>
          <div className="m-drawer__grab" aria-hidden />
        </div>
        <div className="m-sheet__body m-folders__body">
          <div className="m-folders__head">
            <span className="m-folders__title">Verplaats naar…</span>
            {mail && <span className="m-folders__sub">{mail.subject || '(geen onderwerp)'}</span>}
          </div>

          {quick.length > 0 && !q && (
            <div className="m-folders__quick">
              {quick.map(k => (
                <button key={k.match} type="button" className="m-folders__q" disabled={!!busy}
                        onClick={() => onPick(k.row.target)}>
                  <MIcon name={k.icon} size={16} />{k.label}
                </button>
              ))}
            </div>
          )}

          <div className="m-folders__search">
            <MIcon name="search" size={15} />
            <input value={q} onChange={e => setQ(e.target.value)} enterKeyHint="search"
                   placeholder={`Zoek in ${all.length} mappen…`} aria-label="Zoek een map" />
            {q && (
              <button type="button" aria-label="Wissen" onClick={() => setQ('')}>
                <MIcon name="close" size={14} />
              </button>
            )}
          </div>

          <div className="m-folders__list">
            {list.length === 0 ? (
              <div className="m-tl__empty">Geen map met “{q}”.</div>
            ) : list.map(r => (
              <button key={r.key} type="button" className="m-folders__item" disabled={!!busy}
                      data-depth={Math.min(depthOf(r.path), 3)}
                      onClick={() => onPick(r.target)}>
                <MIcon name="folder" size={16} />
                <span className="m-folders__txt">
                  <span className="m-folders__name">{r.name}</span>
                  {/* Het pad erbij, want deze mailbox heeft "Marketing" twee keer. */}
                  {parentOf(r.path) && <span className="m-folders__path">{parentOf(r.path)}</span>}
                </span>
                {r.count != null && <span className="m-folders__count">{r.count}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>,
    host,
  )
}
