'use client'

import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'

export function SettingsPasswordField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label} required controlId={id}>
      <Input id={id} type="password" value={value} onChange={(event) => onChange(event.target.value)} minLength={10} required className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900" />
    </Field>
  )
}
