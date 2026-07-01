import { AdminSettingsClient } from './settings-client'

export default function AdminSettingsPage() {
  const checks = [
    { label: 'Database pooler', ok: Boolean(process.env.DATABASE_URL) },
    { label: 'Migration direct URL', ok: Boolean(process.env.DIRECT_URL) },
    { label: 'NextAuth secret', ok: Boolean(process.env.NEXTAUTH_SECRET) },
    { label: 'Telegram bot', ok: Boolean(process.env.TELEGRAM_BOT_TOKEN) },
    { label: 'Telegram webhook secret', ok: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET) },
    { label: 'Cron secret', ok: Boolean(process.env.CRON_SECRET) },
    { label: 'Supabase storage', ok: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) },
  ]

  return <AdminSettingsClient checks={checks} />
}
