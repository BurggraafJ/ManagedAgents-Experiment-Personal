import { useNavigate } from 'react-router-dom'
import { useStuurTiles } from '../../hooks/useStuurTiles'
import { getal, decimaal, peilingKort, peilingTitel } from '../../components/views/stuurinformatie/format'
import MIcon from '../MIcon'
import '../mobile-home.css'

/**
 * MobileHome (v1.179) — het Dashboard als landing op de telefoon, net als
 * HomeView op desktop. Drie stuurkaarten in de volgorde van de CD-lock
 * (13-09-2026): D1 aanvoer eerst, D9 als ondergrens eronder, D10 met B als
 * stuurgetal en C ernaast — nooit opgeteld. Eén critical number per kaart,
 * altijd met noemer en context; tikken opent het bord.
 *
 * De vragenbak is níét weg: /zoeken blijft MobileZoeken en de vraag-pil
 * bovenaan brengt je er in één tik (desktop: zoekveld in de sidebar). De
 * inset onderaan spiegelt de volledige Confluence D1–D10-set: D2–D8 als
 * Soon-rijen zonder bord (nog niet gebouwd). Kennis/Mail/Omzet waren geen
 * D-bord uit die set en zijn eruit, net als op desktop.
 *
 * Twee lege toestanden die níét hetzelfde zijn: laden (skelet) en "geen
 * zicht" — de mirror eist beheerdersrechten plus tweede factor en geeft anders
 * nul rijen zonder fout. Dat tonen we als tekst, nooit als nul.
 */
export default function MobileHome({ profile, isOwner = false }) {
  const navigate = useNavigate()
  const { d1, d9, d10, loading } = useStuurTiles()

  const firstName = (profile?.display_name || '').trim().split(/\s+/)[0] || null
  const datum = new Date().toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')
  const mirror = d1 ? (d1.verouderd ? 'mirror ouder dan een uur' : `HubSpot-mirror · ${getal(d1.minutenOud) ?? '—'} min oud`) : null

  return (
    <div className="m-set m-home">
      <header className="m-set__head m-home__head">
        <div className="m-home__eyebrowrow">
          <span className="m-set__eyebrow">Dashboard · {datum}</span>
          {mirror && <span className="m-home__mirror">{mirror}</span>}
        </div>
        <h1 className="m-set__title">{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
      </header>

      <div className="m-set__body m-home__body">
        <button type="button" className="m-home__vraag" onClick={() => navigate('/zoeken')}>
          <MIcon name="spark" size={16} />
          <span>Vraag Maestro of zoek in je werkruimte…</span>
        </button>

        <div className="m-set__grouplbl m-home__lbl">Stuurinformatie</div>
        <div className="m-home__kaarten">
          {isOwner && (
            <Kaart id="D1" naam="Pipeline & forecast" toon={d1 && d1.doel !== null && d1.kennismakingen !== null && d1.kennismakingen < d1.doel ? 'warn' : 'hero'}
              peil={d1} loading={loading} leeg={!d1} onClick={() => navigate('/pipeline')}>
              {d1 && (
                <>
                  <Getal waarde={getal(d1.kennismakingen) ?? '—'} suffix="kennismakingen vorige week" />
                  <p className="m-home__ctx">
                    {d1.doel === null ? 'geen doel vastgelegd' : <>doel <b>{getal(d1.doel)}</b> per week{tekort(d1)}</>}
                    {d1.gemiddeld4wk !== null && <> · gemiddeld {decimaal(d1.gemiddeld4wk)} over vier weken</>}
                  </p>
                  <div className="m-home__splits">
                    <span>{getal(d1.actief)} open deals</span>
                    <span>{d1.perFase.map(f => <i key={f.fase} className={f.aantal ? '' : 'is-nul'}>f{f.fase} <b>{getal(f.aantal ?? 0)}</b></i>)}</span>
                  </div>
                </>
              )}
            </Kaart>
          )}

          {isOwner && (
            <Kaart id="D9" naam={`Datakwaliteit${d9?.blindVoor.length ? ' · ondergrens' : ''}`} toon={d9?.blindVoor.length ? 'amber' : 'normaal'}
              peil={d9} loading={loading} leeg={!d9} onClick={() => navigate('/pipeline/hygiene')}>
              {d9 && (
                <>
                  <Getal prefix={d9.blindVoor.length ? '≥' : null} waarde={getal(d9.aantal) ?? '—'} suffix={`van ${getal(d9.noemer)} open deals blokkeren de forecast`} />
                  <p className="m-home__ctx">
                    {d9.blindVoor.length
                      ? <>Blind voor {d9.blindVoor.join(' · ')} — die velden staan nog niet in de mirror. Een ondergrens, geen groen licht.</>
                      : 'Deals met minstens één blokkerende fout (H2 · H3 · H4 · H5).'}
                  </p>
                </>
              )}
            </Kaart>
          )}

          <Kaart id="D10" naam="Klantverlies · maandritme" toon="normaal" peil={d10} loading={loading} leeg={!d10} onClick={() => navigate('/klantverlies')}>
            {d10 && (
              <>
                <Getal waarde={getal(d10.b.deze_maand)} suffix="proeven niet omgezet deze maand" />
                <p className="m-home__ctx">
                  vorige maand {getal(d10.b.vorige_maand)} · {getal(d10.b.laatste_13_maanden)} in 13 mnd
                  {d10.proeven !== null && <> · {getal(d10.proeven)} proeven lopen nu</>}
                </p>
                {/* C ernaast, kleiner en apart: wél churn, nooit bij B opgeteld. */}
                <p className="m-home__c">
                  <b>{getal(d10.c.deze_maand)}</b> opzeggingen deze maand · {getal(d10.c.laatste_13_maanden)} in 13 mnd
                  <span className="m-home__chip m-home__chip--churn">churn</span>
                </p>
              </>
            )}
          </Kaart>
        </div>

        <div className="m-set__grouplbl m-home__lbl m-home__lbl--gap">Ook op het dashboard</div>
        <div className="m-inset">
          <Rij icon="contacts" label="D2 · Aanvoer & kanaal" pill="Soon" />
          <Rij icon="activity" label="D3 · Adoptie & klantgezondheid" pill="Soon" />
          <Rij icon="users" label="D4 · Klantbasis & retentie" pill="Soon" />
          <Rij icon="scale" label="D5 · Cash & order-to-cash" pill="Soon" />
          <Rij icon="sliders" label="D6 · Marge & unit economics" pill="Soon" />
          <Rij icon="clock" label="D7 · Capaciteit & inzet" pill="Soon" />
          <Rij icon="dashboard" label="D8 · MT-cockpit" pill="Soon" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- delen

// `peil` (v1.189): het bordobject met peildatum/minutenOud — de laatste peiling
// staat rechts in de kopregel van de kaart, als stempel ("13-09 00:04").
function Kaart({ id, naam, toon, peil = null, loading, leeg, onClick, children }) {
  if (loading) return <div className="m-home__kaart m-home__kaart--skelet skeleton" />
  const stempel = peilingKort(peil?.peildatum)
  return (
    <button type="button" className={`m-home__kaart m-home__kaart--${toon}`} onClick={onClick}>
      <span className="m-home__eyebrow">
        <i className="m-home__dot" />{id} · {naam}
        {stempel && <span className="m-home__peil" title={peilingTitel(peil.peildatum, peil.minutenOud) || undefined}>{stempel}</span>}
      </span>
      {leeg
        ? <p className="m-home__ctx m-home__ctx--leeg">Geen records — of geen rechten. Dit bord leest de HubSpot-mirror; zonder beheerdersrechten plus tweede factor geeft die nul rijen en geen fout.</p>
        : children}
      <span className="m-home__chev"><MIcon name="chevron" size={16} stroke={2} /></span>
    </button>
  )
}

function Getal({ prefix = null, waarde, suffix, klein = false }) {
  return (
    <span className={`m-home__getal ${klein ? 'm-home__getal--klein' : ''}`}>
      <b>{prefix && <em aria-hidden>{prefix}</em>}{waarde ?? '—'}</b>
      <span>{suffix}</span>
    </span>
  )
}

function Rij({ icon, label, meta = null, pill = null, onClick = null }) {
  return (
    <button type="button" className={`m-inset__row ${onClick ? '' : 'is-disabled'}`} onClick={onClick || undefined} disabled={!onClick}>
      <span className="m-inset__ico"><MIcon name={icon} size={19} /></span>
      <span className="m-inset__lbl">{label}</span>
      {meta && <span className="m-home__meta">{meta}</span>}
      {pill && <span className={`m-home__chip m-home__chip--${pill.toLowerCase()}`}>{pill}</span>}
      {onClick && <span className="m-inset__chev"><MIcon name="chevron" size={16} /></span>}
    </button>
  )
}

function tekort(d1) {
  if (d1.kennismakingen === null) return null
  return d1.kennismakingen >= d1.doel ? ' · gehaald' : ` · ${getal(d1.doel - d1.kennismakingen)} tekort`
}

function greeting(now = new Date()) {
  const h = now.getHours()
  if (h < 6)  return 'Goedenacht'
  if (h < 12) return 'Goedemorgen'
  if (h < 18) return 'Goedemiddag'
  return 'Goedenavond'
}
