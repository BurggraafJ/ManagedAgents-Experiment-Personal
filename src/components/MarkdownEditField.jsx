import RichTextEditor from './ui/RichTextEditor'

// MarkdownEditField — eenvoudig WYSIWYG-blok met witte achtergrond, header
// (label + shortcuts-hint) en RichTextEditor erin. Vervangt zowel de
// notitie-editor in ProposalCardCompact als de tone-guide / body-template
// textareas in settings/TemplatesPage. Slaat onder water markdown op
// (`**bold**`, `*italic*`, `- bullet`) zodat skills en HubSpot dezelfde
// tokens zien.
//
// Props:
//   - label: tekst boven het veld (bv. "Notitie", "Tone-guide", "Body-template")
//   - value / onChange: markdown-string + setter
//   - minHeight: pixels — default 320 (notitie-veld). Voor instructies kan
//     800 mooier zijn.
//   - placeholder: hint binnen de editor als deze leeg is
//   - disabled: lock readonly-state
//   - resetKey: forceer re-init van de editor-content (bv. bij agent-wissel)
export default function MarkdownEditField({
  label,
  value,
  onChange,
  minHeight = 320,
  placeholder,
  disabled,
  resetKey,
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border, rgba(0,0,0,0.10))',
        borderRadius: 8,
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border, rgba(0,0,0,0.06))',
          background: '#fff',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
        <span className="muted" style={{ fontSize: 10.5 }}>
          <kbd style={{ padding: '0 4px', border: '1px solid var(--border)', borderRadius: 3 }}>Ctrl+B</kbd> vet ·{' '}
          <kbd style={{ padding: '0 4px', border: '1px solid var(--border)', borderRadius: 3 }}>Ctrl+I</kbd> cursief ·{' '}
          <kbd style={{ padding: '0 4px', border: '1px solid var(--border)', borderRadius: 3 }}>Ctrl+Shift+8</kbd> lijst
        </span>
      </div>
      <div className="pcv7__note-rte">
        <RichTextEditor
          valueMd={value || ''}
          onChangeMd={onChange}
          placeholder={placeholder}
          minHeight={minHeight}
          disabled={disabled}
          resetKey={resetKey}
        />
      </div>
    </div>
  )
}
