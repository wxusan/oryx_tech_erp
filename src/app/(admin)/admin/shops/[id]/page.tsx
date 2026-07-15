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
import { PhoneInput } from '@/components/ui/phone-input'
import { formatUzPhoneDisplay, isValidPhone } from '@/lib/phone'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { ShopStatusBadge } from '@/components/admin/shop-status-badge'
import { commitNavigationMutation, navigateAfterMutation } from '@/lib/client-events'
import { ShopAdminsTable } from '@/components/admin/shop-admins-table'
import { ShopPaymentsTable } from '@/components/admin/shop-payments-table'
import type { AdminShopDetail as ShopDetail, AdminShopUser as ShopAdmin } from '@/lib/admin-shop-detail-contract'
import { useLogicalCommandIdempotency } from '@/lib/use-logical-command-idempotency'
import { ShopPackageEditor } from '@/components/admin/shop-package-editor'
import type { ShopPackageDraft, ShopPackageDto } from '@/lib/shop-package-contract'
import { tashkentTodayInputValue } from '@/lib/timezone'
import { formatUserFacingMoney } from '@/lib/currency'
import { useAdminCurrency } from '@/lib/use-admin-currency'

interface PackageResponse {
  active: ShopPackageDto | null
  versions: ShopPackageDto[]
}

function draftFromPackage(value: ShopPackageDto): ShopPackageDraft {
  return {
    effectiveOn: tashkentTodayInputValue(),
    basePrice: Number(value.basePrice),
    currency: value.currency,
    discountAmount: Number(value.discountAmount),
    note: "Paket sozlamalari yangilandi",
    features: value.features.map((feature) => ({
      featureCode: feature.featureCode,
      enabled: feature.enabled,
      recurringPrice: Number(feature.recurringPrice),
    })),
  }
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
  const paymentCommand = useLogicalCommandIdempotency()
  const { currency: adminCurrency } = useAdminCurrency()
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
  const [packageModalOpen, setPackageModalOpen] = useState(false)
  const [ownerModalOpen, setOwnerModalOpen] = useState(false)
  const [packageInfo, setPackageInfo] = useState<PackageResponse | null>(null)
  const [packageError, setPackageError] = useState<string | null>(null)
  const [packageSaving, setPackageSaving] = useState(false)
  const [selectedOwnerId, setSelectedOwnerId] = useState('')
  const [ownerReason, setOwnerReason] = useState('')
  const [ownerSaving, setOwnerSaving] = useState(false)
  const [ownerError, setOwnerError] = useState<string | null>(null)

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

  const adminValid =
    adminName.trim() !== '' &&
    isValidPhone(adminPhone) &&
    adminLogin.trim() !== '' &&
    adminPassword.trim().length >= 10
  const passwordResetValid =
    !!passwordAdmin &&
    newAdminPassword.trim().length >= 10 &&
    passwordResetNote.trim().length >= 5
  const editValid =
    editName.trim().length >= 2 &&
    editOwnerName.trim().length >= 2 &&
    isValidPhone(editOwnerPhone) &&
    editShopNumber.trim().length >= 1
  const isDeleted = shop?.status === 'DELETED' || !!shop?.deletedAt
  const activePackage = packageInfo?.active ?? null
  const staffAccessEnabled = activePackage?.features.some((feature) => feature.featureCode === 'STAFF_ACCESS' && feature.enabled) ?? false
  const paymentValid = payAmount.trim() !== '' && payMonths !== '' && payMethod !== '' &&
    Boolean(activePackage && !activePackage.pricingNeedsReview && activePackage.price.recurringPrice > 0)
  const paymentPreview = shop && payMonths
    ? (() => {
        const base = new Date(Math.max(previewNow, new Date(shop.subscriptionDue).getTime()))
        const due = new Date(base)
        due.setMonth(due.getMonth() + Number(payMonths))
        return { base, due }
      })()
    : null
  const activePackageDisplay = activePackage
    ? formatUserFacingMoney({
        amount: activePackage.price.recurringPrice,
        amountCurrency: activePackage.currency,
        displayCurrency: adminCurrency.currency,
        rate: adminCurrency.usdUzsRate,
      })
    : '—'
  const activePackageNative = activePackage
    ? formatUserFacingMoney({
        amount: activePackage.price.recurringPrice,
        amountCurrency: activePackage.currency,
        displayCurrency: activePackage.currency,
      })
    : '—'

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

  const fetchPackage = useCallback(() => {
    fetch(`/api/shops/${id}/package`)
      .then((response) => response.json())
      .then((json) => {
        if (json.success) setPackageInfo(json.data)
        else setPackageError(json.error ?? "Paket topilmadi")
      })
      .catch(() => setPackageError('Paket ma\'lumotini yuklab bo\'lmadi'))
  }, [id])

  useEffect(() => {
    fetchShop()
    fetchPackage()
  }, [fetchPackage, fetchShop])

  const savePackage = async (draft: ShopPackageDraft) => {
    setPackageSaving(true)
    setPackageError(null)
    try {
      const response = await fetch(`/api/shops/${id}/package`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await response.json()
      if (!response.ok || !json.success) throw new Error(json.error ?? "Paketni saqlab bo'lmadi")
      await commitNavigationMutation({ kind: 'admin.shopPackageUpdated', shopId: id })
      setPackageModalOpen(false)
      fetchPackage()
      fetchShop()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Paketni saqlab bo'lmadi"
      setPackageError(message)
      throw caught
    } finally {
      setPackageSaving(false)
    }
  }

  const openOwnerDialog = () => {
    if (!shop) return
    setSelectedOwnerId(shop.ownerAdminId ?? shop.admins.find((admin) => admin.isActive)?.id ?? '')
    setOwnerReason('')
    setOwnerError(null)
    setOwnerModalOpen(true)
  }

  const saveOwner = async () => {
    if (!selectedOwnerId || ownerReason.trim().length < 5) return
    setOwnerSaving(true)
    setOwnerError(null)
    try {
      const response = await fetch(`/api/shops/${id}/owner`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerAdminId: selectedOwnerId, reason: ownerReason.trim() }),
      })
      const json = await response.json()
      if (!response.ok || !json.success) throw new Error(json.error ?? "Do'kon egasini saqlab bo'lmadi")
      await commitNavigationMutation({ kind: 'admin.shopOwnerUpdated', shopId: id })
      setOwnerModalOpen(false)
      fetchShop()
    } catch (caught) {
      setOwnerError(caught instanceof Error ? caught.message : 'Xatolik yuz berdi')
    } finally {
      setOwnerSaving(false)
    }
  }

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

  const handlePaymentSubmit = async () => {
    if (!paymentValid) return
    setPayLoading(true)
    setPayError(null)
    try {
      const payload = {
        shopId: id,
        amount: Number(payAmount),
        months: Number(payMonths),
        paymentMethod: methodToEnum(payMethod),
        note: payNote || undefined,
      }
      const res = await fetch(`/api/shops/${id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': paymentCommand.keyFor(payload) },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        paymentCommand.committed()
        await commitNavigationMutation({ kind: 'admin.shopPaymentRecorded', shopId: id }).catch(() => undefined)
        setPaymentModalOpen(false)
        resetPayment()
        fetchShop()
      } else {
        paymentCommand.rejected(res.status)
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
      if (res.ok && json.success) {
        await commitNavigationMutation({ kind: 'admin.shopUpdated', shopId: id })
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
      if (res.ok && json.success) {
        await commitNavigationMutation({ kind: 'admin.shopUpdated', shopId: id })
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
      if (res.ok && json.success) {
        await navigateAfterMutation(router, '/admin/shops', { kind: 'admin.shopDeleted', shopId: id })
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
      if (res.ok && json.success) {
        await commitNavigationMutation({ kind: 'admin.shopAdminsUpdated', shopId: id })
        setAddAdminModalOpen(false)
        resetAdmin()
        fetchShop()
      } else {
        setAdminError(json.error ?? "Do'kon egasini yaratishda xatolik")
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
      if (res.ok && json.success) {
        await commitNavigationMutation({ kind: 'admin.shopAdminsUpdated', shopId: id })
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
      if (res.ok && json.success) {
        await commitNavigationMutation({ kind: 'admin.shopAdminsUpdated', shopId: id })
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
          <ShopStatusBadge status={shop.status} />
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
                onClick={() => setPackageModalOpen(true)}
                disabled={!activePackage}
              >
                Paket va kirish
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
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900">Do&apos;kon ma&apos;lumotlari</h2>
          {!isDeleted && (
            <button onClick={openOwnerDialog} className="border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50">
              {shop.ownershipStatus === 'RESOLVED' ? "Egasini o'zgartirish" : 'Egasini biriktirish'}
            </button>
          )}
        </div>
        {shop.ownershipStatus !== 'RESOLVED' && (
          <div className="mb-4 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Eski ma&apos;lumotdan do&apos;kon egasini xavfsiz aniqlab bo&apos;lmadi ({shop.ownershipStatus}). Xodimlarni o&apos;chirishdan oldin egani tanlang.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
          <InfoRow label="Egasi" value={shop.ownerName} />
          <InfoRow label="Shop ID" value={shop.id} mono />
          <InfoRow label="Tel" value={formatUzPhoneDisplay(shop.ownerPhone)} mono />
          <InfoRow label="Do'kon raqami" value={shop.shopNumber} />
          <InfoRow label="Manzil" value={shop.address} />
          <InfoRow label="Izoh" value={shop.note ?? ''} />
          <InfoRow
            label="Obuna tugash sanasi"
            value={shop.subscriptionDue ? new Date(shop.subscriptionDue).toLocaleDateString('ru-RU') : '—'}
          />
        </div>
      </div>

      <div className="mb-5 border border-zinc-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Paket va kirish turi</h2>
            {activePackage ? (
              <div className="mt-1 text-sm text-zinc-500">
                <p>{staffAccessEnabled ? 'Egasi va xodimlar' : 'Faqat do\'kon egasi'} · {activePackageDisplay}/oy</p>
                <p className="text-xs text-zinc-400">Paketning asl valyutasi: {activePackageNative}/oy</p>
              </div>
            ) : (
              <p className="mt-1 text-sm text-amber-700">{packageError ?? 'Paket yuklanmoqda...'}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
              Xodim profili: {formatUserFacingMoney({ amount: 0, amountCurrency: adminCurrency.currency, displayCurrency: adminCurrency.currency })}
            </span>
            {activePackage?.pricingNeedsReview && (
              <span className="bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">Narx tekshirilishi kerak</span>
            )}
          </div>
        </div>
        {packageInfo && packageInfo.versions.length > 0 && (
          <div className="mt-3 text-xs text-zinc-500">
            {packageInfo.versions.length} ta o&apos;zgarmas paket versiyasi · faol sana {activePackage?.effectiveOn ?? '—'}
          </div>
        )}
      </div>

      <ShopAdminsTable
        admins={shop.admins}
        onAdd={() => setAddAdminModalOpen(true)}
        onResetPassword={openPasswordReset}
        onDelete={openDeleteAdmin}
        canCreateOwner={shop.ownershipStatus !== 'RESOLVED' && !isDeleted}
      />
      <ShopPaymentsTable payments={shop.payments} />

      <Dialog open={packageModalOpen} onOpenChange={setPackageModalOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto rounded-xl p-0">
          <DialogHeader className="border-b border-zinc-200 px-5 py-4">
            <DialogTitle className="text-base font-semibold text-zinc-900">Paket, narx va kirish turini boshqarish</DialogTitle>
          </DialogHeader>
          <div className="p-4 sm:p-5">
            {activePackage ? (
              <ShopPackageEditor
                key={activePackage.id}
                initialValue={draftFromPackage(activePackage)}
                onSubmit={savePackage}
                isSaving={packageSaving}
                minimumEffectiveOn={tashkentTodayInputValue()}
                error={packageError}
              />
            ) : (
              <div className="p-8 text-center text-sm text-zinc-500">Paket ma&apos;lumoti topilmadi.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={ownerModalOpen} onOpenChange={setOwnerModalOpen}>
        <DialogContent className="max-w-md rounded-lg">
          <DialogHeader><DialogTitle>Do&apos;kon egasini biriktirish</DialogTitle></DialogHeader>
          <p className="text-sm text-zinc-500">Tanlangan profil to&apos;liq egasi vakolatini oladi. Oldingi faol sessiyalar xavfsizlik uchun yakunlanadi.</p>
          {ownerError && <div className="border border-red-200 bg-red-50 p-3 text-sm text-red-700">{ownerError}</div>}
          <Field label="Egasi profili" required>
            <select value={selectedOwnerId} onChange={(event) => setSelectedOwnerId(event.target.value)} className="h-9 w-full border border-zinc-200 bg-white px-2 text-sm">
              <option value="">Tanlang...</option>
              {shop.admins.filter((admin) => admin.isActive).map((admin) => (
                <option key={admin.id} value={admin.id}>{admin.name} · {admin.login}</option>
              ))}
            </select>
          </Field>
          <Field label="Sabab" required help="Kamida 5 ta belgi">
            <Textarea value={ownerReason} onChange={(event) => setOwnerReason(event.target.value)} placeholder="Masalan: egasi bilan tasdiqlandi" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOwnerModalOpen(false)}>Bekor qilish</Button>
            <Button disabled={!selectedOwnerId || ownerReason.trim().length < 5 || ownerSaving} onClick={() => void saveOwner()} className="bg-zinc-900 text-white hover:bg-zinc-800">
              {ownerSaving ? 'Saqlanmoqda...' : 'Egani saqlash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <Field label="Sabab" required className="mt-3">
            <Textarea
              placeholder="O'chirish sababini kiriting..."
              value={deleteNote}
              onChange={(e) => setDeleteNote(e.target.value)}
              className="min-h-[80px] rounded-none border-zinc-200 text-sm"
            />
          </Field>
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
          <Field label="Sabab" required className="mt-3">
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
          </Field>
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
            <Field label={<>Do&apos;kon nomi</>} required>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </Field>
            <Field label="Egasi" required>
              <Input
                value={editOwnerName}
                onChange={(e) => setEditOwnerName(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </Field>
            <Field label="Tel" required>
              <PhoneInput
                value={editOwnerPhone}
                onChange={setEditOwnerPhone}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </Field>
            <Field label={<>Do&apos;kon raqami</>} required>
              <Input
                value={editShopNumber}
                onChange={(e) => setEditShopNumber(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </Field>
            <Field label="Manzil">
              <Input
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </Field>
            <Field label="Izoh">
              <Textarea
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                className="min-h-[72px] rounded-none border-zinc-200 text-sm"
              />
            </Field>
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
            <Field label={`Miqdor (${activePackage?.currency ?? 'UZS'})`} required help="Faol paket narxi va tanlangan oylar sonidan avtomatik hisoblanadi">
              <MoneyInput
                placeholder="500000"
                value={payAmount}
                onChange={setPayAmount}
                currency={activePackage?.currency}
                readOnly
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </Field>
            <Field label="Oylar" required>
              <select
                value={payMonths}
                onChange={(e) => {
                  const months = e.target.value
                  setPayMonths(months)
                  if (!months || !activePackage) {
                    setPayAmount('')
                    return
                  }
                  const amount = activePackage.price.recurringPrice * Number(months)
                  setPayAmount(activePackage.currency === 'USD' ? amount.toFixed(2) : amount.toFixed(0))
                }}
                className="w-full h-8 text-sm border border-zinc-200 bg-white px-2 focus:outline-none focus:ring-1 focus:ring-zinc-400"
              >
                <option value="">Tanlang...</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m} oy</option>
                ))}
              </select>
            </Field>
            {activePackage?.pricingNeedsReview && (
              <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                To&apos;lov qabul qilishdan oldin paket narxini tasdiqlang.
              </div>
            )}
            <Field label={<>To&apos;lov usuli</>} required>
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
            </Field>
            {paymentPreview && (
              <div className="border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                <div>Joriy muddat: {new Date(shop.subscriptionDue).toLocaleDateString('uz-UZ')}</div>
                <div>Hisoblanadigan sana: {paymentPreview.base.toLocaleDateString('uz-UZ')}</div>
                <div className="font-medium text-zinc-900">
                  Yangi muddat: {paymentPreview.due.toLocaleDateString('uz-UZ')}
                </div>
              </div>
            )}
            <Field label="Izoh">
              <Input
                placeholder="Ixtiyoriy izoh..."
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </Field>
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
              Do&apos;kon egasini yaratish
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-500">
            Ega do&apos;konning to&apos;liq boshqaruv vakolatini oladi. Xodimlarni keyin faqat shu ega yaratadi va boshqaradi.
          </p>
          {adminError && (
            <p className="text-xs text-red-500 mt-1">{adminError}</p>
          )}
          <div className="mt-3 space-y-3">
            <Field label="Ism" required>
              <Input
                placeholder="To'liq ism"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </Field>
            <Field label="Tel" required>
              <PhoneInput
                value={adminPhone}
                onChange={setAdminPhone}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </Field>
            <Field label="Telegram ID">
              <Input
                placeholder="123456789"
                inputMode="numeric"
                value={adminTelegram}
                onChange={(e) => setAdminTelegram(e.target.value.replace(/\D/g, ''))}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </Field>
            <Field label="Login" required>
              <Input
                placeholder="login"
                value={adminLogin}
                onChange={(e) => setAdminLogin(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </Field>
            <Field label="Parol" required help="Kamida 10 ta belgi">
              <Input
                type="password"
                placeholder="Kamida 10 ta belgi"
                minLength={10}
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </Field>
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
            <Field label="Yangi parol" required help="Kamida 10 ta belgi">
              <Input
                type="password"
                placeholder="Kamida 10 ta belgi"
                minLength={10}
                value={newAdminPassword}
                onChange={(e) => setNewAdminPassword(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </Field>
            <Field label="Sabab" required>
              <Textarea
                placeholder="Masalan: admin parolini unutdi..."
                value={passwordResetNote}
                onChange={(e) => setPasswordResetNote(e.target.value)}
                className="min-h-[72px] rounded-none border-zinc-200 text-sm"
              />
            </Field>
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
          <Field label="Sabab" required className="mt-3">
            <Textarea
              placeholder="O'chirish sababini kiriting (kamida 5 belgi)..."
              value={deleteAdminNote}
              onChange={(e) => setDeleteAdminNote(e.target.value)}
              className="min-h-[72px] rounded-none border-zinc-200 text-sm"
            />
          </Field>
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
