/**
 * PRO-224: Mimo's school-menu tools (web chat and WhatsApp, D-051).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const saved: any[] = []
vi.mock('../services/scopeResolver.js', () => ({ getPrimaryHouseholdId: vi.fn(async () => 'h1') }))
vi.mock('../services/schoolMenu.js', async () => {
  const shared = await import('@ona/shared')
  return {
    schoolLunchLines: shared.schoolLunchLines,
    loadSchoolLunches: vi.fn(async () => saved.flatMap((s) => s.days)),
    saveSchoolLunches: vi.fn(async (householdId: string, userId: string, days: any[], clear: string[]) => {
      saved.push({ householdId, userId, days, clear })
    }),
  }
})

const { schoolMenuSkills } = await import('../services/assistant/schoolMenuSkills.js')
const get = schoolMenuSkills.find((s) => s.name === 'get_school_menu')!
const set = schoolMenuSkills.find((s) => s.name === 'set_school_menu_days')!
const ctx = { userId: 'u1', db: {} } as any

beforeEach(() => {
  saved.length = 0
})

describe('school menu skills', () => {
  it('get_school_menu with nothing saved explains how to send it', async () => {
    const r = await get.handler({}, ctx)
    expect(r.summary).toContain('menú del cole')
    expect(r.summary).toContain('Perfil → Mi casa → Menú del cole')
  })

  it('set_school_menu_days saves a fix (group from the dish when missing) and clears dates', async () => {
    const r = await set.handler({ days: [{ date: '2026-11-03', dish: 'Merluza a la romana' }, { date: 'mal', dish: 'x' }], clear: ['2026-11-04'] }, ctx)
    expect(saved).toEqual([{ householdId: 'h1', userId: 'u1', days: [{ date: '2026-11-03', dish: 'Merluza a la romana', group: 'pescado' }], clear: ['2026-11-04'] }])
    expect(r.summary).toContain('martes 3: Merluza a la romana (pescado)')
    expect(r.summary).toContain('no repetirán')
    expect(r.summary).not.toMatch(/equilibr|salud/i)

    const after = await get.handler({ from: '2026-11-01', to: '2026-11-30' }, ctx)
    expect(after.summary).toContain('Merluza a la romana')
  })

  it('nothing valid → nothing saved', async () => {
    const r = await set.handler({ days: [{ date: '2026-11-03', dish: '  ' }] }, ctx)
    expect(saved).toEqual([])
    expect(r.summary).toMatch(/No he cambiado nada/)
  })
})
