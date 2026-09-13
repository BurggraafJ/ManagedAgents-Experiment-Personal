import { useMemo } from 'react'
import MeesterLijst, { MeesterGroep, MeesterRij } from '../../../ui/MeesterLijst'
import SnedeKiezer from '../../../ui/SnedeKiezer'
import TrendCel from './TrendCel'

/**
 * D9Checks — zone 3, de ontleding. Eén blok met drie sneden over dezélfde
 * regels; nooit drie blokken onder elkaar.
 *
 * Wat er bewust NIET staat (Research 1 §5, de snoei):
 *  • geen aggregaat-tellers per groep. "4 checks · 30 records" telt records op
 *    over ongelijksoortige checks, en één deal kan op twee lijsten staan —
 *    precies de dubbeltelling waarvoor het critical number een deal-telling is.
 *    De groepskop noemt daarom het aantal checks en de eigenaar, geen som.
 *  • geen rij "— wacht op mirror". Die vijf checks zijn in HubSpot wél te
 *    meten maar hier niet; ze staan als één regel in zone 5, niet vijf keer
 *    in de lijst.
 *  • geen accordeon. De records openen in het detailpaneel ernaast, zodat de
 *    lijst niet uit elkaar geduwd wordt en zijn scrollpositie houdt.
 */
const SNEDEN = [
  { id: 'alle',     label: 'alle' },
  { id: 'eigenaar', label: 'eigenaar' },
  { id: 'bord',     label: 'bord' },
]

const VOETNOOT = {
  alle: <>Trend uit <b>snap_hygiene_dag</b> — de reeks start deze week, dus nog geen lijn. Geen reeks, geen grafiek.</>,
  eigenaar: <>Eigenaar is wie opruimt, niet wie de fout maakte: <b>Jay</b> de sales-records, <b>CS</b> de klantrecords, <b>Jelle</b> de velden en de structuur.</>,
  bord: <>Een check kan meer dan één bord vertekenen en staat dan in meer dan één groep — het aantal regels is daarom hoger dan het aantal checks.</>,
}

function eigenaren(rijen) {
  return [...new Set(rijen.map(c => c.eigenaar).filter(Boolean))].join(' & ')
}

/** De groepen per snede. Dezelfde regels, een andere doorsnede. */
function groepeer(snede, werk) {
  if (snede === 'eigenaar') {
    return [...new Set(werk.map(c => c.eigenaar || 'zonder eigenaar'))]
      .map(naam => {
        const rijen = werk.filter(c => (c.eigenaar || 'zonder eigenaar') === naam)
        return { sleutel: naam, naam, tel: `${rijen.length} ${rijen.length === 1 ? 'check' : 'checks'}`, rijen }
      })
  }

  if (snede === 'bord') {
    const borden = [...new Set(werk.flatMap(c => c.raakt || []))].sort()
    const zonder = werk.filter(c => (c.raakt || []).length === 0)
    const groepen = borden.map(bord => {
      const rijen = werk.filter(c => (c.raakt || []).includes(bord))
      return { sleutel: bord, naam: bord, tel: `${rijen.length} ${rijen.length === 1 ? 'check vertekent' : 'checks vertekenen'} dit bord`, rijen }
    })
    if (zonder.length > 0) {
      groepen.push({ sleutel: 'geen', naam: 'geen bord', tel: `${zonder.length} checks`, rijen: zonder })
    }
    return groepen
  }

  const blokkeert = werk.filter(c => c.blokkerend)
  const opruim = werk.filter(c => !c.blokkerend)
  return [
    blokkeert.length > 0 && {
      sleutel: 'blokkeert',
      naam: 'Blokkeert de forecast',
      tel: `${blokkeert.length} ${blokkeert.length === 1 ? 'check' : 'checks'} · eigenaar ${eigenaren(blokkeert)}`,
      rijen: blokkeert,
    },
    opruim.length > 0 && {
      sleutel: 'opruim',
      naam: 'Opruimwerk',
      tel: `${opruim.length} ${opruim.length === 1 ? 'check' : 'checks'} · vertekent geen forecast`,
      rijen: opruim,
    },
  ].filter(Boolean)
}

export default function D9Checks({
  checks, trend, meta, snede, onSnede, gekozen, onKies,
}) {
  const { werk, schoon, geenVeld, geenBron } = useMemo(() => {
    const meetbaar = checks.filter(c => c.status === 'meetbaar' || c.status === 'constatering')
    return {
      werk: meetbaar
        .filter(c => (c.aantal || 0) > 0)
        .sort((a, b) => (b.aantal || 0) - (a.aantal || 0)),
      schoon: meetbaar.filter(c => c.aantal === 0),
      geenVeld: checks.filter(c => c.status === 'niet_meetbaar'),
      geenBron: checks.filter(c => c.status === 'niet_gekoppeld'),
    }
  }, [checks])

  const groepen = useMemo(() => groepeer(snede, werk), [snede, werk])
  const nietMeetbaar = geenVeld.length + geenBron.length

  const sneden = SNEDEN.map(s => ({
    ...s,
    n: s.id === 'bord'
      ? werk.reduce((som, c) => som + Math.max(1, (c.raakt || []).length), 0)
      : werk.length,
    titel: s.id === 'bord' ? 'Per bord dat de fout vertekent — een check kan in twee groepen staan' : undefined,
  }))

  return (
    <MeesterLijst
      titel="Per check"
      snede={<SnedeKiezer sneden={sneden} actief={snede} onKies={onSnede} />}
      kolomkoppen={['n', 'trend 8 weken']}
      voet={VOETNOOT[snede]}
      slot={
        <>
          {schoon.length > 0 && (
            <div className="bs-rij bs-rij--schoon">
              <span>
                ✓ schoon · {schoon.map(c => c.check_id).join(' · ')}{' '}
                <span className="bs-zacht">— 0 records, niets te doen</span>
              </span>
            </div>
          )}
          {nietMeetbaar > 0 && (
            <button
              type="button"
              className={`bs-rij bs-rij--blok${gekozen === 'niet-meetbaar' ? ' is-gekozen' : ''}`}
              onClick={() => onKies('niet-meetbaar')}
              aria-pressed={gekozen === 'niet-meetbaar'}
            >
              <span>
                ⛔ Niet meetbaar · {nietMeetbaar} checks
                {geenVeld.length > 0 && ` — ${geenVeld.length} zonder veld in HubSpot`}
                {geenBron.length > 0 && `${geenVeld.length > 0 ? ', ' : ' — '}${geenBron.length} zonder gekoppelde bron`}
              </span>
              <span className="bs-rij__caret" aria-hidden>▸</span>
            </button>
          )}
        </>
      }
    >
      {werk.length === 0 && (
        <div className="bs-leeg">
          Geen enkele meetbare check heeft nog openstaande records. Dat is een geslaagde week —
          en geen kapotte lijst.
        </div>
      )}

      {groepen.map(g => (
        <div key={g.sleutel}>
          <MeesterGroep naam={g.naam} tel={g.tel} />
          {g.rijen.map(c => (
            <MeesterRij
              key={`${g.sleutel}-${c.check_id}`}
              code={c.check_id}
              naam={c.titel}
              sub={c.noemer !== null && c.noemer !== undefined
                ? `van ${c.noemer.toLocaleString('nl-NL')} ${c.noemer_label}`
                : null}
              n={c.aantal}
              titel={c.definitie || undefined}
              gekozen={gekozen === c.check_id}
              onClick={() => onKies(c.check_id)}
              trend={
                <TrendCel
                  trend={trend[c.check_id]}
                  meetbaar
                  trendVanaf={meta?.trend_vanaf}
                />
              }
            />
          ))}
        </div>
      ))}
    </MeesterLijst>
  )
}
