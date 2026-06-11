/* Kennisbank — gedeelde labels, kleur-mapping en afgeleide status.
   Kennisbank 2.0: één kennisbank (klant-only), 8 klantgerichte categorieën.
   Categorie-kleurklassen volgen het Claude Design (`app/kennisbank.css`). */

// slug → { label (fallback), cls } — label komt bij voorkeur uit kb_categories.
export const CAT_META = {
  aan_de_slag:           { label: 'Aan de slag',               cls: 'cat-onb' },
  account_gebruikers:    { label: 'Account & Gebruikers',      cls: 'cat-jur' },
  gebruik_how_to:        { label: 'Gebruik & How-to',          cls: 'cat-sal' },
  storingen_problemen:   { label: 'Storingen & Problemen',     cls: 'cat-hr'  },
  facturatie_abonnement: { label: 'Facturatie & Abonnement',   cls: 'cat-fin' },
  licenties_voorwaarden: { label: 'Licenties & Voorwaarden',   cls: 'cat-con' },
  privacy_beveiliging:   { label: 'Privacy & Beveiliging',     cls: 'cat-int' },
  integraties:           { label: 'Integraties & Koppelingen', cls: 'cat-par' },
  // legacy v1-slugs (gearchiveerde rijen blijven leesbaar)
  facturatie_financien:  { label: 'Facturatie & Financiën',    cls: 'cat-fin' },
  contracten_licenties:  { label: 'Contracten & Licenties',    cls: 'cat-con' },
  juridisch_compliance:  { label: 'Juridisch & Compliance',    cls: 'cat-jur' },
  onboarding_support:    { label: 'Onboarding & Support',      cls: 'cat-onb' },
  sales_pricing:         { label: 'Sales & Pricing',           cls: 'cat-sal' },
  partnerships:          { label: 'Partnerships',              cls: 'cat-par' },
  intern_operatie:       { label: 'Intern & Operatie',         cls: 'cat-int' },
  hr_pers_community:     { label: 'HR · Pers & Community',     cls: 'cat-hr'  },
}

const CAT_CYCLE = ['cat-jur', 'cat-sal', 'cat-con', 'cat-onb', 'cat-par', 'cat-fin', 'cat-int', 'cat-hr']

export function catClass(slug) {
  if (CAT_META[slug]?.cls) return CAT_META[slug].cls
  // onbekende (zelf toegevoegde) categorie → deterministische kleur uit de cyclus
  let h = 0
  for (const ch of String(slug || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return CAT_CYCLE[h % CAT_CYCLE.length]
}
export function catLabel(slug, fromDb) {
  return fromDb || CAT_META[slug]?.label || slug || 'Categorie'
}
// Voor bron-avatars: deterministische kleur-variatie per rij (zoals het design).
export function avatarClass(i) {
  return CAT_CYCLE[i % CAT_CYCLE.length]
}

export const TYPE_LABEL = {
  how_to: 'How-to', beleid: 'Beleid', referentie: 'Referentie',
  troubleshooting: 'Troubleshooting', faq: 'FAQ', besluit_rationale: 'Besluit',
}

// Impact/belang (door de curator gescoord, read-only). impact kan null zijn bij
// oude/ongescoorde rijen → behandel als laagste niveau.
export const IMPACT_LABEL = { hoog: 'Hoog', midden: 'Midden', laag: 'Laag' }
export function impactKey(p) { return (p && p.impact) || 'laag' }

const STATUS_LABEL = { concept: 'Concept', gevalideerd: 'Gevalideerd', gepubliceerd: 'Gepubliceerd' }

// Een artikel is "needs-review" als er een reden staat of de review-datum is verlopen.
export function isNeedsReview(article) {
  if (!article) return false
  if (article.needs_review_reason) return true
  if (article.review_due_at && new Date(article.review_due_at) < new Date()) return true
  return false
}

// Levert { cls, label } voor de status-pill (st-needs wint van de ruwe status).
export function statusPill(article) {
  if (isNeedsReview(article)) return { cls: 'st-needs', label: 'Needs-review' }
  const s = article?.status || 'concept'
  return { cls: `st-${s}`, label: STATUS_LABEL[s] || s }
}

// Confidence → percentage + bar/ring-kleurklasse.
export function confInfo(conf) {
  if (typeof conf !== 'number') return null
  const pct = Math.round(conf * 100)
  const bucket = pct >= 80 ? 'ok' : pct >= 50 ? 'mid' : 'low'
  const stroke = pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--error)'
  return { pct, bucket, stroke }
}

export function fmtDate(iso) {
  if (!iso) return '—'
  try {
    const s = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
    return s.replace(/\./g, '') // "9 jan. 2026" → "9 jan 2026"
  } catch { return '—' }
}

export function initials(nameOrEmail) {
  const s = String(nameOrEmail || '').trim()
  if (!s) return '—'
  if (s.includes('@') && !s.includes(' ')) return s.slice(0, 2).toUpperCase()
  const parts = s.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
