import { supabase } from './supabase'

// composeAi — de schrijfhulp achter "Nieuwe mail", op desktop en mobiel.
//
// Eén Edge Function (`mail-verbeteraar`), één set chips, één afspraak over wat
// er gebeurt als het schrijfvlak nog leeg is. Die afspraak stond tot v1.202
// alleen in `Pv2NewMail.jsx`; mobiel kreeg in v1.203 dezelfde knoppen, en twee
// kopieën van dezelfde prompts lopen uit elkaar zodra iemand er één bijwerkt.
//
// Geen nieuwe AI-stack: dit is precies de call die desktop al deed.

export const CHIP_PROMPTS = {
  'Schrijf voor mij': 'Schrijf op basis van deze opdracht een complete, natuurlijke mail in Jelle’s stijl.',
  'Korter': 'Maak de mail korter en directer.',
  'Vriendelijker': 'Maak de toon vriendelijker en warmer.',
  'Zakelijker': 'Maak de toon zakelijker en formeler.',
  'Vraag om bevestiging': 'Sluit af met een korte, vriendelijke vraag om bevestiging.',
}

/** De chips in de volgorde waarin ze op desktop staan. */
export const CHIP_ORDER = Object.keys(CHIP_PROMPTS)

/**
 * Herschrijf of schrijf.
 *
 * Met tekst in het vlak is `label` een bewerking ván die tekst. Zonder tekst is
 * er niets te herschrijven en wordt de opdracht zélf de inhoud — "Schrijf voor
 * mij" met de chiptekst als briefing. Dat onderscheid is het hele contract van
 * deze functie; zonder dat stuurde een lege composer een lege mail op.
 *
 * Gooit bij een fout; de caller toont de toast, want die weet in welk scherm
 * het misging.
 */
export async function refineMail({ body, label }) {
  const instruction = CHIP_PROMPTS[label] || label
  const hasBody = String(body || '').trim().length > 0
  const { data, error } = await supabase.functions.invoke('mail-verbeteraar', {
    body: hasBody
      ? { original_mail: body, extra_prompt: instruction }
      : { original_mail: instruction, extra_prompt: CHIP_PROMPTS['Schrijf voor mij'] },
  })
  if (error) throw new Error(error.message)
  if (!data || !data.ok) throw new Error(data?.reason || 'mislukt')
  return {
    text: data.improved_mail || '',
    examplesUsed: Number(data.examples_used) || 0,
  }
}
