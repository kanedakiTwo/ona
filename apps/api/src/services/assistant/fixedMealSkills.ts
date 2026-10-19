/**
 * Comidas fijas from chat (PRO-218, D-051): «todos los días desayuno yogur con
 * cereales y dos galletas» is said once. Same data as Perfil → Plantilla
 * semanal → Comidas fijas.
 */
import {
  COOKING_WEEKDAYS,
  FIXED_ITEM_UNITS,
  FIXED_MEALS,
  FIXED_MEAL_LABELS,
  fixedItemsText,
  fixedMealSchema,
  type FixedMeal,
  type FixedMealType,
} from '@ona/shared'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'
import { getFixedMeals, saveFixedMeal } from '../fixedMealsStore.js'

function describe(f: FixedMeal): string {
  const days = f.days.length === 7 ? 'todos los días' : f.days.join(', ')
  return `${FIXED_MEAL_LABELS[f.meal]} fijo (${days}): ${f.label} — por persona: ${fixedItemsText(f.items)}`
}

const getFixedMealsSkill: SkillDefinition = {
  name: 'get_fixed_meals',
  description:
    'Lee las comidas fijas del usuario (una comida de unos días que siempre es lo mismo, p. ej. el desayuno de yogur con cereales): no entran en el menú generado y lo suyo va solo a la lista de la compra.',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_params: Record<string, never>, ctx: SkillContext): Promise<SkillResult> {
    const list = await getFixedMeals(ctx.userId, ctx.db)
    if (list.length === 0) return { data: { fixedMeals: [] }, summary: 'No hay comidas fijas.', uiHint: 'text' }
    return { data: { fixedMeals: list }, summary: list.map(describe).join('\n'), uiHint: 'text' }
  },
}

const setFixedMealSkill: SkillDefinition = {
  name: 'set_fixed_meal',
  description:
    'Marca una comida como fija («todos los días desayuno yogur con cereales y dos galletas»): esa comida de esos días no se genera, se ve como «Fijo: …» y sus cosas (cantidades POR PERSONA y por día) van solas a la lista de la compra. Con remove=true la quita. Se aplica al generar el menú (la semana ya hecha no cambia hasta que se regenere). Una por tipo de comida.',
  parameters: {
    type: 'object',
    properties: {
      meal: { type: 'string', enum: [...FIXED_MEALS], description: 'breakfast (desayuno), lunch (comida), snack (merienda) o dinner (cena).' },
      days: { type: 'array', items: { type: 'string', enum: [...COOKING_WEEKDAYS] }, description: 'Días (lunes…domingo). Por defecto, todos.' },
      label: { type: 'string', description: 'Nombre corto, p. ej. «Yogur con cereales».' },
      items: {
        type: 'array',
        description: 'Cosas y cantidades por persona y día.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'p. ej. «yogur natural», «cereales», «galletas»' },
            quantity: { type: 'number' },
            unit: { type: 'string', enum: [...FIXED_ITEM_UNITS], description: 'u (unidades), g o ml' },
          },
          required: ['name', 'quantity', 'unit'],
        },
      },
      remove: { type: 'boolean', description: 'true para quitar la comida fija de ese tipo.' },
    },
    required: ['meal'],
  },
  async handler(
    params: { meal: FixedMealType; days?: string[]; label?: string; items?: Array<{ name: string; quantity: number; unit: string }>; remove?: boolean },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    if (!(FIXED_MEALS as readonly string[]).includes(params?.meal)) {
      return { data: null, summary: 'No he cambiado nada: dime qué comida (desayuno, comida, merienda o cena).', uiHint: 'text' }
    }
    if (params.remove) {
      await saveFixedMeal(ctx.userId, params.meal, null, ctx.db)
      return { data: { removed: params.meal }, summary: `Quitado el ${FIXED_MEAL_LABELS[params.meal].toLowerCase()} fijo. Volverá a planificarse al generar el menú.`, uiHint: 'text' }
    }
    const parsed = fixedMealSchema.safeParse({
      meal: params.meal,
      days: params.days && params.days.length > 0 ? params.days : [...COOKING_WEEKDAYS],
      label: params.label ?? '',
      items: params.items ?? [],
    })
    if (!parsed.success) {
      return { data: null, summary: 'No he cambiado nada: necesito un nombre corto y al menos una cosa con su cantidad por persona (u, g o ml).', uiHint: 'text' }
    }
    await saveFixedMeal(ctx.userId, params.meal, parsed.data, ctx.db)
    return {
      data: { fixedMeal: parsed.data },
      summary: `Guardado. ${describe(parsed.data)}. Se aplica al generar el menú: esa comida sale como «Fijo: ${parsed.data.label}» y lo suyo va a la lista de la compra.`,
      uiHint: 'text',
    }
  },
}

export const fixedMealSkills: SkillDefinition[] = [getFixedMealsSkill, setFixedMealSkill]
