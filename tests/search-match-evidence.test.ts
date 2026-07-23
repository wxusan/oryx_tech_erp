import { describe, expect, it } from 'vitest'
import {
  firstSearchMatchEvidence,
  searchMatchEvidence,
} from '@/lib/search-match-evidence'

describe('permission-safe search match evidence', () => {
  it('returns formatted secondary IMEI/additional-phone evidence with original ranges', () => {
    expect(firstSearchMatchEvidence('2446', [{
      field: 'SECONDARY_IMEI',
      value: '86 001-2446-789012',
      mode: 'identifier',
    }])).toEqual({
      field: 'SECONDARY_IMEI',
      displayText: '86 001-2446-789012',
      mode: 'imei',
      ranges: [{ start: 7, end: 11 }],
    })

    expect(searchMatchEvidence('2446', [{
      field: 'ADDITIONAL_PHONE',
      value: '+998 (95) 002-44-67',
      mode: 'identifier',
    }])).toEqual([{
      field: 'ADDITIONAL_PHONE',
      displayText: '+998 (95) 002-44-67',
      mode: 'phone',
      ranges: [{ start: 12, end: 18 }],
    }])
  })

  it('returns only a field marker for matched text that is not authorized in the DTO', () => {
    const evidence = firstSearchMatchEvidence('2446', [{
      field: 'NOTE',
      value: 'Private note contains 2446',
      mode: 'text',
      exposeValue: false,
    }])

    expect(evidence).toEqual({ field: 'NOTE' })
    expect(JSON.stringify(evidence)).not.toContain('Private note')
    expect(JSON.stringify(evidence)).not.toContain('2446')
  })

  it('never combines fragments from different candidates', () => {
    expect(firstSearchMatchEvidence('2446', [
      { field: 'MODEL', value: '24', mode: 'text' },
      { field: 'NOTE', value: '46', mode: 'text', exposeValue: false },
    ])).toBeUndefined()
  })

  it('does not use the numeric suffix of mixed model text against a phone', () => {
    expect(firstSearchMatchEvidence('iPhone 13', [{
      field: 'CUSTOMER_PHONE',
      value: '+998 90 000 13 00',
      mode: 'identifier',
    }])).toBeUndefined()
  })
})
