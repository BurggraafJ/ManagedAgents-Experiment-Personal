import { useCallback, useEffect, useState } from 'react'
import { readPromptHistory, subscribePromptHistory, clearPromptHistory } from '../lib/promptHistory'

// De eerder gestelde vragen als React-state. Leest uit localStorage (zie
// lib/promptHistory.js) en luistert op wijzigingen, zodat de lijst achter de
// composer-knop meteen klopt als je een vraag verstuurt terwijl hij open staat.
export function usePromptHistory() {
  const [items, setItems] = useState(() => readPromptHistory())

  useEffect(() => subscribePromptHistory(() => setItems(readPromptHistory())), [])

  const clear = useCallback(() => clearPromptHistory(), [])

  return { items, clear }
}
