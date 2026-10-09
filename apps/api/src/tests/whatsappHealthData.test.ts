/**
 * PRO-24 (LEG-03; Meta's WhatsApp terms 4.2: no special-category data):
 * over WhatsApp the assistant never stores health data — allergies,
 * intolerances, restrictions, physical data — consent or not. It answers
 * with the link to the web profile. The web chat is unaffected.
 */
import { describe, expect, it } from 'vitest'
import { appSkills } from '../services/assistant/appSkills.js'
import { skills } from '../services/assistant/skills.js'
import { buildSystemPrompt } from '../services/assistant/systemPrompt.js'
import type { AppApi } from '../services/assistant/appApi.js'

function fakeApi() {
  const calls: { method: string; path: string; body?: any }[] = []
  const api: AppApi = async (method, path, body) => {
    calls.push({ method, path, body })
    if (path.endsWith('/health-consent')) return { active: true } as any
    return {} as any
  }
  return { api, calls }
}
const writes = (calls: { method: string }[]) => calls.filter((c) => c.method !== 'GET')
const updateProfile = appSkills.find((s) => s.name === 'update_profile')!
const updateMemory = skills.find((s) => s.name === 'update_memory')!

describe('WhatsApp never stores health data', () => {
  it('update_profile: restrictions / physical data are not written, even with consent', async () => {
    const f = fakeApi()
    const r = await updateProfile.handler(
      { addRestrictions: ['sin gluten'], weight: 70 },
      { userId: 'u1', db: null, api: f.api, channel: 'whatsapp' },
    )
    expect(writes(f.calls)).toEqual([])
    expect(r.summary).toMatch(/Por WhatsApp no guardo datos de salud/)
    expect(r.summary).toMatch(/\/profile$/)
  })

  it('update_profile: a non-health change in the same message still goes through', async () => {
    const f = fakeApi()
    const r = await updateProfile.handler(
      { priority: 'cheap', age: 40 },
      { userId: 'u1', db: null, api: f.api, channel: 'whatsapp' },
    )
    expect(writes(f.calls)).toEqual([{ method: 'PUT', path: '/user/u1', body: { priority: 'cheap' } }])
    expect(r.summary).toMatch(/perfil de la web/)
  })

  it('update_memory: health facts are refused with the profile link', async () => {
    const r = await updateMemory.handler(
      { facts: [{ key: 'restrictions', value: ['sin lactosa'] }, { key: 'physical.weight_kg', value: 70 }] },
      { userId: 'u1', db: null, channel: 'whatsapp' },
    )
    expect(r.data).toBeNull()
    expect(r.summary).toMatch(/Por WhatsApp no guardo datos de salud/)
  })

  it('the web chat still writes them (with consent)', async () => {
    const f = fakeApi()
    await updateProfile.handler({ addRestrictions: ['sin gluten'] }, { userId: 'u1', db: null, api: f.api, channel: 'text' })
    expect(writes(f.calls)).toEqual([{ method: 'PUT', path: '/user/u1', body: { restrictions: ['sin gluten'] } }])
  })

  it('the WhatsApp prompt tells the model not to store them', () => {
    expect(buildSystemPrompt('', 'whatsapp')).toMatch(/Por WhatsApp nunca guardas datos de salud/)
    expect(buildSystemPrompt('', 'text')).not.toMatch(/Por WhatsApp nunca guardas datos de salud/)
  })
})
