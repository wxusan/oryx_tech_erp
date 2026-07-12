export function digitCountBeforeCaret(value: string, caret: number): number {
  return value.slice(0, Math.max(0, caret)).replace(/\D/g, '').length
}

export function caretAfterDigitCount(value: string, digitCount: number): number {
  if (digitCount <= 0) return 0
  let seen = 0
  for (let index = 0; index < value.length; index++) {
    if (/\d/.test(value[index]!)) seen++
    if (seen === digitCount) return index + 1
  }
  return value.length
}

export function editableDigitIndex(value: string, caret: number, direction: 'backward' | 'forward', ignoredLeadingDigits = 0): number | null {
  const positions: number[] = []
  for (let index = 0; index < value.length; index++) {
    if (/\d/.test(value[index]!)) positions.push(index)
  }
  const editable = positions.slice(ignoredLeadingDigits)
  if (direction === 'backward') {
    for (let index = editable.length - 1; index >= 0; index--) {
      if (editable[index]! < caret) return index
    }
    return null
  }
  for (let index = 0; index < editable.length; index++) {
    if (editable[index]! >= caret) return index
  }
  return null
}

export function removeDigitAt(value: string, index: number): string {
  return `${value.slice(0, index)}${value.slice(index + 1)}`
}
