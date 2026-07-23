'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ImagePlus, RefreshCw, Replace, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ImageViewer, useImageViewer } from '@/components/ui/image-viewer'
import { ImageViewerTrigger } from '@/components/ui/image-viewer-trigger'

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024
const DEFAULT_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type ImageUploadStatus = 'ready' | 'uploading' | 'uploaded' | 'error'

export interface SavedImageSelection {
  key: string
  previewUrl: string
  filename?: string
}

export interface ImageSelectionItem {
  id: string
  file: File | null
  previewUrl: string
  savedKey: string | null
  filename: string
  size: number | null
  validationError: string | null
  uploadStatus: ImageUploadStatus
  uploadProgress: number
  uploadError: string | null
  uploadedKey: string | null
}

export interface UseImageSelectionOptions {
  mode: 'single' | 'multiple'
  uploadEndpoint: string
  maxFiles?: number
  maxFileSize?: number
  acceptedTypes?: readonly string[]
}

export interface ImageSelectionController {
  items: ImageSelectionItem[]
  selectionError: string | null
  hasBlockingErrors: boolean
  addFiles: (files: FileList | readonly File[]) => void
  replaceFile: (id: string, file: File) => void
  remove: (id: string) => void
  move: (id: string, direction: -1 | 1) => void
  clear: () => void
  resetSavedImages: (images: readonly SavedImageSelection[]) => void
  uploadAll: () => Promise<string[]>
  retryUpload: (id: string) => Promise<string>
}

interface UploadResponse {
  success?: boolean
  error?: string
  data?: { reference?: string }
}

let imageSelectionSequence = 0

function nextSelectionId() {
  imageSelectionSequence += 1
  return `image-selection-${imageSelectionSequence}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function itemValidationError(file: File, acceptedTypes: ReadonlySet<string>, maxFileSize: number) {
  if (!acceptedTypes.has(file.type)) return 'Faqat JPG, PNG yoki WEBP rasm tanlang'
  if (file.size <= 0) return "Bo'sh faylni yuklab bo'lmaydi"
  if (file.size > maxFileSize) return `Rasm ${formatBytes(maxFileSize)} dan oshmasligi kerak`
  return null
}

function createLocalItem(file: File, acceptedTypes: ReadonlySet<string>, maxFileSize: number): ImageSelectionItem {
  return {
    id: nextSelectionId(),
    file,
    previewUrl: URL.createObjectURL(file),
    savedKey: null,
    filename: file.name || 'Nomsiz rasm',
    size: file.size,
    validationError: itemValidationError(file, acceptedTypes, maxFileSize),
    uploadStatus: 'ready',
    uploadProgress: 0,
    uploadError: null,
    uploadedKey: null,
  }
}

function createSavedItem(image: SavedImageSelection): ImageSelectionItem {
  return {
    id: nextSelectionId(),
    file: null,
    previewUrl: image.previewUrl,
    savedKey: image.key,
    filename: image.filename ?? 'Saqlangan rasm',
    size: null,
    validationError: null,
    uploadStatus: 'uploaded',
    uploadProgress: 100,
    uploadError: null,
    uploadedKey: image.key,
  }
}

function revokeLocalPreview(item: ImageSelectionItem) {
  if (item.file && item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
}

function parseUploadResponse(xhr: XMLHttpRequest): UploadResponse {
  try {
    return JSON.parse(xhr.responseText) as UploadResponse
  } catch {
    return {}
  }
}

export function useImageSelection({
  mode,
  uploadEndpoint,
  maxFiles = mode === 'single' ? 1 : 10,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  acceptedTypes = DEFAULT_ACCEPTED_TYPES,
}: UseImageSelectionOptions): ImageSelectionController {
  const [items, setItemsState] = useState<ImageSelectionItem[]>([])
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const itemsRef = useRef<ImageSelectionItem[]>([])
  const requestsRef = useRef(new Map<string, XMLHttpRequest>())
  const acceptedTypeSetRef = useRef(new Set(acceptedTypes))

  function commit(next: ImageSelectionItem[] | ((current: ImageSelectionItem[]) => ImageSelectionItem[])) {
    setItemsState((current) => {
      const resolved = typeof next === 'function' ? next(current) : next
      itemsRef.current = resolved
      return resolved
    })
  }

  function cancelRequest(id: string) {
    const request = requestsRef.current.get(id)
    if (request) request.abort()
    requestsRef.current.delete(id)
  }

  function dispose(itemsToDispose: readonly ImageSelectionItem[]) {
    for (const item of itemsToDispose) {
      cancelRequest(item.id)
      revokeLocalPreview(item)
    }
  }

  useEffect(() => {
    const requests = requestsRef.current
    return () => {
      for (const request of requests.values()) request.abort()
      requests.clear()
      for (const item of itemsRef.current) revokeLocalPreview(item)
      itemsRef.current = []
    }
  }, [])

  function addFiles(filesInput: FileList | readonly File[]) {
    const files = Array.from(filesInput)
    if (files.length === 0) return
    setSelectionError(null)

    if (mode === 'single') {
      dispose(itemsRef.current)
      commit([createLocalItem(files[0], acceptedTypeSetRef.current, maxFileSize)])
      return
    }

    const available = Math.max(0, maxFiles - itemsRef.current.length)
    const accepted = files.slice(0, available)
    if (accepted.length < files.length) {
      setSelectionError(`Ko'pi bilan ${maxFiles} ta rasm tanlash mumkin`)
    }
    if (accepted.length > 0) {
      commit((current) => [
        ...current,
        ...accepted.map((file) => createLocalItem(file, acceptedTypeSetRef.current, maxFileSize)),
      ])
    }
  }

  function replaceFile(id: string, file: File) {
    setSelectionError(null)
    cancelRequest(id)
    commit((current) => current.map((item) => {
      if (item.id !== id) return item
      revokeLocalPreview(item)
      const replacement = createLocalItem(file, acceptedTypeSetRef.current, maxFileSize)
      return { ...replacement, id }
    }))
  }

  function remove(id: string) {
    const item = itemsRef.current.find((candidate) => candidate.id === id)
    if (!item) return
    cancelRequest(id)
    revokeLocalPreview(item)
    commit((current) => current.filter((candidate) => candidate.id !== id))
    setSelectionError(null)
  }

  function move(id: string, direction: -1 | 1) {
    commit((current) => {
      const index = current.findIndex((item) => item.id === id)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      const reordered = [...current]
      const [item] = reordered.splice(index, 1)
      reordered.splice(nextIndex, 0, item)
      return reordered
    })
  }

  function clear() {
    dispose(itemsRef.current)
    commit([])
    setSelectionError(null)
  }

  function resetSavedImages(images: readonly SavedImageSelection[]) {
    dispose(itemsRef.current)
    const limited = images.slice(0, mode === 'single' ? 1 : maxFiles).map(createSavedItem)
    commit(limited)
    setSelectionError(null)
  }

  function updateItem(id: string, update: Partial<ImageSelectionItem>) {
    commit((current) => current.map((item) => item.id === id ? { ...item, ...update } : item))
  }

  function uploadOne(id: string): Promise<string> {
    const item = itemsRef.current.find((candidate) => candidate.id === id)
    if (!item) return Promise.reject(new Error('Rasm tanlovi topilmadi'))
    if (item.validationError) return Promise.reject(new Error(item.validationError))
    if (item.uploadedKey) return Promise.resolve(item.uploadedKey)
    if (!item.file) return Promise.reject(new Error('Yuklanadigan rasm fayli topilmadi'))
    const file = item.file

    cancelRequest(id)
    updateItem(id, { uploadStatus: 'uploading', uploadProgress: 0, uploadError: null })

    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      requestsRef.current.set(id, xhr)
      xhr.open('POST', uploadEndpoint)
      xhr.responseType = 'text'
      xhr.upload.addEventListener('progress', (event) => {
        if (!event.lengthComputable) return
        updateItem(id, { uploadProgress: Math.min(99, Math.round((event.loaded / event.total) * 100)) })
      })
      xhr.addEventListener('load', () => {
        requestsRef.current.delete(id)
        const body = parseUploadResponse(xhr)
        const reference = body.data?.reference
        if (xhr.status >= 200 && xhr.status < 300 && body.success && reference) {
          updateItem(id, { uploadStatus: 'uploaded', uploadProgress: 100, uploadError: null, uploadedKey: reference })
          resolve(reference)
          return
        }
        const message = body.error || 'Rasmni yuklab bo\'lmadi'
        updateItem(id, { uploadStatus: 'error', uploadError: message })
        reject(new Error(message))
      })
      xhr.addEventListener('error', () => {
        requestsRef.current.delete(id)
        const message = "Tarmoq xatosi sabab rasm yuklanmadi"
        updateItem(id, { uploadStatus: 'error', uploadError: message })
        reject(new Error(message))
      })
      xhr.addEventListener('abort', () => {
        requestsRef.current.delete(id)
        reject(new Error('Rasm yuklash bekor qilindi'))
      })

      const body = new FormData()
      body.append('file', file)
      xhr.send(body)
    })
  }

  async function uploadAll() {
    const snapshot = [...itemsRef.current]
    const invalid = snapshot.find((item) => item.validationError)
    if (invalid) throw new Error(invalid.validationError ?? 'Rasm tanlovini tekshiring')
    return Promise.all(snapshot.map((item) => uploadOne(item.id)))
  }

  return {
    items,
    selectionError,
    hasBlockingErrors: items.some((item) => Boolean(item.validationError || item.uploadError)),
    addFiles,
    replaceFile,
    remove,
    move,
    clear,
    resetSavedImages,
    uploadAll,
    retryUpload: uploadOne,
  }
}

export interface ImageSelectionFieldProps {
  inputId: string
  label: string
  selection: ImageSelectionController
  mode: 'single' | 'multiple'
  required?: boolean
  disabled?: boolean
  help?: string
  className?: string
  previewClassName?: string
}

function statusCopy(item: ImageSelectionItem) {
  if (item.validationError) return item.validationError
  if (item.uploadStatus === 'uploading') return `Yuklanmoqda: ${item.uploadProgress}%`
  if (item.uploadStatus === 'uploaded') return item.savedKey ? 'Saqlangan rasm' : 'Yuklandi'
  if (item.uploadStatus === 'error') return item.uploadError ?? 'Yuklashda xatolik'
  return 'Brauzer tekshiruvidan o‘tdi; fayl tarkibi serverda ham tekshiriladi'
}

export function ImageSelectionField({
  inputId,
  label,
  selection,
  mode,
  required = false,
  disabled = false,
  help = 'JPG, PNG yoki WEBP; har bir rasm 5 MB gacha',
  className,
  previewClassName,
}: ImageSelectionFieldProps) {
  const helpId = `${inputId}-help`
  const errorId = `${inputId}-error`
  const hasError = Boolean(selection.selectionError || selection.items.some((item) => item.validationError))
  const imageViewer = useImageViewer()
  const previewableItems = selection.items.filter((item) => (
    !item.file || DEFAULT_ACCEPTED_TYPES.includes(item.file.type as (typeof DEFAULT_ACCEPTED_TYPES)[number])
  ))
  const viewerImages = previewableItems.map((item) => ({
    id: item.id,
    src: item.previewUrl,
    alt: `${label}: ${selection.items.findIndex((candidate) => candidate.id === item.id) + 1}-rasm, ${item.filename}`,
  }))

  return (
    <>
      <fieldset className={cn('min-w-0', className)} disabled={disabled} aria-describedby={`${helpId}${hasError ? ` ${errorId}` : ''}`}>
        <legend className="text-xs font-medium text-zinc-700">
          {label}
          {required && <span aria-hidden="true" className="ml-1 text-red-500">*</span>}
        </legend>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label
            htmlFor={inputId}
            className={cn(
              'inline-flex min-h-9 cursor-pointer items-center gap-2 rounded border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <ImagePlus size={16} aria-hidden="true" />
            {mode === 'single' && selection.items.length ? 'Rasmni almashtirish' : 'Rasm tanlash'}
            <input
              id={inputId}
              data-image-selection-input
              type="file"
              accept={DEFAULT_ACCEPTED_TYPES.join(',')}
              multiple={mode === 'multiple'}
              required={required && selection.items.length === 0}
              aria-required={required || undefined}
              aria-invalid={hasError || undefined}
              aria-describedby={`${helpId}${hasError ? ` ${errorId}` : ''}`}
              disabled={disabled}
              onChange={(event) => {
                if (event.target.files) selection.addFiles(event.target.files)
                event.target.value = ''
              }}
              className="sr-only"
            />
          </label>
          <span className="text-xs text-zinc-500" aria-live="polite">
            {selection.items.length ? `${selection.items.length} ta rasm tanlandi` : 'Rasm tanlanmagan'}
          </span>
        </div>

        {selection.items.length > 0 && (
          <ol
            className={cn(
              'mt-3 grid min-w-0 gap-3',
              mode === 'single' ? 'grid-cols-1' : 'grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-3',
            )}
            aria-label={`${label} tartibi`}
          >
            {selection.items.map((item, index) => {
              const itemError = Boolean(item.validationError || item.uploadError)
              const viewerIndex = previewableItems.findIndex((candidate) => candidate.id === item.id)
              return (
                <li key={item.id} className={cn('min-w-0 overflow-hidden rounded-lg border bg-white', itemError ? 'border-red-300' : 'border-zinc-200')}>
                  <div className={cn('relative aspect-square bg-zinc-100', previewClassName)}>
                    {viewerIndex < 0 ? (
                      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-zinc-500">Rasmni ko‘rib bo‘lmaydi</div>
                    ) : (
                      <>
                        <Image
                          src={item.previewUrl}
                          alt={`${label}: ${index + 1}-rasm, ${item.filename}`}
                          fill
                          sizes="(max-width: 379px) 100vw, (max-width: 640px) 50vw, 220px"
                          unoptimized
                          className="object-cover"
                        />
                        <ImageViewerTrigger
                          label={`${item.filename} rasmini kattalashtirish`}
                          onClick={(trigger) => imageViewer.openAt(viewerIndex, trigger)}
                        />
                      </>
                    )}
                  </div>
                  <div className="min-w-0 space-y-2 p-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-zinc-800" title={item.filename}>{item.filename}</p>
                      {item.size !== null && <p className="text-[11px] text-zinc-500">{formatBytes(item.size)}</p>}
                      <p className={cn('mt-1 text-[11px] leading-4', itemError ? 'text-red-700' : 'text-zinc-500')} role={itemError ? 'alert' : undefined}>
                        {statusCopy(item)}
                      </p>
                    </div>
                    {item.uploadStatus === 'uploading' && (
                      <progress className="h-1.5 w-full accent-zinc-900" max={100} value={item.uploadProgress} aria-label={`${item.filename} yuklash holati`} />
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {mode === 'multiple' && (
                        <>
                          <button type="button" onClick={() => selection.move(item.id, -1)} disabled={index === 0 || disabled} aria-label={`${item.filename} rasmini oldinga surish`} className="inline-flex size-8 items-center justify-center rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-35">
                            <ArrowLeft size={14} aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => selection.move(item.id, 1)} disabled={index === selection.items.length - 1 || disabled} aria-label={`${item.filename} rasmini keyinga surish`} className="inline-flex size-8 items-center justify-center rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-35">
                            <ArrowRight size={14} aria-hidden="true" />
                          </button>
                        </>
                      )}
                      <label htmlFor={`${inputId}-${item.id}-replace`} className="inline-flex size-8 cursor-pointer items-center justify-center rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50" aria-label={`${item.filename} rasmini almashtirish`} title="Almashtirish">
                        <Replace size={14} aria-hidden="true" />
                        <input
                          data-image-selection-replace
                          id={`${inputId}-${item.id}-replace`}
                          type="file"
                          accept={DEFAULT_ACCEPTED_TYPES.join(',')}
                          aria-label={`${item.filename} rasmini almashtirish`}
                          disabled={disabled}
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            if (file) selection.replaceFile(item.id, file)
                            event.target.value = ''
                          }}
                          className="sr-only"
                        />
                      </label>
                      <button type="button" onClick={() => selection.remove(item.id)} disabled={disabled} aria-label={`${item.filename} rasmini olib tashlash`} className="inline-flex size-8 items-center justify-center rounded border border-zinc-200 text-zinc-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                      {item.uploadStatus === 'error' && (
                        <button type="button" onClick={() => void selection.retryUpload(item.id).catch(() => {})} disabled={disabled} className="inline-flex min-h-8 items-center gap-1 rounded border border-red-200 px-2 text-xs text-red-700 hover:bg-red-50">
                          <RefreshCw size={13} aria-hidden="true" /> Qayta urinish
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        <p id={helpId} className="mt-2 text-xs text-zinc-500">{help}</p>
        {selection.selectionError && <p id={errorId} role="alert" className="mt-1 text-xs text-red-700">{selection.selectionError}</p>}
      </fieldset>
      <ImageViewer
        images={viewerImages}
        open={imageViewer.open}
        activeIndex={imageViewer.activeIndex}
        onOpenChange={imageViewer.onOpenChange}
        onActiveIndexChange={imageViewer.onActiveIndexChange}
        finalFocusRef={imageViewer.finalFocusRef}
        title={label}
      />
    </>
  )
}
