/**
 * D9Tellers — de eerste blik (tien seconden): het critical number plus één
 * teller per datagebied.
 *
 * Het critical number is bewust een dealtelling met noemer ("7 van 32 open
 * deals"), geen percentage en geen score-op-honderd: bij deze aantallen is elk
 * percentage ruis, en een samengestelde score verbergt welke fout ertoe doet
 * (D9-pagina 642285572). Richting omlaag is het doel, niet nul.
 *
 * `blind_voor` staat er expliciet bij. Zonder die regel zou een laag getal als
 * "het valt mee" gelezen worden, terwijl het betekent dat drie van de vier
 * blokkerende checks nog niet meetbaar zijn.
 *
 * CD-lock (Commercieel 2026-09-13): zolang blind_voor niet leeg is, hero in
 * amber/ondergrens-staat (geen oranje feest-0). Pas na sync + full round oranje.
 */
function Teller({ titel, aantal, subregel, wacht, blind, accent = false }) {
  const leeg = aantal === null || aantal === undefined
  return (
    <div className={`d9-teller ${accent ? 'd9-teller--accent' : ''}`}>
      <div className="d9-teller__lbl">{titel}</div>
      <div className="d9-teller__val">
        {leeg ? <span className="d9-teller__leeg">—</span> : aantal.toLocaleString('nl-NL')}
        {/* "over 0 checks" is geen informatie maar ruis: als er niets meetbaar
            is, zegt de subregel eronder al wat er in de weg staat. */}
        {subregel && <span className="d9-teller__noemer">{subregel}</span>}
      </div>
      {(wacht > 0 || blind > 0) && (
        <div className="d9-teller__sub">
          {wacht > 0 && <>{wacht} {wacht === 1 ? 'check wacht' : 'checks wachten'} op de mirror</>}
          {wacht > 0 && blind > 0 && ' · '}
          {blind > 0 && <>{blind} niet meetbaar</>}
        </div>
      )}
    </div>
  )
}

export default function D9Tellers({ blokkers, tellers }) {
  const blind = blokkers?.blind_voor || []
  const ondergrens = blind.length > 0
  const heroClass = ondergrens ? 'd9-teller d9-teller--ondergrens' : 'd9-teller d9-teller--hero'
  const aantal = blokkers?.aantal
  const leeg = aantal === null || aantal === undefined

  return (
    <div className="d9-tellers">
      <div className={heroClass}>
        <div className="d9-teller__lbl">
          Forecast-blokkers{ondergrens ? ' · ondergrens' : ''}
        </div>
        <div className={`d9-teller__val${ondergrens ? ' d9-teller__val--muted' : ''}`}>
          {leeg
            ? <span className="d9-teller__leeg">—</span>
            : <>
                {ondergrens && <span className="d9-teller__prefix" aria-hidden="true">≥</span>}
                {aantal.toLocaleString('nl-NL')}
              </>}
          <span className="d9-teller__noemer">
            van {blokkers?.noemer ?? '—'} open sales-deals
          </span>
        </div>
        {ondergrens ? (
          <div className="d9-teller__blind-banner" role="status">
            Blind voor {blind.join(' · ')} — die velden staan nog niet in de mirror.
            Dit getal is een <strong>ondergrens</strong>, geen groen licht.
          </div>
        ) : (
          <div className="d9-teller__sub">
            Deals met minstens één blokkerende fout (H2 · H3 · H4 · H5).
          </div>
        )}
      </div>

      {tellers.map(t => (
        <Teller
          key={t.scope}
          titel={t.scope_label}
          aantal={t.open_fouten}
          subregel={t.checks_meetbaar > 0
            ? `over ${t.checks_meetbaar} ${t.checks_meetbaar === 1 ? 'check' : 'checks'}`
            : null}
          wacht={t.checks_wacht}
          blind={t.checks_blind}
        />
      ))}
    </div>
  )
}
