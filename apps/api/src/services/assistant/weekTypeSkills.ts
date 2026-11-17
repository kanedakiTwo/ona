/**
 * «Semana tipo» por Mimo (D-182 fase 3, web y WhatsApp): «los viernes por la
 * noche, pizza», «los jueves, una semana ceviche y otra carpaccio»,
 * «legumbres el sábado, cada dos semanas», «quita el desayuno del domingo».
 * Lee y escribe por las mismas rutas que el perfil (`GET /households/me/week-type`
 * y `PUT …/:day/:meal`, una por hueco), como el usuario: mismos permisos
 * (un menor no la cambia), misma validación y el mismo «desde esta semana».
 * Un plato dicho por su nombre se resuelve como en la fase 1
 * (`optionForDishName`: un tipo si el nombre lo es; la receta si hay
 * exactamente una; si no, el nombre escrito).
 */
import {
  COOKING_WEEKDAYS,
  MEALS,
  WEEK_TYPE_MAX_OPTIONS,
  DISH_TYPES,
  defaultWeekTypeSlot,
  dishTypeInfo,
  isDishType,
  stableSlotJson,
  weekTypeSlotAt,
  weekTypeSlotError,
  weekTypeSlotSchema,
  type Meal,
  type WeekTypeDays,
  type WeekTypeOption,
  type WeekTypeSlot,
} from '@ona/shared'
import { appApiFor, AppApiError, type AppApi } from './appApi.js'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'
import {
  DAY_LABELS,
  MEAL_LABELS,
  daysLabel,
  dishTypeForName,
  joinY,
  loadRecipesFor,
  nextWeekTypeSlot,
  optionForDishName,
  type WeekTypeSlotRequest,
} from '../weekType.js'

const api = (ctx: SkillContext): AppApi =>
  ctx.api ?? appApiFor(ctx.userId, { channel: ctx.channel === 'whatsapp' ? 'whatsapp' : 'web' })
const text = (summary: string, data: unknown = null, uiHint: SkillResult['uiHint'] = 'text'): SkillResult => ({ data, summary, uiHint })

const MEAL_WORDS: Record<string, Meal> = {
  breakfast: 'breakfast', desayuno: 'breakfast',
  lunch: 'lunch', comida: 'lunch', almuerzo: 'lunch', mediodia: 'lunch',
  snack: 'snack', merienda: 'snack',
  dinner: 'dinner', cena: 'dinner', noche: 'dinner',
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Pure: «sábado», "sabado", 5 → 5; anything else → null. */
export function dayIndexOf(d: unknown): number | null {
  if (typeof d === 'number') return Number.isInteger(d) && d >= 0 && d <= 6 ? d : null
  const i = (COOKING_WEEKDAYS as readonly string[]).indexOf(fold(String(d ?? '')))
  return i >= 0 ? i : null
}

/** Pure: "dinner", «cena», «la cena» → dinner; else null. */
export function mealOf(m: unknown): Meal | null {
  const s = fold(String(m ?? '')).replace(/^(el|la) /, '')
  return MEAL_WORDS[s] ?? null
}

/** Pure: an option as it reads mid-sentence («pizza», «Lentejas con chorizo», «táper de la cena»). */
function optionText(o: WeekTypeOption): string {
  if (o.kind === 'type') return (dishTypeInfo(o.type)?.label ?? o.type).toLocaleLowerCase('es')
  if (o.kind === 'recipe') return `«${o.name}»`
  if (o.kind === 'fixed') return `«${o.label}»`
  if (o.kind === 'taper') return 'táper de la cena'
  return 'cualquier receta'
}

/**
 * Pure: what a slot says, in a few words: «pizza cada semana», «legumbres
 * cada 2 semanas», «una semana ceviche y otra carpaccio y tartar», «pasta y
 * ensaladas, en la misma comida», «no hay», «cualquier receta»; «, para 3».
 */
export function describeWeekTypeSlot(slot: WeekTypeSlot): string {
  if (slot.off) return 'no hay'
  const options = slot.options ?? []
  const labels = options.map(optionText)
  let s: string
  if (options.length === 0) s = 'cualquier receta'
  else if (slot.together) s = `${joinY(labels)}, en la misma comida`
  else if (options[0].kind !== 'any' && options.slice(1).every((o) => o.kind === 'any')) {
    s = options.length === 1 ? `${labels[0]} cada semana` : `${labels[0]} cada ${options.length} semanas`
  } else if (options.length === 2) s = `una semana ${labels[0]} y otra ${labels[1]}`
  else s = `por turnos, ${joinY(labels)}`
  return slot.diners ? `${s}, para ${slot.diners}` : s
}

const NO_HOUSEHOLD = 'No he cambiado nada: no encuentro su hogar. La semana tipo se cambia también en Perfil.'

async function loadDays(ctx: SkillContext): Promise<WeekTypeDays | null> {
  try {
    return (await api(ctx)<{ days: WeekTypeDays }>('GET', '/households/me/week-type')).days
  } catch (err) {
    if (err instanceof AppApiError && err.status === 404) return null
    throw err
  }
}

const getWeekType: SkillDefinition = {
  name: 'get_week_type',
  description:
    'Lee la semana tipo del hogar: lo que suelen comer cada día y comida (un tipo de plato, una receta, algo fijo, el táper, por turnos o juntos, «no hay») y los comensales. El menú de cada semana sale de ahí. Úsalo cuando pregunte «¿qué tengo en mi semana tipo?» o antes de cambiar algo que dependa de lo que ya hay.',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_p: unknown, ctx: SkillContext): Promise<SkillResult> {
    const days = await loadDays(ctx)
    if (!days) return text('No encuentro su hogar, así que no tiene semana tipo.')
    const lines: string[] = []
    for (let d = 0; d < 7; d++) {
      for (const m of MEALS) {
        const { since: _s, ...slot } = weekTypeSlotAt(days, d, m)
        if (stableSlotJson(slot) === stableSlotJson(defaultWeekTypeSlot(m))) continue
        lines.push(`- ${DAY_LABELS[d]}, ${MEAL_LABELS[m]}: ${describeWeekTypeSlot(slot)}`)
      }
    }
    const rest = 'Lo que no sale: comida y cena con cualquier receta (Mimo elige), sin desayuno ni merienda, con los comensales de casa.'
    return text(lines.length ? `Semana tipo del hogar:\n${lines.join('\n')}\n${rest}` : `Su semana tipo está sin tocar. ${rest}`, { days })
  },
}

interface OptionParam {
  kind?: string
  type?: string
  name?: string
  items?: Array<{ name: string; quantity: number; unit: string }>
}

const setWeekTypeSlot: SkillDefinition = {
  name: 'set_week_type_slot',
  description:
    'Cambia la semana tipo del hogar, lo que suelen comer un día y una comida todas las semanas: «los viernes por la noche, pizza», «los jueves, una semana ceviche y otra carpaccio», «legumbres el sábado, cada dos semanas», «el domingo no desayunamos», «los lunes somos tres en la cena». Es lo que debes usar para las costumbres de un día y una comida (no la ficha). Uno o varios días y UNA comida por llamada. Si el usuario no ha dicho el día o la comida, no lo inventes: deja el campo vacío y la herramienta te dice qué preguntar. Sale así en los menús que se generen desde ahora (la semana ya hecha no cambia). Un gusto sin día ni comida («nos gusta mucho la pizza») no va aquí: va a la ficha.',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'array', items: { type: 'string', enum: [...COOKING_WEEKDAYS] }, description: 'Días (lunes…domingo, sin tildes). «Entre semana» = lunes a viernes; «el finde» = sabado y domingo.' },
      meal: { type: 'string', enum: [...MEALS], description: 'breakfast (desayuno), lunch (comida, mediodía), snack (merienda), dinner (cena, por la noche).' },
      options: {
        type: 'array',
        maxItems: WEEK_TYPE_MAX_OPTIONS,
        description: `Lo que va en ese hueco, hasta ${WEEK_TYPE_MAX_OPTIONS}, en orden. Sustituye a lo que había. Para dejarlo libre («quita la pizza del viernes») pasa [{kind:"any"}].`,
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['type', 'dish', 'fixed', 'taper', 'any'],
              description: 'type = un tipo de plato (en type); dish = un plato o receta por su nombre (en name: si es un tipo, el tipo; si hay una sola receta con ese nombre, esa; si no, sale escrito); fixed = algo fijo sin receta con lo que lleva por persona (name + items, p. ej. «Yogur con cereales»); taper = el táper de la cena de la víspera (solo desayuno, comida o merienda, de martes a domingo, y como única opción); any = cualquier receta (Mimo elige).',
            },
            type: { type: 'string', enum: DISH_TYPES.map((t) => t.key), description: `Con kind=type: ${DISH_TYPES.map((t) => `${t.key} (${t.label})`).join(', ')}.` },
            name: { type: 'string', description: 'Con kind=dish: el plato tal como lo dice («pizza», «lentejas con chorizo», «sándwich mixto»). Con kind=fixed: nombre corto.' },
            items: {
              type: 'array',
              description: 'Con kind=fixed: cosas y cantidades por persona.',
              items: {
                type: 'object',
                properties: { name: { type: 'string' }, quantity: { type: 'number' }, unit: { type: 'string', enum: ['u', 'g', 'ml'] } },
                required: ['name', 'quantity', 'unit'],
              },
            },
          },
          required: ['kind'],
        },
      },
      mode: { type: 'string', enum: ['turns', 'together'], description: 'Con varias opciones: turns (por defecto) = una cada semana, por orden («una semana ceviche y otra carpaccio»); together = todas en la misma comida, un plato cada una.' },
      every: { type: 'integer', minimum: 2, maximum: WEEK_TYPE_MAX_OPTIONS, description: '«Cada N semanas» con UNA opción («legumbres cada dos semanas» = 2). Sin esto, cada semana.' },
      off: { type: 'boolean', description: 'true = «no hay» esa comida esos días («quita el desayuno del domingo», «el sábado no cenamos en casa»); false = vuelve a planificarse.' },
      diners: { type: 'integer', minimum: 1, maximum: 24, description: 'Comensales de esa comida, si los dice.' },
    },
    required: [],
  },
  async handler(
    p: { days?: unknown; meal?: unknown; options?: OptionParam[]; mode?: string; every?: number; off?: boolean; diners?: number },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const meal = mealOf(p?.meal)
    const rawDays = Array.isArray(p?.days) ? p.days : p?.days != null ? [p.days] : []
    const days = rawDays.map(dayIndexOf)
    if (days.some((d) => d === null)) return text('No he cambiado nada: no entiendo uno de los días. Pásalos como lunes…domingo.')
    if (!meal && days.length === 0) return text('No he cambiado nada: falta el día y la comida. Pregúntale solo eso, en una frase: «¿Qué día y en qué comida?».')
    if (!meal) return text(`No he cambiado nada: falta la comida. Pregúntale solo eso, en una frase: «¿En la comida o en la cena?» (o el desayuno o la merienda, si encaja con lo que dice).`)
    if (days.length === 0) return text(`No he cambiado nada: falta el día. Pregúntale solo eso, en una frase: «¿Qué día?».`)
    const hasOptions = Array.isArray(p.options) && p.options.length > 0
    if (!hasOptions && p.off === undefined && p.diners === undefined) {
      return text('No he cambiado nada: dime qué va en ese hueco (options), si no hay esa comida (off) o los comensales (diners).')
    }

    // Each option, resolved; a dish named goes through the phase-1 search.
    const options: WeekTypeOption[] = []
    const written: string[] = []
    if (hasOptions) {
      let recipes: Awaited<ReturnType<typeof loadRecipesFor>> | null = null
      for (const o of p.options!) {
        const kind = o?.kind
        if (kind === 'type') {
          const type = isDishType(o.type) ? o.type : dishTypeForName(o.type ?? o.name ?? '')
          if (!type) return text(`No he cambiado nada: «${o.type ?? o.name ?? ''}» no es un tipo de plato. Pásalo como kind=dish con su nombre.`)
          options.push({ kind: 'type', type })
        } else if (kind === 'dish') {
          const name = String(o.name ?? '').trim()
          if (!name) return text('No he cambiado nada: falta el nombre del plato.')
          recipes ??= await loadRecipesFor(ctx.userId, ctx.db)
          const option = optionForDishName(name, recipes)
          if (option.kind === 'fixed') written.push(option.label)
          options.push(option)
        } else if (kind === 'fixed') {
          const label = String(o.name ?? '').trim().slice(0, 60)
          if (!label) return text('No he cambiado nada: falta el nombre corto de lo fijo.')
          options.push({ kind: 'fixed', label, items: Array.isArray(o.items) ? o.items.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit as 'u' | 'g' | 'ml' })) : [] })
        } else if (kind === 'taper' || kind === 'any') {
          options.push({ kind })
        } else {
          return text('No he cambiado nada: cada opción lleva kind (type, dish, fixed, taper o any).')
        }
      }
    }

    const current = await loadDays(ctx)
    if (!current) return text(NO_HOUSEHOLD)
    const request: WeekTypeSlotRequest = {
      options: hasOptions ? options : undefined,
      together: p.mode === 'together',
      every: typeof p.every === 'number' && p.every > 1 ? Math.round(p.every) : undefined,
      off: typeof p.off === 'boolean' ? p.off : undefined,
      diners: typeof p.diners === 'number' ? Math.round(p.diners) : undefined,
    }
    // Every slot checked before writing any: all or nothing.
    const changes: Array<{ day: number; slot: WeekTypeSlot }> = []
    let shown: WeekTypeSlot | null = null
    for (const day of [...new Set(days as number[])].sort((a, b) => a - b)) {
      const prev = weekTypeSlotAt(current, day, meal)
      const next = nextWeekTypeSlot(prev, request)
      if ('error' in next) return text(`No he cambiado nada: ${next.error}`)
      const invalid = weekTypeSlotError(day, meal, next) ?? (weekTypeSlotSchema.safeParse(next).success ? null : 'eso no cabe en un hueco de la semana tipo.')
      if (invalid) return text(`No he cambiado nada: ${invalid}`)
      shown ??= next
      const { since: _s, ...before } = prev
      if (stableSlotJson(next) !== stableSlotJson(before)) changes.push({ day, slot: next })
    }
    const where = `${daysLabel(days as number[])}, ${MEAL_LABELS[meal]}, ${describeWeekTypeSlot(shown!)}`
    if (changes.length === 0) return text(`Ya estaba así en su semana tipo: ${where}. No he cambiado nada.`)
    try {
      for (const c of changes) await api(ctx)('PUT', `/households/me/week-type/${c.day}/${meal}`, c.slot)
    } catch (err) {
      if (err instanceof AppApiError && err.status === 404 && /hogar|household/i.test(err.message)) return text(NO_HOUSEHOLD)
      if (err instanceof AppApiError && err.status < 500) return text(`No he cambiado nada: ${err.message}`)
      throw err
    }
    const note = written.length
      ? ` ${joinY(written.map((w) => `«${w}»`))} no es un tipo de plato ni el nombre de una sola receta: sale escrito así en el menú, sin receta ni compra.`
      : ''
    return text(
      `Hecho, en tu semana tipo: ${where}.${note} Sale así en los menús que se generen desde ahora; la semana ya hecha no cambia. Confírmaselo en una línea, con estas palabras.`,
      { days: changes.map((c) => c.day), meal, slot: shown },
      'confirmation',
    )
  },
}

export const weekTypeSkills: SkillDefinition[] = [getWeekType, setWeekTypeSlot]
