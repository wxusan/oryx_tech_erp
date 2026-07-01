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

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-zinc-900 mb-6">Sozlamalar</h1>
      <div className="border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-3 mb-3">
          <h2 className="text-sm font-semibold text-zinc-900">Tizim holati</h2>
          <span className="text-xs text-zinc-500">Vercel env vars</span>
        </div>
        <div className="divide-y divide-zinc-100">
          {checks.map((check) => (
            <div key={check.label} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-zinc-700">{check.label}</span>
              <span className={check.ok ? 'text-xs font-medium text-emerald-700' : 'text-xs font-medium text-red-700'}>
                {check.ok ? 'Sozlangan' : 'Kerak'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
