import { type ReactNode, useEffect, useRef } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  labelledBy: string
  className?: string
  children: ReactNode
}

// A native modal dialog: it traps the focus, closes on Escape and gives the
// focus back when it closes. The control marked `data-autofocus` gets the
// focus on opening. A click on the backdrop closes it too.
export function Modal({
  open,
  onClose,
  labelledBy,
  className,
  children,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current!
    if (open && !dialog.open) {
      dialog.showModal()
      // The browser focuses the first control; a dialog may name another.
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    } else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={`m-auto bg-transparent p-0 text-ink outline-none backdrop:bg-black/50 backdrop:backdrop-blur-[2px] ${className ?? ''}`}
    >
      {children}
    </dialog>
  )
}

export const CARD =
  'flex flex-col gap-4 rounded-xl border border-line bg-panel p-5 shadow-2xl shadow-black/50'

export const PRIMARY =
  'rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export const SECONDARY =
  'rounded-md px-3 py-1.5 text-xs text-ink-muted hover:bg-panel-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent'
