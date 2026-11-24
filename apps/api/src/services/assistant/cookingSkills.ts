// Mimo's in-app cooking mode tools. Split out of skills.ts (PRO-400).
import { and, ilike, or } from 'drizzle-orm'
import { recipes } from '../../db/schema.js'
import { type SkillDefinition } from './types.js'
import { visibleWhere } from './skillHelpers.js'

// 12. ── start_cooking_mode ────────────────────────────────
export const startCookingMode: SkillDefinition = {
  name: 'start_cooking_mode',
  description: 'Abre el modo cocina paso a paso para una receta. El cliente navega a /recipes/:id/cook al recibir esta respuesta.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string', description: 'Nombre de la receta' },
      servings: { type: 'number', description: 'Comensales para el cooking mode (opcional)' },
    },
    required: ['recipeName'],
  },
  async handler(params: { recipeName: string; servings?: number }, ctx) {
    const { db } = ctx
    const [recipe] = await db
      .select({ id: recipes.id, name: recipes.name })
      .from(recipes)
      .where(and(await visibleWhere(ctx), or(
        ilike(recipes.name, `%${params.recipeName}%`),
        ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map(w => ilike(recipes.name, `%${w}%`)),
      )))
      .limit(1)
    if (!recipe) {
      return { data: null, summary: `No he encontrado "${params.recipeName}".`, uiHint: 'text' }
    }
    return {
      data: { recipeId: (recipe as any).id, recipeName: (recipe as any).name, servings: params.servings ?? null },
      summary: `Empezando a cocinar ${(recipe as any).name}.`,
      uiHint: 'cooking_navigate',
    }
  },
}

// 13. ── set_timer ─────────────────────────────────────────
export const setTimer: SkillDefinition = {
  name: 'set_timer',
  description: 'Pone un temporizador de cocina. Solo tiene efecto visible si el usuario esta en el modo cocina; en otros contextos confirma verbalmente.',
  parameters: {
    type: 'object',
    properties: {
      minutes: { type: 'number', description: 'Minutos del temporizador (0.5 - 180)' },
      label: { type: 'string', description: 'Etiqueta opcional (ej: "arroz")' },
    },
    required: ['minutes'],
  },
  async handler(params: { minutes: number; label?: string }) {
    const m = Math.max(0.5, Math.min(180, Number(params.minutes) || 0))
    return {
      data: { minutes: m, label: params.label ?? null },
      summary: `Temporizador de ${m} min${params.label ? ` para ${params.label}` : ''} en marcha.`,
      uiHint: 'cooking_timer',
    }
  },
}

// 14. ── cooking_step ──────────────────────────────────────
export const cookingStep: SkillDefinition = {
  name: 'cooking_step',
  description: 'Avanza, retrocede o repite el paso actual del modo cocina. Solo tiene efecto visible si el usuario esta en el modo cocina.',
  parameters: {
    type: 'object',
    properties: {
      direction: { type: 'string', enum: ['next', 'previous', 'repeat'], description: 'Direccion del paso' },
    },
    required: ['direction'],
  },
  async handler(params: { direction: 'next' | 'previous' | 'repeat' }) {
    const d = params.direction === 'previous' ? 'previous' : params.direction === 'repeat' ? 'repeat' : 'next'
    const verb = d === 'next' ? 'Siguiente paso' : d === 'previous' ? 'Paso anterior' : 'Repitiendo el paso actual'
    return {
      data: { direction: d },
      summary: `${verb}.`,
      uiHint: 'cooking_step',
    }
  },
}
