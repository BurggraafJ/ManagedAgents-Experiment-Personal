// Verzonnen taken met de vorm van de echte tabel: drie prio's bezet, een paar
// deadlines in elke bucket, één taak met een AI-voorstel voor de categorie,
// één met een beschrijving (die is het onderwerp van de detail-shots) en twee
// geparkeerde taken in de backlog. Geen klantnamen, geen echte gegevens.
const DAY = 86400000
const iso = (d) => new Date(Date.now() + d * DAY).toISOString()
const ymd = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10)

export const TASKS = [
  {
    id: 't-01', title: 'Offerte nalopen voor het middelgrote kantoor', priority: 'high', status: 'open',
    in_backlog: false, deadline: ymd(-1), deadline_kind: 'day', task_type: 'uitvoeren', task_type_suggested: false,
    notes: 'Tarieven uit het licentiemodel overnemen, de LE-dagen los benoemen en de looptijd op 12 maanden zetten.\n\nVragen die nog open staan:\n- gaat de pilot mee in het eerste jaar?\n- wie tekent er aan hun kant?',
    tags: ['offerte'], source: 'manual', project_id: null, created_at: iso(-4), updated_at: iso(-1),
    completion_candidate: false, ai_reasoning: null,
  },
  {
    id: 't-02', title: 'Terugbellen over de pilotverlenging', priority: 'high', status: 'open',
    in_backlog: false, deadline: ymd(0), deadline_kind: 'day', task_type: 'opvolgen', task_type_suggested: true,
    notes: null, tags: [], source: 'mail', project_id: null, created_at: iso(-2), updated_at: iso(0),
    completion_candidate: false, ai_reasoning: 'Uit de mailwisseling van dinsdag: zij wachten op een datum van ons.',
  },
  {
    id: 't-03', title: 'Demo-omgeving klaarzetten', priority: 'normal', status: 'open',
    in_backlog: false, deadline: ymd(1), deadline_kind: 'day', task_type: 'uitvoeren', task_type_suggested: false,
    notes: null, tags: [], source: 'manual', project_id: null, created_at: iso(-3), updated_at: iso(-1),
    completion_candidate: false, ai_reasoning: null,
  },
  {
    id: 't-04', title: 'Notulen van het partneroverleg rondsturen', priority: 'normal', status: 'open',
    in_backlog: false, deadline: ymd(3), deadline_kind: 'day', task_type: 'mail', task_type_suggested: false,
    notes: null, tags: [], source: 'manual', project_id: null, created_at: iso(-1), updated_at: iso(-1),
    completion_candidate: false, ai_reasoning: null,
  },
  {
    id: 't-05', title: 'Vakliteratuur doornemen voor de kennisbank', priority: 'low', status: 'open',
    in_backlog: false, deadline: null, deadline_kind: 'day', task_type: 'onderzoek', task_type_suggested: false,
    notes: null, tags: [], source: 'manual', project_id: null, created_at: iso(-6), updated_at: iso(-6),
    completion_candidate: false, ai_reasoning: null,
  },
  {
    id: 't-06', title: 'Nieuwe laptop bestellen', priority: 'low', status: 'open',
    in_backlog: true, deadline: null, deadline_kind: 'day', task_type: 'anders', task_type_suggested: false,
    notes: null, tags: [], source: 'manual', project_id: null, created_at: iso(-12), updated_at: iso(-12),
    completion_candidate: false, ai_reasoning: null,
  },
  {
    id: 't-07', title: 'Templates opschonen', priority: 'normal', status: 'open',
    in_backlog: true, deadline: null, deadline_kind: 'day', task_type: null, task_type_suggested: false,
    notes: null, tags: [], source: 'manual', project_id: null, created_at: iso(-15), updated_at: iso(-15),
    completion_candidate: false, ai_reasoning: null,
  },
  {
    id: 't-08', title: 'Onboarding-checklist schrijven', priority: 'normal', status: 'open',
    in_backlog: false, deadline: ymd(5), deadline_kind: 'day', task_type: 'uitvoeren', task_type_suggested: false,
    notes: null, tags: ['wip'], source: 'manual', project_id: 'p-01', created_at: iso(-5), updated_at: iso(-2),
    completion_candidate: false, ai_reasoning: null,
  },
]

export const PROJECTS = [
  { id: 'p-01', name: 'Onboarding-traject', icon: '🚀', color: '#7c8aff', status: 'active', sort_order: 1 },
]
