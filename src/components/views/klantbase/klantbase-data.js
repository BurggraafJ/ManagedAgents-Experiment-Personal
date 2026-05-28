/* ============================================================
   klantbase-data.js — Sample data voor Klantbase-view (UI-fase)
   Port van mockup app/klantbase-data.js. Vervangt later door
   live data uit Supabase / HubSpot via een hook.
   ============================================================ */

/* Single source of truth voor velddefinities */
export const FIELDS_DEF = [
  /* === Pricing & Licenties === */
  {
    key: 'licentieprijs_per_gebruiker', group: 'Pricing & licenties',
    label: 'Licentieprijs per gebruiker', type: 'euro', req: true,
    xor: 'vaste_licentieprijs_maand',
    uitleg: 'Wat we per actieve gebruiker per maand factureren. Geldt zowel tijdens de proefperiode als tijdens het contract. Belangrijk: deze prijs verandert nóóit binnen dezelfde deal. Wijzigt de prijs? Dan komt er een nieuwe deal en sluit de oude.',
  },
  {
    key: 'vaste_licentieprijs_maand', group: 'Pricing & licenties',
    label: 'Vaste licentieprijs per maand', type: 'euro', req: false,
    xor: 'licentieprijs_per_gebruiker',
    uitleg: 'Één vast bedrag per maand voor de hele klant, in plaats van per actieve gebruiker. Komt bijna nooit voor — alleen bij een speciale afspraak. Vul deze óf de prijs-per-gebruiker in, niet allebei.',
  },
  {
    key: 'omvang_licentieperiode', group: 'Pricing & licenties',
    label: '# Accounts (licentieperiode)', type: 'int', req: true,
    uitleg: 'Hoeveel accounts de klant in totaal heeft voor de contractperiode. Vul je voor nu handmatig in — later komt dit automatisch uit het dashboard.',
  },
  {
    key: 'minimale_licenties_licentieperiode', group: 'Pricing & licenties',
    label: 'Minimale licenties (licentieperiode)', type: 'int', req: true,
    uitleg: 'De ondergrens: voor zoveel licenties betaalt de klant sowieso, ook als er minder mensen actief zijn. Boven dit minimum rekenen we per actieve gebruiker.',
  },

  /* === Contract-structuur === */
  {
    key: 'type_contract_jm', group: 'Contract-structuur',
    label: 'Type contract (J/M)', type: 'select', req: true,
    options: ['Maandelijks', 'Jaarlijks'],
    uitleg: 'Krijgt de klant elke maand of elke jaar een factuur. Bijna altijd maandelijks. Alleen op "Jaarlijks" zetten als de klant daar zelf om vraagt — vooral bij 1-pitters die niet elke maand een factuur willen verwerken.',
  },
  {
    key: 'startdatum', group: 'Contract-structuur',
    label: 'Startdatum contract', type: 'date', req: true,
    computed: 'einddatum_proefperiode + 1 dag',
    uitleg: 'De eerste dag dat het echte contract loopt. Altijd de dag ná de proefperiode. Bij een nieuwe deal die een oude vervangt: altijd de 1e van een maand.',
  },
  {
    key: 'einddatum', group: 'Contract-structuur',
    label: 'Einddatum contract', type: 'date', req: false,
    uitleg: 'Alleen invullen als er specifiek een einddatum is afgesproken. Standaard leeg laten — het contract loopt dan gewoon door. Bij het vervangen door een nieuwe deal: zet hier de laatste dag van de maand neer.',
  },

  /* === DMS-integratie === */
  {
    key: 'dms_actief', group: 'DMS-integratie',
    label: 'DMS actief', type: 'select', req: true,
    options: ['Geen interesse', 'Aangevraagd', 'In behandeling', 'Actief', 'Niet mogelijk met hun DMS voor nu'],
    uitleg: 'Status van de koppeling met het document-systeem van de klant. Géén ja/nee — vijf mogelijke statussen. Bij nieuwe klanten meestal "Actief" of "Aangevraagd".',
  },
  {
    key: 'type_dms', group: 'DMS-integratie',
    label: 'Type DMS', type: 'select', req: true,
    options: ['Heeft geen DMS', 'iManage', 'Urios', 'Sharepoint', 'Google Drive', 'BaseNet', 'CCLaw', 'Hammock', 'Cicero', 'Epona', 'Kleos', 'NextMatters (NEXTLegal)', 'Onbekend'],
    uitleg: 'Welk document-systeem het kantoor gebruikt. Te achterhalen uit eerder contact, het contract of de notities op de company.',
  },
  {
    key: 'dms_integratie_prijs', group: 'DMS-integratie',
    label: 'DMS-integratie prijs', type: 'euro', req: false,
    uitleg: 'Wat we extra per maand rekenen voor de DMS-koppeling, bovenop de licentieprijs.',
  },

  /* === Proefperiode === */
  {
    key: 'looptijd_proefperiode_maanden', group: 'Proefperiode',
    label: 'Looptijd proefperiode (mnd)', type: 'int', req: true,
    uitleg: 'Hoe lang de proefperiode duurt, in maanden. Vrijwel altijd 2 of 3. Staat in de licentieovereenkomst.',
  },
  {
    key: 'startdatum_proefperiode', group: 'Proefperiode',
    label: 'Startdatum proefperiode', type: 'date', req: true,
    uitleg: 'Eerste dag van de proefperiode.',
  },
  {
    key: 'einddatum_proefperiode', group: 'Proefperiode',
    label: 'Einddatum proefperiode', type: 'date', req: true,
    computed: 'startdatum_proefperiode + looptijd_proefperiode_maanden',
    uitleg: 'Laatste dag van de proefperiode. Wordt automatisch berekend. De dag erna start het contract.',
  },
  {
    key: 'omvang_proefperiode', group: 'Proefperiode',
    label: '# Accounts (proefperiode)', type: 'int', req: true,
    uitleg: 'Hoeveel accounts de klant gebruikt tijdens de proefperiode.',
  },
  {
    key: 'vaste_prijs_proefperiode_maand', group: 'Proefperiode',
    label: 'Vaste prijs proefperiode (mnd)', type: 'euro', req: false,
    uitleg: 'Één vast bedrag per maand voor de hele proefperiode, in plaats van per actieve gebruiker. Zelden gebruikt.',
  },
  {
    key: 'vragen_treshold_per_gebruiker_proefperiode', group: 'Proefperiode',
    label: 'Vragen-threshold per gebruiker (proef)', type: 'int', req: true,
    uitleg: 'Hoeveel vragen een gebruiker tijdens de proefperiode moet stellen om als "actief" mee te tellen.',
  },
  {
    key: 'korting_proefperiode_procent', group: 'Proefperiode',
    label: 'Korting proefperiode (%)', type: 'percent', req: false,
    uitleg: 'Eventueel afgesproken korting in procent tijdens de proefperiode, op de normale licentieprijs.',
  },

  /* === Activiteits-metric === */
  {
    key: 'permanent_actief', group: 'Activiteits-metric',
    label: 'Permanent actief', type: 'select', req: true, options: ['Yes', 'No'],
    uitleg: 'Bij nieuwe contracten altijd "Yes". Vroeger kon een gebruiker na 3 maanden zonder activiteit weer als inactief worden gezet ("No"); dat doen we niet meer — eenmaal actief is voor altijd actief.',
  },
  {
    key: 'vragen_treshold_per_gebruiker_licentieperiode', group: 'Activiteits-metric',
    label: 'Vragen-threshold per gebruiker (licentieperiode)', type: 'int', req: true,
    uitleg: 'Hoeveel vragen een gebruiker tijdens het contract moet stellen om als "actief" mee te tellen — en dus mee te tellen in de facturatie. Vrijwel altijd dezelfde drempel als tijdens de proefperiode.',
  },
]

export const GROUP_ORDER = [
  'Pricing & licenties',
  'Contract-structuur',
  'DMS-integratie',
  'Proefperiode',
  'Activiteits-metric',
]

/* Bronnen (waar de agent uit put) */
export const SOURCES = {
  loa:         { type: 'doc',     label: 'Licentieovereenkomst.pdf',  page: 'art. 4' },
  loaProef:    { type: 'doc',     label: 'Licentieovereenkomst.pdf',  page: 'art. 2' },
  loaPrijs:    { type: 'doc',     label: 'Licentieovereenkomst.pdf',  page: 'art. 4.1' },
  loaMin:      { type: 'doc',     label: 'Licentieovereenkomst.pdf',  page: 'art. 4.3' },
  addendum:    { type: 'doc',     label: 'Addendum DMS.pdf',          page: 'p.1' },
  hubspotDeal: { type: 'hubspot', label: 'HubSpot deal-record',       page: 'eigenschap' },
  hubspotComp: { type: 'hubspot', label: 'HubSpot company-record',    page: 'note 12 mei' },
  mailJoost:   { type: 'mail',    label: 'Mail van Joost — 12 mei',   page: 'kickoff' },
  mailReply:   { type: 'mail',    label: 'Reply contract — 8 mei',    page: '' },
  cpeIntake:   { type: 'doc',     label: 'CPE-intake.docx',           page: '§ 2' },
  callNotes:   { type: 'call',    label: 'Belnotitie 6 mei',          page: 'gesprek Joost' },
  dashboard:   { type: 'hubspot', label: 'Dashboard — accounts API',  page: 'live' },
}

/* Helper — bouw een veld-instantie uit een waarde-tuple */
function mkField(key, status, proposed, current, srcKey, reason, sources) {
  const def = FIELDS_DEF.find(f => f.key === key) || {}
  return {
    key, status, proposed, current: current ?? null,
    srcKey, reason, sources: sources || [srcKey],
    label: def.label, group: def.group, type: def.type, req: def.req,
    options: def.options, xor: def.xor, computed: def.computed, uitleg: def.uitleg,
  }
}

/* Bouw de volledige 19-veldenset met defaults */
function buildFields(values) {
  return FIELDS_DEF.map(def => {
    const v = values[def.key]
    if (!v) return mkField(def.key, 'pending', '—', null, 'hubspotDeal', '(nog niet bepaald)', ['hubspotDeal'])
    return mkField(def.key, v[0], v[1], v[2] || null, v[3] || 'loa', v[4] || '', v[5] || null)
  })
}

/* ============================================================
   DEALS — OVERDRACHT (sales pipeline → customer base)
   ============================================================ */
export const DEALS_OVER = [
  {
    id: 'D-1042', company: 'Van Eldijk & Partners',
    avCls: 'av-2', avInit: 'VE',
    domain: 'vaneldijk.nl',
    hubspot: 'https://app.hubspot.com/deals/12345',
    stage: 'Closed Won',
    closedAt: '24 mei 2026',
    dueDate: '31 mei 2026',
    dueLabel: 'Voor maandafsluiting',
    dueUrg: true,
    aiRun: '2u geleden',
    aiSources: 4,
    aiSummary: 'Op basis van 4 bronnen — licentieovereenkomst, HubSpot, CPE-intake en mailwisseling — heeft de agent alle 19 velden ingevuld. 5 daarvan vragen om een handmatige check.',
    filter: 'urg',
    fields: buildFields({
      licentieprijs_per_gebruiker:        ['approved', '€ 95', null, 'loaPrijs', 'Standaard tarief van €95 per actieve gebruiker per maand, expliciet in {{cite}}.', ['loaPrijs', 'hubspotDeal']],
      vaste_licentieprijs_maand:          ['approved', '—',    null, 'loa', 'Niet van toepassing — XOR-veld. Klant zit op usage-based volgens {{cite}}.', ['loa']],
      omvang_licentieperiode:             ['approved', '5',    null, 'cpeIntake', '5 accounts in {{cite}} (gebruikerslijst), bevestigd in HubSpot company-record.', ['cpeIntake', 'hubspotComp']],
      minimale_licenties_licentieperiode: ['pending',  '3',    null, 'loaMin', 'Minimum van 3 licenties in {{cite}}, art. 4.3 ("minimum afname per maand").', ['loaMin']],
      type_contract_jm:                   ['approved', 'Maandelijks', null, 'loa', 'Standaard maandelijkse facturatie in {{cite}}. Geen verzoek voor jaarlijks.', ['loa', 'hubspotDeal']],
      startdatum:                         ['approved', '01-06-2026',  null, 'loa', 'Dag na einde proefperiode (31-05-2026 + 1 = 01-06-2026), conform regel.', ['loa']],
      einddatum:                          ['approved', '—',           null, 'loa', 'Geen afwijkend einde afgesproken — veld blijft leeg, contract loopt door.', ['loa']],
      dms_actief:                         ['pending',  'Aangevraagd', null, 'mailJoost', 'Joost schrijft in {{cite}} "we willen graag dat de iManage-integratie wordt opgezet". Status dus Aangevraagd.', ['mailJoost', 'hubspotComp']],
      type_dms:                           ['approved', 'iManage',     null, 'hubspotComp', 'Company-record: DMS = iManage. Bevestigd in {{cite}}.', ['hubspotComp', 'mailJoost']],
      dms_integratie_prijs:               ['pending',  '€ 75',        null, 'addendum', 'In {{cite}} bevestigd: €75/mnd voor de iManage-koppeling.', ['addendum']],
      looptijd_proefperiode_maanden:      ['approved', '3', null, 'loaProef', 'Proefperiode van 3 maanden, conform {{cite}}.', ['loaProef']],
      startdatum_proefperiode:            ['approved', '01-03-2026', null, 'loaProef', 'Start 1 maart 2026 in {{cite}}.', ['loaProef']],
      einddatum_proefperiode:             ['approved', '31-05-2026', null, 'loaProef', 'Berekend uit startdatum + 3 maanden (computed-veld).', ['loaProef']],
      omvang_proefperiode:                ['approved', '5', null, 'cpeIntake', '5 accounts ook tijdens proef — zie {{cite}}.', ['cpeIntake']],
      vaste_prijs_proefperiode_maand:     ['approved', '—', null, 'loa', 'Niet van toepassing — usage-based.', ['loa']],
      vragen_treshold_per_gebruiker_proefperiode: ['pending', '10', null, 'loa', '10 vragen per gebruiker per maand om als actief te tellen, art. 5.2 in {{cite}}.', ['loa']],
      korting_proefperiode_procent:       ['pending', '50%', null, 'mailJoost', '50% korting tijdens proef — afspraak met Joost in {{cite}} ("we doen de pilot tegen halve prijs").', ['mailJoost']],
      permanent_actief:                   ['approved', 'Yes', null, 'loa', 'Standaard "Yes" voor alle nieuwe contracten.', ['loa']],
      vragen_treshold_per_gebruiker_licentieperiode: ['approved', '10', null, 'loa', 'Gelijk aan proefperiode-threshold — standaard.', ['loa']],
    }),
  },
  {
    id: 'D-1051', company: 'Bos Vastgoedbeheer',
    avCls: 'av-4', avInit: 'BV',
    domain: 'bosvastgoed.nl',
    hubspot: 'https://app.hubspot.com/deals/12351',
    stage: 'Closed Won',
    closedAt: '23 mei 2026',
    dueDate: '31 mei 2026',
    dueLabel: 'Voor maandafsluiting',
    dueUrg: true,
    aiRun: '38 min geleden',
    aiSources: 3,
    aiSummary: '3 bronnen — licentieovereenkomst, HubSpot en mail. Twee tegenstrijdigheden: korting in mail wijkt af van overeenkomst; type DMS onbekend.',
    filter: 'check',
    fields: buildFields({
      licentieprijs_per_gebruiker:        ['pending', '€ 95', null, 'loaPrijs', 'Standaardtarief.', ['loaPrijs']],
      vaste_licentieprijs_maand:          ['approved', '—',    null, 'loa', 'XOR, niet ingevuld.', ['loa']],
      omvang_licentieperiode:             ['pending', '3',    null, 'cpeIntake', '3 accounts uit intake.', ['cpeIntake']],
      minimale_licenties_licentieperiode: ['pending', '2',    null, 'loaMin', '2 minimum afgesproken in {{cite}}.', ['loaMin']],
      type_contract_jm:                   ['pending', 'Maandelijks', null, 'loa', 'Maandelijks.', ['loa']],
      startdatum:                         ['pending', '01-07-2026', null, 'loa', 'Dag na proef = 01-07.', ['loa']],
      einddatum:                          ['pending', '—', null, 'loa', 'Geen afwijking.', ['loa']],
      dms_actief:                         ['pending', 'Geen interesse', null, 'callNotes', 'Joost meldt geen DMS-koppeling te willen — {{cite}}.', ['callNotes']],
      type_dms:                           ['pending', 'Onbekend',  null, 'hubspotComp', 'Niet vermeld in company-notes — onbekend.', ['hubspotComp']],
      dms_integratie_prijs:               ['approved', '€ 0', null, 'loa', 'Geen DMS-koppeling, dus geen kosten.', ['loa']],
      looptijd_proefperiode_maanden:      ['pending', '2', null, 'loaProef', '2 maanden proef in {{cite}}.', ['loaProef']],
      startdatum_proefperiode:            ['pending', '01-05-2026', null, 'loaProef', '1 mei start.', ['loaProef']],
      einddatum_proefperiode:             ['pending', '30-06-2026', null, 'loaProef', 'Berekend.', ['loaProef']],
      omvang_proefperiode:                ['pending', '3', null, 'cpeIntake', '3 accounts.', ['cpeIntake']],
      vaste_prijs_proefperiode_maand:     ['approved', '—', null, 'loa', 'Niet van toepassing.', ['loa']],
      vragen_treshold_per_gebruiker_proefperiode: ['pending', '10', null, 'loa', 'Standaard 10.', ['loa']],
      korting_proefperiode_procent:       ['pending', '15%', null, 'mailReply', '⚠️ Conflict: {{cite}} noemt 15% — maar in de licentieovereenkomst is 0% afgesproken.', ['mailReply', 'loa']],
      permanent_actief:                   ['approved', 'Yes', null, 'loa', 'Standaard Yes.', ['loa']],
      vragen_treshold_per_gebruiker_licentieperiode: ['approved', '10', null, 'loa', '10.', ['loa']],
    }),
  },
  {
    id: 'D-1058', company: 'Notarissen Den Haag',
    avCls: 'av-5', avInit: 'NH',
    domain: 'ndh.nl', hubspot: 'https://app.hubspot.com/deals/12358',
    stage: 'Closed Won', closedAt: '22 mei 2026', dueDate: '04 jun 2026',
    dueLabel: 'Komende week', dueUrg: false,
    aiRun: '5u geleden', aiSources: 5,
    aiSummary: 'Volledig contract + 2 mails + telefoonnotities + addendum verwerkt. Alle 19 velden ingevuld met hoge zekerheid — geen handmatige check nodig.',
    filter: 'ready',
    fields: buildFields({
      licentieprijs_per_gebruiker:        ['approved', '€ 95', null, 'loaPrijs', 'Standaard €95.', ['loaPrijs']],
      vaste_licentieprijs_maand:          ['approved', '—', null, 'loa', 'XOR.', ['loa']],
      omvang_licentieperiode:             ['approved', '12', null, 'cpeIntake', '12 accounts.', ['cpeIntake']],
      minimale_licenties_licentieperiode: ['approved', '8', null, 'loaMin', 'Minimum 8 in {{cite}}.', ['loaMin']],
      type_contract_jm:                   ['approved', 'Maandelijks', null, 'loa', 'Maandelijks.', ['loa']],
      startdatum:                         ['approved', '01-07-2026', null, 'loa', '1 juli start.', ['loa']],
      einddatum:                          ['approved', '—', null, 'loa', 'Geen afwijkend einde.', ['loa']],
      dms_actief:                         ['approved', 'Actief', null, 'addendum', 'DMS actief volgens {{cite}}.', ['addendum']],
      type_dms:                           ['approved', 'iManage', null, 'hubspotComp', 'iManage.', ['hubspotComp']],
      dms_integratie_prijs:               ['approved', '€ 75', null, 'addendum', '€75/mnd in {{cite}}.', ['addendum']],
      looptijd_proefperiode_maanden:      ['approved', '3', null, 'loaProef', '3 maanden.', ['loaProef']],
      startdatum_proefperiode:            ['approved', '01-04-2026', null, 'loaProef', '1 april.', ['loaProef']],
      einddatum_proefperiode:             ['approved', '30-06-2026', null, 'loaProef', 'Berekend.', ['loaProef']],
      omvang_proefperiode:                ['approved', '12', null, 'cpeIntake', '12 accounts.', ['cpeIntake']],
      vaste_prijs_proefperiode_maand:     ['approved', '—', null, 'loa', 'Niet van toepassing.', ['loa']],
      vragen_treshold_per_gebruiker_proefperiode: ['approved', '10', null, 'loa', 'Standaard 10.', ['loa']],
      korting_proefperiode_procent:       ['approved', '50%', null, 'mailJoost', '50% korting bevestigd in {{cite}}.', ['mailJoost']],
      permanent_actief:                   ['approved', 'Yes', null, 'loa', 'Yes.', ['loa']],
      vragen_treshold_per_gebruiker_licentieperiode: ['approved', '10', null, 'loa', '10.', ['loa']],
    }),
  },
  {
    id: 'D-1060', company: 'Westra Advocaten',
    avCls: 'av-1', avInit: 'WA',
    domain: 'westra-advocaten.nl', hubspot: 'https://app.hubspot.com/deals/12360',
    stage: 'Closed Won', closedAt: '20 mei 2026', dueDate: '07 jun 2026',
    dueLabel: 'Komende week', dueUrg: false,
    aiRun: '1d geleden', aiSources: 2,
    aiSummary: 'Beperkte data — alleen licentieovereenkomst en HubSpot. 4 velden zonder harde bron, mogelijk handmatig invullen.',
    filter: 'check',
    fields: buildFields({
      licentieprijs_per_gebruiker:        ['approved', '€ 95', null, 'loaPrijs', 'Standaard tarief.', ['loaPrijs']],
      vaste_licentieprijs_maand:          ['approved', '—', null, 'loa', 'XOR.', ['loa']],
      omvang_licentieperiode:             ['pending', '2', null, 'hubspotComp', '2 contacten in HubSpot — als users aangenomen.', ['hubspotComp']],
      minimale_licenties_licentieperiode: ['pending', '2', null, 'loaMin', 'Minimum 2.', ['loaMin']],
      type_contract_jm:                   ['approved', 'Maandelijks', null, 'loa', 'Maandelijks.', ['loa']],
      startdatum:                         ['approved', '01-06-2026', null, 'loa', '1 juni.', ['loa']],
      einddatum:                          ['approved', '—', null, 'loa', 'Leeg.', ['loa']],
      dms_actief:                         ['pending', 'Geen interesse', null, 'callNotes', 'Geen DMS-koppeling gewenst.', ['callNotes']],
      type_dms:                           ['pending', 'Heeft geen DMS', null, 'hubspotComp', 'Geen DMS bekend.', ['hubspotComp']],
      dms_integratie_prijs:               ['approved', '€ 0', null, 'loa', 'Geen DMS-kosten.', ['loa']],
      looptijd_proefperiode_maanden:      ['pending', '2', null, 'loaProef', '2 maanden.', ['loaProef']],
      startdatum_proefperiode:            ['pending', '01-04-2026', null, 'loaProef', '1 april.', ['loaProef']],
      einddatum_proefperiode:             ['pending', '31-05-2026', null, 'loaProef', 'Berekend.', ['loaProef']],
      omvang_proefperiode:                ['pending', '2', null, 'cpeIntake', '2 accounts.', ['cpeIntake']],
      vaste_prijs_proefperiode_maand:     ['approved', '—', null, 'loa', 'Niet van toepassing.', ['loa']],
      vragen_treshold_per_gebruiker_proefperiode: ['pending', '10', null, 'loa', '10.', ['loa']],
      korting_proefperiode_procent:       ['pending', '0%', null, 'loa', 'Geen korting.', ['loa']],
      permanent_actief:                   ['approved', 'Yes', null, 'loa', 'Yes.', ['loa']],
      vragen_treshold_per_gebruiker_licentieperiode: ['approved', '10', null, 'loa', '10.', ['loa']],
    }),
  },
  {
    id: 'D-1063', company: 'Gemeente Almere — Juridische Zaken',
    avCls: 'av-3', avInit: 'GA',
    domain: 'almere.nl', hubspot: 'https://app.hubspot.com/deals/12363',
    stage: 'Closed Won', closedAt: '18 mei 2026', dueDate: '21 jun 2026',
    dueLabel: 'Wacht op accordering', dueUrg: false,
    aiRun: '3d geleden', aiSources: 3,
    aiSummary: 'Overheidsklant — wacht op formele accordering door inkoop voordat we kunnen verplaatsen. Concept-voorstellen klaar; vaste maandprijs in plaats van usage-based.',
    filter: 'hold',
    fields: buildFields({
      licentieprijs_per_gebruiker:        ['approved', '—', null, 'loa', 'XOR — vaste prijs gebruikt.', ['loa']],
      vaste_licentieprijs_maand:          ['pending', '€ 3.100', null, 'loa', 'Aanbestedingsovereenkomst: vaste prijs van €3.100/mnd in {{cite}}.', ['loa']],
      omvang_licentieperiode:             ['pending', '18', null, 'cpeIntake', '18 accounts in intake.', ['cpeIntake']],
      minimale_licenties_licentieperiode: ['pending', '15', null, 'loaMin', 'Minimum 15.', ['loaMin']],
      type_contract_jm:                   ['pending', 'Jaarlijks', null, 'mailReply', 'Klant wil jaarfactuur — bevestigd in {{cite}}.', ['mailReply']],
      startdatum:                         ['pending', '01-09-2026', null, 'loa', 'Start na zomer.', ['loa']],
      einddatum:                          ['pending', '31-08-2028', null, 'loa', '2-jarig contract.', ['loa']],
      dms_actief:                         ['pending', 'In behandeling', null, 'addendum', 'SSO en DMS-koppeling in behandeling.', ['addendum']],
      type_dms:                           ['pending', 'Sharepoint', null, 'hubspotComp', 'Sharepoint op kantoor.', ['hubspotComp']],
      dms_integratie_prijs:               ['pending', '€ 150', null, 'addendum', '€150/mnd voor SharePoint-koppeling met SSO.', ['addendum']],
      looptijd_proefperiode_maanden:      ['pending', '3', null, 'loaProef', '3 maanden.', ['loaProef']],
      startdatum_proefperiode:            ['pending', '01-06-2026', null, 'loaProef', '1 juni.', ['loaProef']],
      einddatum_proefperiode:             ['pending', '31-08-2026', null, 'loaProef', 'Berekend.', ['loaProef']],
      omvang_proefperiode:                ['pending', '18', null, 'cpeIntake', '18 accounts.', ['cpeIntake']],
      vaste_prijs_proefperiode_maand:     ['pending', '€ 1.500', null, 'loa', 'Vaste pilotprijs €1.500/mnd.', ['loa']],
      vragen_treshold_per_gebruiker_proefperiode: ['pending', '15', null, 'loa', '15 vragen — afwijkend, overheidsklant.', ['loa']],
      korting_proefperiode_procent:       ['pending', '0%', null, 'loa', 'Geen extra korting.', ['loa']],
      permanent_actief:                   ['approved', 'Yes', null, 'loa', 'Yes.', ['loa']],
      vragen_treshold_per_gebruiker_licentieperiode: ['approved', '15', null, 'loa', 'Gelijk aan proef.', ['loa']],
    }),
  },
]

/* ============================================================
   DEALS — VERLENGING (oude deal vervangen door nieuwe)
   ============================================================ */
export const DEALS_REN = [
  {
    id: 'R-2031', company: 'Kuiper Notarissen',
    avCls: 'av-6', avInit: 'KN',
    domain: 'kuipernotarissen.nl', hubspot: 'https://app.hubspot.com/deals/22001',
    oldDealName: 'Kuiper — Pilot 3mnd', oldDealStage: 'Customer (Pilot)',
    closedAt: '24 mei 2026', dueDate: '01 jun 2026',
    dueLabel: 'Pilot eindigt — nieuwe deal vereist', dueUrg: true,
    aiRun: '1u geleden', aiSources: 4,
    aiSummary: 'De pilot eindigt op 31 mei. De agent voorspelt op basis van licentieovereenkomst, mail en gebruiksdata een nieuwe deal met regulier tarief €95/gebruiker, dezelfde 4 accounts en losse DMS-koppeling.',
    renBasis: 'Voorspelling op basis van licentieovereenkomst (art. 4–6), mail van Joost van 12 mei, en pilot-gebruiksdata uit het dashboard.',
    proposedFrom: '01-06-2026', oldEnds: '31-05-2026',
    filter: 'urg',
    fields: buildFields({
      licentieprijs_per_gebruiker:        ['pending', '€ 95', '€ 47,50', 'loaPrijs', 'Reguliere tarief €95 na pilot (was 50% korting, dus €47,50).', ['loaPrijs', 'mailJoost']],
      vaste_licentieprijs_maand:          ['approved', '—', '—', 'loa', 'XOR — niet gewijzigd.', ['loa']],
      omvang_licentieperiode:             ['pending', '4', '4', 'cpeIntake', 'Aantal accounts blijft 4 — geen uitbreiding tijdens pilot.', ['cpeIntake']],
      minimale_licenties_licentieperiode: ['pending', '3', 'n.v.t.', 'loaMin', 'Minimum van 3 voor de licentieperiode.', ['loaMin']],
      type_contract_jm:                   ['pending', 'Maandelijks', 'Maandelijks', 'loa', 'Maandelijks — ongewijzigd.', ['loa']],
      startdatum:                         ['pending', '01-06-2026', '01-03-2026', 'loa', 'Nieuwe deal start 1 juni — exact de dag na het einde van de pilot.', ['loa']],
      einddatum:                          ['pending', '—', '31-05-2026', 'loa', 'Oude deal krijgt einddatum 31-05-2026.', ['loa']],
      dms_actief:                         ['pending', 'Aangevraagd', 'Geen interesse', 'mailJoost', 'Joost vraagt nu wel DMS-koppeling aan voor de jaar-periode — {{cite}}.', ['mailJoost']],
      type_dms:                           ['pending', 'Sharepoint', 'Sharepoint', 'hubspotComp', 'Sharepoint — ongewijzigd.', ['hubspotComp']],
      dms_integratie_prijs:               ['pending', '€ 75', '€ 0', 'addendum', '€75/mnd voor SharePoint-koppeling vanaf 1 juni.', ['addendum']],
      looptijd_proefperiode_maanden:      ['approved', '3', '3', 'loaProef', 'Historische pilot was 3 maanden — wordt niet aangepast.', ['loaProef']],
      startdatum_proefperiode:            ['approved', '01-03-2026', '01-03-2026', 'loaProef', 'Historisch — gelijk.', ['loaProef']],
      einddatum_proefperiode:             ['approved', '31-05-2026', '31-05-2026', 'loaProef', 'Historisch — gelijk.', ['loaProef']],
      omvang_proefperiode:                ['approved', '4', '4', 'cpeIntake', '4 accounts — gelijk.', ['cpeIntake']],
      vaste_prijs_proefperiode_maand:     ['approved', '—', '—', 'loa', 'Niet van toepassing.', ['loa']],
      vragen_treshold_per_gebruiker_proefperiode: ['approved', '10', '10', 'loa', '10 — gelijk.', ['loa']],
      korting_proefperiode_procent:       ['approved', '50%', '50%', 'mailJoost', '50% pilotkorting — historisch.', ['mailJoost']],
      permanent_actief:                   ['approved', 'Yes', 'Yes', 'loa', 'Yes.', ['loa']],
      vragen_treshold_per_gebruiker_licentieperiode: ['pending', '10', 'n.v.t.', 'loa', '10 in de nieuwe deal.', ['loa']],
    }),
  },
  {
    id: 'R-2034', company: 'De Vries & Co Advocaten',
    avCls: 'av-7', avInit: 'DV',
    domain: 'devriesadvocaten.nl', hubspot: 'https://app.hubspot.com/deals/22004',
    oldDealName: 'De Vries — Jaar 1', oldDealStage: 'Customer',
    closedAt: '22 mei 2026', dueDate: '01 jul 2026',
    dueLabel: 'Uitbreiding + DMS — Q3', dueUrg: false,
    aiRun: '4u geleden', aiSources: 5,
    aiSummary: 'Klant breidt uit van 4 naar 8 accounts en wil de iManage-koppeling activeren. Agent voorspelt een nieuwe deal vanaf 1 juli; oude deal sluit 30 juni.',
    renBasis: 'Voorspelling op basis van mailwisseling met de accountmanager, dashboard-data over actieve gebruikers, en bestaande HubSpot-deal.',
    proposedFrom: '01-07-2026', oldEnds: '30-06-2026',
    filter: 'check',
    fields: buildFields({
      licentieprijs_per_gebruiker:        ['pending', '€ 95', '€ 95', 'loaPrijs', 'Tarief blijft gelijk — geen prijswijziging, maar wel uitbreiding.', ['loaPrijs']],
      vaste_licentieprijs_maand:          ['approved', '—', '—', 'loa', 'XOR.', ['loa']],
      omvang_licentieperiode:             ['pending', '8', '4', 'mailReply', 'Uitbreiding naar 8 accounts — bevestigd in {{cite}}.', ['mailReply', 'dashboard']],
      minimale_licenties_licentieperiode: ['pending', '6', '3', 'mailReply', 'Nieuwe afspraak: minimum 6 (was 3).', ['mailReply']],
      type_contract_jm:                   ['approved', 'Maandelijks', 'Maandelijks', 'loa', 'Ongewijzigd.', ['loa']],
      startdatum:                         ['pending', '01-07-2026', '01-07-2025', 'loa', 'Nieuwe deal start 1 juli 2026.', ['loa']],
      einddatum:                          ['pending', '—', '30-06-2026', 'loa', 'Oude deal krijgt einddatum 30-06-2026.', ['loa']],
      dms_actief:                         ['pending', 'Aangevraagd', 'Geen interesse', 'mailReply', 'Klant vraagt nu wel iManage-koppeling — {{cite}}.', ['mailReply']],
      type_dms:                           ['pending', 'iManage', 'iManage', 'hubspotComp', 'iManage — ongewijzigd.', ['hubspotComp']],
      dms_integratie_prijs:               ['pending', '€ 75', '€ 0', 'addendum', '€75/mnd voor de koppeling.', ['addendum']],
      looptijd_proefperiode_maanden:      ['approved', '0', '3', 'loa', 'Geen nieuwe pilot.', ['loa']],
      startdatum_proefperiode:            ['approved', '—', '01-04-2025', 'loa', 'Niet van toepassing.', ['loa']],
      einddatum_proefperiode:             ['approved', '—', '30-06-2025', 'loa', 'Niet van toepassing.', ['loa']],
      omvang_proefperiode:                ['approved', '—', '4', 'loa', 'Niet van toepassing.', ['loa']],
      vaste_prijs_proefperiode_maand:     ['approved', '—', '—', 'loa', 'Niet van toepassing.', ['loa']],
      vragen_treshold_per_gebruiker_proefperiode: ['approved', '—', '10', 'loa', 'Niet van toepassing.', ['loa']],
      korting_proefperiode_procent:       ['approved', '—', '50%', 'loa', 'Niet van toepassing.', ['loa']],
      permanent_actief:                   ['approved', 'Yes', 'Yes', 'loa', 'Yes.', ['loa']],
      vragen_treshold_per_gebruiker_licentieperiode: ['approved', '10', '10', 'loa', '10 — ongewijzigd.', ['loa']],
    }),
  },
]
