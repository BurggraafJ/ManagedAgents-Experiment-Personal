// Pure helpers + constants voor InstructiesPage.

export const PLACEHOLDERS = {
  'daily-admin':
    'Bijv.:\n- Maak alleen tasks voor deals in de Sales Pipeline (niet Customer Base).\n- Bij Customer Base: schrijf een note, geen task — tenzij er een expliciete actie in de mail staat.\n- Recruitment-kaarten altijd met assignee = huidige eigenaar in de kanban.\n- Bij partner-items: Jira-ticket op board Partnerships.',
  'auto-draft':
    'Bijv.:\n- Geen drafts voor nieuwsbrieven of noreply-afzenders.\n- Bij Nederlandse mails altijd tutoyeren.\n- Drafts max 5 zinnen tenzij de input-mail lang is.',
  'sales-on-road':
    'Bijv.:\n- Altijd een follow-up-mail klaarzetten in map "SalesAgent".\n- Deal-stage "Kennismaking" alleen als de match voldoende helder is — anders needs_info.',
  'sales-todos':
    'Bijv.:\n- Offerte-reminders: 3 dagen na verzenden, daarna elke 5 dagen.\n- Trial eindigt binnen 7 dagen → altijd een draft-mail voorbereiden.',
}

export function friendlyName(s) {
  return s.display_name || s.agent_name
}
