import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import { normalizePhone } from '@/lib/phone'

export type CustomerSelectionMode = 'EXISTING' | 'NEW'

export class CustomerSelectionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message)
    this.name = 'CustomerSelectionError'
  }
}

/**
 * Resolve one explicit customer choice inside the caller's transaction.
 * Existing customer identity is read-only here: an operation must never
 * rename, merge, or replace phone/passport identity merely because it was
 * selected for a sale. A Nasiya may explicitly attach a missing passport
 * photo, but replacement stays in customer management. New mode always
 * inserts and lets the tenant-scoped
 * active phone/passport indexes report a clear collision.
 */
export async function resolveCustomerSelection(
  tx: Prisma.TransactionClient,
  input: {
    shopId: string
    mode: CustomerSelectionMode
    customerId?: string
    customerName?: string
    customerPhone?: string
    passportPhotoUrl?: string
    requirePassportPhoto?: boolean
  },
) {
  if (input.mode === 'EXISTING') {
    if (!input.customerId) throw new CustomerSelectionError('Mavjud mijoz tanlanishi shart', 400)
    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, shopId: input.shopId, deletedAt: null },
      select: { id: true, shopId: true, name: true, phone: true, passportPhotoUrl: true },
    })
    if (!customer) throw new CustomerSelectionError('Tanlangan mijoz topilmadi', 404)
    if (input.requirePassportPhoto && !customer.passportPhotoUrl && !input.passportPhotoUrl) {
      throw new CustomerSelectionError('Tanlangan mijoz uchun pasport rasmi kiritilishi shart', 400)
    }
    if (input.passportPhotoUrl && !customer.passportPhotoUrl) {
      return tx.customer.update({
        where: { id: customer.id },
        data: { passportPhotoUrl: input.passportPhotoUrl },
        select: { id: true, shopId: true, name: true, phone: true, passportPhotoUrl: true },
      })
    }
    return customer
  }

  const name = input.customerName?.trim()
  const phone = input.customerPhone?.trim()
  if (!name || !phone) {
    throw new CustomerSelectionError("Yangi mijozning ismi va telefoni kiritilishi shart", 400)
  }
  if (input.requirePassportPhoto && !input.passportPhotoUrl) {
    throw new CustomerSelectionError('Yangi nasiya mijozining pasport rasmi kiritilishi shart', 400)
  }

  return tx.customer.create({
    data: {
      shopId: input.shopId,
      name,
      phone,
      normalizedPhone: normalizePhone(phone),
      passportPhotoUrl: input.passportPhotoUrl,
    },
    select: { id: true, shopId: true, name: true, phone: true, passportPhotoUrl: true },
  })
}
