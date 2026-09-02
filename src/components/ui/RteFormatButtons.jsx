// RteFormatButtons — B / I / U-knoppen voor de contentEditable
// RichTextEditor. execCommand werkt op de huidige selectie in de editor;
// mousedown/touchstart worden onderdrukt zodat de editor z'n focus (en dus
// de selectie) houdt als je op een knop tikt. De editor zelf emit't via het
// input-event dat execCommand afvuurt.
//
// Onderstreping bestaat niet in de opgeslagen markdown (alleen **bold** en
// *italic*) — de U-knop is er voor de vertrouwde toolbar; tekst blijft
// leesbaar, alleen de decoratie valt bij opslaan weg.
const CMDS = [
  { cmd: 'bold',      label: 'B', title: 'Vet (⌘B)',       mod: '' },
  { cmd: 'italic',    label: 'I', title: 'Cursief (⌘I)',   mod: '--i' },
  { cmd: 'underline', label: 'U', title: 'Onderstrepen',    mod: '--u' },
]

export default function RteFormatButtons({ className = 'set-editor__fmt', disabled }) {
  const keepFocus = (e) => e.preventDefault()
  return (
    <>
      {CMDS.map(c => (
        <button
          key={c.cmd}
          type="button"
          className={`${className} ${c.mod ? `${className}${c.mod}` : ''}`}
          title={c.title}
          aria-label={c.title}
          disabled={disabled}
          onMouseDown={keepFocus}
          onTouchStart={keepFocus}
          onClick={() => document.execCommand(c.cmd, false)}
        >
          {c.label}
        </button>
      ))}
    </>
  )
}
