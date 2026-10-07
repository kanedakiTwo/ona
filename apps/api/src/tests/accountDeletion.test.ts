/** Unit side of "Borrar mi cuenta" (the full flow runs in accountDeletion.smoke.ts). */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import { AdminAccountDeletionError, deleteAccount, localImagePath } from '../services/accountDeletion.js'

describe('localImagePath', () => {
  const base = 'https://api.example/images/recipes'
  const dir = '/data/images'
  it('maps our own <uuid>.jpg URLs to the volume', () => {
    expect(localImagePath(`${base}/0b9c2f5e-1a2b-4c3d-9e8f-001122334455.jpg`, base, dir)).toBe(
      '/data/images/0b9c2f5e-1a2b-4c3d-9e8f-001122334455.jpg',
    )
  })
  it('never touches seed images, other hosts or path tricks', () => {
    expect(localImagePath('/images/recipes/lentejas.jpg', base, dir)).toBeNull()
    expect(localImagePath('https://i.ytimg.com/vi/x/hqdefault.jpg', base, dir)).toBeNull()
    expect(localImagePath(`${base}/../../etc/passwd`, base, dir)).toBeNull()
    expect(localImagePath(null, base, dir)).toBeNull()
  })
})

describe('deleteAccount', () => {
  it('refuses admin accounts before touching anything', async () => {
    const transaction = vi.fn()
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ role: 'admin' }] }) }) }),
      transaction,
    }
    await expect(deleteAccount('u-admin', { db })).rejects.toBeInstanceOf(AdminAccountDeletionError)
    expect(transaction).not.toHaveBeenCalled()
  })
})
