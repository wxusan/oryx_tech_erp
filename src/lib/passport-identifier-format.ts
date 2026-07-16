export const PASSPORT_IDENTIFIER_INPUT_PATTERN = /^[A-Z]{2} \d{7}$/

/** Format user input as two capital letters, one space, then seven digits. */
export function formatPassportIdentifierInput(value: string): string {
  const source = value.normalize('NFKC').toUpperCase()
  let letters = ''
  let digits = ''

  for (const character of source) {
    if (letters.length < 2) {
      if (character >= 'A' && character <= 'Z') letters += character
      continue
    }
    if (digits.length < 7 && character >= '0' && character <= '9') digits += character
  }

  return letters.length === 2 ? `${letters} ${digits}` : letters
}

export function normalizePassportIdentifier(value: string): string {
  return formatPassportIdentifierInput(value).replace(' ', '')
}

export function isValidPassportIdentifier(value: string): boolean {
  return PASSPORT_IDENTIFIER_INPUT_PATTERN.test(value.normalize('NFKC').toUpperCase())
}
