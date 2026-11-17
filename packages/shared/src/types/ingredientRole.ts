import { z } from 'zod'

/**
 * Role of an ingredient inside one recipe («Cocinar ahora», 2026-11-03):
 * essential = without it it isn't that dish; secondary = it can be left out.
 * Marked by Cocina for catalogue recipes; null = not marked yet (the
 * automatic rule in the API decides).
 */
export const INGREDIENT_ROLES = ['essential', 'secondary'] as const
export type IngredientRole = (typeof INGREDIENT_ROLES)[number]

export const ingredientRoleMarkSchema = z.object({
  recipeIngredientId: z.string().uuid(),
  role: z.enum(INGREDIENT_ROLES),
  substituteIngredientIds: z.array(z.string().uuid()).max(5).default([]),
})
export type IngredientRoleMark = z.infer<typeof ingredientRoleMarkSchema>

export const ingredientRolesUpdateSchema = z.array(ingredientRoleMarkSchema).min(1).max(80)
