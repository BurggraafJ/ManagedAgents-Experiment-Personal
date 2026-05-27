// DashHero — greeting + datum + "items te gaan" + done-today big number
// met breakdown-chips. Alles data-driven uit useDashboard view-model.
export default function DashHero({ vm }) {
  const itemsLabel = vm.itemsToGo === 0
    ? 'geen items meer vandaag.'
    : `${vm.itemsToGo} item${vm.itemsToGo === 1 ? '' : 's'} te gaan vandaag.`

  return (
    <div className="hero">
      <div>
        <div className="hero__date"><strong>{vm.dateLabel}</strong> · <span>{vm.clock}</span></div>
        <h1 className="hero__title">{vm.greeting} Jelle.<br /><em>{itemsLabel}</em></h1>
        <div className="hero__sub">{vm.heroSub}</div>
      </div>
      <div className="hero__done">
        <div className="hero__big">{vm.doneTotal}<small>al verwerkt vandaag</small></div>
        <div className="hero__breakdown">
          {vm.doneBreakdown.map((b, i) => (
            <span key={i} className="hero__chip"><strong>{b.n}</strong>{b.label}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
