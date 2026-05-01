import { eq, desc, ilike, or } from 'drizzle-orm'
import {
  menus,
  recipes,
  recipeIngredients,
  ingredients,
  userFavorites,
  users,
  userNutrientBalance,
  menuLogs,
} from '../../db/schema.js'
import { nutrientsToPercentages, TARGET_MACROS, detectSeason } from '@ona/shared'
import type { DayMenu, Meal, NutrientBalance, HouseholdSize } from '@ona/shared'
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
      .select({ householdSize: users.householdSize })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    const householdSize = (user?.householdSize as HouseholdSize) ?? 'solo'
    const items = await generateShoppingList(menu.days as DayMenu[], householdSize, db)

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
  description: 'Cambia un plato concreto del menu por otro. dayIndex: 0=lunes, 6=domingo. meal: breakfast, lunch o dinner.',
  parameters: {
    type: 'object',
    properties: {
      dayIndex: { type: 'number', description: 'Indice del dia (0=lunes, 6=domingo)' },
      meal: { type: 'string', description: 'Tipo de comida: breakfast, lunch o dinner' },
    },
    required: ['dayIndex', 'meal'],
  },
  async handler(params: { dayIndex: number; meal: string }, ctx: SkillContext): Promise<SkillResult> {
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
