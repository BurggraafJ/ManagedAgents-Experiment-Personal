import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Multi-user M2 — de spiegelstand van je EIGEN mailbox (beslissing 4:
// "iedereen een eigen inbox-koppeling").
//
// `v_mailbox_link_status` (migratie h) zegt óf er een koppeling is. Dat is
// genoeg voor de owner die naar een lijst met mensen kijkt, en te weinig voor
// de persoon zelf: tussen "gekoppeld" en "er staat mail" zit de eerste sync, en
// die duurt. Zonder dat onderscheid leest een leeg Postvak als "ik heb geen
// mail" terwijl het "de spiegel loopt nog" betekent — precies de toestand die
// RESEARCH §4.2 als eis stelt om uit elkaar te houden.
//
// `my_mailbox_state()` geeft de drie toestanden in één call: mag ik het (recht),
// is er een koppeling, en staat er al iets. auth.uid() staat hard in elke arm
// van die functie, dus deze hook kan per definitie niet over een ander gaan.
export function useMyMailbox() {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchState = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase.rpc('my_mailbox_state')
    if (err) {
      setError(err.message)
      setState(null)
    } else {
      setError(null)
      setState(data || null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchState() }, [fetchState])

  // Vijf toestanden, want "leeg" is er drie van en die vragen elk een ander
  // antwoord van de lezer.
  let fase = 'onbekend'
  if (state) {
    if (!state.mag_postvak) fase = 'geen_recht'
    else if (!state.gekoppeld) fase = 'niet_gekoppeld'
    else if (state.heeft_fout) fase = 'fout'
    else if (!state.mails_gespiegeld) fase = 'spiegelt_nog'
    else fase = 'in_bedrijf'
  }

  return { state, fase, loading, error, refresh: fetchState }
}
