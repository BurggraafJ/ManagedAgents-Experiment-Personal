import ReorganizeButton from './ReorganizeButton'

// Top-bar — zoek + ✨ AI herindelen
export default function TopActionBar({ search, onSearch, totalLive }) {
  return (
    <div style={{
      display: 'flex',
      gap: 10,
      alignItems: 'center',
      flexWrap: 'wrap',
      paddingBottom: 8,
      borderBottom: '1px solid var(--border)',
    }}>
      <input
        className="input"
        placeholder="zoeken in titels, notes, tags…"
        value={search}
        onChange={e => onSearch(e.target.value)}
        style={{ flex: 1, minWidth: 240, maxWidth: 360 }}
      />
      <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
        {totalLive} live
      </span>
      <ReorganizeButton />
    </div>
  )
}
