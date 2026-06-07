import { describe, it, expect } from 'vitest'
import { COURSES, COURSE_LABELS, courseSchema, type Course } from '@ona/shared'

describe('Course validator', () => {
  it('accepts the 3 valid course values', () => {
    for (const v of COURSES) {
      expect(courseSchema.safeParse(v).success).toBe(true)
    }
  })
  it('accepts null (recipe is versatile / unclassified)', () => {
    expect(courseSchema.safeParse(null).success).toBe(true)
  })
  it('rejects unknown values', () => {
    expect(courseSchema.safeParse('mainplate').success).toBe(false)
    expect(courseSchema.safeParse('').success).toBe(false)
    expect(courseSchema.safeParse(undefined).success).toBe(false)
  })
  it('exports Spanish labels for every value', () => {
    expect(COURSE_LABELS.starter).toBe('Entrante')
    expect(COURSE_LABELS.main).toBe('Principal')
    expect(COURSE_LABELS.dessert).toBe('Postre')
  })
})
