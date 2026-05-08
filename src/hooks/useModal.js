import { createContext, useContext } from 'react'

/**
 * useModal — modal-stack via React context.
 *
 * Wikkel je App in `<ModalProvider>` (uit `components/ui/ModalProvider.jsx`)
 * en plaats `<ModalRoot />` ergens in de boom. Dan kan elke component:
 *
 *   const { open, close } = useModal()
 *   const id = open(<MyModal onClose={() => close(id)} />)
 *
 * Stack maakt het mogelijk om meerdere modals tegelijk te tonen
 * (bv. confirm-dialog bovenop een form-dialog).
 *
 * Returns:
 *  - stack    huidige stack (array van { id, content })
 *  - open     (content, opts?) → id (string), pusht een modal op de stack
 *  - close    (id?) → void, sluit de modal met die id (of de top wanneer leeg)
 *  - closeAll () → void
 *  - isOpen   bool, of er minstens één modal open staat
 */
export const ModalContext = createContext(null)

export function useModal() {
  const ctx = useContext(ModalContext)
  if (!ctx) throw new Error('useModal must be used inside <ModalProvider>')
  return ctx
}
