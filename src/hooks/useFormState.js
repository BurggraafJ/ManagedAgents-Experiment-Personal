import { useState, useCallback, useRef } from 'react'

/**
 * useFormState — eenvoudige form-state-machine met dirty-tracking en reset.
 *
 * Vervangt het patroon `useState` per veld + handmatige onChange-handlers in
 * forms (TerminologiePage, EdgeFunctionsPage, AutoDraft compose, etc.).
 *
 * @template T
 * @param {T} initial — startwaarden van het formulier
 * @returns {{
 *   values: T,
 *   setValue: (key: keyof T, value: any) => void,
 *   setValues: (partial: Partial<T>) => void,
 *   reset: (next?: T) => void,
 *   isDirty: boolean,
 *   bind: (key: keyof T) => { value: any, onChange: (e) => void }
 * }}
 *
 * `bind('title')` is een shortcut voor `value` + `onChange` props zodat je
 * `<input {...bind('title')} />` kunt schrijven.
 */
export function useFormState(initial) {
  const initialRef = useRef(initial)
  const [values, setStateValues] = useState(initial)
  const [dirty, setDirty] = useState(false)

  const setValue = useCallback((key, value) => {
    setStateValues(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }, [])

  const setValues = useCallback((partial) => {
    setStateValues(prev => ({ ...prev, ...partial }))
    setDirty(true)
  }, [])

  const reset = useCallback((next) => {
    const target = next ?? initialRef.current
    initialRef.current = target
    setStateValues(target)
    setDirty(false)
  }, [])

  const bind = useCallback((key) => ({
    value: values[key] ?? '',
    onChange: (e) => {
      const v = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e
      setValue(key, v)
    },
  }), [values, setValue])

  return { values, setValue, setValues, reset, isDirty: dirty, bind }
}
