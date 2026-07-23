// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  ImageViewer,
  useImageViewer,
  type ImageViewerItem,
} from '@/components/ui/image-viewer'

const images: ImageViewerItem[] = [
  { id: 'first', src: '/first.jpg', alt: 'Birinchi rasm' },
  { id: 'second', src: '/second.jpg', alt: 'Ikkinchi rasm' },
  { id: 'third', src: '/third.jpg', alt: 'Uchinchi rasm' },
]

afterEach(cleanup)

function ViewerHarness({
  items = images,
  initialIndex = 0,
  nested = false,
}: {
  items?: ImageViewerItem[]
  initialIndex?: number
  nested?: boolean
}) {
  const viewer = useImageViewer()
  const content = (
    <>
      <button type="button" onClick={(event) => viewer.openAt(initialIndex, event.currentTarget)}>
        Kattalashtirish
      </button>
      <ImageViewer
        images={items}
        open={viewer.open}
        activeIndex={viewer.activeIndex}
        onOpenChange={viewer.onOpenChange}
        onActiveIndexChange={viewer.onActiveIndexChange}
        finalFocusRef={viewer.finalFocusRef}
      />
    </>
  )

  if (!nested) return content

  return (
    <Dialog open>
      <DialogContent showCloseButton={false}>
        <DialogTitle>Tahrirlash oynasi</DialogTitle>
        {content}
      </DialogContent>
    </Dialog>
  )
}

describe('full-screen image viewer', () => {
  it('shows only valid previous/next controls and never wraps', async () => {
    const user = userEvent.setup()
    render(<ViewerHarness />)

    await user.click(screen.getByRole('button', { name: 'Kattalashtirish' }))
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('img', { name: 'Birinchi rasm' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Oldingi rasm' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Keyingi rasm' })).toBeTruthy()
    expect(screen.getByText('1 / 3')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Keyingi rasm' }))
    expect(screen.getByRole('img', { name: 'Ikkinchi rasm' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Oldingi rasm' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keyingi rasm' })).toBeTruthy()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('img', { name: 'Uchinchi rasm' })).toBeTruthy()
    expect(screen.getByText('3 / 3')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Keyingi rasm' })).toBeNull()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('img', { name: 'Uchinchi rasm' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Rasm oynasini yopish' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rasmni to‘liq ekranda ko‘rish' })).toBeNull())
  })

  it('has no arrows or bottom toolbar for a single image', async () => {
    const user = userEvent.setup()
    render(<ViewerHarness items={[images[0]]} />)

    await user.click(screen.getByRole('button', { name: 'Kattalashtirish' }))
    expect(screen.getByRole('img', { name: 'Birinchi rasm' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Oldingi rasm' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Keyingi rasm' })).toBeNull()
    expect(screen.queryByText('1 / 1')).toBeNull()
    expect(screen.queryByRole('button', { name: /download|yuklab|share|ulash|edit|tahrir|delete|o‘chirish|zoom/i })).toBeNull()
  })

  it('supports keyboard navigation, Escape, and focus restoration from a nested dialog', async () => {
    const user = userEvent.setup()
    render(<ViewerHarness initialIndex={1} nested />)
    const trigger = screen.getByRole('button', { name: 'Kattalashtirish' })

    await user.click(trigger)
    expect(screen.getByRole('img', { name: 'Ikkinchi rasm' })).toBeTruthy()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('img', { name: 'Birinchi rasm' })).toBeTruthy()
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('img', { name: 'Birinchi rasm' })).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })
    expect(screen.getByRole('dialog', { name: 'Tahrirlash oynasi' })).toBeTruthy()
  })
})
