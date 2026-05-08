// Pure helpers + constanten voor ContactenView (F.5 Contactpersonen Source of Truth).
// Geen React; geen Supabase.

export const CONTACT_TYPES = [
  'intern', 'klant', 'prospect', 'partner', 'leverancier',
  'advocatenorde', 'rechtbank', 'overheid', 'persoonlijk', 'overig',
]

export const CONTACT_TYPE_LABEL = {
  intern:        'Intern',
  klant:         'Klant',
  prospect:      'Prospect',
  partner:       'Partner',
  leverancier:   'Leverancier',
  advocatenorde: 'Advocatenorde',
  rechtbank:     'Rechtbank',
  overheid:      'Overheid',
  persoonlijk:   'Persoonlijk',
  overig:        'Overig',
}

/**
 * Mappen van contact-type naar pill-tone (`s-success` etc. uit index.css).
 */
export const CONTACT_TYPE_TONE = {
  intern:        'success',
  klant:         'success',
  prospect:      'warning',
  partner:       '',
  leverancier:   'idle',
  advocatenorde: 'idle',
  rechtbank:     'idle',
  overheid:      'idle',
  persoonlijk:   'idle',
  overig:        '',
}

export const FIRM_TYPE_LABEL = {
  advocatenkantoor: 'Advocatenkantoor',
  rechtbank:        'Rechtbank',
  notariaat:        'Notariaat',
  overheid:         'Overheid',
  advocatenorde:    'Advocatenorde',
  tech:             'Tech / SaaS',
  consulting:       'Consulting',
  mediator:         'Mediator',
  internal:         'Intern',
  overig:           'Overig',
}

/**
 * Telt contacten per contact_type.
 */
export function countByType(contactRows) {
  const counts = {}
  for (const r of contactRows || []) {
    counts[r.contact_type] = (counts[r.contact_type] || 0) + 1
  }
  return counts
}

/**
 * Genereer initials voor een contactpersoon.
 */
export function contactInitials(c) {
  const first = c.voornaam?.[0] || c.email?.[0] || '?'
  const last = c.achternaam?.[0] || ''
  return (first + last).toUpperCase()
}
