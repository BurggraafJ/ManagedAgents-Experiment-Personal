// Follow-up-varianten voor In afwachting — functioneel geport uit variant 1
// (AwaitingActions): 2 varianten, begroeting-variatie per mail_id, geen
// em-dashes, echte ontvanger uit to_recipients.

function firstRecipient(toRecip) {
  if (!toRecip) return ''
  const arr = Array.isArray(toRecip) ? toRecip : [toRecip]
  for (const x of arr) {
    if (typeof x === 'string') return x
    if (x?.name) return x.name
    if (x?.email) return x.email
    if (x?.address) return x.address
  }
  return ''
}

export function buildFollowupVariants(mail) {
  const stripAan = s => String(s || '').replace(/^aan\s+/i, '').trim()
  const raw = firstRecipient(mail.to_recipients) || stripAan(mail.from_name) || (mail.from_email || '').split('@')[0] || ''
  const label = raw.includes('@') ? raw.split('@')[0].replace(/[._-]+/g, ' ') : raw
  const firstName = (label.split(/[\s,]+/)[0] || label || '').trim()
  const days = mail.days_waiting || 0
  const subj = (mail.subject || '').replace(/^(re|fw|fwd):\s*/i, '')
  const ago = days === 0 ? 'recent' : days === 1 ? 'gisteren' : `${days} dagen geleden`
  const greetings = ['Hi', 'Hé', 'Hallo', firstName ? `Beste ${firstName}` : 'Beste']
  const hashIdx = (mail.mail_id || '').split('').reduce((a, c) => (a + c.charCodeAt(0)) % greetings.length, 0)
  const greet = greetings[hashIdx]
  const opener = greet.startsWith('Beste') ? `${greet},` : `${greet}${firstName && !greet.includes(firstName) ? ' ' + firstName : ''},`
  return [
    {
      label: 'Kort en direct',
      body: `${opener}\n\nEven een korte reminder. Ik mailde je ${ago}${subj ? ` over "${subj}"` : ''} en heb nog geen reactie ontvangen. Lukt het om er deze week naar te kijken?\n\nGroet,\nJelle`,
    },
    {
      label: 'Warm en uitgebreid',
      body: `${opener}\n\nGeen druk hoor, maar ik wilde even checken of mijn mail van ${ago}${subj ? ` over "${subj}"` : ''} bij je is binnengekomen. Soms verdwijnt zoiets in de drukte. Mocht je er nog naar willen kijken, dan hoor ik graag van je.\n\nVriendelijke groet,\nJelle`,
    },
  ]
}
