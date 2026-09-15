/**
 * hs_analytics_source → leesbare NL-labels.
 *
 * De enum-waarden komen van HubSpot. ~94 % van de open Sales-deals draagt een
 * bron (Jelle, 2026-09-15). UNKNOWN = leeg veld; die telt mee als
 * hygiëne-indicator en wordt niet verborgen.
 */
const KANAAL_MAP = {
  ORGANIC_SEARCH:  'Organisch',
  PAID_SEARCH:     'Betaald zoeken',
  EMAIL_MARKETING: 'E-mail',
  SOCIAL_MEDIA:    'Social',
  REFERRALS:       'Verwijzingen',
  OTHER_CAMPAIGNS: 'Campagnes',
  DIRECT_TRAFFIC:  'Direct',
  OFFLINE:         'Offline / outbound',
  PAID_SOCIAL:     'Betaald sociaal',
  UNKNOWN:         'Onbekend',
}

export function kanaalLabel(code) {
  return KANAAL_MAP[code] || code || 'Onbekend'
}
