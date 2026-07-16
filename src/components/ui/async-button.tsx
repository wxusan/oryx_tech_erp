'use client'

import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ButtonProps = React.ComponentProps<typeof Button>

export interface AsyncButtonProps extends Omit<ButtonProps, 'aria-busy'> {
  pending: boolean
  pendingLabel: string
}

/** Stable-width, accessible pending feedback with an additional click guard. */
export function AsyncButton({
  pending,
  pendingLabel,
  disabled,
  children,
  onClick,
  ...props
}: AsyncButtonProps) {
  const invocationLocked = useRef(false)

  useEffect(() => {
    if (!pending) invocationLocked.current = false
  }, [pending])

  const handleClick: ButtonProps['onClick'] = (event) => {
    if (pending || invocationLocked.current) {
      event.preventDefault()
      return
    }
    invocationLocked.current = true
    const result = onClick?.(event) as unknown
    if (!pending && !(result instanceof Promise)) {
      queueMicrotask(() => { invocationLocked.current = false })
    }
    if (result instanceof Promise) {
      void result.finally(() => { invocationLocked.current = false })
    }
  }

  return (
    <Button
      {...props}
      disabled={Boolean(disabled || pending)}
      aria-busy={pending}
      onClick={handleClick}
    >
      <span className="grid place-items-center">
        <span className={pending ? 'invisible col-start-1 row-start-1' : 'col-start-1 row-start-1'}>
          {children}
        </span>
        <span className={pending ? 'col-start-1 row-start-1 inline-flex items-center gap-1.5' : 'invisible col-start-1 row-start-1 inline-flex items-center gap-1.5'}>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {pendingLabel}
        </span>
      </span>
    </Button>
  )
}
