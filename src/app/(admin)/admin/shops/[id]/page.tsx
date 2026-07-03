'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type ShopStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED'

interface ShopAdmin {
  id: string
  name: string
  phone: string
  telegramId: string | null
  telegramVerifiedAt: string | null
  login: string
  isActive: boolean
}

interface ShopPayment {
  id: string
  paidAt: string
  amount: string | number
  months: number
  paymentMethod: string
  note: string | null
}

interface ShopDetail {
  id: string
  name: string
  ownerName: string
  ownerPhone: string
  shopNumber: string
  address: string
  note: string | null
  subscriptionDue: string
  status: ShopStatus
  deletedAt: string | null
  deletedBy: string | null
  deleteNote: string | null
  admins: ShopAdmin[]
  payments: ShopPayment[]
}

function formatMoney(n: number | string) {
  return Number(n).toLocaleString('ru-RU') + " so'm"
}

function StatusBadge({ status }: { status: ShopStatus }) {
  if (status === 'ACTIVE') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-zinc-900 text-white">
        Faol
      </span>
    )
  }
  if (status === 'SUSPENDED') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-500">
        To&apos;xtatilgan
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-400">
      O&apos;chirilgan
    </span>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-zinc-400 mb-0.5">{label}</div>
      <div className={['text-sm text-zinc-900', mono ? 'font-mono' : 'font-medium'].join(' ')}>
        {value || '—'}
      </div>
    </div>
  )
}

export default function ShopDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [shop, setShop] = useState<ShopDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [suspendModalOpen, setSuspendModalOpen] = useState(false)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [addAdminModalOpen, setAddAdminModalOpen] = useState(false)
  const [resetPasswordModalOpen, setResetPasswordModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)

  // Delete form
  const [deleteNote, setDeleteNote] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Suspend/activate
  const [suspendReason, setSuspendReason] = useState('')
  const [suspendLoading, setSuspendLoading] = useState(false)
  const [suspendError, setSuspendError] = useState<string | null>(null)

  // Edit shop form
  const [editName, setEditName] = useState('')
  const [editOwnerName, setEditOwnerName] = useState('')
  const [editOwnerPhone, setEditOwnerPhone] = useState('')
  const [editShopNumber, setEditShopNumber] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Payment form
  const [payAmount, setPayAmount] = useState('')
  const [payMonths, setPayMonths] = useState('')
  const [payMethod, setPayMethod] = useState('')
  const [payNote, setPayNote] = useState('')
  const [payLoading, setPayLoading] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [previewNow] = useState(() => Date.now())

  // Add admin form
  const [adminName, setAdminName] = useState('')
  const [adminPhone, setAdminPhone] = useState('')
  const [adminTelegram, setAdminTelegram] = useState('')
  const [adminLogin, setAdminLogin] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)

  // Reset admin password
  const [passwordAdmin, setPasswordAdmin] = useState<ShopAdmin | null>(null)
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [passwordResetNote, setPasswordResetNote] = useState('')
  const [passwordResetLoading, setPasswordResetLoading] = useState(false)
  const [passwordResetError, setPasswordResetError] = useState<string | null>(null)

  // Delete admin
  const [deleteAdminTarget, setDeleteAdminTarget] = useState<ShopAdmin | null>(null)
  const [deleteAdminNote, setDeleteAdminNote] = useState('')
  const [deleteAdminLoading, setDeleteAdminLoading] = useState(false)
  const [deleteAdminError, setDeleteAdminError] = useState<string | null>(null)

  const paymentValid = payAmount.trim() !== '' && payMonths !== '' && payMethod !== ''
  const adminValid =
    adminName.trim() !== '' &&
    adminPhone.trim() !== '' &&
    adminLogin.trim() !== '' &&
    adminPassword.trim() !== ''
  const passwordResetValid =
    !!passwordAdmin &&
    newAdminPassword.trim().length >= 6 &&
    passwordResetNote.trim().length >= 5
  const editValid =
    editName.trim().length >= 2 &&
    editOwnerName.trim().length >= 2 &&
    editOwnerPhone.trim().length >= 9 &&
    editShopNumber.trim().length >= 1
  const isDeleted = shop?.status === 'DELETED' || !!shop?.deletedAt
  const paymentPreview = shop && payMonths
    ? (() => {
        const base = new Date(Math.max(previewNow, new Date(shop.subscriptionDue).getTime()))
        const due = new Date(base)
        due.setMonth(due.getMonth() + Number(payMonths))
        return { base, due }
      })()
    : null

  const fetchShop = useCallback(() => {
    fetch(`/api/shops/${id}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setShop(json.data)
        else setError(json.error ?? "Do'kon topilmadi")
      })
      .catch(() => setError('Xatolik yuz berdi'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    fetchShop()
  }, [fetchShop])

  const resetPayment = () => {
    setPayAmount('')
    setPayMonths('')
    setPayMethod('')
    setPayNote('')
    setPayError(null)
  }

  const resetAdmin = () => {
    setAdminName('')
    setAdminPhone('')
    setAdminTelegram('')
    setAdminLogin('')
    setAdminPassword('')
    setAdminError(null)
  }

  const resetPasswordForm = () => {
    setPasswordAdmin(null)
    setNewAdminPassword('')
    setPasswordResetNote('')
    setPasswordResetError(null)
  }

  const openEditShop = () => {
    if (!shop) return
    setEditName(shop.name)
    setEditOwnerName(shop.ownerName)
    setEditOwnerPhone(shop.ownerPhone)
    setEditShopNumber(shop.shopNumber)
    setEditAddress(shop.address)
    setEditNote(shop.note ?? '')
    setEditError(null)
    setEditModalOpen(true)
  }

  const resetEditShop = () => {
    setEditError(null)
  }

  // Map UI method labels to API enum values
  function methodToEnum(m: string) {
    if (['CASH', 'CARD', 'TRANSFER', 'OTHER'].includes(m)) return m
    if (m === 'Naqd') return 'CASH'
    if (m === 'Karta') return 'CARD'
    if (m === 'Bank') return 'TRANSFER'
    return 'OTHER'
  }

  function methodFromEnum(m: string) {
    if (m === 'CASH') return 'Naqd'
    if (m === 'CARD') return 'Karta'
    if (m === 'TRANSFER') return 'Bank'
    return m
  }

  const handlePaymentSubmit = async () => {
    if (!paymentValid) return
    setPayLoading(true)
    setPayError(null)
    try {
      const res = await fetch(`/api/shops/${id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: id,
          amount: Number(payAmount),
          months: Number(payMonths),
          paymentMethod: methodToEnum(payMethod),
          note: payNote || undefined,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setPaymentModalOpen(false)
        resetPayment()
        fetchShop()
      } else {
        setPayError(json.error ?? "To'lov qo'shishda xatolik")
      }
    } catch {
      setPayError('Xatolik yuz berdi')
    } finally {
      setPayLoading(false)
    }
  }

  const handleSuspendToggle = async () => {
    if (!shop) return
    if (suspendReason.trim().length < 5) {
      setSuspendError("Sabab kamida 5 ta belgidan iborat bo'lishi kerak")
      return
    }
    setSuspendLoading(true)
    setSuspendError(null)
    const newStatus = shop.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
    try {
      const res = await fetch(`/api/shops/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, reason: suspendReason.trim() }),
      })
      const json = await res.json()
      if (json.success) {
        setSuspendModalOpen(false)
        setSuspendReason('')
        setSuspendError(null)
        fetchShop()
      } else {
        setSuspendError(json.error ?? 'Xatolik yuz berdi')
      }
    } catch {
      setSuspendError('Xatolik yuz berdi')
    } finally {
      setSuspendLoading(false)
    }
  }

  const handleEditShop = async () => {
    if (!editValid) return
    setEditLoading(true)
    setEditError(null)
    try {
      const res = await fetch(`/api/shops/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          ownerName: editOwnerName.trim(),
          ownerPhone: editOwnerPhone.trim(),
          shopNumber: editShopNumber.trim(),
          address: editAddress.trim(),
          note: editNote.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setEditModalOpen(false)
        resetEditShop()
        fetchShop()
      } else {
        setEditError(json.error ?? "Do'kon ma'lumotlarini yangilashda xatolik")
      }
    } catch {
      setEditError('Xatolik yuz berdi')
    } finally {
      setEditLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteNote.trim()) return
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/shops/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteNote }),
      })
      const json = await res.json()
      if (json.success) {
        router.push('/admin/shops')
      } else {
        setDeleteError(json.error ?? "O'chirishda xatolik")
      }
    } catch {
      setDeleteError('Xatolik yuz berdi')
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleAddAdmin = async () => {
    if (!adminValid) return
    setAdminLoading(true)
    setAdminError(null)
    try {
      const res = await fetch(`/api/shops/${id}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: adminName,
          phone: adminPhone,
          telegramId: adminTelegram || undefined,
          login: adminLogin,
          password: adminPassword,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setAddAdminModalOpen(false)
        resetAdmin()
        fetchShop()
      } else {
        setAdminError(json.error ?? "Admin qo'shishda xatolik")
      }
    } catch {
      setAdminError('Xatolik yuz berdi')
    } finally {
      setAdminLoading(false)
    }
  }

  const openDeleteAdmin = (admin: ShopAdmin) => {
    setDeleteAdminTarget(admin)
    setDeleteAdminNote('')
    setDeleteAdminError(null)
  }

  const confirmDeleteAdmin = async () => {
    if (!deleteAdminTarget || deleteAdminNote.trim().length < 5 || deleteAdminLoading) return
    setDeleteAdminLoading(true)
    setDeleteAdminError(null)
    try {
      const res = await fetch(`/api/shops/${id}/admins`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: deleteAdminTarget.id, note: deleteAdminNote.trim() }),
      })
      const json = await res.json()
      if (json.success) {
        setDeleteAdminTarget(null)
        setDeleteAdminNote('')
        fetchShop()
      } else {
        setDeleteAdminError(json.error ?? "O'chirishda xatolik")
      }
    } catch {
      setDeleteAdminError('Xatolik yuz berdi')
    } finally {
      setDeleteAdminLoading(false)
    }
  }

  const openPasswordReset = (admin: ShopAdmin) => {
    setPasswordAdmin(admin)
    setNewAdminPassword('')
    setPasswordResetNote('')
    setPasswordResetError(null)
    setResetPasswordModalOpen(true)
  }

  const handleResetAdminPassword = async () => {
    if (!passwordResetValid || !passwordAdmin) return
    setPasswordResetLoading(true)
    setPasswordResetError(null)
    try {
      const res = await fetch(`/api/shops/${id}/admins`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId: passwordAdmin.id,
          password: newAdminPassword,
          note: passwordResetNote,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setResetPasswordModalOpen(false)
        resetPasswordForm()
        fetchShop()
      } else {
        setPasswordResetError(json.error ?? 'Parolni yangilashda xatolik')
      }
    } catch {
      setPasswordResetError('Xatolik yuz berdi')
    } finally {
      setPasswordResetLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto flex items-center justify-center py-20">
        <span className="text-sm text-zinc-400">Yuklanmoqda...</span>
      </div>
    )
  }

  if (error || !shop) {
    return (
      <div className="max-w-4xl mx-auto">
        <Link
          href="/admin/shops"
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 mb-6 transition-colors"
        >
          ← Do&apos;konlar ro&apos;yxatiga qaytish
        </Link>
        <div className="p-4 border border-red-200 bg-red-50 text-sm text-red-600">
          {error ?? "Do'kon topilmadi"}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back */}
      <Link
        href="/admin/shops"
        className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 mb-6 transition-colors"
      >
        ← Do&apos;konlar ro&apos;yxatiga qaytish
      </Link>

      {/* Top row */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-zinc-900">{shop.name}</h1>
          <StatusBadge status={shop.status} />
        </div>
        <div className="flex items-center gap-2">
          {!isDeleted && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3 text-xs rounded-none border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                onClick={openEditShop}
              >
                Tahrirlash
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3 text-xs rounded-none border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                onClick={() => setPaymentModalOpen(true)}
              >
                To&apos;lov qo&apos;shish
              </Button>
            </>
          )}
          {!isDeleted && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs rounded-none border-zinc-200 text-zinc-700 hover:bg-zinc-50"
              onClick={() => setSuspendModalOpen(true)}
            >
              {shop.status === 'ACTIVE' ? "To'xtatish" : "Faollashtirish"}
            </Button>
          )}
          {!isDeleted && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs rounded-none border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => setDeleteModalOpen(true)}
            >
              O&apos;chirish
            </Button>
          )}
        </div>
      </div>

      {isDeleted && (
        <div className="mb-5 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Bu do&apos;kon o&apos;chirilgan. Ma&apos;lumotlar audit uchun faqat ko&apos;rish rejimida ochildi.
          {shop.deleteNote && <span className="block mt-1">Sabab: {shop.deleteNote}</span>}
        </div>
      )}

      {/* Info card */}
      <div className="bg-white border border-zinc-200 p-5 mb-5">
        <h2 className="text-sm font-semibold text-zinc-900 mb-4">Do&apos;kon ma&apos;lumotlari</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
          <InfoRow label="Egasi" value={shop.ownerName} />
          <InfoRow label="Shop ID" value={shop.id} mono />
          <InfoRow label="Tel" value={shop.ownerPhone} mono />
          <InfoRow label="Do'kon raqami" value={shop.shopNumber} />
          <InfoRow label="Manzil" value={shop.address} />
          <InfoRow label="Izoh" value={shop.note ?? ''} />
          <InfoRow
            label="Obuna tugash sanasi"
            value={shop.subscriptionDue ? new Date(shop.subscriptionDue).toLocaleDateString('ru-RU') : '—'}
          />
        </div>
      </div>

      {/* Admins */}
      <div className="bg-white border border-zinc-200 mb-5">
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">Adminlar</h2>
          <button
            className="text-xs text-zinc-500 hover:text-zinc-900 border border-zinc-200 px-2.5 py-1 hover:bg-zinc-50 transition-colors"
            onClick={() => setAddAdminModalOpen(true)}
          >
            + Admin qo&apos;shish
          </button>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-200 bg-zinc-50">
              <TableHead className="text-xs text-zinc-500 font-medium pl-5">Ism</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Login</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Tel</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Telegram ID</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Holat</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium pr-5 text-right">Amallar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shop.admins.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-sm text-zinc-400">
                  Admin topilmadi
                </TableCell>
              </TableRow>
            ) : (
              shop.admins.map((admin) => (
                <TableRow key={admin.id} className="border-zinc-100 hover:bg-zinc-50">
                  <TableCell className="pl-5 text-sm font-medium text-zinc-900">{admin.name}</TableCell>
                  <TableCell className="text-sm text-zinc-500 font-mono">{admin.login}</TableCell>
                  <TableCell className="text-sm text-zinc-500 font-mono">{admin.phone}</TableCell>
                  <TableCell className="text-sm text-zinc-500">
                    {admin.telegramVerifiedAt ? (
                      <span className="text-emerald-700">Ulangan</span>
                    ) : admin.telegramId ? (
                      <span className="text-zinc-500">Tasdiqlanmagan</span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    {admin.isActive ? (
                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-zinc-900 text-white">
                        Faol
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-500">
                        Nofaol
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button
                        onClick={() => openPasswordReset(admin)}
                        className="text-xs text-zinc-500 hover:text-zinc-900 border border-zinc-200 px-2 py-1 hover:bg-zinc-50 transition-colors"
                      >
                        Parol
                      </button>
                      <button
                        onClick={() => openDeleteAdmin(admin)}
                        className="text-xs text-red-500 hover:text-red-700 border border-red-200 px-2 py-1 hover:bg-red-50 transition-colors"
                      >
                        O&apos;chirish
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Payment history */}
      <div className="bg-white border border-zinc-200">
        <div className="px-5 py-4 border-b border-zinc-200">
          <h2 className="text-sm font-semibold text-zinc-900">To&apos;lov tarixi</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-200 bg-zinc-50">
              <TableHead className="text-xs text-zinc-500 font-medium pl-5">Sana</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Miqdor (so&apos;m)</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Oylar</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Usul</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shop.payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-sm text-zinc-400">
                  To&apos;lovlar tarixi yo&apos;q
                </TableCell>
              </TableRow>
            ) : (
              shop.payments.map((p) => (
                <TableRow key={p.id} className="border-zinc-100 hover:bg-zinc-50">
                  <TableCell className="pl-5 text-sm text-zinc-600">
                    {p.paidAt ? new Date(p.paidAt).toLocaleDateString('ru-RU') : '—'}
                  </TableCell>
                  <TableCell className="text-sm font-medium text-zinc-900">
                    {formatMoney(p.amount)}
                  </TableCell>
                  <TableCell className="text-sm text-zinc-500">{p.months} oy</TableCell>
                  <TableCell className="text-sm text-zinc-500">{methodFromEnum(p.paymentMethod)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── DELETE DIALOG ── */}
      <Dialog open={deleteModalOpen} onOpenChange={(v) => { setDeleteModalOpen(v); if (!v) { setDeleteNote(''); setDeleteError(null) } }}>
        <DialogContent className="max-w-md rounded-none">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-zinc-900">
              Do&apos;konni o&apos;chirish
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-500 mt-1">
            <strong className="text-zinc-800">{shop.name}</strong> do&apos;konini o&apos;chirmoqchisiz.
            Bu amalni tasdiqlash uchun sabab ko&apos;rsating.
          </p>
          {deleteError && (
            <p className="text-xs text-red-500 mt-1">{deleteError}</p>
          )}
          <div className="mt-3">
            <label className="block text-xs font-medium text-zinc-700 mb-1.5">
              Sabab <span className="text-red-500">*</span>
            </label>
            <Textarea
              placeholder="O'chirish sababini kiriting..."
              value={deleteNote}
              onChange={(e) => setDeleteNote(e.target.value)}
              className="min-h-[80px] rounded-none border-zinc-200 text-sm"
            />
          </div>
          <DialogFooter className="mt-4 gap-2">
            <button
              onClick={() => { setDeleteModalOpen(false); setDeleteNote(''); setDeleteError(null) }}
              className="h-8 px-4 text-sm border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Bekor qilish
            </button>
            <button
              disabled={!deleteNote.trim() || deleteLoading}
              onClick={handleDelete}
              className="h-8 px-4 text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {deleteLoading ? 'Yuklanmoqda...' : "O'chirishni tasdiqlash"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── SUSPEND / ACTIVATE DIALOG ── */}
      <Dialog open={suspendModalOpen} onOpenChange={(v) => { setSuspendModalOpen(v); if (!v) { setSuspendError(null); setSuspendReason('') } }}>
        <DialogContent className="max-w-md rounded-none">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-zinc-900">
              {shop.status === 'ACTIVE' ? "Do'konni to'xtatish" : "Do'konni faollashtirish"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-500 mt-1">
            {shop.status === 'ACTIVE'
              ? "Rostdan to'xtatmoqchimisiz? Do'kon adminlari tizimga kira olmaydi."
              : "Do'konni faollashtirmoqchimisiz? Adminlar yana tizimga kira oladi."}
          </p>
          {suspendError && (
            <p className="text-xs text-red-500 mt-2">{suspendError}</p>
          )}
          <div className="mt-3">
            <label className="block text-xs font-medium text-zinc-700 mb-1.5">
              Sabab <span className="text-red-500">*</span>
            </label>
            <Textarea
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder={
                shop.status === 'ACTIVE'
                  ? "Masalan: to'lov muddati o'tgani uchun"
                  : "Masalan: to'lov qabul qilindi"
              }
              className="min-h-[72px] rounded-none border-zinc-200 text-sm"
            />
          </div>
          <DialogFooter className="mt-4 gap-2">
            <button
              onClick={() => { setSuspendModalOpen(false); setSuspendError(null) }}
              className="h-8 px-4 text-sm border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Bekor qilish
            </button>
            <button
              disabled={suspendReason.trim().length < 5 || suspendLoading}
              onClick={handleSuspendToggle}
              className="h-8 px-4 text-sm bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {suspendLoading ? 'Yuklanmoqda...' : shop.status === 'ACTIVE' ? "To'xtatish" : "Faollashtirish"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── EDIT SHOP DIALOG ── */}
      <Dialog open={editModalOpen} onOpenChange={(v) => { setEditModalOpen(v); if (!v) resetEditShop() }}>
        <DialogContent className="max-w-md rounded-none">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-zinc-900">
              Do&apos;kon ma&apos;lumotlarini tahrirlash
            </DialogTitle>
          </DialogHeader>
          {editError && (
            <p className="text-xs text-red-500 mt-1">{editError}</p>
          )}
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Do&apos;kon nomi <span className="text-red-500">*</span>
              </label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Egasi <span className="text-red-500">*</span>
              </label>
              <Input
                value={editOwnerName}
                onChange={(e) => setEditOwnerName(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Tel <span className="text-red-500">*</span>
              </label>
              <Input
                value={editOwnerPhone}
                onChange={(e) => setEditOwnerPhone(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Do&apos;kon raqami <span className="text-red-500">*</span>
              </label>
              <Input
                value={editShopNumber}
                onChange={(e) => setEditShopNumber(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">Manzil</label>
              <Input
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">Izoh</label>
              <Textarea
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                className="min-h-[72px] rounded-none border-zinc-200 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="mt-4 gap-2">
            <button
              onClick={() => { setEditModalOpen(false); resetEditShop() }}
              className="h-8 px-4 text-sm border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Bekor qilish
            </button>
            <button
              disabled={!editValid || editLoading}
              onClick={handleEditShop}
              className="h-8 px-4 text-sm bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {editLoading ? 'Saqlanmoqda...' : 'Saqlash'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── PAYMENT DIALOG ── */}
      <Dialog open={paymentModalOpen} onOpenChange={(v) => { setPaymentModalOpen(v); if (!v) resetPayment() }}>
        <DialogContent className="max-w-md rounded-none">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-zinc-900">
              To&apos;lov qo&apos;shish
            </DialogTitle>
          </DialogHeader>
          {payError && (
            <p className="text-xs text-red-500 mt-1">{payError}</p>
          )}
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Miqdor (so&apos;m) <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                placeholder="500000"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Oylar <span className="text-red-500">*</span>
              </label>
              <select
                value={payMonths}
                onChange={(e) => setPayMonths(e.target.value)}
                className="w-full h-8 text-sm border border-zinc-200 bg-white px-2 focus:outline-none focus:ring-1 focus:ring-zinc-400"
              >
                <option value="">Tanlang...</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m} oy</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                To&apos;lov usuli <span className="text-red-500">*</span>
              </label>
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                className="w-full h-8 text-sm border border-zinc-200 bg-white px-2 focus:outline-none focus:ring-1 focus:ring-zinc-400"
              >
                <option value="">Tanlang...</option>
                <option value="CASH">Naqd</option>
                <option value="CARD">Karta</option>
                <option value="TRANSFER">Bank</option>
                <option value="OTHER">Boshqa</option>
              </select>
            </div>
            {paymentPreview && (
              <div className="border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                <div>Joriy muddat: {new Date(shop.subscriptionDue).toLocaleDateString('uz-UZ')}</div>
                <div>Hisoblanadigan sana: {paymentPreview.base.toLocaleDateString('uz-UZ')}</div>
                <div className="font-medium text-zinc-900">
                  Yangi muddat: {paymentPreview.due.toLocaleDateString('uz-UZ')}
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">Izoh</label>
              <Input
                placeholder="Ixtiyoriy izoh..."
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </div>
          </div>
          <DialogFooter className="mt-4 gap-2">
            <button
              onClick={() => { setPaymentModalOpen(false); resetPayment() }}
              className="h-8 px-4 text-sm border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Bekor qilish
            </button>
            <button
              disabled={!paymentValid || payLoading}
              onClick={handlePaymentSubmit}
              className="h-8 px-4 text-sm bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {payLoading ? 'Saqlanmoqda...' : 'Saqlash'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── ADD ADMIN DIALOG ── */}
      <Dialog open={addAdminModalOpen} onOpenChange={(v) => { setAddAdminModalOpen(v); if (!v) resetAdmin() }}>
        <DialogContent className="max-w-md rounded-none">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-zinc-900">
              Admin qo&apos;shish
            </DialogTitle>
          </DialogHeader>
          {adminError && (
            <p className="text-xs text-red-500 mt-1">{adminError}</p>
          )}
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Ism <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="To'liq ism"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Tel <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="+998 90 000 00 00"
                value={adminPhone}
                onChange={(e) => setAdminPhone(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Telegram ID
              </label>
              <Input
                placeholder="@username"
                value={adminTelegram}
                onChange={(e) => setAdminTelegram(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Login <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="login"
                value={adminLogin}
                onChange={(e) => setAdminLogin(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Parol <span className="text-red-500">*</span>
              </label>
              <Input
                type="password"
                placeholder="Kamida 6 ta belgi"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </div>
          </div>
          <DialogFooter className="mt-4 gap-2">
            <button
              onClick={() => { setAddAdminModalOpen(false); resetAdmin() }}
              className="h-8 px-4 text-sm border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Bekor qilish
            </button>
            <button
              disabled={!adminValid || adminLoading}
              onClick={handleAddAdmin}
              className="h-8 px-4 text-sm bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {adminLoading ? 'Saqlanmoqda...' : 'Saqlash'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── RESET ADMIN PASSWORD DIALOG ── */}
      <Dialog open={resetPasswordModalOpen} onOpenChange={(v) => { setResetPasswordModalOpen(v); if (!v) resetPasswordForm() }}>
        <DialogContent className="max-w-md rounded-none">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-zinc-900">
              Admin parolini yangilash
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-500 mt-1">
            <strong className="text-zinc-800">{passwordAdmin?.name}</strong> uchun yangi parol kiriting.
          </p>
          {passwordResetError && (
            <p className="text-xs text-red-500 mt-1">{passwordResetError}</p>
          )}
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Yangi parol <span className="text-red-500">*</span>
              </label>
              <Input
                type="password"
                placeholder="Kamida 6 ta belgi"
                value={newAdminPassword}
                onChange={(e) => setNewAdminPassword(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Sabab <span className="text-red-500">*</span>
              </label>
              <Textarea
                placeholder="Masalan: admin parolini unutdi..."
                value={passwordResetNote}
                onChange={(e) => setPasswordResetNote(e.target.value)}
                className="min-h-[72px] rounded-none border-zinc-200 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="mt-4 gap-2">
            <button
              onClick={() => { setResetPasswordModalOpen(false); resetPasswordForm() }}
              className="h-8 px-4 text-sm border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Bekor qilish
            </button>
            <button
              disabled={!passwordResetValid || passwordResetLoading}
              onClick={handleResetAdminPassword}
              className="h-8 px-4 text-sm bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {passwordResetLoading ? 'Saqlanmoqda...' : 'Parolni yangilash'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteAdminTarget} onOpenChange={(v) => { if (!v) { setDeleteAdminTarget(null); setDeleteAdminNote(''); setDeleteAdminError(null) } }}>
        <DialogContent className="max-w-md rounded-none">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-zinc-900">
              Adminni o&apos;chirish
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-500 mt-1">
            <strong className="text-zinc-800">{deleteAdminTarget?.name}</strong> adminini o&apos;chirmoqchimisiz? Buni bekor qilib bo&apos;lmaydi.
          </p>
          {deleteAdminError && (
            <p className="text-xs text-red-500 mt-1">{deleteAdminError}</p>
          )}
          <div className="mt-3">
            <label className="block text-xs font-medium text-zinc-700 mb-1.5">
              Sabab <span className="text-red-500">*</span>
            </label>
            <Textarea
              placeholder="O'chirish sababini kiriting (kamida 5 belgi)..."
              value={deleteAdminNote}
              onChange={(e) => setDeleteAdminNote(e.target.value)}
              className="min-h-[72px] rounded-none border-zinc-200 text-sm"
            />
          </div>
          <DialogFooter className="mt-4 gap-2">
            <button
              onClick={() => { setDeleteAdminTarget(null); setDeleteAdminNote(''); setDeleteAdminError(null) }}
              className="h-8 px-4 text-sm border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Bekor qilish
            </button>
            <button
              disabled={deleteAdminNote.trim().length < 5 || deleteAdminLoading}
              onClick={confirmDeleteAdmin}
              className="h-8 px-4 text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {deleteAdminLoading ? "O'chirilmoqda..." : "O'chirish"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
