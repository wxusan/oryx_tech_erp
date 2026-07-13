'use client'

import * as React from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface FieldControlProps {
  id?: string
  required?: boolean
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  'aria-required'?: boolean
}

export interface FieldProps {
  label: React.ReactNode
  children: React.ReactElement<FieldControlProps>
  controlId?: string
  required?: boolean
  help?: React.ReactNode
  error?: React.ReactNode
  /** Focuses this control only when it is the form's first invalid control. */
  focusOnError?: boolean
  className?: string
}

/**
 * Accessible form-field contract shared by admin and shop forms. It owns the
 * label/control association, required state, help/error descriptions, invalid
 * state, and first-error focus without changing the child control's behavior.
 */
export function Field({
  label,
  children,
  controlId,
  required = false,
  help,
  error,
  focusOnError = true,
  className,
}: FieldProps) {
  const generatedId = React.useId()
  const id = controlId ?? children.props.id ?? `field-${generatedId.replaceAll(':', '')}`
  const helpId = help ? `${id}-help` : null
  const errorId = error ? `${id}-error` : null
  const describedBy = [children.props['aria-describedby'], helpId, errorId]
    .filter(Boolean)
    .join(' ') || undefined

  React.useEffect(() => {
    if (!error || !focusOnError) return
    const firstInvalid = document.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (firstInvalid?.id === id) firstInvalid.focus()
  }, [error, focusOnError, id])

  const control = React.cloneElement(children, {
    id,
    required: required ? true : children.props.required,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : children.props['aria-invalid'],
    'aria-required': required ? true : children.props['aria-required'],
  })

  return (
    <div className={className} data-slot="field">
      <Label htmlFor={id} className="mb-1.5 block text-xs font-medium text-zinc-700">
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-red-500">*</span>}
      </Label>
      {control}
      {help && <p id={helpId!} className="mt-1 text-xs text-zinc-500">{help}</p>}
      {error && (
        <p id={errorId!} role="alert" className={cn('mt-1 text-xs text-red-600')}>
          {error}
        </p>
      )}
    </div>
  )
}
