export default function AdminSettingsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-zinc-900 mb-6">Sozlamalar</h1>
      <div className="border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-zinc-900 mb-2">Tizim holati</h2>
        <p className="text-sm text-zinc-500">
          Asosiy sozlamalar Vercel environment variables orqali boshqariladi.
        </p>
      </div>
    </div>
  )
}
