import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useContactSuggestions — wie kun je uitnodigen?
 *
 * Twee bronnen, en dat is een meting en geen smaak. Gemeten op de mailbox van
 * de eigenaar (2026-09-15):
 *
 *   outlook_contacts     9 adressen  — het adresboek dat Jelle zelf bijhoudt
 *   calendar_attendees   609 adressen — de mensen met wie hij echt vergadert
 *
 * Alleen het adresboek zou een kiezer met negen namen opleveren. Alleen de
 * genodigden-historie zou het adresboek negeren. Dus allebei, met het adresboek
 * bovenaan: wie je bewust hebt opgeslagen weegt zwaarder dan wie ooit in een
 * uitnodiging stond.
 *
 * Bewust NIET `contact_directory`. Die view bestaat, is per gebruiker gescoped
 * en heeft 2.036 rijen — maar hij rekent bij élke aanroep een UNION met een
 * seq-scan over `hubspot_contacts` uit (93 ms uitvoeringstijd, gemeten). Dat is
 * te duur voor een veld dat per toetsaanslag zoekt. Beide tabellen hierboven
 * zijn klein en geïndexeerd op `user_id`.
 *
 * RLS doet de afbakening: `outlook_contacts` en `calendar_attendees` hebben
 * allebei een SELECT-policy "eigen rijen of admin, mét tweede factor". Er is
 * dus geen RPC en geen nieuwe grant — niets extra's voor de multi-user-poort om
 * op te struikelen.
 */
const MIN_CHARS = 2
const DEBOUNCE_MS = 180
const MAX_RESULTS = 8

/**
 * PostgREST's `or=(...)` is een eigen minitaaltje: een komma scheidt de takken
 * en een haakje sluit de groep. Wie een komma uit een zoekveld ongefilterd
 * doorgeeft, stuurt dus een tweede filtervoorwaarde mee. `%` en `_` zijn
 * bovendien LIKE-jokers. Alles eruit wat betekenis heeft, niets vertalen.
 */
function safeTerm(q) {
  return String(q || '').replace(/[,()%_*\\"']/g, ' ').trim().slice(0, 60)
}

function label(name, email) {
  const n = String(name || '').trim()
  return n && n.toLowerCase() !== String(email || '').toLowerCase() ? n : null
}

export function useContactSuggestions() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  // Elke zoekopdracht krijgt een nummer; alleen het antwoord van de laatste mag
  // de lijst zetten. Zonder dat kan een trage eerste query een snelle tweede
  // overschrijven en staat er een lijst bij een woord dat er niet meer staat.
  const seq = useRef(0)

  const run = useCallback(async (raw) => {
    const term = safeTerm(raw)
    const mine = ++seq.current
    if (term.length < MIN_CHARS) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const like = `%${term}%`
    try {
      const [book, seen] = await Promise.all([
        supabase.from('outlook_contacts')
          .select('email, display_name, company_name')
          .eq('is_deleted', false)
          .or(`email.ilike.${like},display_name.ilike.${like}`)
          .limit(MAX_RESULTS),
        // Eén persoon staat in zoveel rijen als hij afspraken heeft (4.268 rijen
        // voor 609 mensen), dus ruim ophalen en hier ontdubbelen. Nieuwste
        // eerst: met wie je vorige week zat is een betere gok dan wie je in
        // 2024 een keer sprak.
        supabase.from('calendar_attendees')
          .select('email, name, created_at')
          .or(`email.ilike.${like},name.ilike.${like}`)
          .order('created_at', { ascending: false })
          .limit(120),
      ])
      if (mine !== seq.current) return

      const out = []
      const seenEmails = new Set()
      for (const r of (book.data || [])) {
        const email = String(r.email || '').toLowerCase()
        if (!email || seenEmails.has(email)) continue
        seenEmails.add(email)
        out.push({ email, name: label(r.display_name, email), hint: r.company_name || null, source: 'outlook' })
      }
      for (const r of (seen.data || [])) {
        if (out.length >= MAX_RESULTS) break
        const email = String(r.email || '').toLowerCase()
        if (!email || seenEmails.has(email)) continue
        seenEmails.add(email)
        out.push({ email, name: label(r.name, email), hint: null, source: 'agenda' })
      }
      setResults(out.slice(0, MAX_RESULTS))
    } catch {
      // Een kiezer die niet kan zoeken is nog steeds een kiezer: je typt het
      // adres zelf. Geen toast, geen rood vlak — alleen geen suggesties.
      if (mine === seq.current) setResults([])
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => { run(query) }, DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query, run])

  const reset = useCallback(() => { seq.current++; setQuery(''); setResults([]); setLoading(false) }, [])

  return { query, setQuery, results, loading, reset }
}
