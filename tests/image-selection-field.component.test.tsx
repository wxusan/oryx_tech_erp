// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ImageSelectionField,
  useImageSelection,
  type ImageSelectionController,
} from '@/components/ui/image-selection-field'

const createObjectURL = vi.fn((file: File) => `blob:${file.name}:${file.lastModified}`)
const revokeObjectURL = vi.fn()

beforeEach(() => {
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Harness({ onController }: { onController?: (controller: ImageSelectionController) => void }) {
  const selection = useImageSelection({ mode: 'multiple', uploadEndpoint: '/api/uploads/device', maxFiles: 3 })
  onController?.(selection)
  return <ImageSelectionField inputId="shared-images" label="Qurilma rasmlari" mode="multiple" selection={selection} />
}

describe('shared image selection lifecycle and accessibility', () => {
  it('previews metadata, reorders deterministically, replaces, removes, and revokes every local URL', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness />)
    const first = new File(['first'], 'first.jpg', { type: 'image/jpeg', lastModified: 1 })
    const second = new File(['second'], 'second.png', { type: 'image/png', lastModified: 2 })

    await user.upload(screen.getByLabelText('Rasm tanlash'), [first, second])
    expect(screen.getByAltText(/1-rasm, first\.jpg/)).toBeTruthy()
    expect(screen.getByText('5 B')).toBeTruthy()
    expect(screen.getByText('6 B')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'second.png rasmini oldinga surish' }))
    expect(screen.getAllByRole('img')[0]?.getAttribute('alt')).toContain('second.png')

    const replacement = new File(['new'], 'replacement.webp', { type: 'image/webp', lastModified: 3 })
    const replaceInput = screen.getAllByLabelText('second.png rasmini almashtirish').find((element) => element.tagName === 'INPUT')
    await user.upload(replaceInput!, replacement)
    expect(screen.getByAltText(/replacement\.webp/)).toBeTruthy()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:second.png:2')

    await user.click(screen.getByRole('button', { name: 'first.jpg rasmini olib tashlash' }))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first.jpg:1')
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:replacement.webp:3')
  })

  it('keeps invalid images visible with a per-image error and prevents upload', async () => {
    let controller: ImageSelectionController | undefined
    render(<Harness onController={(value) => { controller = value }} />)
    const invalid = new File(['x'], 'bad.gif', { type: 'image/gif' })
    fireEvent.change(screen.getByLabelText('Rasm tanlash'), { target: { files: [invalid] } })
    expect(screen.getByRole('alert').textContent).toContain('Faqat JPG, PNG yoki WEBP')
    expect(controller?.hasBlockingErrors).toBe(true)
    await expect(controller!.uploadAll()).rejects.toThrow('Faqat JPG, PNG yoki WEBP')
  })

  it('uses accessible ordering controls without requiring drag-and-drop', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.upload(screen.getByLabelText('Rasm tanlash'), [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ])
    expect(screen.getByRole('button', { name: 'a.jpg rasmini oldinga surish' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'a.jpg rasmini keyinga surish' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'b.jpg rasmini keyinga surish' }).hasAttribute('disabled')).toBe(true)
  })

  it('opens local blob previews in their current order and omits invalid placeholders', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.upload(screen.getByLabelText('Rasm tanlash'), [
      new File(['a'], 'a.jpg', { type: 'image/jpeg', lastModified: 10 }),
      new File(['b'], 'b.png', { type: 'image/png', lastModified: 11 }),
      new File(['x'], 'bad.gif', { type: 'image/gif', lastModified: 12 }),
    ])

    expect(screen.getAllByRole('button', { name: /rasmini kattalashtirish/ })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'bad.gif rasmini kattalashtirish' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'b.png rasmini oldinga surish' }))
    await user.click(screen.getByRole('button', { name: 'b.png rasmini kattalashtirish' }))
    expect(screen.getByRole('img', { name: /1-rasm, b\.png/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Oldingi rasm' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Keyingi rasm' })).toBeTruthy()
  })
})

class FakeUploadTarget {
  private listeners = new Map<string, Array<(event: ProgressEvent) => void>>()

  addEventListener(name: string, listener: EventListener) {
    const current = this.listeners.get(name) ?? []
    current.push(listener as (event: ProgressEvent) => void)
    this.listeners.set(name, current)
  }

  emit(name: string, event: ProgressEvent) {
    for (const listener of this.listeners.get(name) ?? []) listener(event)
  }
}

class FakeXMLHttpRequest {
  static attempts = 0
  upload = new FakeUploadTarget()
  responseText = ''
  status = 0
  responseType = ''
  private listeners = new Map<string, Array<() => void>>()

  open() {}

  addEventListener(name: string, listener: EventListener) {
    const current = this.listeners.get(name) ?? []
    current.push(listener as () => void)
    this.listeners.set(name, current)
  }

  abort() {
    this.emit('abort')
  }

  send() {
    FakeXMLHttpRequest.attempts += 1
    this.upload.emit('progress', { lengthComputable: true, loaded: 1, total: 2 } as ProgressEvent)
    if (FakeXMLHttpRequest.attempts === 1) {
      this.status = 503
      this.responseText = JSON.stringify({ success: false, error: 'Vaqtincha yuklanmadi' })
    } else {
      this.status = 200
      this.responseText = JSON.stringify({ success: true, data: { reference: 'v1.opaque-device-reference' } })
    }
    this.emit('load')
  }

  private emit(name: string) {
    for (const listener of this.listeners.get(name) ?? []) listener()
  }
}

describe('per-image upload retry', () => {
  it('retains the failed item and retries it without resetting the selection', async () => {
    FakeXMLHttpRequest.attempts = 0
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
    const { result, unmount } = renderHook(() => useImageSelection({ mode: 'single', uploadEndpoint: '/api/uploads/device' }))
    const file = new File(['retry'], 'retry.jpg', { type: 'image/jpeg' })

    act(() => result.current.addFiles([file]))
    await act(async () => {
      await expect(result.current.uploadAll()).rejects.toThrow('Vaqtincha yuklanmadi')
    })
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]?.uploadStatus).toBe('error')

    let key = ''
    await act(async () => {
      key = await result.current.retryUpload(result.current.items[0]!.id)
    })
    expect(key).toBe('v1.opaque-device-reference')
    expect(result.current.items[0]?.uploadStatus).toBe('uploaded')
    expect(result.current.items[0]?.uploadProgress).toBe(100)
    unmount()
  })
})

describe('image-input source inventory', () => {
  it('keeps every raw file input inside the shared component and covers every business call site', async () => {
    const { readFile, readdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const root = join(process.cwd(), 'src')
    const files: string[] = []
    async function walk(directory: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await walk(path)
        else if (/\.(tsx|ts)$/.test(entry.name)) files.push(path)
      }
    }
    await walk(root)
    const rawFileInputs: string[] = []
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (/type=["']file["']/.test(source) && !/accept=["'][^"']*\.csv/.test(source)) rawFileInputs.push(file)
    }
    expect(rawFileInputs).toEqual([join(root, 'components/ui/image-selection-field.tsx')])

    const requiredConsumers = [
      'app/(shop)/shop/qurilmalar/new/page.tsx',
      'app/(shop)/shop/qurilmalar/[id]/page.tsx',
      'app/(shop)/shop/olib-sotdim/new/page.tsx',
      'app/(shop)/shop/nasiyalar/new/page.tsx',
      'app/(shop)/shop/nasiyalar/import/page.tsx',
      'app/(shop)/shop/mijozlar/customers-client.tsx',
    ]
    for (const relative of requiredConsumers) {
      expect(await readFile(join(root, relative), 'utf8')).toContain('ImageSelectionField')
    }
  })

  it('keeps every rendered device or passport photo wired to the shared viewer', async () => {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const root = join(process.cwd(), 'src')
    const directPhotoSurfaces = [
      'app/(shop)/shop/qurilmalar/[id]/page.tsx',
      'app/(shop)/shop/qarzlar/qarzlar-client.tsx',
      'app/(shop)/shop/nasiyalar/[id]/page.tsx',
      'app/(shop)/shop/nasiyalar/new/page.tsx',
      'components/shop/customer-passport-panel.tsx',
      'components/ui/image-selection-field.tsx',
    ]

    for (const relative of directPhotoSurfaces) {
      const source = await readFile(join(root, relative), 'utf8')
      expect(source, relative).toContain('ImageViewerTrigger')
      expect(source, relative).toContain('ImageViewer')
    }

    const deviceDetail = await readFile(
      join(root, 'app/(shop)/shop/qurilmalar/[id]/page.tsx'),
      'utf8',
    )
    expect(deviceDetail).not.toMatch(/target=["']_blank["'][\s\S]{0,500}getDeviceImageSrc/)
  })
})
