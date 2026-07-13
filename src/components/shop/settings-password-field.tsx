'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function SettingsPasswordField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 block text-xs font-medium text-zinc-700">{label}</Label>
      <Input id={id} type="password" value={value} onChange={(event) => onChange(event.target.value)} minLength={10} required className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900" />
    </div>
  )
}
