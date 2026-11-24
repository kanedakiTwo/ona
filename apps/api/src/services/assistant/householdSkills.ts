// Mimo's household tools: who eats at home and what Mimo remembers. Split out of skills.ts (PRO-400).
import { eq } from 'drizzle-orm'
import { users } from '../../db/schema.js'
import { householdMultiplier } from '@ona/shared'
import { type SkillDefinition, type SkillContext, type SkillResult } from './types.js'
import { HEALTH_CONSENT_SKILL_REPLY, RELIGION_CONSENT_SKILL_REPLY, WHATSAPP_HEALTH_DATA_REPLY, hasHealthConsent, saidAllergyReply } from '../healthConsent.js'
import { divertDietFacts } from './dietFacts.js'
import { isHealthMemoryKey } from '@ona/shared'

export interface MemoryFactInput {
  key: string
  value: unknown
  confidence?: number
  remove?: string[]
  replace?: boolean
}

/**
 * What update_memory actually writes. Lists (dislikes, notes, equipment…)
 * are merged with what's stored — the model used to resend a list without
 * an old entry and silently delete it — and `remove` takes items out. A fact
 * the user set by hand (source manual) isn't overwritten by an inference
 * unless the user asked for it (confidence 1).
 */
export function mergeMemoryFacts(
  current: Record<string, { value: unknown; source?: string } | undefined>,
  facts: MemoryFactInput[],
): { facts: Array<{ key: string; value: unknown; confidence: number }>; keptManual: string[] } {
  const out: Array<{ key: string; value: unknown; confidence: number }> = []
  const keptManual: string[] = []
  const norm = (x: unknown) => String(x).trim().toLowerCase()
  for (const f of facts) {
    const confidence = typeof f.confidence === 'number' ? f.confidence : 0.8
    const existing = current[f.key]
    if (existing?.source === 'manual' && confidence < 1) {
      keptManual.push(f.key)
      continue
    }
    let value = f.value
    if (Array.isArray(existing?.value) && (Array.isArray(value) || (f.remove?.length ?? 0) > 0)) {
      const base = f.replace ? [] : (existing!.value as unknown[])
      const incoming = Array.isArray(value) ? value : []
      const removed = new Set((f.remove ?? []).map(norm))
      const seen = new Set<string>()
      value = [...base, ...incoming].filter((item) => {
        const k = norm(item)
        if (removed.has(k) || seen.has(k)) return false
        seen.add(k)
        return true
      })
    } else if (Array.isArray(value) && f.remove?.length) {
      const removed = new Set(f.remove.map(norm))
      value = value.filter((item) => !removed.has(norm(item)))
    }
    out.push({ key: f.key, value, confidence })
  }
  return { facts: out, keptManual }
}

/**
 * update_household — set the user's adults + kidsCount (children 2–10 years)
 * via voice ("ahora somos 2 adultos y un niño", "quítame el niño"). Drives
 * shopping-list portion sizing immediately.
 */
export const updateHousehold: SkillDefinition = {
  name: 'update_household',
  description:
    'Actualiza la composición del hogar del usuario: adultos (incluye mayores de 10 años) y número de niños de 2 a 10 años. Los menores de 2 no se cuentan. Se usa para escalar la lista de la compra y las raciones por defecto en las recetas.',
  parameters: {
    type: 'object',
    properties: {
      adults: {
        type: 'number',
        description: 'Número de adultos en el hogar (>=1). Incluye mayores de 10 años.',
      },
      kidsCount: {
        type: 'number',
        description: 'Niños entre 2 y 10 años (>=0). Cada niño cuenta como 0.5 raciones.',
      },
    },
    required: ['adults', 'kidsCount'],
  },
  async handler(
    params: { adults: number; kidsCount: number },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const { userId, db } = ctx
    const adults = Math.max(1, Math.floor(params.adults))
    const kidsCount = Math.max(0, Math.floor(params.kidsCount))

    await db
      .update(users)
      .set({ adults, kidsCount, householdSize: null })
      .where(eq(users.id, userId))
    const { alignHouseholdMemory } = await import('../userMemoryStore.js')
    await alignHouseholdMemory(userId, { adults, kidsCount }).catch((err) => console.error('[update_household] memory', err))

    const multiplier = householdMultiplier(adults, kidsCount)
    return {
      data: { adults, kidsCount, multiplier },
      summary: householdUpdatedSummary(adults, kidsCount),
      uiHint: 'confirmation',
    }
  },
}

/**
 * What Mimo says after `update_household`: people, never «5 raciones» for a
 * family of seven (2026-10-22, a tester with a large family: «creo que el
 * concepto de familia numerosa no le entra en la cabeza»).
 */
export function householdUpdatedSummary(adults: number, kidsCount: number): string {
  const adultsLabel = adults === 1 ? '1 adulto' : `${adults} adultos`
  const people = adults + kidsCount
  if (kidsCount === 0) return `Hogar actualizado: ${adultsLabel}. La compra sale para ${people === 1 ? '1 persona' : `${people} personas`}.`
  const kidsLabel = kidsCount === 1 ? '1 niño de 2 a 10 años' : `${kidsCount} niños de 2 a 10 años`
  return `Hogar actualizado: ${adultsLabel} y ${kidsLabel}, ${people} personas. La compra sale para las ${people} (cada niño de 2 a 10 años cuenta como media ración de adulto).`
}

/**
 * Persist a freshly-learned preference into the user's long-term memory.
 *
 * The advisor calls this when the user says "recuerda que…", "apunta que…",
 * "ya no me gusta…", etc. Source is 'inferred' (confidence 0.8) unless the
 * user is emphatic ("APUNTA", "GUÁRDATE", "QUE NO SE TE OLVIDE") — then
 * confidence 1.0. The skill is fire-and-forget from the LLM's perspective;
 * it returns a one-line Spanish confirmation.
 */
export const updateMemory: SkillDefinition = {
  name: 'update_memory',
  description:
    'Guarda en la memoria del usuario un dato persistente que mencione en la conversación (disgustos, equipo de cocina, presupuesto, preferencias de cocina, días con poco tiempo, hábitos de preparación, etc.). «Sin X», «no me sugieras X», «prescindir de X», «no comemos X» van SIEMPRE en dislikes (no en notes), también las familias enteras: «legumbres», «arroz», «patata», «casquería», «cerdo», «carne roja», «marisco», «pescado» (el menú las entiende con todo lo que llevan). Una dieta no es un gusto: «vegetariano», «vegano», «sin carne ni pescado», «sin alcohol», «sin cerdo» (por dieta, no porque no les guste), «halal», «sin gluten», «sin lactosa» y las alergias van en restrictions, con esas palabras. Las notes no cambian el menú: lo que es una regla del menú va en dislikes, en note_ficha_fact (menu_rule) o en la semana tipo. Llámalo SIEMPRE que el usuario diga "recuerda que…", "ya no me gusta…", "no me apetece nunca…", "tengo / no tengo (electrodoméstico)", "los lunes no cocino", "el presupuesto semanal es…", "preferimos cocina mediterránea", "siempre congelo el pescado", "pongo las legumbres en remojo la noche antes". Acepta un array de hechos para cubrir varios cambios en un único turno. Usa claves canónicas: dislikes (array), equipment (array), restrictions (array), weekly_budget_eur (number), cuisine_bias (object cuisine->0..100), time_available (object weekday->minutes), cooking_skill ("easy"|"medium"|"advanced"), meal_times (object meal->"HH:MM"), notes (array), nutrition_principles (array), prep_habits (array), physical.age, physical.weight_kg, physical.height_cm, physical.activity_level, household.adults, household.kids_2_to_10, region (comunidad autónoma del hogar, código: AN Andalucía, AR Aragón, AS Asturias, IB Illes Balears, CN Canarias, CB Cantabria, CM Castilla-La Mancha, CL Castilla y León, CT Cataluña, EX Extremadura, GA Galicia, MD Madrid, MC Murcia, NC Navarra, PV País Vasco, RI La Rioja, VC Comunitat Valenciana, CE Ceuta, ML Melilla; sus festivos van como fin de semana en el menú).',
  parameters: {
    type: 'object',
    properties: {
      facts: {
        type: 'array',
        description: 'Hechos a guardar. Cada uno con key + value.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Clave canónica.' },
            value: {
              description: 'Valor en el formato correcto para la clave (array, número, string, etc).',
            },
            confidence: {
              type: 'number',
              description: 'Opcional. 0..1. Default 0.8 (inferido). Usa 1 si el usuario lo pidió explícitamente ("recuerda que…", "ya no…") o corrige un dato guardado.',
            },
            remove: {
              type: 'array',
              items: { type: 'string' },
              description: 'Solo para listas: elementos a QUITAR ("ya no me disgusta el vacuno" → key dislikes, value [], remove ["vacuno"]).',
            },
            replace: {
              type: 'boolean',
              description: 'Solo para listas: true si el usuario quiere rehacer la lista entera. Por defecto lo que pasas en value se AÑADE a lo que ya hay.',
            },
          },
          required: ['key', 'value'],
        },
      },
    },
    required: ['facts'],
  },
  async handler(
    params: { facts: MemoryFactInput[] },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const { userId } = ctx
    // Over WhatsApp health data is never stored (PRO-24): drop those facts
    // and point to the web profile.
    // PRO-1041: the allergies among them go to the web link, already marked.
    const saidAllergies = params.facts
      .filter((f) => f.key === 'restrictions')
      .flatMap((f) => (Array.isArray(f.value) ? f.value : [f.value]))
      .filter((v): v is string => typeof v === 'string')
    if (ctx.channel === 'whatsapp' && params.facts.some((f) => isHealthMemoryKey(f.key))) {
      params = { facts: params.facts.filter((f) => !isHealthMemoryKey(f.key)) }
      if (params.facts.length === 0) {
        return { data: null, summary: saidAllergies.length ? saidAllergyReply(saidAllergies, 'whatsapp') : WHATSAPP_HEALTH_DATA_REPLY, uiHint: 'text' }
      }
    }
    // PRO-201: what the household doesn't eat by diet («vegetariano», «sin
    // alcohol», «sin cerdo») is a restriction, not a taste or a note — when it
    // can be written (not WhatsApp, with the consent); otherwise the facts stay
    // as they came and the menu still reads the dislikes.
    if (ctx.channel !== 'whatsapp') {
      const diet = divertDietFacts(params.facts)
      if (diet.diverted.length > 0 && (await hasHealthConsent(userId))) params = { facts: diet.facts }
    }
    const { setMemoryBatch, getMemoryForUser, UnknownMemoryKeyError, MemoryValueValidationError, HealthConsentRequiredError } = await import('../userMemoryStore.js')
    const current = await getMemoryForUser(userId).catch(() => ({}))
    const { facts: merged, keptManual } = mergeMemoryFacts(current as Record<string, { value: unknown; source?: string }>, params.facts)
    if (merged.length === 0) {
      return {
        data: null,
        summary: `No he cambiado nada: ${keptManual.join(', ')} lo puso el usuario a mano; si quiere cambiarlo, que te lo diga expresamente.`,
        uiHint: 'text',
      }
    }
    // Forward as a single transaction so a partial failure rolls back.
    try {
      // The skill writes source='inferred'; mergeMemoryFacts keeps what the
      // user set by hand unless they asked for the change (confidence 1).
      // PRO-316: the ficha gets it too, with where it was said.
      const signal = ctx.channel === 'whatsapp' ? 'whatsapp' : ctx.channel === 'voice' ? 'voice' : ctx.channel === 'onboarding' ? 'onboarding' : 'chat'
      // PRO-201: allergies and diet are never deduced: the person said them
      // («Lo dijiste tú» in «Tu ficha»), out of the sign-up.
      const facts = ctx.channel === 'onboarding' ? merged : merged.map((f) => (f.key === 'restrictions' ? { ...f, source: 'manual' as const } : f))
      await setMemoryBatch(userId, facts, 'inferred', { signal })
    } catch (err) {
      if (err instanceof HealthConsentRequiredError) {
        return {
          data: null,
          summary:
            err.code === 'RELIGION_CONSENT_REQUIRED'
              ? RELIGION_CONSENT_SKILL_REPLY
              : saidAllergies.length
                ? saidAllergyReply(saidAllergies, ctx.channel)
                : HEALTH_CONSENT_SKILL_REPLY,
          uiHint: 'text',
        }
      }
      if (err instanceof UnknownMemoryKeyError) {
        return {
          data: null,
          summary: `No conozco la clave "${err.message.split(':').pop()?.trim()}", no la he guardado.`,
          uiHint: 'text',
        }
      }
      if (err instanceof MemoryValueValidationError) {
        return {
          data: null,
          summary: `No he podido guardar ${err.key}: ${err.reason}.`,
          uiHint: 'text',
        }
      }
      throw err
    }
    const keys = merged.map((f) => f.key).join(', ')
    const kept = keptManual.length ? ` No he tocado ${keptManual.join(', ')}: lo puso el usuario a mano.` : ''
    return {
      data: { updated: merged.length },
      summary: `Apuntado. (${keys})${kept}`,
      uiHint: 'confirmation',
    }
  },
}
