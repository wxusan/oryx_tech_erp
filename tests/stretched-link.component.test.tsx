// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StretchedLink } from '@/components/ui/stretched-link'

afterEach(cleanup)

describe('StretchedLink', () => {
  it('renders a genuine accessible anchor with a full-surface focus treatment', () => {
    render(
      <div className="relative">
        <StretchedLink href="/shop/qurilmalar/device-1" aria-label="Qurilma ma'lumotlarini ochish">
          <span>Qurilma</span>
        </StretchedLink>
      </div>,
    )

    const link = screen.getByRole('link', { name: "Qurilma ma'lumotlarini ochish" })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/shop/qurilmalar/device-1')
    expect(link.getAttribute('data-slot')).toBe('stretched-link')
    expect(link.className).toContain('after:absolute')
    expect(link.className).toContain('focus-visible:after:ring-2')
  })
})
