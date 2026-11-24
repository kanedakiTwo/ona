/**
 * PRO-1041 (Seguridad): an allergy told to Mimo by the chat or WhatsApp,
 * without the health consent, is never stored, but the menu Mimo generates
 * applies it (that menu only) and Mimo sends the web link with it marked.
 * The full flow against Postgres is `saidAllergies.smoke.ts`.
 */
import { describe, expect, it } from 'vitest'
import { healthConsentLink, saidAllergyReply } from '../services/healthConsent.js'
import { withHouseholdRestrictions } from '../services/householdAllergies.js'
import { menuOnlyRestrictions, withMenuOnlyRestrictions } from '../services/menuOnlyRestrictions.js'
import { notYetSaved, restrictionsSaidIn, saidRestrictionsForMenu, saidRestrictionsLine } from '../services/saidRestrictions.js'
import { buildSystemPrompt, WHATSAPP_ONBOARDING_PROMPT } from '../services/assistant/systemPrompt.js'
import { skills } from '../services/assistant/skills.js'

describe('restrictionsSaidIn: what the person said, by the keyword rule', () => {
  it('the test households, literally', () => {
    expect(restrictionsSaidIn(['Hola! Soy celíaca, somos dos en casa'])).toEqual(['sin gluten']) // Lucía, 2026-10-24
    expect(restrictionsSaidIn(['soy alérgico al marisco'])).toEqual(['marisco']) // Iker, 2026-10-31
    expect(restrictionsSaidIn(['mi hijo tiene alergia a los frutos secos'])).toEqual(['frutos secos']) // Irene, 2026-10-27
    expect(restrictionsSaidIn(['hola. vejetariano. sin lactosa', 'doy permiso. si'])).toEqual(['sin lactosa']) // Mohamed, 2026-10-28
  })

  it('nothing said, nothing applied', () => {
    expect(restrictionsSaidIn(['somos 3 y cocinamos cada dia', 'no tengo alergias', ''])).toEqual([])
  })
})

describe('notYetSaved', () => {
  it('drops what is already saved, by meaning', () => {
    expect(notYetSaved(['sin gluten', 'marisco'], ['Sin gluten'])).toEqual(['marisco'])
    expect(notYetSaved(['sin gluten'], [])).toEqual(['sin gluten'])
  })
})

describe('saidRestrictionsForMenu', () => {
  const load = (texts: string[]) => async () => texts

  const saved = (list: string[]) => async () => list

  it('what Mimo passed and what the messages say, without the saved ones', async () => {
    const said = await saidRestrictionsForMenu('u1', null, ['celiaca'], saved([]), load(['soy alergico al marisco']))
    expect(said?.apply).toEqual(['sin gluten', 'marisco'])
    expect(said?.link).toContain('#marcar=sin%20gluten,marisco')
  })

  it('null when everything said is saved; the saved ones are not read when nothing was said', async () => {
    expect(await saidRestrictionsForMenu('u1', null, undefined, saved(['sin gluten']), load(['soy celiaca']))).toBeNull()
    const never = async () => {
      throw new Error('must not read')
    }
    expect(await saidRestrictionsForMenu('u1', null, undefined, never, load(['somos dos']))).toBeNull()
  })

  it('a read error keeps the safe side: the messages → what Mimo passed; the saved ones → all that was said', async () => {
    const down = async () => {
      throw new Error('db down')
    }
    expect((await saidRestrictionsForMenu('u1', null, ['frutos secos'], saved([]), down))?.apply).toEqual(['frutos secos'])
    expect((await saidRestrictionsForMenu('u1', null, ['frutos secos'], down, load([])))?.apply).toEqual(['frutos secos'])
  })

  it('the line for Mimo says it is applied to this menu only, and gives the link', () => {
    const line = saidRestrictionsLine({ apply: ['sin gluten'], link: healthConsentLink(['sin gluten']) }, 'whatsapp')
    expect(line).toMatch(/Aplicado solo a este menu \(no esta guardado\): sin gluten/)
    expect(line).toMatch(/Por WhatsApp no se guardan/)
    expect(line).toContain('/profile/casa/alergias?next=%2Fmenu#marcar=sin%20gluten')
  })
})

describe('the menu applies them only inside withMenuOnlyRestrictions', () => {
  const noHousehold = async () => [] as string[]

  it('every pick inside adds them; outside, nothing', async () => {
    const inside = await withMenuOnlyRestrictions(['sin gluten'], () => withHouseholdRestrictions(['marisco'], 'u1', null as any, noHousehold))
    expect(inside).toEqual(['marisco', 'sin gluten'])
    expect(await withHouseholdRestrictions(['marisco'], 'u1', null as any, noHousehold)).toEqual(['marisco'])
    expect(menuOnlyRestrictions()).toEqual([])
  })

  it('survives the awaits inside the generation', async () => {
    const seen = await withMenuOnlyRestrictions(['frutos secos'], async () => {
      await new Promise((r) => setTimeout(r, 5))
      return menuOnlyRestrictions()
    })
    expect(seen).toEqual(['frutos secos'])
  })
})

describe('the link and the replies', () => {
  it('the allergies go after #, never in the query', () => {
    const link = healthConsentLink(['sin gluten', 'Frutos secos', 'sin gluten'])
    const [beforeHash, hash] = link.split('#')
    expect(beforeHash).toMatch(/\/profile\/casa\/alergias\?next=%2Fmenu$/)
    expect(beforeHash).not.toMatch(/gluten/)
    expect(hash).toBe('marcar=sin%20gluten,frutos%20secos')
    expect(healthConsentLink([])).not.toContain('#')
  })

  it('saidAllergyReply: why it is not saved, the link, and that the menu applies it meanwhile', () => {
    expect(saidAllergyReply(['marisco'], 'whatsapp')).toMatch(/^Por WhatsApp no guardo datos de salud/)
    const web = saidAllergyReply(['marisco'], 'text')
    expect(web).toMatch(/solo los guardo con tu consentimiento/)
    expect(web).toContain('#marcar=marisco')
    expect(web).toMatch(/el menu que te genere lo aplica igualmente/)
  })
})

describe('Mimo is told to pass them and never to refuse the menu', () => {
  it('both menu tools take restrictions_said', () => {
    for (const name of ['generate_weekly_menu', 'complete_onboarding']) {
      const skill = skills.find((s) => s.name === name)!
      expect((skill.parameters as any).properties.restrictions_said.type).toBe('array')
    }
  })

  it('the prompt (every mode) and the WhatsApp sign-up', () => {
    for (const mode of ['text', 'whatsapp'] as const) {
      const prompt = buildSystemPrompt('ctx', mode)
      expect(prompt).toMatch(/pasala en restrictions_said y el menu la aplica solo esa vez/)
      expect(prompt).toMatch(/Nunca te niegues a hacer el menu por eso/)
    }
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/pasalas a complete_onboarding en restrictions_said/)
  })
})
