import crypto from 'crypto'
import { eq, desc, ilike, or, inArray } from 'drizzle-orm'
import {
  menus,
  recipes,
  recipeIngredients,
  recipeSteps,
  ingredients,
  userFavorites,
  users,
  userNutrientBalance,
  menuLogs,
  shoppingLists,
} from '../../db/schema.js'
import { nutrientsToPercentages, TARGET_MACROS, detectSeason } from '@ona/shared'
import type { DayMenu, Meal, NutrientBalance, HouseholdSize } from '@ona/shared'
import { householdMultiplier, householdSizeToCounts } from '@ona/shared'
import { generateMenu } from '../menuGenerator.js'
import { generateShoppingList } from '../shoppingList.js'
import { findRecipeForSlot, type RecipeWithIngredients } from '../recipeMatcher.js'
import { calculateMenuCaloriesFromDB } from '../calorieCalculator.js'
import { calculateMenuNutrientsFromDB } from '../nutrientCalculator.js'
import { updateBalance } from '../nutrientBalance.js'
import { getSummary } from '../advisor.js'
import type { SkillDefinition, SkillContext, SkillResult } from './types.js'

// ─── Helper: get current week start (Monday) ───────────────
function getWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day // Monday = 1
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  return monday.toISOString().slice(0, 10)
}

// ─── Helper: load recipes with ingredients ─────────────────
async function loadRecipesWithIngredients(db: any): Promise<RecipeWithIngredients[]> {
  const allRecipes = await db.select().from(recipes)
  const riRows = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
      ingredientName: ingredients.name,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))

  const ingredientsByRecipe = new Map<string, any[]>()
  for (const row of riRows) {
    const list = ingredientsByRecipe.get(row.recipeId) ?? []
    list.push({
      ingredientId: row.ingredientId,
      ingredientName: row.ingredientName,
      quantity: row.quantity,
      unit: row.unit ?? 'g',
    })
    ingredientsByRecipe.set(row.recipeId, list)
  }

  return allRecipes.map((r: any) => ({
    id: r.id,
    name: r.name,
    meals: r.meals ?? [],
    seasons: r.seasons ?? [],
    tags: r.tags ?? [],
    ingredients: ingredientsByRecipe.get(r.id) ?? [],
  }))
}

// ─── Skill definitions ─────────────────────────────────────

const getTodaysMenu: SkillDefinition = {
  name: 'get_todays_menu',
  description: 'Obtiene el menu del dia indicado (o de hoy si no se especifica). dayIndex: 0=lunes, 6=domingo.',
  parameters: {
    type: 'object',
    properties: {
      dayIndex: { type: 'number', description: 'Indice del dia (0=lunes, 6=domingo). Si se omite, se calcula automaticamente.' },
    },
    required: [],
  },
  async handler(params: { dayIndex?: number }, ctx: SkillContext): Promise<SkillResult> {
    const { userId, db } = ctx

    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.userId, userId))
      .orderBy(desc(menus.createdAt))
      .limit(1)

    if (!menu) {
      return { data: null, summary: 'No tienes ningun menu generado todavia.', uiHint: 'text' }
    }

    const days = menu.days as DayMenu[]
    let dayIndex = params.dayIndex

    if (dayIndex === undefined || dayIndex === null) {
      const now = new Date()
      const jsDay = now.getDay()
      dayIndex = jsDay === 0 ? 6 : jsDay - 1 // Convert Sunday=0 to index 6, Monday=1 to 0
    }

    if (dayIndex < 0 || dayIndex >= days.length) {
      return { data: null, summary: 'Indice de dia fuera de rango.', uiHint: 'text' }
    }

    const dayNames = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
    const day = days[dayIndex]
    const meals = Object.entries(day)
      .filter(([, slot]: any) => slot?.recipeName)
      .map(([meal, slot]: any) => `${meal}: ${slot.recipeName}`)

    const summary = meals.length > 0
      ? `Menu del ${dayNames[dayIndex]}: ${meals.join(', ')}`
      : `No hay comidas planificadas para el ${dayNames[dayIndex]}.`

    return { data: { dayIndex, menuId: menu.id, day }, summary, uiHint: 'menu' }
  },
}

const getRecipeDetails: SkillDefinition = {
  name: 'get_recipe_details',
  description: 'Busca una receta por nombre y devuelve todos los detalles: ingredientes con cantidades, pasos, tiempo de preparacion.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string', description: 'Nombre de la receta a buscar' },
    },
    required: ['recipeName'],
  },
  async handler(params: { recipeName: string }, ctx: SkillContext): Promise<SkillResult> {
    const { db } = ctx

    // First try exact match
    let results = await db
      .select()
      .from(recipes)
      .where(ilike(recipes.name, `%${params.recipeName}%`))
      .limit(1)

    // If no exact match, try word-by-word
    if (results.length === 0) {
      const words = params.recipeName.split(/\s+/).filter(w => w.length >= 3)
      if (words.length > 0) {
        results = await db
          .select()
          .from(recipes)
          .where(or(...words.map((w: string) => ilike(recipes.name, `%${w}%`))))
          .limit(5)
      }
    }

    if (results.length === 0) {
      return { data: null, summary: `No he encontrado ninguna receta con el nombre "${params.recipeName}".`, uiHint: 'text' }
    }

    // Pick the best match: prefer name that contains the most query words
    const queryWords = params.recipeName.toLowerCase().split(/\s+/).filter(w => w.length >= 3)
    const recipe = results.reduce((best: any, r: any) => {
      const nameWords = r.name.toLowerCase()
      const score = queryWords.filter(w => nameWords.includes(w)).length
      const bestScore = queryWords.filter(w => best.name.toLowerCase().includes(w)).length
      return score > bestScore ? r : best
    }, results[0])

    // Get ingredients
    const riRows = await db
      .select({
        ingredientName: ingredients.name,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(eq(recipeIngredients.recipeId, recipe.id))

    const ingredientList = riRows.map((r: any) => `${r.ingredientName}: ${r.quantity}${r.unit ?? 'g'}`)
    const summary = [
      `${recipe.name} (${recipe.prepTime ?? '?'}min)`,
      `Ingredientes: ${ingredientList.join(', ')}`,
      recipe.steps?.length ? `Pasos: ${recipe.steps.length}` : '',
    ].filter(Boolean).join('. ')

    return {
      data: {
        id: recipe.id,
        name: recipe.name,
        prepTime: recipe.prepTime,
        meals: recipe.meals,
        seasons: recipe.seasons,
        steps: recipe.steps,
        ingredients: riRows,
      },
      summary,
      uiHint: 'recipe',
    }
  },
}

const getWeeklyNutrition: SkillDefinition = {
  name: 'get_weekly_nutrition',
  description: 'Obtiene el resumen nutricional de las ultimas semanas: calorias, macros y tendencia.',
  parameters: {
    type: 'object',
    properties: {
      weeks: { type: 'number', description: 'Numero de semanas a analizar (por defecto 4)' },
    },
    required: [],
  },
  async handler(params: { weeks?: number }, ctx: SkillContext): Promise<SkillResult> {
    const { userId, db } = ctx
    const weeks = params.weeks ?? 4

    const summaryResult = await getSummary(userId, weeks, db)

    // Also get current balance
    const [balance] = await db
      .select()
      .from(userNutrientBalance)
      .where(eq(userNutrientBalance.userId, userId))
      .limit(1)

    let balanceSummary = ''
    if (balance?.balance) {
      const pct = nutrientsToPercentages(balance.balance as NutrientBalance)
      balanceSummary = ` Balance actual: proteina ${pct.protein.toFixed(1)}%, carbohidratos ${pct.carbohydrates.toFixed(1)}%, grasa ${pct.fat.toFixed(1)}% (objetivo: ${TARGET_MACROS.protein}/${TARGET_MACROS.carbohydrates}/${TARGET_MACROS.fat}).`
    }

    const summary = summaryResult.weeks.length > 0
      ? `Ultimas ${summaryResult.weeks.length} semanas: media de ${Math.round(summaryResult.averageCalories)} kcal/semana, tendencia ${summaryResult.trend}.${balanceSummary}`
      : 'No hay datos nutricionales todavia. Genera un menu semanal para empezar a acumular datos.'

    return { data: { ...summaryResult, currentBalance: balance?.balance }, summary, uiHint: 'nutrition' }
  },
}

const getShoppingList: SkillDefinition = {
  name: 'get_shopping_list',
  description: 'Genera la lista de la compra basada en el menu semanal actual.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async handler(_params: {}, ctx: SkillContext): Promise<SkillResult> {
    const { userId, db } = ctx

    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.userId, userId))
      .orderBy(desc(menus.createdAt))
      .limit(1)

    if (!menu) {
      return { data: null, summary: 'No tienes menu. Genera uno primero para obtener la lista de la compra.', uiHint: 'text' }
    }

    const [user] = await db
      .select({
        adults: users.adults,
        kidsCount: users.kidsCount,
        householdSize: users.householdSize,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    let multiplier: number
    if (user && typeof user.adults === 'number' && user.adults > 0) {
      multiplier = householdMultiplier(user.adults, user.kidsCount ?? 0)
    } else {
      const counts = householdSizeToCounts(
        (user?.householdSize as HouseholdSize | null | undefined) ?? null,
      )
      multiplier = householdMultiplier(counts.adults, counts.kidsCount)
    }
    const items = await generateShoppingList(menu.days as DayMenu[], multiplier, db)

    const summary = items.length > 0
      ? `Lista de la compra con ${items.length} ingredientes para esta semana.`
      : 'La lista de la compra esta vacia.'

    return { data: items, summary, uiHint: 'shopping_list' }
  },
}

const suggestRecipes: SkillDefinition = {
  name: 'suggest_recipes',
  description: 'Sugiere recetas filtradas por temporada y/o tipo de comida. Devuelve hasta 5 recetas.',
  parameters: {
    type: 'object',
    properties: {
      criteria: { type: 'string', description: 'Criterio de busqueda libre (ej: "rapida", "legumbres")' },
      mealType: { type: 'string', description: 'Tipo de comida: breakfast, lunch, dinner' },
    },
    required: [],
  },
  async handler(params: { criteria?: string; mealType?: string }, ctx: SkillContext): Promise<SkillResult> {
    const { db } = ctx
    const season = detectSeason()

    let allRecipes = await db
      .select({
        id: recipes.id,
        name: recipes.name,
        meals: recipes.meals,
        seasons: recipes.seasons,
        prepTime: recipes.prepTime,
        tags: recipes.tags,
      })
      .from(recipes)

    // Filter by season
    allRecipes = allRecipes.filter((r: any) => {
      if (!r.seasons || r.seasons.length === 0) return true
      return r.seasons.includes(season)
    })

    // Filter by meal type
    if (params.mealType) {
      allRecipes = allRecipes.filter((r: any) => r.meals?.includes(params.mealType))
    }

    // Filter by criteria (search in name and tags)
    if (params.criteria) {
      const q = params.criteria.toLowerCase()
      allRecipes = allRecipes.filter((r: any) =>
        r.name.toLowerCase().includes(q) ||
        r.tags?.some((t: string) => t.toLowerCase().includes(q))
      )
    }

    const top5 = allRecipes.slice(0, 5)
    const summary = top5.length > 0
      ? `Sugerencias: ${top5.map((r: any) => `${r.name} (${r.prepTime ?? '?'}min)`).join(', ')}`
      : 'No he encontrado recetas con esos criterios.'

    return { data: top5, summary, uiHint: 'recipe' }
  },
}

const searchRecipes: SkillDefinition = {
  name: 'search_recipes',
  description: 'Busca recetas por nombre.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Texto a buscar en el nombre de la receta' },
    },
    required: ['query'],
  },
  async handler(params: { query: string }, ctx: SkillContext): Promise<SkillResult> {
    const { db } = ctx

    const results = await db
      .select({
        id: recipes.id,
        name: recipes.name,
        meals: recipes.meals,
        seasons: recipes.seasons,
        prepTime: recipes.prepTime,
      })
      .from(recipes)
      .where(
        or(
          ilike(recipes.name, `%${params.query}%`),
          ...params.query.split(/\s+/).filter(w => w.length >= 3).map(word => ilike(recipes.name, `%${word}%`)),
        )
      )
      .limit(10)

    const summary = results.length > 0
      ? `Encontradas ${results.length} receta(s): ${results.map((r: any) => r.name).join(', ')}`
      : `No he encontrado recetas con "${params.query}".`

    return { data: results, summary, uiHint: 'recipe' }
  },
}

const generateWeeklyMenu: SkillDefinition = {
  name: 'generate_weekly_menu',
  description: 'Genera un nuevo menu semanal completo y lo guarda. Usa esto cuando el usuario pida un nuevo menu.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async handler(_params: {}, ctx: SkillContext): Promise<SkillResult> {
    const { userId, db } = ctx
    const weekStart = getWeekStart()

    const days = await generateMenu(userId, weekStart, undefined, db)

    // Save to menus table
    const [menu] = await db
      .insert(menus)
      .values({ userId, weekStart, days, locked: {} })
      .returning()

    // Calculate calories and nutrients for the log
    const caloriesTotal = await calculateMenuCaloriesFromDB(days, db)
    const aggregatedNutrients = await calculateMenuNutrientsFromDB(days, db)

    await db.insert(menuLogs).values({
      userId,
      menuId: menu.id,
      weekStart,
      aggregatedNutrients,
      caloriesTotal,
    })

    await updateBalance(userId, aggregatedNutrients, db)

    // Build summary
    const dayNames = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
    const menuSummary = days.map((day: DayMenu, i: number) => {
      const meals = Object.entries(day)
        .filter(([, slot]: any) => slot?.recipeName)
        .map(([meal, slot]: any) => `${meal}: ${slot.recipeName}`)
      return `${dayNames[i]}: ${meals.join(', ')}`
    }).join('; ')

    return {
      data: menu,
      summary: `Menu generado para la semana del ${weekStart}. ${menuSummary}`,
      uiHint: 'menu',
    }
  },
}

const swapMeal: SkillDefinition = {
  name: 'swap_meal',
  description:
    'Cambia un plato concreto del menu. dayIndex: 0=lunes, 6=domingo. meal: breakfast, lunch o dinner. Si el usuario nombra una receta concreta, pásala en `recipeName` (o `recipeId` si lo conoces) y la receta se asigna directamente sin elegir aleatorio. Si no se nombra, el sistema escoge automáticamente un plato compatible con la temporada y restricciones.',
  parameters: {
    type: 'object',
    properties: {
      dayIndex: { type: 'number', description: 'Indice del dia (0=lunes, 6=domingo)' },
      meal: { type: 'string', description: 'Tipo de comida: breakfast, lunch o dinner' },
      recipeId: {
        type: 'string',
        description: 'UUID de la receta concreta a colocar en ese hueco. Opcional.',
      },
      recipeName: {
        type: 'string',
        description: 'Nombre (o parte) de la receta concreta. Se buscará por substring case-insensitive. Opcional. Si hay varias coincidencias se prioriza la del usuario sobre las del catálogo de ONA.',
      },
    },
    required: ['dayIndex', 'meal'],
  },
  async handler(
    params: { dayIndex: number; meal: string; recipeId?: string; recipeName?: string },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const { userId, db } = ctx
    const { dayIndex, meal } = params

    // Get latest menu
    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.userId, userId))
      .orderBy(desc(menus.createdAt))
      .limit(1)

    if (!menu) {
      return { data: null, summary: 'No tienes menu. Genera uno primero.', uiHint: 'text' }
    }

    const days = menu.days as DayMenu[]

    if (dayIndex < 0 || dayIndex >= days.length) {
      return { data: null, summary: 'Indice de dia fuera de rango.', uiHint: 'text' }
    }

    // Manual override path: if the user (or the model) named a specific
    // recipe, look it up and place it directly. Prefer recipes the user
    // owns when matching by name so "mi tortilla" wins over a system one
    // with the same word.
    if (params.recipeId || params.recipeName) {
      let chosen: { id: string; name: string } | null = null
      if (params.recipeId) {
        const [row] = await db
          .select({ id: recipes.id, name: recipes.name })
          .from(recipes)
          .where(eq(recipes.id, params.recipeId))
          .limit(1)
        chosen = row ?? null
      } else if (params.recipeName) {
        const candidates = await db
          .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
          .from(recipes)
          .where(ilike(recipes.name, `%${params.recipeName}%`))
          .limit(20)
        const owned = candidates.find((c: { authorId: string | null }) => c.authorId === userId)
        chosen = owned ?? candidates[0] ?? null
      }
      if (!chosen) {
        return {
          data: null,
          summary: `No he encontrado la receta "${params.recipeName ?? params.recipeId}".`,
          uiHint: 'text',
        }
      }
      days[dayIndex][meal] = { recipeId: chosen.id, recipeName: chosen.name }
      const [updatedManual] = await db
        .update(menus)
        .set({ days })
        .where(eq(menus.id, menu.id))
        .returning()
      const dayNames = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
      const mealEs = meal === 'breakfast' ? 'desayuno' : meal === 'lunch' ? 'comida' : meal === 'dinner' ? 'cena' : meal
      return {
        data: updatedManual,
        summary: `Hecho. He puesto "${chosen.name}" en el ${mealEs} del ${dayNames[dayIndex]}.`,
        uiHint: 'menu',
      }
    }

    // Collect used recipe IDs (excluding the one being replaced)
    const usedRecipeIds = new Set<string>()
    for (let d = 0; d < days.length; d++) {
      for (const m of Object.keys(days[d])) {
        const slot = days[d][m]
        if (slot?.recipeId && !(d === dayIndex && m === meal)) {
          usedRecipeIds.add(slot.recipeId)
        }
      }
    }

    // Fetch user restrictions
    const [user] = await db
      .select({ restrictions: users.restrictions })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    const restrictions: string[] = user?.restrictions ?? []

    // Fetch favorites
    const favRows = await db
      .select({ recipeId: userFavorites.recipeId })
      .from(userFavorites)
      .where(eq(userFavorites.userId, userId))

    const favoriteRecipeIds = new Set<string>(favRows.map((f: any) => f.recipeId))

    // Load recipes with ingredients for matching
    const allRecipes = await loadRecipesWithIngredients(db)
    const season = detectSeason()

    const newRecipe = findRecipeForSlot(allRecipes, {
      meal: meal as Meal,
      season,
      usedRecipeIds,
      restrictions,
      favoriteRecipeIds,
    })

    if (!newRecipe) {
      return { data: null, summary: 'No he encontrado una receta alternativa para ese hueco.', uiHint: 'text' }
    }

    // Update the menu
    days[dayIndex][meal] = { recipeId: newRecipe.id, recipeName: newRecipe.name }

    const [updated] = await db
      .update(menus)
      .set({ days })
      .where(eq(menus.id, menu.id))
      .returning()

    const dayNames = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
    return {
      data: updated,
      summary: `Cambiado: ${dayNames[dayIndex]} ${meal} ahora es ${newRecipe.name}.`,
      uiHint: 'menu',
    }
  },
}

const toggleFavorite: SkillDefinition = {
  name: 'toggle_favorite',
  description: 'Anade o quita una receta de favoritos del usuario.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string', description: 'Nombre de la receta' },
    },
    required: ['recipeName'],
  },
  async handler(params: { recipeName: string }, ctx: SkillContext): Promise<SkillResult> {
    const { userId, db } = ctx

    // Find recipe by name
    const [recipe] = await db
      .select({ id: recipes.id, name: recipes.name })
      .from(recipes)
      .where(or(
        ilike(recipes.name, `%${params.recipeName}%`),
        ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map((w: string) => ilike(recipes.name, `%${w}%`)),
      ))
      .limit(1)

    if (!recipe) {
      return { data: null, summary: `No he encontrado la receta "${params.recipeName}".`, uiHint: 'text' }
    }

    // Check if already favorited
    const existing = await db
      .select()
      .from(userFavorites)
      .where(
        eq(userFavorites.userId, userId),
      )

    const alreadyFav = existing.find((f: any) => f.recipeId === recipe.id)

    if (alreadyFav) {
      await db
        .delete(userFavorites)
        .where(eq(userFavorites.id, alreadyFav.id))

      return { data: { recipeId: recipe.id, favorited: false }, summary: `${recipe.name} eliminada de favoritos.`, uiHint: 'confirmation' }
    } else {
      await db
        .insert(userFavorites)
        .values({ userId, recipeId: recipe.id })

      return { data: { recipeId: recipe.id, favorited: true }, summary: `${recipe.name} anadida a favoritos.`, uiHint: 'confirmation' }
    }
  },
}

const markMealEaten: SkillDefinition = {
  name: 'mark_meal_eaten',
  description: 'Marca una comida como comida o no comida en el menu actual.',
  parameters: {
    type: 'object',
    properties: {
      dayIndex: { type: 'number', description: 'Indice del dia (0=lunes, 6=domingo)' },
      meal: { type: 'string', description: 'Tipo de comida: breakfast, lunch o dinner' },
      eaten: { type: 'boolean', description: 'true si se ha comido, false si no' },
    },
    required: ['dayIndex', 'meal', 'eaten'],
  },
  async handler(params: { dayIndex: number; meal: string; eaten: boolean }, ctx: SkillContext): Promise<SkillResult> {
    const { userId, db } = ctx
    const { dayIndex, meal, eaten } = params

    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.userId, userId))
      .orderBy(desc(menus.createdAt))
      .limit(1)

    if (!menu) {
      return { data: null, summary: 'No tienes menu.', uiHint: 'text' }
    }

    const days = menu.days as any[]

    if (dayIndex < 0 || dayIndex >= days.length) {
      return { data: null, summary: 'Indice de dia fuera de rango.', uiHint: 'text' }
    }

    if (!days[dayIndex][meal]) {
      return { data: null, summary: 'No hay comida planificada en ese hueco.', uiHint: 'text' }
    }

    days[dayIndex][meal].eaten = eaten
    if (eaten) {
      days[dayIndex][meal].eatenAt = new Date().toISOString()
    } else {
      delete days[dayIndex][meal].eatenAt
    }

    const [updated] = await db
      .update(menus)
      .set({ days })
      .where(eq(menus.id, menu.id))
      .returning()

    const dayNames = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
    const label = eaten ? 'comida' : 'no comida'
    const recipeName = days[dayIndex][meal].recipeName ?? meal
    return {
      data: updated,
      summary: `${recipeName} del ${dayNames[dayIndex]} marcada como ${label}.`,
      uiHint: 'confirmation',
    }
  },
}

const createRecipe: SkillDefinition = {
  name: 'create_recipe',
  description: 'Crea y guarda una nueva receta en la base de datos. Usa esta herramienta cuando tengas toda la informacion necesaria: nombre, ingredientes con cantidades, pasos, tiempo, tipo de comida y temporada.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre de la receta' },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nombre del ingrediente' },
            quantity: { type: 'number', description: 'Cantidad' },
            unit: { type: 'string', description: 'Unidad (g, ml, unidades, etc.)' },
          },
          required: ['name', 'quantity', 'unit'],
        },
        description: 'Lista de ingredientes con cantidades',
      },
      steps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Pasos de preparacion',
      },
      prepTime: { type: 'number', description: 'Tiempo de preparacion en minutos' },
      meals: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tipos de comida: breakfast, lunch, dinner',
      },
      seasons: {
        type: 'array',
        items: { type: 'string' },
        description: 'Temporadas: spring, summer, autumn, winter',
      },
    },
    required: ['name', 'ingredients', 'steps', 'prepTime', 'meals', 'seasons'],
  },
  async handler(params: {
    name: string
    ingredients: Array<{ name: string; quantity: number; unit: string }>
    steps: string[]
    prepTime: number
    meals: string[]
    seasons: string[]
  }, ctx: SkillContext): Promise<SkillResult> {
    const { userId, db } = ctx

    // Create the recipe
    const [recipe] = await db
      .insert(recipes)
      .values({
        name: params.name,
        authorId: userId,
        prepTime: params.prepTime,
        meals: params.meals,
        seasons: params.seasons,
        steps: params.steps,
      })
      .returning()

    // Match ingredient names to existing ingredients (case-insensitive)
    const linkedIngredients: string[] = []
    const missingIngredients: string[] = []

    for (const ing of params.ingredients) {
      const [found] = await db
        .select({ id: ingredients.id, name: ingredients.name })
        .from(ingredients)
        .where(ilike(ingredients.name, ing.name))
        .limit(1)

      if (found) {
        await db.insert(recipeIngredients).values({
          recipeId: recipe.id,
          ingredientId: found.id,
          quantity: ing.quantity,
          unit: ing.unit,
        })
        linkedIngredients.push(found.name)
      } else {
        missingIngredients.push(ing.name)
      }
    }

    let summary = `Receta "${recipe.name}" creada con ${linkedIngredients.length} ingredientes vinculados.`
    if (missingIngredients.length > 0) {
      summary += ` Ingredientes no encontrados en la base de datos (no vinculados): ${missingIngredients.join(', ')}.`
    }

    return { data: { recipeId: recipe.id, name: recipe.name, linkedIngredients, missingIngredients }, summary, uiHint: 'recipe' }
  },
}

const recipeVariation: SkillDefinition = {
  name: 'recipe_variation',
  description: 'Obtiene los datos de una receta para sugerir una variacion o sustitucion de ingrediente. Tu (Claude) sugerieras la sustitucion usando tu conocimiento.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string', description: 'Nombre de la receta' },
      ingredientToReplace: { type: 'string', description: 'Ingrediente que se quiere sustituir' },
    },
    required: ['recipeName', 'ingredientToReplace'],
  },
  async handler(params: { recipeName: string; ingredientToReplace: string }, ctx: SkillContext): Promise<SkillResult> {
    const { db } = ctx

    const [recipe] = await db
      .select()
      .from(recipes)
      .where(or(
        ilike(recipes.name, `%${params.recipeName}%`),
        ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map((w: string) => ilike(recipes.name, `%${w}%`)),
      ))
      .limit(1)

    if (!recipe) {
      return { data: null, summary: `No he encontrado la receta "${params.recipeName}".`, uiHint: 'text' }
    }

    const riRows = await db
      .select({
        ingredientName: ingredients.name,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(eq(recipeIngredients.recipeId, recipe.id))

    const ingredientList = riRows.map((r: any) => `${r.ingredientName} (${r.quantity}${r.unit ?? 'g'})`)

    return {
      data: {
        recipeName: recipe.name,
        ingredients: riRows,
        ingredientToReplace: params.ingredientToReplace,
      },
      summary: `Receta ${recipe.name}. Ingredientes: ${ingredientList.join(', ')}. El usuario quiere sustituir: ${params.ingredientToReplace}.`,
      uiHint: 'recipe',
    }
  },
}

const nutritionAdvice: SkillDefinition = {
  name: 'nutrition_advice',
  description: 'Proporciona contexto del usuario para responder preguntas de nutricion. Tu (Claude) responderas usando la base de conocimiento del sistema.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Pregunta de nutricion del usuario' },
    },
    required: ['question'],
  },
  async handler(params: { question: string }, ctx: SkillContext): Promise<SkillResult> {
    const { userId, db } = ctx

    // Get current balance
    const [balance] = await db
      .select()
      .from(userNutrientBalance)
      .where(eq(userNutrientBalance.userId, userId))
      .limit(1)

    let balanceInfo = 'Sin datos de balance nutricional.'
    if (balance?.balance) {
      const b = balance.balance as NutrientBalance
      const pct = nutrientsToPercentages(b)
      balanceInfo = `Balance actual: proteina ${pct.protein.toFixed(1)}%, carbohidratos ${pct.carbohydrates.toFixed(1)}%, grasa ${pct.fat.toFixed(1)}% (objetivo: ${TARGET_MACROS.protein}/${TARGET_MACROS.carbohydrates}/${TARGET_MACROS.fat}).`
    }

    // Recent logs
    const recentLogs = await db
      .select()
      .from(menuLogs)
      .where(eq(menuLogs.userId, userId))
      .orderBy(desc(menuLogs.weekStart))
      .limit(4)

    let logInfo = ''
    if (recentLogs.length > 0) {
      const avgCal = recentLogs.reduce((s: number, l: any) => s + l.caloriesTotal, 0) / recentLogs.length
      logInfo = ` Calorias promedio semanal (ultimas ${recentLogs.length} semanas): ${Math.round(avgCal)} kcal.`
    }

    return {
      data: { balance: balance?.balance, question: params.question },
      summary: `Pregunta del usuario: ${params.question}. ${balanceInfo}${logInfo} Responde usando la base de conocimiento de ONA.`,
      uiHint: 'nutrition',
    }
  },
}

// ─── New skills (expansion 1–13) ────────────────────────────

// Helper: fuzzy-find an item in a shopping_lists.items array by ingredient name
function findShoppingItem(items: any[], query: string): any | null {
  const q = query.toLowerCase().trim()
  if (!q) return null
  const exact = items.find(i => String(i?.name ?? '').toLowerCase() === q)
  if (exact) return exact
  const includes = items.find(i => String(i?.name ?? '').toLowerCase().includes(q))
  if (includes) return includes
  const words = q.split(/\s+/).filter(w => w.length >= 3)
  for (const w of words) {
    const found = items.find(i => String(i?.name ?? '').toLowerCase().includes(w))
    if (found) return found
  }
  return null
}

// Helper: rounding bands consistent with services/recipeScaler.ts (kept inline so the
// skill stays a pure read; if scaler adds units we should mirror them here).
function scaleRound(raw: number, unit: string): number {
  if (raw === 0) return 0
  const u = (unit ?? 'g').toLowerCase()
  if (u === 'pizca' || u === 'al_gusto') return raw
  if (u === 'u') return Math.max(1, Math.round(raw))
  if (u === 'cda' || u === 'cdita') return Math.round(raw * 2) / 2
  // g / ml: same bands as recipeScaler.ts
  const bands: ReadonlyArray<readonly [number, number]> = [
    [5, 0.5], [25, 1], [100, 5], [250, 25], [500, 50], [1000, 100], [5000, 250], [Infinity, 500],
  ]
  let step = 500
  for (const [upper, s] of bands) { if (raw < upper) { step = s; break } }
  return Math.round(raw / step) * step
}

// 1. ── get_pantry_stock ────────────────────────────────────
const getPantryStock: SkillDefinition = {
  name: 'get_pantry_stock',
  description: 'Devuelve los ingredientes que el usuario tiene en casa (marcados como "en casa" en la lista de la compra mas reciente). Usa esta skill cuando el usuario pregunte que tiene en la nevera o despensa.',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_params, ctx) {
    const { userId, db } = ctx
    const [list] = await db
      .select()
      .from(shoppingLists)
      .where(eq(shoppingLists.userId, userId))
      .orderBy(desc(shoppingLists.createdAt))
      .limit(1)
    if (!list) {
      return { data: [], summary: 'Aun no tengo lista de la compra, asi que no se que tienes en casa. Genera un menu para empezar.', uiHint: 'text' }
    }
    const items = ((list.items as any[]) ?? []).filter(i => i?.inStock)
    if (items.length === 0) {
      return { data: [], summary: 'No tienes nada marcado como en casa. Cuando vayas comprando, marca lo que vas guardando.', uiHint: 'text' }
    }
    const names = items.map(i => i.name).slice(0, 30).join(', ')
    return {
      data: items,
      summary: `Tienes en casa: ${names}${items.length > 30 ? '…' : ''}.`,
      uiHint: 'shopping_list',
    }
  },
}

// 2. ── mark_in_stock ────────────────────────────────────────
const markInStock: SkillDefinition = {
  name: 'mark_in_stock',
  description: 'Marca o desmarca un ingrediente como disponible en casa. Si el usuario dice "tengo X" pasa inStock:true; si dice "se acabo X" o "ya no tengo X" pasa false. Sin parametro inStock alterna.',
  parameters: {
    type: 'object',
    properties: {
      ingredient: { type: 'string', description: 'Nombre del ingrediente (acepta coincidencia parcial)' },
      inStock: { type: 'boolean', description: 'true si tiene, false si no. Si se omite, alterna el estado.' },
    },
    required: ['ingredient'],
  },
  async handler(params: { ingredient: string; inStock?: boolean }, ctx) {
    const { userId, db } = ctx
    const [list] = await db
      .select()
      .from(shoppingLists)
      .where(eq(shoppingLists.userId, userId))
      .orderBy(desc(shoppingLists.createdAt))
      .limit(1)
    if (!list) {
      return { data: null, summary: 'Necesitas tener una lista de la compra activa para gestionar la despensa.', uiHint: 'text' }
    }
    const items = ((list.items as any[]) ?? []).slice()
    const item = findShoppingItem(items, params.ingredient)
    if (!item) {
      return { data: null, summary: `No he encontrado "${params.ingredient}" en tu lista. Anadelo manualmente o regenera la lista.`, uiHint: 'text' }
    }
    const next = params.inStock != null ? !!params.inStock : !item.inStock
    item.inStock = next
    await db.update(shoppingLists).set({ items }).where(eq(shoppingLists.id, list.id))
    return {
      data: { name: item.name, inStock: next },
      summary: next ? `${item.name} marcado como en casa.` : `${item.name} eliminado de la despensa.`,
      uiHint: 'confirmation',
    }
  },
}

// 3. ── check_shopping_item ─────────────────────────────────
const checkShoppingItem: SkillDefinition = {
  name: 'check_shopping_item',
  description: 'Marca un articulo de la lista de la compra como comprado (o lo desmarca). Util cuando el usuario va por el supermercado en manos libres.',
  parameters: {
    type: 'object',
    properties: {
      ingredient: { type: 'string', description: 'Nombre del ingrediente (acepta coincidencia parcial)' },
      checked: { type: 'boolean', description: 'true para marcar como comprado, false para devolver a pendiente. Si se omite, alterna.' },
    },
    required: ['ingredient'],
  },
  async handler(params: { ingredient: string; checked?: boolean }, ctx) {
    const { userId, db } = ctx
    const [list] = await db
      .select()
      .from(shoppingLists)
      .where(eq(shoppingLists.userId, userId))
      .orderBy(desc(shoppingLists.createdAt))
      .limit(1)
    if (!list) {
      return { data: null, summary: 'No tienes lista de la compra activa.', uiHint: 'text' }
    }
    const items = ((list.items as any[]) ?? []).slice()
    const item = findShoppingItem(items, params.ingredient)
    if (!item) {
      return { data: null, summary: `No he encontrado "${params.ingredient}" en tu lista.`, uiHint: 'text' }
    }
    const next = params.checked != null ? !!params.checked : !item.checked
    item.checked = next
    await db.update(shoppingLists).set({ items }).where(eq(shoppingLists.id, list.id))
    return {
      data: { name: item.name, checked: next },
      summary: next ? `${item.name} marcado como comprado.` : `${item.name} vuelve a la lista.`,
      uiHint: 'confirmation',
    }
  },
}

// 4. ── get_my_recipes ──────────────────────────────────────
const getMyRecipes: SkillDefinition = {
  name: 'get_my_recipes',
  description: 'Lista las recetas creadas por el usuario (no las del catalogo del sistema). Util cuando dice "mis recetas".',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_p, ctx) {
    const { userId, db } = ctx
    const rows = await db
      .select({ id: recipes.id, name: recipes.name, meals: recipes.meals, prepTime: recipes.prepTime, servings: recipes.servings })
      .from(recipes)
      .where(eq(recipes.authorId, userId))
      .orderBy(desc(recipes.createdAt))
      .limit(50)
    if (rows.length === 0) {
      return { data: [], summary: 'Aun no has guardado recetas propias. Cuando crees una se quedara aqui.', uiHint: 'text' }
    }
    const names = rows.map((r: any) => r.name).join(', ')
    return { data: rows, summary: `Tienes ${rows.length} receta(s) propia(s): ${names}.`, uiHint: 'recipe' }
  },
}

// 5. ── get_menu_history ────────────────────────────────────
const getMenuHistory: SkillDefinition = {
  name: 'get_menu_history',
  description: 'Devuelve los menus pasados del usuario para responder cuando dice "cuando comi X la ultima vez" o "que cocine la semana pasada".',
  parameters: {
    type: 'object',
    properties: {
      weeks: { type: 'number', description: 'Semanas pasadas a recuperar (1-12, por defecto 4)' },
    },
    required: [],
  },
  async handler(params: { weeks?: number }, ctx) {
    const { userId, db } = ctx
    const limit = Math.max(1, Math.min(12, params.weeks ?? 4))
    const rows = await db
      .select({ id: menus.id, weekStart: menus.weekStart, days: menus.days })
      .from(menus)
      .where(eq(menus.userId, userId))
      .orderBy(desc(menus.weekStart))
      .limit(limit)
    if (rows.length === 0) {
      return { data: [], summary: 'No tienes historial de menus.', uiHint: 'text' }
    }
    const summary = rows.map((m: any) => {
      const meals = new Set<string>()
      for (const d of (m.days as any[]) ?? []) {
        for (const slot of Object.values(d) as any[]) {
          if (slot?.recipeName) meals.add(slot.recipeName)
        }
      }
      const list = [...meals].slice(0, 8).join(', ')
      return `${m.weekStart}: ${list}${meals.size > 8 ? '…' : ''}`
    }).join(' | ')
    return { data: rows, summary: `Historial: ${summary}`, uiHint: 'menu' }
  },
}

// 6. ── scale_recipe ────────────────────────────────────────
const scaleRecipeSkill: SkillDefinition = {
  name: 'scale_recipe',
  description: 'Reescala los ingredientes de una receta a un numero distinto de comensales. No modifica la receta guardada — solo devuelve las cantidades para el plato de hoy.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string', description: 'Nombre de la receta' },
      servings: { type: 'number', description: 'Numero de comensales objetivo (entero positivo)' },
    },
    required: ['recipeName', 'servings'],
  },
  async handler(params: { recipeName: string; servings: number }, ctx) {
    const { db } = ctx
    if (!Number.isFinite(params.servings) || params.servings <= 0) {
      return { data: null, summary: 'El numero de comensales debe ser positivo.', uiHint: 'text' }
    }
    const [recipe] = await db
      .select()
      .from(recipes)
      .where(or(
        ilike(recipes.name, `%${params.recipeName}%`),
        ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map(w => ilike(recipes.name, `%${w}%`)),
      ))
      .limit(1)
    if (!recipe) {
      return { data: null, summary: `No he encontrado la receta "${params.recipeName}".`, uiHint: 'text' }
    }
    const baseServings = (recipe as any).servings || 2
    const ratio = params.servings / baseServings
    const riRows = await db
      .select({
        ingredientName: ingredients.name,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
        optional: recipeIngredients.optional,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(eq(recipeIngredients.recipeId, (recipe as any).id))
    const scaled = (riRows as any[]).map(r => ({
      name: r.ingredientName,
      quantity: scaleRound((r.quantity as number) * ratio, r.unit ?? 'g'),
      unit: r.unit ?? 'g',
      optional: !!r.optional,
    }))
    const summary = `${(recipe as any).name} para ${params.servings} comensales (receta original para ${baseServings}): ${scaled.map(s => `${s.name} ${s.quantity}${s.unit}${s.optional ? ' (opcional)' : ''}`).join(', ')}.`
    return {
      data: { recipeId: (recipe as any).id, recipeName: (recipe as any).name, servings: params.servings, baseServings, ingredients: scaled },
      summary,
      uiHint: 'recipe',
    }
  },
}

// 7. ── evaluate_food_health ────────────────────────────────
const evaluateFoodHealth: SkillDefinition = {
  name: 'evaluate_food_health',
  description: 'Cuando el usuario pregunta si un alimento es saludable (ej. "el zumo es sano", "que tal la avena"), llama a esta skill. Devuelve contexto para que tu (Claude) respondas con criterio segun los principios de ONA — no neutral.',
  parameters: {
    type: 'object',
    properties: {
      food: { type: 'string', description: 'Alimento o producto que el usuario pregunta' },
    },
    required: ['food'],
  },
  async handler(params: { food: string }) {
    return {
      data: { food: params.food },
      summary: `Evalua si "${params.food}" es saludable usando los principios de ONA. Considera: 1) carga inflamatoria, 2) impacto en insulina, 3) si esta procesado y por tanto carece de fibra, 4) frecuencia recomendada (la frecuencia importa tanto como el contenido), 5) si es de los alimentos popularmente "saludables" que no lo son (zumos, pan blanco, arroz blanco, aceites vegetales refinados, fruta en exceso fuera de temporada). Da una respuesta corta (2-3 frases) con criterio propio, sin moralizar.`,
      uiHint: 'nutrition',
    }
  },
}

// 8. ── suggest_substitution ────────────────────────────────
const suggestSubstitution: SkillDefinition = {
  name: 'suggest_substitution',
  description: 'Cuando al usuario le falta un ingrediente o quiere cambiarlo (ej. "no tengo nata, que uso", "como sustituyo el azucar"), llama a esta skill. Tu (Claude) propondras alternativas alineadas con los principios de ONA.',
  parameters: {
    type: 'object',
    properties: {
      ingredient: { type: 'string', description: 'Ingrediente a sustituir' },
      recipeName: { type: 'string', description: 'Nombre de la receta (opcional, da contexto)' },
      restriction: { type: 'string', description: 'Restriccion del usuario (ej: sin lactosa, sin gluten)' },
    },
    required: ['ingredient'],
  },
  async handler(params: { ingredient: string; recipeName?: string; restriction?: string }, ctx) {
    const { db } = ctx
    let recipeContext = ''
    if (params.recipeName) {
      const [recipe] = await db
        .select({ name: recipes.name, allergens: recipes.allergens })
        .from(recipes)
        .where(or(
          ilike(recipes.name, `%${params.recipeName}%`),
          ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map(w => ilike(recipes.name, `%${w}%`)),
        ))
        .limit(1)
      if (recipe) {
        const allergens = ((recipe as any).allergens as string[]) ?? []
        recipeContext = ` Receta: ${(recipe as any).name}${allergens.length > 0 ? ` (alergenos detectados: ${allergens.join(', ')})` : ''}.`
      }
    }
    return {
      data: params,
      summary: `El usuario quiere sustituir "${params.ingredient}"${params.restriction ? ` (restriccion: ${params.restriction})` : ''}.${recipeContext} Sugiere 1-2 alternativas concretas alineadas con los principios de ONA. Importante: NUNCA propongas margarina, aceites vegetales refinados (girasol, soja, maiz, colza), edulcorantes artificiales ni sirope de maiz. Si propon AOVE, ghee, mantequilla, fermentados, frutos secos, semillas, harinas integrales, hueso/caldo casero, fruta entera en lugar de zumo.`,
      uiHint: 'recipe',
    }
  },
}

// 9. ── get_variety_score ───────────────────────────────────
const VEG_RE = /(verdura|hoja|espinaca|kale|acelga|brocoli|coliflor|tomate|cebolla|ajo|pimiento|calabac|berenjena|zanahoria|remolacha|esparrago|aguacate|champin|seta|alcachofa|pepino|rucula|canon|lechuga|repollo|col|puerro|apio|nabo|rabano|calabaza|judia_verde|guisante)/i
const PROT_RE = /(pollo|pavo|ternera|cerdo|cordero|huevo|salmon|atun|sardina|merluza|bacalao|gamba|mejillon|pulpo|tofu|tempeh|legumbre|lenteja|garbanzo|alubia|conejo|pato|trucha|caballa)/i

const getVarietyScore: SkillDefinition = {
  name: 'get_variety_score',
  description: 'Calcula la diversidad de ingredientes (con foco en vegetales y proteinas) en el menu actual del usuario. Pilar del principio 7 de ONA: variedad maxima para microbioma resiliente.',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_p, ctx) {
    const { userId, db } = ctx
    const [menu] = await db.select().from(menus).where(eq(menus.userId, userId)).orderBy(desc(menus.createdAt)).limit(1)
    if (!menu) {
      return { data: null, summary: 'No tienes menu activo.', uiHint: 'text' }
    }
    const recipeIds = new Set<string>()
    for (const d of (menu.days as any[]) ?? []) {
      for (const slot of Object.values(d) as any[]) {
        if (slot?.recipeId) recipeIds.add(slot.recipeId)
      }
    }
    if (recipeIds.size === 0) {
      return { data: null, summary: 'El menu no tiene recetas asignadas.', uiHint: 'text' }
    }
    const ids = [...recipeIds]
    const riRows = await db
      .select({ ingredientName: ingredients.name })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(inArray(recipeIngredients.recipeId, ids))
    const distinct = new Set<string>()
    const veggies = new Set<string>()
    const proteins = new Set<string>()
    for (const r of riRows as any[]) {
      const n = String(r.ingredientName ?? '').toLowerCase().trim()
      if (!n) continue
      distinct.add(n)
      if (VEG_RE.test(n)) veggies.add(n)
      if (PROT_RE.test(n)) proteins.add(n)
    }
    const score = Math.round(Math.min(distinct.size / 35, 1) * 100)
    const advice = score < 50
      ? 'Anade verdes oscuros (espinaca, kale) y crucíferas (brocoli, coliflor) para subir.'
      : score < 80
        ? 'Buen camino — sigue rotando proteinas distintas (legumbres, pescado azul, huevo).'
        : 'Excelente variedad — el microbioma te lo agradece.'
    return {
      data: { distinctCount: distinct.size, vegetableCount: veggies.size, proteinCount: proteins.size, score, vegetables: [...veggies], proteins: [...proteins] },
      summary: `Esta semana llevas ${distinct.size} ingredientes distintos (${veggies.size} vegetales, ${proteins.size} proteinas). Score de variedad: ${score}/100. ${advice}`,
      uiHint: 'nutrition',
    }
  },
}

// 10. ── get_eating_window ──────────────────────────────────
const getEatingWindow: SkillDefinition = {
  name: 'get_eating_window',
  description: 'Calcula la ventana de alimentacion del usuario (primera y ultima comida del dia, longitud media en horas) usando las comidas marcadas como comidas. Importante para el principio 3 de ONA: la frecuencia importa tanto como el contenido.',
  parameters: {
    type: 'object',
    properties: {
      weeks: { type: 'number', description: 'Semanas a analizar (1-8, por defecto 2)' },
    },
    required: [],
  },
  async handler(params: { weeks?: number }, ctx) {
    const { userId, db } = ctx
    const limit = Math.max(1, Math.min(8, params.weeks ?? 2))
    const rows = await db
      .select({ days: menus.days, weekStart: menus.weekStart })
      .from(menus)
      .where(eq(menus.userId, userId))
      .orderBy(desc(menus.weekStart))
      .limit(limit)
    if (rows.length === 0) {
      return { data: null, summary: 'No tengo datos de menus.', uiHint: 'text' }
    }
    const dayHours: number[][] = []
    for (const r of rows as any[]) {
      const days = (r.days as any[]) ?? []
      for (const d of days) {
        const hours: number[] = []
        for (const slot of Object.values(d) as any[]) {
          if (slot?.eaten && slot?.eatenAt) {
            const t = new Date(slot.eatenAt)
            if (!Number.isNaN(t.valueOf())) hours.push(t.getHours() + t.getMinutes() / 60)
          }
        }
        if (hours.length > 0) dayHours.push(hours)
      }
    }
    if (dayHours.length === 0) {
      return { data: null, summary: 'Aun no has marcado ninguna comida como comida con hora. Cuando lo hagas podre calcular tu ventana.', uiHint: 'text' }
    }
    const widths = dayHours.map(hs => Math.max(...hs) - Math.min(...hs))
    const avgW = widths.reduce((a, b) => a + b, 0) / widths.length
    const avgFirst = dayHours.map(hs => Math.min(...hs)).reduce((a, b) => a + b, 0) / dayHours.length
    const avgLast = dayHours.map(hs => Math.max(...hs)).reduce((a, b) => a + b, 0) / dayHours.length
    const fmt = (h: number) => `${Math.floor(h).toString().padStart(2, '0')}:${Math.round((h - Math.floor(h)) * 60).toString().padStart(2, '0')}`
    const advice = avgW > 12
      ? 'Ventana ancha. Cerrarla a 10h (mover desayuno mas tarde o cenar antes) reduce la insulina cronica.'
      : avgW < 8
        ? 'Ventana corta — buena para insulina. Mantenla.'
        : 'Ventana razonable. Estrecharla un poco mas si quieres ir mas alla.'
    return {
      data: { avgWindowHours: Number(avgW.toFixed(2)), avgFirstHour: avgFirst, avgLastHour: avgLast, daysSampled: dayHours.length },
      summary: `Sobre ${dayHours.length} dia(s) con datos: ventana media ${avgW.toFixed(1)}h (~${fmt(avgFirst)} a ~${fmt(avgLast)}). ${advice}`,
      uiHint: 'nutrition',
    }
  },
}

// 11. ── get_inflammation_index ────────────────────────────
const PROCESSED_RE = /(azucar|harina blanca|harina_blanca|aceite girasol|aceite_girasol|aceite soja|aceite_soja|aceite maiz|aceite_maiz|embutido|salchich|bacon|nata industrial|salsa industrial|margarina|edulcorante|sirope|jarabe_maiz|jarabe maiz|fritos)/i
const WHOLE_RE = /(verdura|hoja|espinaca|kale|acelga|brocoli|coliflor|crucifera|aguacate|aceite oliva|aceite_oliva|aove|ghee|mantequilla|fermentado|chucrut|kimchi|kefir|salmon|sardina|caballa|atun|frutos secos|frutos_secos|nuez|almendra|semilla|legumbre|lenteja|garbanzo|alubia|hueso|caldo)/i
const FIBER_RE = /(legumbre|lenteja|garbanzo|alubia|frijol|integral|avena|quinoa|chia|lino|psyllium|semilla)/i
const FRY_RE = /(\bfrit|fritura|deep[ _]fry|empanad|rebozad)/i
const STEAM_RE = /(\bvapor\b|\bplancha\b|\bhorno\b|hervid|cocer|asad|al horno)/i

async function scoreRecipe(recipe: any, db: any): Promise<{ recipeId: string; name: string; score: number; reasons: string[] }> {
  let score = 50
  const reasons: string[] = []

  // Real per-serving signal: fiber boost / kcal density
  const nps = recipe.nutritionPerServing as any
  if (nps) {
    if (typeof nps.fiberG === 'number') {
      if (nps.fiberG >= 10) { score += 8; reasons.push(`+8 fibra alta (${nps.fiberG.toFixed(0)} g)`) }
      else if (nps.fiberG <= 2) { score -= 5; reasons.push(`-5 fibra baja (${nps.fiberG.toFixed(0)} g)`) }
    }
    if (typeof nps.saltG === 'number' && nps.saltG > 3) {
      score -= 4; reasons.push(`-4 sal alta (${nps.saltG.toFixed(1)} g)`)
    }
  }

  // Ingredient names
  const riRows = await db
    .select({ name: ingredients.name })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(eq(recipeIngredients.recipeId, recipe.id))
  for (const r of riRows as any[]) {
    const n = String(r.name ?? '').toLowerCase()
    if (!n) continue
    if (PROCESSED_RE.test(n)) { score -= 5; reasons.push(`-5 procesado: ${n}`) }
    if (WHOLE_RE.test(n)) { score += 4; reasons.push(`+4 alimento real: ${n}`) }
    if (FIBER_RE.test(n)) { score += 2; reasons.push(`+2 fibra: ${n}`) }
  }

  // Steps (techniques)
  const stepRows = await db
    .select({ text: recipeSteps.text, technique: recipeSteps.technique })
    .from(recipeSteps)
    .where(eq(recipeSteps.recipeId, recipe.id))
  for (const s of stepRows as any[]) {
    const t = `${s.text ?? ''} ${s.technique ?? ''}`.toLowerCase()
    if (FRY_RE.test(t)) { score -= 4; reasons.push('-4 fritura/rebozado') }
    if (STEAM_RE.test(t)) { score += 3; reasons.push('+3 coccion suave') }
  }

  return {
    recipeId: recipe.id,
    name: recipe.name,
    score: Math.max(0, Math.min(100, score)),
    reasons: reasons.slice(0, 6),
  }
}

const getInflammationIndex: SkillDefinition = {
  name: 'get_inflammation_index',
  description: 'Devuelve un indice antiinflamatorio aproximado (0-100, mas alto = menos inflamatorio) para una receta concreta o el menu de la semana. Combina datos reales de fibra/sal con heuristicas de procesado y tecnica de coccion.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string', description: 'Nombre de receta. Omitir si quieres el indice del menu semanal.' },
      weekly: { type: 'boolean', description: 'Si true, calcula media para todas las recetas del menu actual.' },
    },
    required: [],
  },
  async handler(params: { recipeName?: string; weekly?: boolean }, ctx) {
    const { userId, db } = ctx
    if (params.weekly) {
      const [menu] = await db.select().from(menus).where(eq(menus.userId, userId)).orderBy(desc(menus.createdAt)).limit(1)
      if (!menu) {
        return { data: null, summary: 'No tienes menu activo.', uiHint: 'text' }
      }
      const ids = new Set<string>()
      for (const d of (menu.days as any[]) ?? []) {
        for (const s of Object.values(d) as any[]) if (s?.recipeId) ids.add(s.recipeId)
      }
      if (ids.size === 0) {
        return { data: null, summary: 'El menu no tiene recetas.', uiHint: 'text' }
      }
      const recipesData = await db.select().from(recipes).where(inArray(recipes.id, [...ids]))
      const scores = await Promise.all((recipesData as any[]).map(r => scoreRecipe(r, db)))
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b.score, 0) / scores.length : 0
      const top = [...scores].sort((a, b) => b.score - a.score).slice(0, 3).map(s => `${s.name} (${s.score})`).join(', ')
      const bottom = [...scores].sort((a, b) => a.score - b.score).slice(0, 3).map(s => `${s.name} (${s.score})`).join(', ')
      return {
        data: { average: Math.round(avg), scores },
        summary: `Indice antiinflamatorio medio del menu: ${Math.round(avg)}/100. Mejores: ${top}. Para revisar: ${bottom}.`,
        uiHint: 'nutrition',
      }
    }
    if (!params.recipeName) {
      return { data: null, summary: 'Indica una receta o pasa weekly:true para el menu completo.', uiHint: 'text' }
    }
    const [recipe] = await db
      .select()
      .from(recipes)
      .where(or(
        ilike(recipes.name, `%${params.recipeName}%`),
        ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map(w => ilike(recipes.name, `%${w}%`)),
      ))
      .limit(1)
    if (!recipe) {
      return { data: null, summary: `No he encontrado "${params.recipeName}".`, uiHint: 'text' }
    }
    const result = await scoreRecipe(recipe, db)
    return {
      data: result,
      summary: `${result.name}: ${result.score}/100. ${result.reasons.length > 0 ? `Lo que cuenta: ${result.reasons.join('; ')}.` : 'Sin senales fuertes en ningun sentido.'}`,
      uiHint: 'nutrition',
    }
  },
}

// 12. ── start_cooking_mode ────────────────────────────────
const startCookingMode: SkillDefinition = {
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
      .where(or(
        ilike(recipes.name, `%${params.recipeName}%`),
        ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map(w => ilike(recipes.name, `%${w}%`)),
      ))
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
const setTimer: SkillDefinition = {
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
const cookingStep: SkillDefinition = {
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

/**
 * edit_recipe — author-only metadata edits via voice ("cambia el nombre de mi
 * tortilla a 'Tortilla de patatas Lacoma'", "mi receta de paella tarda 50
 * minutos en total"). For full edits (ingredients/steps), the skill responds
 * with a navigate hint to /recipes/<id>/edit so the realtime overlay can route
 * the user to the form. Voice does not attempt to rewrite the ingredient list
 * inline — too error-prone in audio-only context.
 */
const editRecipe: SkillDefinition = {
  name: 'edit_recipe',
  description:
    'Edita una receta del usuario. Sólo el autor puede editar (las recetas de ONA con authorId null no son editables). Útil para cambios de nombre, tiempos, dificultad, notas y trucos por voz. Para editar ingredientes o pasos completos sugiere abrir el editor.',
  parameters: {
    type: 'object',
    properties: {
      recipeId: {
        type: 'string',
        description: 'UUID de la receta. Si lo conoces, úsalo. Si no, usa recipeName.',
      },
      recipeName: {
        type: 'string',
        description: 'Nombre (o parte) de la receta a editar. Se buscará en las recetas del usuario primero.',
      },
      name: { type: 'string', description: 'Nuevo nombre' },
      prepTime: { type: 'number', description: 'Tiempo de preparación en minutos' },
      cookTime: { type: 'number', description: 'Tiempo de cocción en minutos' },
      difficulty: { type: 'string', description: 'easy | medium | hard' },
      notes: { type: 'string', description: 'Notas (texto libre)' },
      tips: { type: 'string', description: 'Trucos (texto libre)' },
      openEditor: {
        type: 'boolean',
        description: 'Si true, no aplica cambios y devuelve un hint para navegar al editor de ingredientes/pasos.',
      },
    },
    required: [],
  },
  async handler(
    params: {
      recipeId?: string
      recipeName?: string
      name?: string
      prepTime?: number
      cookTime?: number
      difficulty?: string
      notes?: string
      tips?: string
      openEditor?: boolean
    },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const { userId, db } = ctx

    // Resolve target recipe — prefer user-owned matches when looking up by name.
    let target: { id: string; name: string; authorId: string | null } | null = null
    if (params.recipeId) {
      const [row] = await db
        .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
        .from(recipes)
        .where(eq(recipes.id, params.recipeId))
        .limit(1)
      target = row ?? null
    } else if (params.recipeName) {
      // Look in user's own recipes first.
      const candidates = await db
        .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
        .from(recipes)
        .where(ilike(recipes.name, `%${params.recipeName}%`))
        .limit(10)
      target = candidates.find((c: { authorId: string | null }) => c.authorId === userId) ?? null
    }

    if (!target) {
      return {
        data: null,
        summary: params.recipeName
          ? `No he encontrado una receta tuya que se llame "${params.recipeName}". Sólo puedes editar las recetas que tú has creado.`
          : 'Necesito el nombre o el id de la receta que quieres editar.',
        uiHint: 'text',
      }
    }

    if (target.authorId !== userId) {
      return {
        data: null,
        summary: `"${target.name}" es una receta del catálogo de ONA, no tuya. Para hacer cambios, primero añádela a tus recetas y edita la copia.`,
        uiHint: 'text',
      }
    }

    if (params.openEditor) {
      return {
        data: { recipeId: target.id, navigateTo: `/recipes/${target.id}/edit` },
        summary: `Te abro el editor completo de "${target.name}".`,
        uiHint: 'recipe',
      }
    }

    // Apply field-level updates (only the recipe row — no ingredients/steps via voice).
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    const changedFields: string[] = []

    if (typeof params.name === 'string' && params.name.trim().length > 0) {
      updates.name = params.name.trim()
      changedFields.push('nombre')
    }
    if (typeof params.prepTime === 'number' && params.prepTime >= 0) {
      updates.prepTime = params.prepTime
      changedFields.push('tiempo de preparación')
    }
    if (typeof params.cookTime === 'number' && params.cookTime >= 0) {
      updates.cookTime = params.cookTime
      changedFields.push('tiempo de cocción')
    }
    if (typeof params.difficulty === 'string') {
      const d = params.difficulty.toLowerCase()
      if (d === 'easy' || d === 'medium' || d === 'hard') {
        updates.difficulty = d
        changedFields.push('dificultad')
      }
    }
    if (typeof params.notes === 'string') {
      updates.notes = params.notes.trim() || null
      changedFields.push('notas')
    }
    if (typeof params.tips === 'string') {
      updates.tips = params.tips.trim() || null
      changedFields.push('trucos')
    }

    if (changedFields.length === 0) {
      return {
        data: { recipeId: target.id },
        summary: `Para editar "${target.name}" dime qué quieres cambiar (nombre, tiempo, dificultad, notas, trucos) o pídeme abrir el editor completo.`,
        uiHint: 'text',
      }
    }

    await db.update(recipes).set(updates).where(eq(recipes.id, target.id))

    return {
      data: { recipeId: target.id, changed: changedFields },
      summary: `Hecho. He actualizado ${changedFields.join(', ')} en "${target.name}".`,
      uiHint: 'recipe',
    }
  },
}

/**
 * update_household — set the user's adults + kidsCount (children 2–10 years)
 * via voice ("ahora somos 2 adultos y un niño", "quítame el niño"). Drives
 * shopping-list portion sizing immediately.
 */
const updateHousehold: SkillDefinition = {
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

    const multiplier = householdMultiplier(adults, kidsCount)
    const adultsLabel = adults === 1 ? '1 adulto' : `${adults} adultos`
    const kidsLabel =
      kidsCount === 0
        ? 'sin niños'
        : kidsCount === 1
          ? '1 niño (2-10 años)'
          : `${kidsCount} niños (2-10 años)`

    return {
      data: { adults, kidsCount, multiplier },
      summary: `Hogar actualizado: ${adultsLabel} ${kidsCount > 0 ? `+ ${kidsLabel}` : `(${kidsLabel})`}. Las próximas listas de la compra escalarán a ${multiplier} raciones.`,
      uiHint: 'confirmation',
    }
  },
}

/**
 * add_recipe_to_mine — copy a system (or another user's) recipe into the
 * caller's catalog so they can edit it. Drives the "añade la fabada de ONA
 * a mis recetas" voice utterance and unlocks the Editar flow on copies.
 */
const addRecipeToMine: SkillDefinition = {
  name: 'add_recipe_to_mine',
  description:
    'Copia una receta (del catálogo de ONA o de otro usuario) a las recetas del usuario actual. La copia es totalmente editable. Devuelve el id y el nombre de la nueva receta. Si el usuario nombra una receta que ya es suya, no se duplica.',
  parameters: {
    type: 'object',
    properties: {
      recipeId: { type: 'string', description: 'UUID de la receta original.' },
      recipeName: {
        type: 'string',
        description: 'Nombre (o parte) de la receta a copiar. Se prefiere el match exacto en el catálogo de ONA.',
      },
    },
    required: [],
  },
  async handler(
    params: { recipeId?: string; recipeName?: string },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const { userId, db } = ctx

    let source: { id: string; name: string; authorId: string | null } | null = null
    if (params.recipeId) {
      const [row] = await db
        .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
        .from(recipes)
        .where(eq(recipes.id, params.recipeId))
        .limit(1)
      source = row ?? null
    } else if (params.recipeName) {
      const candidates = await db
        .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
        .from(recipes)
        .where(ilike(recipes.name, `%${params.recipeName}%`))
        .limit(20)
      // Prefer ONA system recipes for "add to mine" (don't accidentally copy
      // your own recipe). If only your own match, refuse with a friendly
      // message.
      source = candidates.find((c: { authorId: string | null }) => c.authorId === null)
        ?? candidates.find((c: { authorId: string | null }) => c.authorId !== userId)
        ?? null
      const ownsOnly = candidates.length > 0 && candidates.every((c: { authorId: string | null }) => c.authorId === userId)
      if (!source && ownsOnly) {
        return {
          data: null,
          summary: `"${params.recipeName}" ya está en tus recetas.`,
          uiHint: 'text',
        }
      }
    }

    if (!source) {
      return {
        data: null,
        summary: params.recipeName
          ? `No he encontrado la receta "${params.recipeName}" en el catálogo.`
          : 'Necesito el nombre o el id de la receta que quieres añadir.',
        uiHint: 'text',
      }
    }

    if (source.authorId === userId) {
      return {
        data: { recipeId: source.id, name: source.name },
        summary: `"${source.name}" ya es tuya.`,
        uiHint: 'text',
      }
    }

    // Load child rows + clone in a transaction (mirrors POST /recipes/:id/copy
    // semantics; we keep the logic local to the skill so the voice path doesn't
    // depend on the HTTP route).
    const sourceIngredients = await db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, source.id))

    const sourceSteps = await db
      .select()
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, source.id))

    const ingRowIdMap = new Map<string, string>()
    for (const ing of sourceIngredients) {
      ingRowIdMap.set(ing.id, crypto.randomUUID())
    }

    const [full] = await db.select().from(recipes).where(eq(recipes.id, source.id)).limit(1)
    const baseInternalTags = (full.internalTags ?? []).filter(
      (t: string) => t !== 'compartida' && t !== 'auto-extracted' && t !== 'from-url',
    )
    baseInternalTags.push('copied-from-catalog')

    const newId = await db.transaction(async (tx: any) => {
      const [inserted] = await tx
        .insert(recipes)
        .values({
          name: full.name,
          authorId: userId,
          imageUrl: full.imageUrl,
          servings: full.servings,
          yieldText: full.yieldText,
          prepTime: full.prepTime,
          cookTime: full.cookTime,
          activeTime: full.activeTime,
          totalTime: full.totalTime,
          difficulty: full.difficulty ?? 'medium',
          meals: full.meals ?? [],
          seasons: full.seasons ?? [],
          equipment: full.equipment ?? [],
          allergens: full.allergens ?? [],
          notes: full.notes,
          tips: full.tips,
          substitutions: full.substitutions,
          storage: full.storage,
          nutritionPerServing: full.nutritionPerServing,
          tags: full.tags ?? [],
          internalTags: baseInternalTags,
          sourceUrl: full.sourceUrl,
          sourceType: 'manual',
        })
        .returning({ id: recipes.id })

      if (sourceIngredients.length > 0) {
        await tx.insert(recipeIngredients).values(
          sourceIngredients.map((ing: any, i: number) => ({
            id: ingRowIdMap.get(ing.id)!,
            recipeId: inserted.id,
            ingredientId: ing.ingredientId,
            section: ing.section,
            quantity: ing.quantity,
            unit: ing.unit,
            optional: ing.optional,
            note: ing.note,
            displayOrder: ing.displayOrder ?? i,
          })),
        )
      }

      if (sourceSteps.length > 0) {
        await tx.insert(recipeSteps).values(
          sourceSteps.map((s: any) => ({
            recipeId: inserted.id,
            index: s.index,
            text: s.text,
            durationMin: s.durationMin,
            temperature: s.temperature,
            technique: s.technique,
            ingredientRefs: (s.ingredientRefs ?? []).map(
              (oldId: string) => ingRowIdMap.get(oldId) ?? oldId,
            ),
          })),
        )
      }
      return inserted.id
    })

    return {
      data: { recipeId: newId, name: source.name },
      summary: `He añadido "${source.name}" a tus recetas. Ya puedes editarla.`,
      uiHint: 'recipe',
    }
  },
}

// ─── Exports ────────────────────────────────────────────────

export const skills: SkillDefinition[] = [
  getTodaysMenu,
  getRecipeDetails,
  getWeeklyNutrition,
  getShoppingList,
  suggestRecipes,
  searchRecipes,
  generateWeeklyMenu,
  swapMeal,
  toggleFavorite,
  markMealEaten,
  createRecipe,
  recipeVariation,
  nutritionAdvice,
  // Expansion 1–13:
  getPantryStock,
  markInStock,
  checkShoppingItem,
  getMyRecipes,
  getMenuHistory,
  scaleRecipeSkill,
  evaluateFoodHealth,
  suggestSubstitution,
  getVarietyScore,
  getEatingWindow,
  getInflammationIndex,
  startCookingMode,
  setTimer,
  cookingStep,
  // Improvements 2026-05:
  editRecipe,
  updateHousehold,
  addRecipeToMine,
]

/**
 * Convert skills to Anthropic tool definitions format.
 */
export function getToolDefinitions(): Array<{
  name: string
  description: string
  input_schema: Record<string, any>
}> {
  return skills.map(skill => ({
    name: skill.name,
    description: skill.description,
    input_schema: skill.parameters,
  }))
}
