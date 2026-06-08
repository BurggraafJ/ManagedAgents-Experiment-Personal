import { useRef, useState } from 'react'
import { useKbDocuments } from '../../../hooks/useKbDocuments'
import { showToast } from '../../Toast'
import { fmtDate } from './kbMeta'
import './kb-documents.css'

function Lc({ d, w = 16 }) {
  return <svg className="lc" viewBox="0 0 24 24" width={w} height={w}>{d.map((p, i) => <path key={i} d={p} />)}</svg>
}
const I = {
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  paperclip: ['M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'],
  doc: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z'],
}

function fmtSize(b) {
  if (b == null) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * KbDocuments — gedeelde documenten-lijst voor de kennisbank.
 *  - variant="library"     : losse documentenbibliotheek per kennisbank (KennisbankView)
 *  - variant="attachments" : bijlagen bij één artikel (KbArticleView rail)
 */
export default function KbDocuments({ audience, articleId = null, variant = 'library' }) {
  const { docs, loading, error, busy, upload, remove, getUrl } = useKbDocuments({ audience, articleId })
  const inputRef = useRef(null)
  const [drag, setDrag] = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const [downloading, setDownloading] = useState(null)
  const isAttach = variant === 'attachments'

  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    for (const f of files) {
      const r = await upload(f)
      if (!r.ok) { showToast({ kind: 'error', message: `Upload mislukt: ${f.name}`, detail: r.error }); break }
    }
    showToast({ kind: 'success', message: files.length === 1 ? 'Document toegevoegd' : `${files.length} documenten toegevoegd` })
  }

  async function download(doc) {
    setDownloading(doc.id)
    const r = await getUrl(doc)
    setDownloading(null)
    if (r.ok && r.url) window.open(r.url, '_blank', 'noopener')
    else showToast({ kind: 'error', message: 'Kon document niet openen', detail: r.error })
  }

  async function confirmRemove(doc) {
    setConfirmId(null)
    const r = await remove(doc)
    if (r.ok) showToast({ kind: 'success', message: 'Document verwijderd' })
    else showToast({ kind: 'error', message: 'Verwijderen mislukt', detail: r.error })
  }

  const onDrop = (e) => {
    e.preventDefault(); setDrag(false)
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files)
  }

  return (
    <section className={`kbdoc ${isAttach ? 'kbdoc--attach' : 'kbdoc--lib'}`}>
      <div className="kbdoc__head">
        <h3 className="kbdoc__title"><Lc d={isAttach ? I.paperclip : I.doc} w={isAttach ? 15 : 17} />
          {isAttach ? 'Bijlagen' : 'Documenten'}{docs.length > 0 && <span className="kbdoc__count">{docs.length}</span>}
        </h3>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Lc d={I.upload} w={13} />{busy ? 'Bezig…' : 'Uploaden'}
        </button>
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />
      </div>

      {!isAttach && (
        <div className={`kbdoc__drop ${drag ? 'is-drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)} onDrop={onDrop}
          onClick={() => inputRef.current?.click()} role="button" tabIndex={0}>
          <Lc d={I.upload} w={20} />
          <span>Sleep bestanden hierheen of <b>klik om te uploaden</b></span>
          <span className="kbdoc__hint">PDF, Word, Excel, afbeeldingen — alles kan</span>
        </div>
      )}

      {error ? (
        <p className="kbdoc__state kbdoc__state--err">Kon documenten niet laden: {error}</p>
      ) : loading ? (
        <p className="kbdoc__state">Documenten laden…</p>
      ) : docs.length === 0 ? (
        <p className="kbdoc__state kbdoc__empty">{isAttach ? 'Nog geen bijlagen bij dit artikel.' : 'Nog geen documenten in deze kennisbank.'}</p>
      ) : (
        <ul className="kbdoc__list">
          {docs.map(doc => (
            <li key={doc.id} className="kbdoc__item">
              <span className="kbdoc__ic"><Lc d={I.file} w={16} /></span>
              <div className="kbdoc__meta">
                <span className="kbdoc__name" title={doc.file_name}>{doc.title || doc.file_name}</span>
                <span className="kbdoc__sub">{fmtSize(doc.size_bytes)}{doc.size_bytes != null ? ' · ' : ''}{fmtDate(doc.created_at)}</span>
              </div>
              <div className="kbdoc__actions">
                <button type="button" className="kbdoc__btn" title="Downloaden" disabled={downloading === doc.id} onClick={() => download(doc)}>
                  <Lc d={I.download} w={15} />
                </button>
                {confirmId === doc.id ? (
                  <>
                    <button type="button" className="kbdoc__btn kbdoc__btn--danger" disabled={busy} onClick={() => confirmRemove(doc)}>Verwijder</button>
                    <button type="button" className="kbdoc__btn" onClick={() => setConfirmId(null)}>×</button>
                  </>
                ) : (
                  <button type="button" className="kbdoc__btn" title="Verwijderen" onClick={() => setConfirmId(doc.id)}>
                    <Lc d={I.trash} w={15} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
