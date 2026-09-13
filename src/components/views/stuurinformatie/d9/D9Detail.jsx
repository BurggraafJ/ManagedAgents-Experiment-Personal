import DetailPaneel from '../../../ui/DetailPaneel'
import CheckRecords from './CheckRecords'
import NietMeetbaar from './NietMeetbaar'

/**
 * D9Detail — zone 4. Wat er achter de gekozen regel zit.
 *
 * Twee soorten inhoud, één paneel: de records van een check, of de zes checks
 * die niet meetbaar zijn. Het paneel kiest nooit zelf een eerste regel — wie
 * binnenkomt moet aan het antwoord genoeg hebben, het detail is een
 * vervolgvraag (Research 2 §5, check 9).
 *
 * De subregel draagt wat de oude tabel in vier kolommen kwijt moest: de
 * noemer, de eigenaar en de borden die deze fout vertekent. Dat hoort bij de
 * check en niet bij elk record — één keer boven de lijst in plaats van
 * tweehonderd keer erin.
 */
export default function D9Detail({ checks, records, gekozen }) {
  if (gekozen === 'niet-meetbaar') {
    const blind = checks.filter(c => c.status === 'niet_meetbaar' || c.status === 'niet_gekoppeld')
    return (
      <DetailPaneel
        titel="⛔ Niet meetbaar"
        sub={<><b>{blind.length}</b> van de {checks.length} checks — ze tellen in geen enkel getal op dit bord mee</>}
        voet="Een lege plek is hier het argument om het veld aan te maken of de bron te koppelen — geen fout in het bord."
      >
        <NietMeetbaar checks={checks} />
      </DetailPaneel>
    )
  }

  const check = checks.find(c => c.check_id === gekozen)
  if (!check) {
    // "links" staat er bewust niet in: op een telefoon zakt de lijst naar
    // bóven het paneel en klopt die aanwijzing niet meer.
    return (
      <DetailPaneel leegTekst="Kies een check. De records erachter komen hier te staan, met een link naar HubSpot." />
    )
  }

  const state = records[check.check_id]
  const rijen = state?.rows?.length ?? 0

  return (
    <DetailPaneel
      titel={`${check.check_id} · ${check.titel}`}
      sub={
        <>
          <b>{check.aantal?.toLocaleString('nl-NL')}</b>
          {check.noemer !== null && check.noemer !== undefined && <> van {check.noemer.toLocaleString('nl-NL')} {check.noemer_label}</>}
          {check.eigenaar && <> · eigenaar <b>{check.eigenaar}</b></>}
          {(check.raakt || []).length > 0 && <> · vertekent <b>{check.raakt.join(' · ')}</b></>}
        </>
      }
      voet={
        state?.afgekapt
          ? <>Alleen de eerste {rijen} records — deze lijst is te lang voor handwerk. Dat is zelf het signaal: geen opruimklus maar een procesprobleem.</>
          : <>{rijen} {rijen === 1 ? 'record' : 'records'} · <b>scrollt in dít paneel</b> — een regel opent HubSpot, de route verandert niet.</>
      }
    >
      <CheckRecords state={state} />
    </DetailPaneel>
  )
}
