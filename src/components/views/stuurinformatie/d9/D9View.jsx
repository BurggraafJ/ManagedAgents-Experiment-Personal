import { useMemo, useState } from 'react'
import { useD9Hygiene } from '../../../../hooks/useD9Hygiene'
import DataStatusBar from '../../../ui/DataStatusBar'
import D9Tellers from './D9Tellers'
import CheckTable from './CheckTable'
import NietMeetbaar from './NietMeetbaar'
import './d9.css'

/**
 * D9 — Datakwaliteit & hygiëne (/pipeline/hygiene).
 *
 * Eén vraag: mag je de andere cijfers geloven, en wie ruimt wat op?
 * Type: hygiënebord (werkbord over de data). Ritme: wekelijks een kwartier per
 * pipeline-eigenaar; de commercieel directeur kijkt alleen naar de trend.
 *
 * Dit bord rekent niet. Elke telling komt uit v_d9_checks; de component kiest
 * alleen hoe ze getoond wordt. Dat is de les uit de KPI-strip van
 * /klantverlies, die client-side optelde en daardoor jarenlang een getal kon
 * tonen dat bijna twintig keer te hoog was zonder dat iemand het zag.
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
    meta, checks, tellers, blokkers, trend, records,
    loading, error, schemaMissing, refreshedAt, loadRecords, refresh,
  } = useD9Hygiene()

  const [open, setOpen] = useState(null)

  const toggle = (check) => {
    if (open === check.check_id) { setOpen(null); return }
    setOpen(check.check_id)
    loadRecords(check)
  }

  const bronnen = useMemo(() => {
    if (!meta) return []
    const wachtend = checks.filter(c => c.status === 'wacht_op_mirror').length
    return [
      {
        label: 'HubSpot-mirror',
        status: meta.mirror_verouderd ? 'geel' : 'groen',
        toelichting: meta.mirror_verouderd
          ? 'stand ouder dan een uur'
          : 'delta-synchronisatie elke 30 minuten, volledige ronde per 24 uur',
      },
      {
        label: 'Stuurinformatie-velden',
        status: wachtend > 0 ? 'rood' : 'groen',
        toelichting: wachtend > 0
          ? `${wachtend} checks wachten op velden die nog niet meegesynchroniseerd worden`
          : 'alle velden aanwezig',
      },
      {
        label: 'Hygiënetrend',
        status: (meta.trend_dagen || 0) >= 14 ? 'groen' : 'geel',
        toelichting: (meta.trend_dagen || 0) === 0
          ? 'nog geen dagsnapshots'
          : `${meta.trend_dagen} dagen gemeten`,
      },
    ]
  }, [meta, checks])

  const meldingen = useMemo(() => {
    const uit = []
    const wachtend = checks.filter(c => c.status === 'wacht_op_mirror')
    if (wachtend.length > 0) {
      uit.push(
        `${wachtend.length} ${wachtend.length === 1 ? 'check is' : 'checks zijn'} in HubSpot wél te meten maar in deze app niet: ` +
        `${wachtend.map(c => c.check_id).join(' · ')}. De velden staan nog niet in de propertylijst van de HubSpot-synchronisatie.`
      )
    }
    if ((meta?.trend_dagen || 0) === 0) {
      uit.push('Er zijn nog geen dagsnapshots, dus geen trend. De eerste vulling van snap_hygiene_dag start de reeks; elke dag zonder snapshot is trend die niet meer terugkomt.')
    }
    return uit
  }, [checks, meta])

  const geenRechten = !loading && !error && !schemaMissing && (meta?.deals_zichtbaar ?? 0) === 0

  return (
    <div className="d9-app">
      <header className="d9-topbar">
        <div className="d9-crumbs">
          <span className="d9-crumb">Werkruimte</span>
          <span className="d9-crumb-sep">/</span>
          <span className="d9-crumb">Stuurinformatie</span>
          <span className="d9-crumb-sep">/</span>
          <span className="d9-crumb-current">Datakwaliteit</span>
        </div>
        <div className="d9-topbar__right">
          <span className="d9-ritme" title="Hygiënebord: wekelijks een kwartier per pipeline-eigenaar">
            Wekelijks · eigenaar Jay (sales) · CS (klanten) · Jelle (structuur)
          </span>
          <button type="button" className="d9-btn d9-btn--sm" onClick={refresh} disabled={loading}>
            {loading ? 'Verversen…' : 'Ververs'}
          </button>
        </div>
      </header>

      <div className="d9-card">
        <div className="d9-card-inner">
          <div className="d9-wrap">
            <div className="d9-ph">
              <div>
                <div className="d9-ph__eyebrow"><span className="d9-ph__eyebrow-dot" />Stuurinformatie · D9</div>
                <h2 className="d9-ph__title">Mag je de cijfers geloven?</h2>
                <p className="d9-ph__intro">
                  Per regel één telling, één eigenaar en de borden die de fout vertekent. Geen
                  score op honderd: die verbergt welke fout ertoe doet. Klik op een regel voor de
                  records met een directe link naar HubSpot.
                </p>
              </div>
            </div>

            {loading && (
              <>
                <div className="skeleton" style={{ height: 96 }} />
                <div className="skeleton" style={{ height: 64 }} />
                <div className="skeleton" style={{ height: 360 }} />
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

            {!loading && !schemaMissing && !error && !geenRechten && (
              <>
                <D9Tellers blokkers={blokkers} tellers={tellers} />

                <DataStatusBar
                  peildatum={meta?.peildatum}
                  minutenOud={meta?.minuten_oud}
                  verouderd={!!meta?.mirror_verouderd}
                  bronnen={bronnen}
                  meldingen={meldingen}
                />

                <CheckTable
                  checks={checks}
                  trend={trend}
                  records={records}
                  meta={meta}
                  open={open}
                  onToggle={toggle}
                />

                <NietMeetbaar checks={checks} />
              </>
            )}

            <div className="d9-foot">
              Bron: HubSpot-mirror (<code>hubspot_deals</code>, <code>hubspot_companies</code>) via de
              metric-laag <code>v_d9_*</code> · drempels uit <code>dash_parameters</code> ·
              trend uit <code>snap_hygiene_dag</code> (dagelijks 07:45 NL).
              {refreshedAt && <> · scherm ververst {refreshedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}, daarna elke 5 minuten.</>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
