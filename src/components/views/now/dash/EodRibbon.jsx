import Icon from '../Icon'

// EodRibbon — afsluitende strook onder de timeline. Tekst dynamisch op het
// aantal resterende agenda-items vandaag.
export default function EodRibbon({ itemsToGo }) {
  return (
    <div className="eod">
      <div className="eod__ico">
        <Icon size={16}><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" /></Icon>
      </div>
      <div className="eod__body">
        {itemsToGo > 0 ? (
          <>Nog <strong>{itemsToGo} {itemsToGo === 1 ? 'item' : 'items'}</strong> op de planning. Als die af zijn, sluit Maestro de dag af en bereidt morgen voor.</>
        ) : (
          <><strong>Klaar voor vandaag.</strong> Maestro bereidt morgen alvast voor.</>
        )}
      </div>
    </div>
  )
}
