import { describe, expect, it } from 'vitest'
import {
  isPrismaUniqueConstraintOnField,
  SHOP_LOGIN_TAKEN_MESSAGE,
} from '@/lib/shop-login-conflict'

describe('shop login conflict feedback', () => {
  it('uses one actionable message for owner and staff forms', () => {
    expect(SHOP_LOGIN_TAKEN_MESSAGE).toBe(
      'Bu login allaqachon mavjud. Iltimos, boshqa login tanlang.',
    )
  })

  it('recognizes Prisma field-array unique targets', () => {
    expect(isPrismaUniqueConstraintOnField({
      code: 'P2002',
      meta: { target: ['login'] },
    }, 'login')).toBe(true)
  })

  it('recognizes connector index-name unique targets', () => {
    expect(isPrismaUniqueConstraintOnField({
      code: 'P2002',
      meta: { target: 'ShopAdmin_login_key' },
    }, 'login')).toBe(true)
  })

  it('recognizes Prisma 7 driver-adapter constraint fields', () => {
    expect(isPrismaUniqueConstraintOnField({
      code: 'P2002',
      meta: {
        driverAdapterError: {
          cause: {
            constraint: { fields: ['login'] },
          },
        },
      },
    }, 'login')).toBe(true)
  })

  it('does not mislabel another unique constraint as a login conflict', () => {
    expect(isPrismaUniqueConstraintOnField({
      code: 'P2002',
      meta: { target: ['telegramId'] },
    }, 'login')).toBe(false)
    expect(isPrismaUniqueConstraintOnField({ code: 'P2003' }, 'login')).toBe(false)
  })
})
