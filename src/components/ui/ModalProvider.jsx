import { useState, useCallback, useMemo } from 'react'
import { ModalContext, useModal } from '../../hooks/useModal'

/**
 * ModalProvider — context-provider die de modal-stack beheert.
 * Plaats hoog in de boom (in App.jsx, binnen authenticated tree).
 */
export function ModalProvider({ children }) {
  const [stack, setStack] = useState([])

  const open = useCallback((content, opts = {}) => {
    const id = opts.id ?? Math.random().toString(36).slice(2, 10)
    setStack(s => [...s.filter(it => it.id !== id), { id, content }])
    return id
  }, [])

  const close = useCallback((id) => {
    setStack(s => (id ? s.filter(it => it.id !== id) : s.slice(0, -1)))
  }, [])

  const closeAll = useCallback(() => setStack([]), [])

  const value = useMemo(
    () => ({ stack, open, close, closeAll, isOpen: stack.length > 0 }),
    [stack, open, close, closeAll]
  )

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>
}

/**
 * <ModalRoot /> — rendert de huidige modal-stack. Zet binnen ModalProvider.
 * Elke item.content is een React-node (typisch een <Modal>-instantie).
 */
export function ModalRoot() {
  const { stack } = useModal()
  return stack.map(item => <div key={item.id}>{item.content}</div>)
}
