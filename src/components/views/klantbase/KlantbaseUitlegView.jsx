/* KlantbaseUitlegView — handboek bij Klantbase.
   Twee tabs (subnav):
     - 'spelregels': hoe het proces werkt + maand-grens-regel + afhankelijkheden
     - 'velden':     naslagwerk van alle 19 business-metrics
   Bereikbaar via /klantbase/uitleg en /klantbase/velden.
*/
import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { FIELDS_DEF, GROUP_ORDER } from './klantbase-data'
import './klantbase.css'

const SPELREGELS_SECTIONS = [
  { id: 'hoe-werkt',       label: 'Hoe werkt Klantbase' },
  { id: 'begrip',          label: 'Algemeen begrip' },
  { id: 'nieuwe-deal',     label: 'Nieuwe deal-regel' },
  { id: 'afhankelijkheden', label: 'Afhankelijkheden' },
  { id: 'bronnen',         label: 'Bronnen die de AI gebruikt' },
]

export default function KlantbaseUitlegView() {
  const navigate = useNavigate()
  const location = useLocation()
  const tab = location.pathname.endsWith('/velden') ? 'velden' : 'spelregels'

  const [clock, setClock] = useState('--:--')
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }))
    tick()
    const id = setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="kb-app">
      <header className="kb-topbar">
        <div className="kb-crumbs">
          <span className="kb-crumb">Werkruimte</span>
          <span className="kb-crumb-sep">/</span>
          <span className="kb-crumb">Klantbeheer</span>
          <span className="kb-crumb-sep">/</span>
          <button className="kb-crumb kb-crumb-link" onClick={() => navigate('/klantbase')}>Klantbase</button>
          <span className="kb-crumb-sep">/</span>
          <span className="kb-crumb kb-crumb-current">{tab === 'velden' ? 'Velden' : 'Spelregels'}</span>
        </div>
        <div className="kb-topbar__right">
          <div className="kb-mode" role="tablist">
            <button onClick={() => navigate('/klantbase')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h6l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m9 14 2 2 4-4"/></svg>
              Overdracht
            </button>
            <button onClick={() => navigate('/klantbase/verlenging')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-15.4 6.4L3 16M3 21v-5h5"/></svg>
              Verlenging
            </button>
            <a className="is-active">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/></svg>
              Uitleg
            </a>
          </div>
          <span className="kb-sync">
            <span className="kb-sync__dot" />
            <span>Live</span>
            <span className="kb-sync__meta">{clock}</span>
          </span>
        </div>
      </header>

      <div className="kb-card kb-card--uitleg">
        <div className="kb-card-inner">
          <div className="kb-wrap">
            {tab === 'spelregels'
              ? <SpelregelsContent onSwitch={() => navigate('/klantbase/velden')} />
              : <VeldenContent onSwitch={() => navigate('/klantbase/uitleg')} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function Hero({ children, onSwitch, tab }) {
  return (
    <div className="kb-hero">
      <span className="kb-hero-tag">Klantbase-handboek</span>
      {children}
      <nav className="kb-subnav">
        <a
          className={tab === 'spelregels' ? 'is-active' : ''}
          onClick={() => tab !== 'spelregels' && onSwitch()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19"/>
          </svg>
          Spelregels
        </a>
        <a
          className={tab === 'velden' ? 'is-active' : ''}
          onClick={() => tab !== 'velden' && onSwitch()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
          Velden ({FIELDS_DEF.length})
        </a>
      </nav>
    </div>
  )
}

function SpelregelsContent({ onSwitch }) {
  const [active, setActive] = useState('hoe-werkt')
  function scrollTo(id) {
    setActive(id)
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <>
      <nav className="kb-toc">
        <h4>Op deze pagina</h4>
        {SPELREGELS_SECTIONS.map(s => (
          <a key={s.id} className={active === s.id ? 'is-active' : ''} onClick={() => scrollTo(s.id)}>
            {s.label}
          </a>
        ))}
      </nav>
      <div className="kb-main-col">
        <Hero onSwitch={onSwitch} tab="spelregels">
          <h1>Spelregels & afspraken</h1>
          <p>
            Alles wat je moet weten om de AI-voorstellen op Klantbase goed te kunnen lezen — hoe het
            proces werkt, welke afspraken we hanteren rond facturatie, en uit welke bronnen de agent put.
          </p>
        </Hero>

        <section className="kb-section" id="hoe-werkt">
          <h2>Hoe werkt Klantbase</h2>
          <p className="kb-lede">Het proces in vier stappen — van een gewonnen sales-deal naar een correcte klant in de customer base.</p>
          <ol className="kb-flow">
            <li className="kb-flow-step">
              <div className="kb-flow-num">1</div>
              <div className="kb-flow-body">
                <h3>Deal staat op <em>Closed Won</em></h3>
                <p>Sales sluit een deal in HubSpot. De agent pakt 'm op zodra de deal de pipeline-fase Closed Won bereikt.</p>
              </div>
            </li>
            <li className="kb-flow-step">
              <div className="kb-flow-num">2</div>
              <div className="kb-flow-body">
                <h3>Agent verzamelt &amp; stelt voor</h3>
                <p>De agent leest de licentieovereenkomst, de e-mails op de deal, de company-notities en bestaande HubSpot-velden. Op basis daarvan vult hij alle 19 business-metrics in en geeft per veld aan waar de waarde vandaan komt.</p>
              </div>
            </li>
            <li className="kb-flow-step">
              <div className="kb-flow-num">3</div>
              <div className="kb-flow-body">
                <h3>Jij controleert</h3>
                <p>Per veld zie je het AI-voorstel, de redenering én de bron. Akkoord? <b>Goedkeuren</b>. Klopt het niet? <b>Wijzigen</b> of <b>AI opnieuw laten kijken</b>. Niet relevant? <b>Afwijzen</b>.</p>
              </div>
            </li>
            <li className="kb-flow-step">
              <div className="kb-flow-num">4</div>
              <div className="kb-flow-body">
                <h3>Klant naar customer base</h3>
                <p>Zodra alle vereiste velden gecheckt zijn, verplaats je de klant met één klik. HubSpot wordt geüpdatet en de klant verschijnt in de customer base met correcte facturatiedata.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className="kb-section" id="begrip">
          <h2>Algemeen begrip</h2>
          <p className="kb-lede">Een paar basisbegrippen die elke veldwaarde betekenis geven.</p>
          <div className="kb-rules">
            <div className="kb-rule-card">
              <div className="kb-rule-card-lbl">Begrip</div>
              <h3>Contractperiode = licentieperiode</h3>
              <p>Twee namen voor exact dezelfde periode. Begint zodra de proefperiode klaar is.</p>
            </div>
            <div className="kb-rule-card">
              <div className="kb-rule-card-lbl">Begrip</div>
              <h3>Proefperiode duurt 2 of 3 maanden</h3>
              <p>Daarna start het echte contract automatisch. De agent leest de looptijd uit de overeenkomst.</p>
            </div>
            <div className="kb-rule-card">
              <div className="kb-rule-card-lbl">Facturatie</div>
              <h3>Wie actief is, telt mee</h3>
              <p>We factureren alleen gebruikers die genoeg vragen stellen — minimaal het ingestelde minimum, maximaal het aantal uitgegeven accounts.</p>
            </div>
            <div className="kb-rule-card">
              <div className="kb-rule-card-lbl">Pricing</div>
              <h3>Prijs per gebruiker, of vaste prijs</h3>
              <p>Bijna altijd betaalt de klant per actieve gebruiker. Heel soms een vaste maandprijs — nooit allebei tegelijk.</p>
            </div>
          </div>
        </section>

        <section className="kb-section kb-spotlight" id="nieuwe-deal">
          <span className="kb-spotlight-tag">Cruciaal</span>
          <h2>Nieuwe deal uit oude deal — facturatie-regel</h2>
          <p>
            Verandert de prijs, het aantal accounts of een andere belangrijke afspraak?
            Dan maak je <b>altijd</b> een nieuwe deal. Een bestaande deal aanpassen mag niet —
            anders raakt de facturatie verstrengeld.
          </p>
          <div className="kb-spotlight-timeline">
            <div className="kb-tl-block old">
              <div className="kb-tl-lbl">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                </svg>
                Oude deal
              </div>
              <h4>Eindigt op de <em>laatste</em> dag van de maand</h4>
              <p>Bijv. <code>einddatum</code> = 31-05-2026. Geen middendagen.</p>
            </div>
            <div className="kb-tl-block new">
              <div className="kb-tl-lbl">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
                  <path d="M3 7a2 2 0 0 1 2-2h6l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/>
                </svg>
                Nieuwe deal
              </div>
              <h4>Start op de <em>eerste</em> dag van de volgende maand</h4>
              <p>Bijv. <code>startdatum</code> = 01-06-2026. Naadloos, niet overlappend.</p>
            </div>
          </div>
          <div className="kb-spotlight-callout">
            <div className="kb-spotlight-callout-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
              </svg>
            </div>
            <p>
              <b>Principe: altijd gunstig voor de klant.</b> Wordt het nieuwe tarief gunstiger? Dan
              mag de nieuwe deal eerder ingaan. Wordt het ongunstiger? Dan gaat de nieuwe deal pas in
              vanaf de volgende maand — klant heeft het oude (betere) tarief nog mee.
            </p>
          </div>
        </section>

        <section className="kb-section" id="afhankelijkheden">
          <h2>Veld-afhankelijkheden</h2>
          <p className="kb-lede">Vijf regels die de agent altijd respecteert — zo lopen je velden nooit uit de pas.</p>
          <div className="kb-deps">
            <Dep code1="licentieprijs_per_gebruiker" op="óf" code2="vaste_licentieprijs_maand"
                 desc="Vul één in, niet allebei. Usage-based óf vaste maandprijs." />
            <Dep code1="einddatum_proefperiode" op="=" code2="startdatum_proefperiode" op2="+" code3="looptijd"
                 desc="Wordt automatisch berekend, je hoeft 'm niet apart op te zoeken." />
            <Dep code1="startdatum" op="=" code2="einddatum_proefperiode" op2="+ 1 dag"
                 desc="Het echte contract begint altijd dag-na-proef." extraLeft=" (contract)" />
            <Dep code1="einddatum" op="leeg"
                 desc="Standaard leeg laten — alleen invullen als er expliciet een einddatum is afgesproken." extraLeft=" (contract)" />
            <Dep code1="threshold contract" op="≈" code2="threshold proef"
                 desc="Bijna altijd dezelfde drempel als in de proefperiode." />
          </div>
        </section>

        <section className="kb-section" id="bronnen">
          <h2>Bronnen die de agent gebruikt</h2>
          <p className="kb-lede">Per veld zie je in Klantbase precies welke bron de agent gebruikt heeft. Dit zijn de plekken waar hij naar kijkt.</p>
          <div className="kb-sources-grid">
            <SourceCard kind="doc" title="Licentieovereenkomst (PDF)" desc="De contracttekst zelf — voor looptijd, prijzen, drempels, kortingen en minimums." />
            <SourceCard kind="hub" title="HubSpot deal-historie" desc="Notities, e-mails en activiteit op de deal — voor afwijkende afspraken zoals jaarlijkse facturatie of een vaste prijs." />
            <SourceCard kind="comp" title="HubSpot company-record" desc="Welk DMS de klant gebruikt, hoe groot het kantoor is, en welke contactpersonen er zijn." />
            <SourceCard kind="dash" title="Dashboard (later automatisch)" desc="Voor het actuele aantal accounts. Voor nu nog handmatig invullen, straks komt het automatisch uit het dashboard." />
          </div>
        </section>
      </div>
    </>
  )
}

function Dep({ code1, op, code2, op2, code3, desc, extraLeft = '' }) {
  return (
    <div className="kb-dep">
      <div className="kb-dep-l">
        <code>{code1}</code>{extraLeft && <span style={{ color: 'var(--kb-n500)', marginLeft: 4 }}>{extraLeft}</span>}
        {op && <span className="op">{op}</span>}
        {code2 && <code>{code2}</code>}
        {op2 && <span className="op">{op2}</span>}
        {code3 && <code>{code3}</code>}
      </div>
      <div className="kb-dep-r">{desc}</div>
    </div>
  )
}

function SourceCard({ kind, title, desc }) {
  const icons = {
    doc:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>,
    hub:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/></svg>,
    comp: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><rect x="9" y="11" width="6" height="10"/></svg>,
    dash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-5"/></svg>,
  }
  return (
    <div className="kb-source-card">
      <div className={`kb-source-card-ic ${kind}`}>{icons[kind]}</div>
      <div>
        <h4>{title}</h4>
        <p>{desc}</p>
      </div>
    </div>
  )
}

function VeldenContent({ onSwitch }) {
  const byGroup = {}
  FIELDS_DEF.forEach(f => { (byGroup[f.group] ||= []).push(f) })

  // TOC scroll-aware
  const [active, setActive] = useState(GROUP_ORDER[0])
  const slug = (g) => 'g-' + g.toLowerCase().replace(/[^a-z]+/g, '-')
  function scrollTo(g) {
    setActive(g)
    const el = document.getElementById(slug(g))
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <nav className="kb-toc">
        <h4>Op deze pagina</h4>
        {GROUP_ORDER.filter(g => byGroup[g]).map(g => (
          <a key={g} className={active === g ? 'is-active' : ''} onClick={() => scrollTo(g)}>{g}</a>
        ))}
      </nav>
      <div className="kb-main-col">
        <Hero onSwitch={onSwitch} tab="velden">
          <h1>Alle velden, één voor één</h1>
          <p>
            Naslagwerk per veld — wat het is, of het verplicht is, welke opties er zijn en hoe het
            samenhangt met andere velden. Open in Klantbase een veld om naar de detail-uitleg te springen.
          </p>
        </Hero>

        {GROUP_ORDER.filter(g => byGroup[g]).map(g => (
          <div key={g} className="kb-fields-group" id={slug(g)}>
            <h3>
              {g}
              <span className="kb-grp-count">{byGroup[g].length} velden</span>
            </h3>
            {byGroup[g].map(f => (
              <div key={f.key} className="kb-field-row" id={`f-${f.key}`}>
                <div className="kb-field-l">
                  <div className="kb-field-l-name">{f.label}</div>
                  <div className="kb-field-l-key">{f.key}</div>
                  <div className="kb-field-l-meta">
                    <span className="kb-tag type">{f.type}</span>
                    {f.req && <span className="kb-tag req">verplicht</span>}
                    {f.xor && <span className="kb-tag xor">XOR · {f.xor}</span>}
                    {f.computed && <span className="kb-tag computed">auto · {f.computed}</span>}
                  </div>
                </div>
                <div className="kb-field-r">
                  <p>{f.uitleg || '—'}</p>
                  {f.options && (
                    <div className="opts">
                      {f.options.map(o => <span key={o} className="opt">{o}</span>)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
