import { describe, expect, it } from 'vitest'
import { isCookNowCourse } from '../services/cookNow/load.js'

describe('isCookNowCourse', () => {
  it('main and versatile dishes only', () => {
    expect(isCookNowCourse('main')).toBe(true)
    expect(isCookNowCourse(null)).toBe(true)
    expect(isCookNowCourse('starter')).toBe(false)
    expect(isCookNowCourse('dessert')).toBe(false)
  })
})
