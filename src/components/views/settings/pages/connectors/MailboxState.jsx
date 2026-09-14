// Multi-user M2 — wat je koppeling vandaag oplevert, in één regel boven de
// Connectors-lijst.
//
// De koppelrij zelf zegt "gekoppeld". Dat is waar en niet genoeg: tussen de
// consent-klik en de eerste mail in je Postvak zit een sync van minuten tot
// uren, en in die tijd ziet je Postvak er precies zo uit als bij iemand zonder
// koppeling. Deze regel maakt dat verschil zichtbaar — dezelfde eis als
// RESEARCH §4.2 ("maak leeg onderscheidbaar van geen recht"), maar dan voor de
// persoon zelf in plaats van voor de owner.
//
// Vijf toestanden, elk met één ding dat de lezer nu kan doen (of weten dat hij
// niets hoeft te doen). Geen toestand krijgt een spinner: "we weten het niet"
// is ook een antwoord, en het duurt één RPC.
const TEKST = {
  geen_recht: {
    kind: 'warn',
    kop: 'Je hebt geen Postvak-recht.',
    body: 'Koppelen kan wel, maar je mail komt nergens terecht zolang het recht "Postvak" niet aan staat. Vraag de owner het aan te vinken bij Organisatie › Rechten.',
  },
  niet_gekoppeld: {
    kind: 'info',
    kop: 'Nog geen mailbox gekoppeld.',
    body: 'Je Postvak en je Agenda blijven leeg tot je hieronder je Outlook koppelt. Dat is één Microsoft-login; daarna start de spiegel vanzelf.',
  },
  spiegelt_nog: {
    kind: 'info',
    kop: 'Gekoppeld — de eerste sync loopt nog.',
    body: 'Er staat nog geen mail in de spiegel. Dat is normaal vlak na het koppelen: de eerste ronde haalt je mappen op en de historie volgt daarna. Je Postvak blijft tot die tijd leeg, en dat betekent hier niet "geen mail".',
  },
  fout: {
    kind: 'warn',
    kop: 'De koppeling geeft een fout.',
    body: 'De spiegel is gestopt met ophalen. Koppel opnieuw; blijft het misgaan, laat het de owner weten — de foutmelding zelf staat alleen server-side.',
  },
  in_bedrijf: {
    kind: 'success',
    kop: 'Gekoppeld en in bedrijf.',
    body: null,
  },
}

function aantal(n) {
  return new Intl.NumberFormat('nl-NL').format(n || 0)
}

export default function MailboxState({ mailbox }) {
  const { fase, state, loading, error } = mailbox

  // Een fout hier is geen blokkade: de koppelrijen eronder werken gewoon. Stil
  // niets tonen is dan eerlijker dan een rode balk over een meting die niets
  // tegenhoudt.
  if (loading || error || fase === 'onbekend') return null

  const t = TEKST[fase]
  if (!t) return null

  return (
    <div className={`users-form__notice users-form__notice--${t.kind} conn-mailboxstate`}>
      <strong>{t.kop}</strong>{' '}
      {fase === 'in_bedrijf'
        ? <>{aantal(state.mails_gespiegeld)} mails gespiegeld{state.laatste_sync ? `, laatste ronde ${new Date(state.laatste_sync).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })}` : ''}.</>
        : t.body}
      {state?.gepauzeerd && (
        <div className="users-form__hint">
          De spiegel staat op pauze. Er komt niets bij; wat er staat blijft doorzoekbaar.
        </div>
      )}
    </div>
  )
}
