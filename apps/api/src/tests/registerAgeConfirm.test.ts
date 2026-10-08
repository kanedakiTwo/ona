/**
 * PRO-23 (LOPDGDD art. 7): Mimoia is not for under-14s. `POST /register`
 * validates `registerSchema`, so the box «Tengo 14 años o más» must be ticked.
 */
import { describe, expect, it } from 'vitest'
import { registerSchema } from '@ona/shared'

const base = { username: 'ana_casa', email: 'ana@example.com', password: 'secreto123' }

describe('registerSchema · edad mínima', () => {
  it('rejects a sign-up without the age box', () => {
    const r = registerSchema.safeParse(base)
    expect(r.success).toBe(false)
  })

  it('rejects the box unticked, with a Spanish message', () => {
    const r = registerSchema.safeParse({ ...base, ageConfirmed: false })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.ageConfirmed?.[0]).toMatch(/14 años/)
    }
  })

  it('accepts the box ticked', () => {
    expect(registerSchema.safeParse({ ...base, ageConfirmed: true }).success).toBe(true)
  })
})
