/**
 * PRO-1305 · Deleting from the chat what Mimo noted (C.7 of E-100) and
 * withdrawing the whole permission (with a confirmation button, E-103 §2.4).
 * The notices are the code's (`chatAllergies`), never the model's.
 */
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'
import { askWithdraw, deleteChatAllergies } from '../chatAllergySave.js'
import { env } from '../../config/env.js'

const text = (summary: string): SkillResult => ({ data: null, summary, uiHint: 'text' })

export const forgetAllergySkill: SkillDefinition = {
  name: 'forget_allergy',
  description:
    '«Borra lo del gluten», «ya no soy intolerante a la lactosa», «quita la alergia de la peque»: borra de la ficha una alergia, intolerancia o algo que no se come por salud. Con person (el apodo de alguien sin cuenta, como en get_ficha) si es de esa persona. El aviso «Borrado…» lo manda el sistema.',
  parameters: {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'string' }, description: 'Lo que hay que borrar, como lo dijo («gluten», «marisco»).' },
      person: { type: 'string', description: 'Opcional: el apodo de la persona sin cuenta.' },
    },
    required: ['items'],
  },
  async handler(p: { items?: unknown; person?: string }, ctx: SkillContext): Promise<SkillResult> {
    const out = await deleteChatAllergies(ctx, p?.items, p?.person ?? null)
    return text(out ?? `No lo he borrado desde aqui: se quita en su perfil, ${env.WEB_PUBLIC_URL}/profile/casa/alergias`)
  },
}

export const withdrawHealthPermissionSkill: SkillDefinition = {
  name: 'withdraw_health_permission',
  description:
    '«No guardes mis alergias», «retira el permiso», «borra todos mis datos de salud»: retira el permiso de datos de salud. El sistema le pide confirmación con dos botones y, si pulsa «Sí, retíralo», borra todas sus alergias, intolerancias y datos de salud, como en la web. Para borrar solo una, forget_allergy.',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_p: unknown, ctx: SkillContext): Promise<SkillResult> {
    return text(askWithdraw(ctx) ?? `Desde aqui no puedo: el permiso se retira en su perfil, ${env.WEB_PUBLIC_URL}/profile`)
  },
}

export const chatAllergySkills: SkillDefinition[] = [forgetAllergySkill, withdrawHealthPermissionSkill]
