import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useD9Hygiene } from '../../../../hooks/useD9Hygiene'
import BordShell, { BordKop, BordZuster } from '../../../ui/BordShell'
import DataStatusBar from '../../../ui/DataStatusBar'
import D9Antwoord, { D9Kernzin } from './D9Antwoord'
import D9Checks from './D9Checks'
import D9Detail from './D9Detail'
import './d9.css'

/**
 * D9 — Datakwaliteit & hygiëne (/pipeline/hygiene).
 *
 * Eén vraag: mag je de andere cijfers geloven, en wie ruimt wat op?
 * Type: hygiënebord (werkbord over de data). Ritme: wekelijks een kwartier per
 * pipeline-eigenaar; de commercieel directeur kijkt alleen naar de trend.
 *
 * Vorm: BordShell, vijf zones, master 58 % / detail 42 %. De pagina scrollt
 * niet — de panelen scrollen. Dat is een layoutregel en geen afspraak, en het
 * is de enige ingreep die voorkomt dat een bord naar zesduizend pixels groeit.
 *
 * Dit bord rekent niet. Elke telling komt uit v_d9_*; de component kiest
 * alleen hoe ze getoond wordt. Dat is de les uit de KPI-strip van
 * /klantverlies, die client-side over de volledige array optelde en daardoor
 * jarenlang een getal kon tonen dat bijna twintig keer te hoog was zonder dat
 * iemand het zag. Vandaar ook: geen som over de checks in een groepskop.
 *
 * Twee lege toestanden die níét hetzelfde zijn en dat hier ook zeggen:
 *  • de metric-laag bestaat nog niet (migratie niet uitgerold) → uitleg + het
 *    commando dat het oplost;
 *  • de kijker ziet nul rijen → dat is óf "geen records", óf "geen rechten":
 *    hubspot_deals eist is_admin_or_higher() én session_mfa_ok(), en levert bij
 *    een gebrek daaraan nul rijen zonder enige foutmelding.
 */
export default function D9View() {
  const {
    meta, checks, blokkers, trend, records,
    loading, error, schemaMissing, refreshedAt, loadRecords, refresh,
  } = useD9Hygiene()

  const nav = useNavigate()
  const [snede, setSnede] = useState('alle')
  const [gekozen, setGekozen] = useState(null)

  const kies = (id) => {
    setGekozen(id)
    const check = checks.find(c => c.check_id === id)
    if (check) loadRecords(check)
  }

  // De vier blokkerende checks in de volgorde van de ranglijst: eerst wat
  // gemeten is (hoog naar laag), daarna wat nog blind is.
  const blokkerChecks = useMemo(() => {
    const blok = checks.filter(c => c.blokkerend)
    const gemeten = blok.filter(c => c.aantal !== null && c.aantal !== undefined)
      .sort((a, b) => (b.aantal || 0) - (a.aantal || 0))
    const blind = blok.filter(c => c.aantal === null || c.aantal === undefined)
      .sort((a, b) => a.volgnummer - b.volgnummer)
    return [...gemeten, ...blind]
  }, [checks])

  const wachtend = useMemo(() => checks.filter(c => c.status === 'wacht_op_mirror'), [checks])

  const bronnen = useMemo(() => {
    if (!meta) return []
    const dagen = meta.trend_dagen || 0
    return [
      {
        label: 'HubSpot-mirror',
        status: meta.mirror_verouderd ? 'geel' : 'groen',
        kort: meta.mirror_verouderd ? 'stand ouder dan een uur' : `actueel · ${meta.minuten_oud ?? 0} min`,
        toelichting: meta.mirror_verouderd
          ? 'stand ouder dan een uur — er is een synchronisatie overgeslagen'
          : 'delta-synchronisatie elke 30 minuten, volledige ronde per 24 uur',
      },
      {
        label: 'snap_hygiene_dag',
        status: dagen >= 14 ? 'groen' : 'geel',
        kort: dagen === 0 ? 'reeks start' : `${dagen} ${dagen === 1 ? 'dag' : 'dagen'}`,
        toelichting: dagen === 0
          ? 'nog geen dagsnapshots — de trendkolom toont daarom geen lijn'
          : `${dagen} dagen gemeten; een trend is pas een trend vanaf veertien`,
      },
    ]
  }, [meta])

  // Eén regel per ontbrekend ding, zodat het getal in `Wat ontbreekt (n)`
  // precies telt wat je erachter aantreft. De reden staat één keer onder de
  // lijst en niet vijf keer erin — dezelfde regel vijf keer herhalen is
  // precies wat er van de oude checktabel af moest.
  const meldingen = useMemo(() => {
    const uit = wachtend.map(c => `${c.check_id} · ${c.titel}`)
    if ((meta?.trend_dagen || 0) === 0) {
      uit.push('Hygiënetrend — er zijn nog geen dagsnapshots. Elke dag zonder snapshot is trend die niet meer terugkomt.')
    }
    return uit
  }, [wachtend, meta])

  const zin = useMemo(() => {
    if (wachtend.length > 0) {
      return (
        <>
          <span className="dsb-warn">
            {wachtend.length} {wachtend.length === 1 ? 'check wacht' : 'checks wachten'} op de propertylijst van de sync
          </span>{' '}
          — in HubSpot wél te meten.
        </>
      )
    }
    if (meta?.mirror_verouderd) {
      return <span className="dsb-warn">De mirror is ouder dan een uur — er is een synchronisatie overgeslagen.</span>
    }
    return <>Alle velden staan in de mirror; elke check hierboven is gemeten.</>
  }, [wachtend, meta])

  const geenRechten = !loading && !error && !schemaMissing && (meta?.deals_zichtbaar ?? 0) === 0

  const voetnoot = (
    <>
      {wachtend.length > 0 && (
        <>
          De {wachtend.length === 1 ? 'check' : `${wachtend.length} checks`} hierboven
          {wachtend.length === 1 ? ' wacht' : ' wachten'} op één ding: de propertylijst van
          <code>hubspot-sync-etl</code> moet uitgebreid en daarna één keer volledig gesynct.{' '}
        </>
      )}
      Bron: HubSpot-mirror (<code>hubspot_deals</code>, <code>hubspot_companies</code>) via
      de metric-laag <code>v_d9_*</code> · drempels uit <code>dash_parameters</code> ·
      trend uit <code>snap_hygiene_dag</code> (dagelijks 07:45 NL).
      {refreshedAt && <> Scherm ververst {refreshedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}, daarna elke 5 minuten.</>}
    </>
  )

  // Zone 5 in de kop (v1.188): geen band meer onder het werk. Op dit bord is
  // dat het scherpst te zien — een hygiënebord dat zijn eigen datastatus
  // onderaan verstopt, vraagt vertrouwen op de plek waar niemand kijkt.
  const vertrouwen = (
    <DataStatusBar
      variant="kop"
      peildatum={meta?.peildatum}
      minutenOud={meta?.minuten_oud}
      verouderd={!!meta?.mirror_verouderd}
      bronnen={bronnen}
      meldingen={meldingen}
      zin={zin}
      voetnoot={voetnoot}
    />
  )

  const kop = (
    <BordKop
      /* Ingesprongen pagina onder /pipeline: terug naar het ouderbord, niet
         naar Dashboard — die weg draagt de app-topbalk al (v1.189). */
      terug={{ label: 'Pipeline', onClick: () => nav('/pipeline') }}
      kruimel="Stuurinformatie · D9"
      vraag="Mag je de cijfers geloven?"
      meta={<>wekelijks · <b>Jay</b> sales · <b>CS</b> klanten · <b>Jelle</b> structuur</>}
      vertrouwen={vertrouwen}
      filters={<BordZuster onClick={() => nav('/pipeline')}>Pipeline & forecast</BordZuster>}
      acties={
        <button type="button" className="bs-btn" onClick={refresh} disabled={loading}>
          {loading ? 'Verversen…' : 'Ververs'}
        </button>
      }
    />
  )

  if (loading || schemaMissing || error || geenRechten) {
    return (
      <div className="bs bs--d9">
        {kop}
        {loading && (
          <>
            <div className="skeleton" style={{ height: 130 }} />
            <div className="skeleton" style={{ height: 20, maxWidth: 420 }} />
            <div className="skeleton" style={{ flex: 1, minHeight: 160 }} />
          </>
        )}

        {!loading && schemaMissing && (
          <div className="d9-melding d9-melding--info">
            <b>De metric-laag staat nog niet in de database.</b>
            <p>
              De views <code>v_d9_checks</code>, <code>v_d9_meta</code> en de recordlijsten komen
              uit de migraties <code>20260912220000</code> t/m <code>20260912224000</code>. Rol die
              uit, dan vult dit bord zichzelf — er is geen tweede stap in de app nodig.
            </p>
          </div>
        )}

        {!loading && error && (
          <div className="d9-melding d9-melding--fout">
            Kan de hygiënegegevens niet ophalen: {error}
          </div>
        )}

        {!loading && geenRechten && (
          <div className="d9-melding d9-melding--info">
            <b>Geen records — of geen rechten.</b>
            <p>
              Dit bord leest de HubSpot-mirror, en die is afgeschermd met beheerdersrechten
              plus een tweede factor. Wie daar niet aan voldoet krijgt nul rijen terug en géén
              foutmelding. Nul betekent hier dus niet "alles schoon".
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <BordShell
      className="bs--d9"
      kop={kop}
      antwoord={<D9Antwoord blokkers={blokkers} blokkerChecks={blokkerChecks} />}
      kernzin={<D9Kernzin blokkerChecks={blokkerChecks} />}
      master={
        <D9Checks
          checks={checks}
          trend={trend}
          meta={meta}
          snede={snede}
          onSnede={setSnede}
          gekozen={gekozen}
          onKies={kies}
        />
      }
      detail={<D9Detail checks={checks} records={records} gekozen={gekozen} />}
    />
  )
}
