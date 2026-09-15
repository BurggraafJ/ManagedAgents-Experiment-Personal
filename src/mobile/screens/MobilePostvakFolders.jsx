import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import MIcon from '../MIcon'
import { useSheetDrag } from '../../hooks/useSheetDrag'
import { useFolderPickerPrefs } from '../../hooks/useFolderPickerPrefs'

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
// ── v1.217: een boom die dicht begint, en drie knoppen die van jou leren ────
// Tot v1.216 stond de hele boom plat uitgeschreven, 58 rijen, met inspringing
// als oriëntatie en het zoekveld als navigatie. Jelle (2026-09-15): te veel om
// doorheen te scrollen. Drie dingen zijn anders:
//
//   • **Ingevouwen.** Alleen de hoofdmappen staan er; een chevron ervoor klapt
//     de submappen open. Wat je openklapt **blijft open** — per gebruiker, op
//     dit toestel (`useFolderPickerPrefs`, sleutel `postvak.mappen.v1:<uid>`).
//     Zo groeit de boom naar de vorm van jóuw werk, niet naar die van Outlook.
//   • **Top 3 meest gebruikt** bovenin: de mappen waar je écht naartoe
//     verplaatst, geteld bij elke gelukte verplaatsing. Koud (nog niets
//     geteld) staan daar Archief en Verwijderde items — de waarneming van
//     v1.205 dat 90 % van elke veeg daarheen gaat, blijft gelden tot de
//     tellers iets anders zeggen. Ze verdwijnen niet zomaar: pas als drie
//     ándere mappen vaker gekozen zijn, schuiven ze eruit.
//   • **Zoeken wint van de boom.** Typ je, dan is het weer de platte lijst met
//     het pad eronder — drie letters is nog altijd sneller dan drie tikken.
//
// Een map met submappen blijft zélf ook een bestemming: de chevron vouwt uit,
// de naam kiest. Twee doelen in één rij, elk met eigen knop — niet één knop
// die raadt wat je bedoelde.
// =============================================================================

const sheetHost = () => (typeof document === 'undefined'
  ? null
  : document.querySelector('.shell--m') || document.body)

// Koude start voor de snelknoppen, én hun Nederlandse naam. De paden zijn die
// van de mailbox (Engels); `resolveFolderId` in de Edge Function herkent de
// Nederlandse varianten ook, maar hier sturen we het pad dat zeker bestaat.
const QUICK_DEFAULTS = ['Archive', 'Deleted Items']
const QUICK_LABEL = {
  Archive: 'Archief', 'Deleted Items': 'Verwijderde items', Inbox: 'Postvak IN',
  'Sent Items': 'Verzonden items', Drafts: 'Concepten', 'Junk Email': 'Ongewenste e-mail',
}
const QUICK_ICON = { Archive: 'book', 'Deleted Items': 'trash' }
const TOP_N = 3

const depthOf = (path) => Math.max(0, String(path || '').split('/').length - 1)
const leafOf = (path, fallback) => String(path || '').split('/').pop() || fallback || '—'
const parentOf = (path) => {
  const parts = String(path || '').split('/')
  return parts.length > 1 ? parts.slice(0, -1).join(' › ') : ''
}
const parentPathOf = (path) => {
  const parts = String(path || '').split('/')
  return parts.length > 1 ? parts.slice(0, -1).join('/') : null
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
  const prefs = useFolderPickerPrefs()

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

  // De boom: kinderen per ouderpad. Een map waarvan de ouder niet in de
  // spiegel zit (kan, bij een halve sync) telt als hoofdmap — liever zichtbaar
  // op de verkeerde plek dan onzichtbaar.
  const { roots, kids } = useMemo(() => {
    const byPath = new Set(all.map(r => r.path))
    const kids = new Map()
    const roots = []
    for (const r of all) {
      const parent = parentPathOf(r.path)
      if (parent && byPath.has(parent)) {
        if (!kids.has(parent)) kids.set(parent, [])
        kids.get(parent).push(r)
      } else {
        roots.push(r)
      }
    }
    return { roots, kids }
  }, [all])

  // Top 3: eerst wat je zelf het vaakst koos, aangevuld met de koude
  // standaards — en alleen mappen die in de spiegel bestaan.
  const quick = useMemo(() => {
    const byPath = new Map(all.map(r => [r.path, r]))
    const picked = []
    for (const path of [...prefs.mostUsed, ...QUICK_DEFAULTS]) {
      const row = byPath.get(path)
      if (row && !picked.includes(row)) picked.push(row)
      if (picked.length >= TOP_N) break
    }
    return picked
  }, [all, prefs.mostUsed])
  const learned = prefs.mostUsed.length > 0

  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return null
    return all.filter(r => r.path.toLowerCase().includes(needle))
  }, [all, q])

  const pick = useCallback(async (row) => {
    const ok = await onPick?.(row.target)
    // De ouder zegt `false` als Outlook weigerde; alles anders (ook een oud
    // `undefined`) is een gelukte verplaatsing en telt mee.
    if (ok !== false) prefs.bumpUsage(row.path)
  }, [onPick, prefs])

  const host = open ? sheetHost() : null
  if (!open || !host) return null

  // Eén rij in de boom. Recursief, want de diepte is die van de mailbox.
  const renderNode = (r, depth) => {
    const children = kids.get(r.path) || []
    const hasKids = children.length > 0
    const isOpen = hasKids && prefs.isOpen(r.path)
    return (
      <div key={r.key} className="m-folders__node">
        <div className={`m-folders__row ${isOpen ? 'is-open' : ''}`} data-depth={Math.min(depth, 3)}>
          {hasKids ? (
            <button type="button" className="m-folders__tgl" aria-expanded={isOpen}
                    aria-label={`${isOpen ? 'Verberg' : 'Toon'} submappen van ${r.name}`}
                    onClick={() => prefs.toggleOpen(r.path)}>
              <MIcon name="chevron" size={14} />
            </button>
          ) : (
            <span className="m-folders__tgl m-folders__tgl--none" aria-hidden />
          )}
          <button type="button" className="m-folders__item" disabled={!!busy} onClick={() => pick(r)}>
            <MIcon name="folder" size={16} />
            <span className="m-folders__txt">
              <span className="m-folders__name">{r.name}</span>
              {hasKids && !isOpen && (
                <span className="m-folders__path">{children.length} {children.length === 1 ? 'submap' : 'submappen'}</span>
              )}
            </span>
            {r.count != null && <span className="m-folders__count">{r.count}</span>}
          </button>
        </div>
        {isOpen && children.map(c => renderNode(c, depth + 1))}
      </div>
    )
  }

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

          {quick.length > 0 && !searched && (
            <div className="m-folders__quickwrap">
              <span className="m-folders__eyebrow">{learned ? 'Meest gebruikt' : 'Snelkeuze'}</span>
              <div className="m-folders__quick" data-n={quick.length}>
                {quick.map(r => (
                  <button key={r.key} type="button" className="m-folders__q" disabled={!!busy}
                          title={r.path} onClick={() => pick(r)}>
                    <MIcon name={QUICK_ICON[r.path] || 'folder'} size={16} />
                    <span>{QUICK_LABEL[r.path] || r.name}</span>
                  </button>
                ))}
              </div>
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
            {searched ? (
              searched.length === 0 ? (
                <div className="m-tl__empty">Geen map met “{q}”.</div>
              ) : searched.map(r => (
                <div key={r.key} className="m-folders__row m-folders__row--flat">
                  <button type="button" className="m-folders__item" disabled={!!busy} onClick={() => pick(r)}>
                    <MIcon name="folder" size={16} />
                    <span className="m-folders__txt">
                      <span className="m-folders__name">{r.name}</span>
                      {/* Het pad erbij, want deze mailbox heeft "Marketing" twee keer. */}
                      {parentOf(r.path) && <span className="m-folders__path">{parentOf(r.path)}</span>}
                    </span>
                    {r.count != null && <span className="m-folders__count">{r.count}</span>}
                  </button>
                </div>
              ))
            ) : roots.length === 0 ? (
              <div className="m-tl__empty">Nog geen mappen gesynchroniseerd.</div>
            ) : roots.map(r => renderNode(r, 0))}
          </div>
        </div>
      </div>
    </>,
    host,
  )
}
