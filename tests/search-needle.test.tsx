// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HighlightedText,
  SearchEvidence,
  searchEvidenceFor,
} from '@/components/highlighted-text'
import {
  escapeLikeSearchValue,
  findSearchMatchRanges,
  matchesSearchValue,
  prepareSearchNeedle,
} from '@/lib/search-needle'

afterEach(cleanup)

describe('findSearchMatchRanges', () => {
  it('returns an end-exclusive range only for a contiguous 2446 substring', () => {
    expect(findSearchMatchRanges('AA2446BB', '2446')).toEqual([{ start: 2, end: 6 }])
    expect(findSearchMatchRanges('AA2xx4xx4xx6BB', '2446')).toEqual([])
    expect(findSearchMatchRanges('AA2464BB', '2446')).toEqual([])
  })

  it('is case-insensitive and returns every non-overlapping occurrence', () => {
    expect(findSearchMatchRanges('SaNaSi sanasi SANASI', 'sanasi')).toEqual([
      { start: 0, end: 6 },
      { start: 7, end: 13 },
      { start: 14, end: 20 },
    ])
  })

  it.each(['%', '_', '\\'])('treats %j as a literal character, never a SQL/regex wildcard', (query) => {
    expect(findSearchMatchRanges(`before ${query} after`, query)).toEqual([{ start: 7, end: 8 }])
    expect(findSearchMatchRanges('before wildcard after', query)).toEqual([])
  })

  it('maps a normalized phone match back to the exact formatted display slice', () => {
    const value = '+998 (95) 002-44-67'
    const ranges = findSearchMatchRanges(value, '2446', 'identifier')

    expect(ranges).toEqual([{ start: 12, end: 18 }])
    expect(value.slice(ranges[0].start, ranges[0].end)).toBe('2-44-6')
  })

  it('maps a normalized IMEI match without changing the displayed identifier', () => {
    const value = '35 912-2446-789012'
    const ranges = findSearchMatchRanges(value, '359122446789012', 'identifier')

    expect(ranges).toEqual([{ start: 0, end: value.length }])
    expect(value.slice(ranges[0].start, ranges[0].end)).toBe(value)
  })

  it('does not use numeric fallback for a mixed text query', () => {
    expect(findSearchMatchRanges('+998 90 000 13 00', 'iPhone 13', 'auto')).toEqual([])
    expect(findSearchMatchRanges('iPhone 13 Pro', 'iPhone 13', 'auto')).toEqual([{ start: 0, end: 9 }])
  })
})

describe('prepareSearchNeedle', () => {
  it('creates identifier digits only when the entire query is identifier-like', () => {
    expect(prepareSearchNeedle(' +998 (90) 12-44-67 ')).toMatchObject({
      query: '+998 (90) 12-44-67',
      identifierDigits: '99890124467',
      isIdentifierLike: true,
      exceedsMaxLength: false,
    })
    expect(prepareSearchNeedle(' iPhone 13 ')).toMatchObject({
      query: 'iPhone 13',
      identifierDigits: null,
      isIdentifierLike: false,
      exceedsMaxLength: false,
    })
  })

  it('escapes SQL LIKE metacharacters and reports the bounded-input decision', () => {
    expect(escapeLikeSearchValue('%_\\')).toBe('\\%\\_\\\\')
    expect(prepareSearchNeedle('%_\\')).toMatchObject({
      query: '%_\\',
      escapedText: '\\%\\_\\\\',
      exceedsMaxLength: false,
    })
    expect(prepareSearchNeedle('x'.repeat(101))).toMatchObject({ exceedsMaxLength: true })
  })

  it('matches one value at a time so fragments cannot join across fields', () => {
    expect(matchesSearchValue('prefix 2446 suffix', '2446')).toBe(true)
    expect(matchesSearchValue('2xx4xx4xx6', '2446')).toBe(false)
    expect(matchesSearchValue('24', '2446')).toBe(false)
    expect(matchesSearchValue('46', '2446')).toBe(false)
  })
})

describe('HighlightedText', () => {
  it('uses semantic mark elements while preserving the exact visible text', () => {
    const value = 'IMEI 35 912-2446-789012'
    const { container } = render(
      <HighlightedText value={value} query="2446" mode="identifier" />,
    )

    const marks = [...container.querySelectorAll('mark')]
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('2446')
    expect(marks[0].getAttribute('aria-hidden')).not.toBe('true')
    expect(container.textContent).toBe(value)
  })

  it('renders multiple case-insensitive ranges without altering text', () => {
    const value = 'Sanasi sanasi'
    const { container } = render(<HighlightedText value={value} query="SANASI" />)

    expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
      'Sanasi',
      'sanasi',
    ])
    expect(container.textContent).toBe(value)
  })

  it('renders untrusted text as text rather than HTML', () => {
    const value = '<script>alert(1)</script> 2446'
    const { container } = render(<HighlightedText value={value} query="2446" />)

    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toBe(value)
    expect(container.querySelector('mark')?.textContent).toBe('2446')
  })

  it('suppresses marks for an uncommitted/stale query while leaving text unchanged', () => {
    const value = 'Customer 2446'
    const { container, rerender } = render(<HighlightedText value={value} query="2446" />)
    expect(container.querySelectorAll('mark')).toHaveLength(1)

    rerender(<HighlightedText value={value} query="" />)
    expect(container.querySelectorAll('mark')).toHaveLength(0)
    expect(container.textContent).toBe(value)
  })
})

describe('permission-safe search evidence', () => {
  it('renders a neutral passport marker without echoing the searched identifier', () => {
    const query = 'AA 1234567'
    const { container } = render(
      <SearchEvidence evidence={[{ field: 'PASSPORT' }]} query={query} />,
    )

    expect(container.textContent).toBe("Pasport:bo'yicha mos")
    expect(container.textContent).not.toContain(query)
    expect(container.querySelector('mark')).toBeNull()
  })

  it('renders neutral field-only evidence for hidden notes without echoing the query', () => {
    const query = 'maxfiy 2446'
    const { container } = render(
      <SearchEvidence evidence={[{ field: 'NOTE' }]} query={query} />,
    )

    expect(container.textContent).toBe("Izoh:bo'yicha mos")
    expect(container.textContent).not.toContain(query)
    expect(container.querySelector('mark')).toBeNull()
  })

  it('renders neutral field-only evidence for every recognized safe field label', () => {
    const query = '2446'
    const { container } = render(
      <SearchEvidence
        evidence={[
          { field: 'ADDITIONAL_PHONE' },
          { field: 'SECONDARY_IMEI' },
          { field: 'SUPPLIER_NAME' },
          { field: 'color' },
        ]}
        query={query}
      />,
    )

    expect(container.textContent).toContain("Qo'shimcha telefon:bo'yicha mos")
    expect(container.textContent).toContain("Qo'shimcha IMEI:bo'yicha mos")
    expect(container.textContent).toContain("Yetkazib beruvchi:bo'yicha mos")
    expect(container.textContent).toContain("Rang:bo'yicha mos")
    expect(container.textContent).not.toContain(query)
    expect(container.querySelector('mark')).toBeNull()
  })

  it('keeps unknown field-only evidence suppressed', () => {
    const { container } = render(
      <SearchEvidence evidence={[{ field: 'UNREVIEWED_PRIVATE_FIELD' }]} query="2446" />,
    )

    expect(container.textContent).toBe('')
    expect(container.querySelector('mark')).toBeNull()
  })

  it('highlights explicitly safe display evidence but never a masked value', () => {
    const { container } = render(
      <SearchEvidence
        query="2446"
        evidence={[
          {
            field: 'ADDITIONAL_PHONE',
            displayText: '+998 95 002 44 67',
            mode: 'phone',
          },
          {
            field: 'PASSPORT',
            displayText: '••••2446',
            mode: 'masked',
          },
        ]}
      />,
    )

    expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['2 44 6'])
    expect(container.textContent).toContain('••••2446')
    expect(container.textContent).toContain("+998 95 002 44 67")
  })

  it('resolves evidence from the item first and then the permission-safe envelope map', () => {
    const envelope = {
      matchEvidenceById: {
        'customer-1': [{ field: 'PASSPORT' }],
      },
    }
    expect(searchEvidenceFor('customer-1', null, envelope)).toEqual([{ field: 'PASSPORT' }])
    expect(searchEvidenceFor('customer-1', {
      matchEvidence: [{ field: 'ADDITIONAL_PHONE', displayText: '+998950024467' }],
    }, envelope)).toEqual([{ field: 'ADDITIONAL_PHONE', displayText: '+998950024467' }])
    expect(searchEvidenceFor('other', null, envelope)).toEqual([])
  })
})
