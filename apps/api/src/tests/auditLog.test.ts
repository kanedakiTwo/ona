import { describe, it, expect } from 'vitest'
import { diff } from '../services/auditLog.js'

describe('auditLog.diff', () => {
  it('returns empty before/after when nothing changed', () => {
    const result = diff({ a: 1, b: 2 }, { a: 1, b: 2 })
    expect(result.before).toEqual({})
    expect(result.after).toEqual({})
  })

  it('captures only changed keys', () => {
    const result = diff(
      { a: 1, b: 2, c: 3 },
      { a: 1, b: 99, c: 3 },
    )
    expect(result.before).toEqual({ b: 2 })
    expect(result.after).toEqual({ b: 99 })
  })

  it('handles arrays via JSON-stringify equality', () => {
    const result = diff(
      { tags: ['gluten'] },
      { tags: ['gluten', 'lactosa'] },
    )
    expect(result.before).toEqual({ tags: ['gluten'] })
    expect(result.after).toEqual({ tags: ['gluten', 'lactosa'] })
  })

  it('captures additions present only in after', () => {
    const result = diff(
      { a: 1 } as Record<string, unknown>,
      { a: 1, b: 2 } as Record<string, unknown>,
    )
    expect(result.before).toEqual({ b: undefined })
    expect(result.after).toEqual({ b: 2 })
  })

  it('captures deletions present only in before', () => {
    const result = diff(
      { a: 1, b: 2 } as Record<string, unknown>,
      { a: 1 } as Record<string, unknown>,
    )
    expect(result.before).toEqual({ b: 2 })
    expect(result.after).toEqual({ b: undefined })
  })
})
