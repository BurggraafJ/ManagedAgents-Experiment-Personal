// Postvak-preview — verzonnen mailbox met de vórm van de echte.
//
// ⚠ PUBLIEKE REPO. Geen echte afzender, geen echt onderwerp, geen echte
// mailinhoud. Wat wél klopt is de *verdeling*, want daar gaat de shot over:
// 16 mails in de Inbox-root (prod 2026-09-14), waarvan 7 door Outlook zelf op
// "Overige" gezet (inference_classification = 'other'), 2 ongelezen, 3 met
// bijlage en precies 1 met een openstaand AutoDraft-voorstel. Dat laatste
// getal is de kern van deze PR: onder de oude mobiele regel was díé ene mail
// de hele lijst.

const D = (iso) => new Date(iso).toISOString()

const RAW = [
  { h: 0, from: ['Sanne de Groot', 'sanne@voorbeeldkantoor.nl'], subj: 'Vraag over de licentievoorwaarden Q4',
    prev: 'Hoi, we hebben het contract intern besproken en er is nog één punt waar we naar willen kijken voordat we tekenen…',
    at: '2026-09-14T17:27:05Z', read: false, cls: 'focused', att: false },
  { h: 1, from: ['Nieuwsbrief Rechtspraktijk', 'no-reply@nieuwsbrief.voorbeeld.nl'], subj: 'Weekoverzicht · vijf uitspraken die je gemist hebt',
    prev: 'Deze week in het kort: de Hoge Raad over bewijslast, een nieuwe AVG-boete en drie tips voor je documentbeheer…',
    at: '2026-09-14T15:31:37Z', read: false, cls: 'other', att: false },
  { h: 2, from: ['Thomas Vermeer', 'thomas@voorbeeldpartner.com'], subj: 'RE: Planning kickoff volgende week',
    prev: 'Dinsdagochtend komt ons goed uit. Zal ik een uitnodiging sturen voor 10:00 bij ons op kantoor?',
    at: '2026-09-14T13:03:00Z', read: true, cls: 'focused', att: false },
  { h: 3, from: ['Ilse Brouwer', 'ilse@voorbeeldkantoor.nl'], subj: 'Getekende overeenkomst retour',
    prev: 'Bijgaand de getekende versie. Laat je even weten of jullie hem zo ook in het dossier kunnen opnemen?',
    at: '2026-09-14T08:07:41Z', read: true, cls: 'focused', att: true },
  { h: 4, from: ['Boekhouding', 'facturen@voorbeeldleverancier.nl'], subj: 'Factuur 2026-0914 · september',
    prev: 'Hierbij de factuur voor de maand september. Betaling binnen 30 dagen na factuurdatum.',
    at: '2026-09-11T13:08:05Z', read: true, cls: 'focused', att: true },
  { h: 5, from: ['Productupdates', 'updates@voorbeeldtool.io'], subj: 'Nieuw deze maand: sneller zoeken',
    prev: 'We hebben de zoekfunctie opnieuw gebouwd. Wat betekent dat voor jouw team?',
    at: '2026-09-11T12:11:41Z', read: true, cls: 'other', att: false },
  { h: 6, from: ['Evenementen', 'events@voorbeeldcongres.nl'], subj: 'Laatste plaatsen · najaarscongres',
    prev: 'Nog twaalf plaatsen beschikbaar. Meld je aan vóór 20 september en profiteer van het vroegboektarief.',
    at: '2026-09-11T08:41:11Z', read: true, cls: 'other', att: false },
  { h: 7, from: ['LinkedIn', 'notifications@voorbeeldnetwerk.com'], subj: 'Je hebt 4 nieuwe weergaven',
    prev: 'Bekijk wie er deze week naar je profiel heeft gekeken.',
    at: '2026-09-10T21:04:58Z', read: true, cls: 'other', att: false },
  { h: 8, from: ['Karin Aalders', 'karin@voorbeeldklant.nl'], subj: 'Terugkoppeling pilot week 3',
    prev: 'Het team is enthousiast. Twee punten willen we nog bespreken voordat we breder uitrollen…',
    at: '2026-09-10T16:27:12Z', read: true, cls: 'other', att: false },
  { h: 9, from: ['Systeembeheer', 'alerts@voorbeeldhosting.nl'], subj: 'Gepland onderhoud zondagnacht',
    prev: 'Op zondag 21 september tussen 02:00 en 04:00 is de omgeving korte tijd niet bereikbaar.',
    at: '2026-09-10T15:04:08Z', read: true, cls: 'other', att: false },
  { h: 10, from: ['Webinar-team', 'webinar@voorbeeldacademie.nl'], subj: 'Bevestiging inschrijving',
    prev: 'Je bent ingeschreven. De link ontvang je een dag van tevoren.',
    at: '2026-09-10T14:57:29Z', read: true, cls: 'other', att: false },
  { h: 11, from: ['Marijn Postma', 'marijn@voorbeeldpartner.com'], subj: 'Samenwerking · voorstel voor volgende stap',
    prev: 'Naar aanleiding van ons gesprek heb ik een kort voorstel uitgewerkt. Kun jij er deze week naar kijken?',
    at: '2026-09-10T12:50:51Z', read: true, cls: 'focused', att: true },
  { h: 12, from: ['Dieuwertje Smit', 'dieuwertje@voorbeeldkantoor.nl'], subj: 'Offerte-aanvraag · uitbreiding team',
    prev: 'We willen het aantal gebruikers uitbreiden van 12 naar 20. Kun je een aangepaste offerte sturen?',
    at: '2026-09-09T13:49:04Z', read: true, cls: 'focused', att: false },
  { h: 13, from: ['Joris Kuiper', 'joris@voorbeeldklant.nl'], subj: 'Korte vraag over de exportfunctie',
    prev: 'Kunnen we de export ook per dossier draaien in plaats van per maand?',
    at: '2026-09-09T12:17:53Z', read: true, cls: 'focused', att: false },
  { h: 14, from: ['Renske Doorn', 'renske@voorbeeldpartner.com'], subj: 'Notulen overleg 4 september',
    prev: 'Bijgaand de notulen. Aanvullingen graag vóór vrijdag.',
    at: '2026-09-04T19:18:56Z', read: true, cls: 'focused', att: false },
  { h: 15, from: ['Archiefdienst', 'info@voorbeeldarchief.nl'], subj: 'Bevestiging van je aanvraag',
    prev: 'We hebben je aanvraag in goede orde ontvangen en nemen binnen vijf werkdagen contact op.',
    at: '2026-08-24T08:34:18Z', read: true, cls: 'focused', att: false },
]

const OWNER = '00000000-0000-4000-8000-000000000001'
const INBOX_FOLDER = 'folder-inbox'

export const MAIL_MESSAGES = RAW.map(r => ({
  id: `mail-${String(r.h).padStart(2, '0')}`,
  conversation_id: `conv-${String(r.h).padStart(2, '0')}`,
  received_at: D(r.at),
  from_email: r.from[1],
  from_name: r.from[0],
  to_recipients: [{ name: 'Jelle Burggraaf', address: 'jelle@voorbeeld.nl' }],
  cc_recipients: [],
  bcc_recipients: [],
  subject: r.subj,
  body_preview: r.prev,
  has_attachments: r.att,
  folder_id: INBOX_FOLDER,
  folder_path: 'Inbox',
  is_read: r.read,
  is_from_me: false,
  is_deleted: false,
  synced_at: D('2026-09-14T17:56:07Z'),
  body_truncated: false,
  flag_status: 'notFlagged',
  is_calendar_invite: false,
  flagged_as_spam: false,
  is_pinned: false,
  pinned_at: null,
  inference_classification: r.cls,
  user_id: OWNER,
}))

// Twee verzonden mails, zodat het mobiele segment Verzonden niet leeg staat.
export const SENT_MESSAGES = [
  {
    ...MAIL_MESSAGES[0], id: 'sent-00', conversation_id: 'conv-12', is_from_me: true,
    folder_path: 'Sent Items', received_at: D('2026-09-14T16:39:33Z'),
    from_name: 'Jelle Burggraaf', from_email: 'jelle@voorbeeld.nl',
    to_recipients: [{ name: 'Dieuwertje Smit', address: 'dieuwertje@voorbeeldkantoor.nl' }],
    subject: 'RE: Offerte-aanvraag · uitbreiding team',
    body_preview: 'Dank je wel — ik stuur de aangepaste offerte morgenochtend, dan heb je hem vóór het overleg.',
    is_read: true, has_attachments: false, inference_classification: null,
  },
  {
    ...MAIL_MESSAGES[0], id: 'sent-01', conversation_id: 'conv-13', is_from_me: true,
    folder_path: 'Sent Items', received_at: D('2026-09-12T09:12:04Z'),
    from_name: 'Jelle Burggraaf', from_email: 'jelle@voorbeeld.nl',
    to_recipients: [{ name: 'Joris Kuiper', address: 'joris@voorbeeldklant.nl' }],
    subject: 'RE: Korte vraag over de exportfunctie',
    body_preview: 'Dat kan — per dossier exporteren zit sinds vorige week in de release. Ik loop het zo even met je door.',
    is_read: true, has_attachments: false, inference_classification: null,
  },
]

// Eén openstaand voorstel. Onder de oude mobiele regel wás dit de hele lijst.
export const AUTODRAFT_MAILS = [
  {
    id: 'ad-12',
    mail_id: 'mail-12',
    conversation_id: 'conv-12',
    received_at: D('2026-09-09T13:49:04Z'),
    from_email: 'dieuwertje@voorbeeldkantoor.nl',
    from_name: 'Dieuwertje Smit',
    subject: 'Offerte-aanvraag · uitbreiding team',
    body_preview: 'We willen het aantal gebruikers uitbreiden van 12 naar 20. Kun je een aangepaste offerte sturen?',
    has_attachments: false,
    category_key: 'sales',
    suggested_action: 'draft',
    suggested_reasoning: 'Concrete vraag van een bestaande klant; een antwoord met de aangepaste offerte ligt voor de hand.',
    draft_subject: 'RE: Offerte-aanvraag · uitbreiding team',
    draft_body: 'Hoi Dieuwertje,\n\nDank voor je bericht. Ik pas de offerte aan naar 20 gebruikers en stuur hem je morgenochtend toe, dan heb je hem vóór jullie overleg.\n\nHartelijke groet,\nJelle',
    draft_variants: [
      { label: 'Kort', subject: 'RE: Offerte-aanvraag · uitbreiding team', body: 'Hoi Dieuwertje,\n\nDank je — ik pas de offerte aan naar 20 gebruikers en stuur hem morgenochtend.\n\nGroet,\nJelle' },
      { label: 'Uitgebreid', subject: 'RE: Offerte-aanvraag · uitbreiding team', body: 'Hoi Dieuwertje,\n\nDank voor je bericht. Ik pas de offerte aan naar 20 gebruikers en stuur hem je morgenochtend toe, dan heb je hem vóór jullie overleg.\n\nHartelijke groet,\nJelle' },
    ],
    selected_variant_index: 1,
    confidence: 0.82,
    target_folder: 'Inbox/Klanten',
    status: 'pending',
    audience: 'for_you',
    user_id: OWNER,
  },
]

export const CATEGORIES = [
  { category_key: 'sales', label: 'Sales', color: '#c2703d', sort_order: 1, default_target_folder: 'Inbox/Klanten' },
  { category_key: 'intern', label: 'Intern', color: '#6b7f9e', sort_order: 2, default_target_folder: null },
  { category_key: 'nieuwsbrief', label: 'Nieuwsbrief', color: '#8a8a8a', sort_order: 3, default_target_folder: 'Inbox/General Storage' },
]

// De mappenboom voor de kiezer (v1.205). De échte mailbox heeft er 58, zes
// niveaus diep; dit zijn er 16 met dezelfde vórm — top-level naast een diepe
// Inbox-tak — zodat de inspringing, het pad-regeltje en het zoekveld in de shot
// doen wat ze live ook doen.
//
// ⚠ Verzonnen namen, met opzet. De echte boom staat vol klantnamen en deze repo
// is openbaar (incident PR #44). Wat de shot moet laten zien is de stríjd met
// diepte en aantal, niet wie Jelle's klanten zijn.
const folder = (id, path, count = 0) => ({
  id, folder_id: id, full_path: path, display_name: path.split('/').pop(),
  well_known_name: null, item_count: count,
})

export const FOLDERS = [
  { ...folder(INBOX_FOLDER, 'Inbox', 19), well_known_name: 'inbox' },
  { ...folder('f-archief', 'Archive', 10), well_known_name: 'archive' },
  { ...folder('f-deleted', 'Deleted Items', 9829), well_known_name: 'deleteditems' },
  { ...folder('f-drafts', 'Drafts', 35), well_known_name: 'drafts' },
  { ...folder('f-sentitems', 'Sent Items', 6277), well_known_name: 'sentitems' },
  { ...folder('f-junk', 'Junk Email', 131), well_known_name: 'junkemail' },
  folder('f-storage', 'Inbox/General Storage', 2729),
  folder('f-afd', 'Inbox/General Storage/Afdelingen', 0),
  folder('f-afd-acq', 'Inbox/General Storage/Afdelingen/Acquisitie', 143),
  folder('f-afd-cs', 'Inbox/General Storage/Afdelingen/Customer Succes', 171),
  folder('f-afd-it', 'Inbox/General Storage/Afdelingen/Information Technology', 195),
  folder('f-afd-mkt', 'Inbox/General Storage/Afdelingen/Marketing', 52),
  folder('f-klanten', 'Inbox/Klanten', 1514),
  folder('f-projecten', 'Inbox/Projecten', 9),
  folder('f-proj-jira', 'Inbox/Projecten/JIRA', 95),
  folder('f-todo', "Inbox/Todo's", 50),
]

// Vers — de Edge-ETL draait elke 5 minuten. De pil toont dan "nu".
export const MAIL_SYNC_STATE = [
  { folder_id: INBOX_FOLDER, last_delta_at: new Date(Date.now() - 40_000).toISOString(), last_full_scan_at: D('2026-09-12T17:10:10Z'), last_error: null, total_messages_synced: 3088943 },
  { folder_id: 'f-sent', last_delta_at: new Date(Date.now() - 45_000).toISOString(), last_full_scan_at: D('2026-09-12T17:10:14Z'), last_error: null, total_messages_synced: 1172740 },
]
