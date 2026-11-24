// Mimo's tools on a menu slot: swap a meal, favourite, mark as eaten. Split out of skills.ts (PRO-400).
import { fromWeekTypeOf, poolOfDishType, weekTypeDishTypeAt } from '../weekType.js'
import { and, eq, ilike, or } from 'drizzle-orm'
import { menus, recipes, userFavorites } from '../../db/schema.js'
import { recipeDishesOf } from '@ona/shared'
import { type DayMenu } from '@ona/shared'
import { loadSlotPickContext, pickForSlot, slotPickOptions } from '../menuSlotPick.js'
import { getPrimaryHouseholdId, resolveScope, scopeWhere } from '../scopeResolver.js'
import { repeatNote } from './weekRepeats.js'
import { slotWithDishes } from '../menuDishes.js'
import { DAY_PROP, isMenuDayError } from './menuDay.js'
import { bestMatch, dishNoteText, markEatenAsNote, searchWords } from './appSkills.js'
import { createDishRecipe, NEW_RECIPE_PROP, NOTE_THEN_RECIPE_HINT, type NewRecipeParam } from './dishRecipe.js'
import { unskipDay } from '../menuWeek.js'
import { type SkillDefinition, type SkillContext, type SkillResult } from './types.js'
import { namesAllWords } from './recipeSearchSkills.js'
import { untrustedText, menuOfWeek, noMenuFor, MEAL_LABEL, MEAL_KEYS, menuDayParam, changeOf, dishNow, visibleWhere, restrictionConflicts, notSaved, reactivatedLine } from './skillHelpers.js'

export const swapMeal: SkillDefinition = {
  name: 'swap_meal',
  description:
    'Cambia un plato concreto del menu (nunca rehace la semana). Pasa day con las palabras del usuario ("el sábado", "la cena de hoy" → day "hoy", "el jueves de la semana que viene") o la fecha; la herramienta calcula la fecha en hora de Madrid y te devuelve el dia, la fecha y el plato que han quedado. meal: breakfast, lunch, snack o dinner. Si el usuario nombra una receta concreta, pásala en `recipeName` (o `recipeId` si lo conoces) y la receta se asigna directamente sin elegir aleatorio. Si ese plato no está en sus recetas ni en el catálogo y mandas newRecipe (una versión sencilla estimada), lo creo como receta del hogar y la pongo, para que sus ingredientes lleguen a la lista de la compra; sin newRecipe, se pone como nota con su nombre (y te digo lo más parecido que hay). Llámala igualmente, no hace falta crear la receta antes. Si no se nombra, el sistema escoge automáticamente un plato compatible con la temporada y restricciones.',
  parameters: {
    type: 'object',
    properties: {
      day: DAY_PROP,
      dayIndex: { type: 'number', description: 'Solo si no usas day: 0=lunes … 6=domingo de esta semana (con nextWeek, de la que viene)' },
      nextWeek: { type: 'boolean', description: 'Con dayIndex: true si es de la semana que viene' },
      meal: { type: 'string', description: 'Tipo de comida: breakfast, lunch, snack o dinner' },
      recipeId: {
        type: 'string',
        description: 'UUID de la receta concreta a colocar en ese hueco. Opcional.',
      },
      recipeName: {
        type: 'string',
        description: 'Nombre (o parte) de la receta concreta. Se buscará por substring case-insensitive. Opcional. Si hay varias coincidencias se prioriza la del usuario sobre las del catálogo de Mimoia.',
      },
      confirmRestriction: {
        type: 'boolean',
        description: 'Solo true si el usuario ya ha confirmado que quiere ese plato aunque choque con su alergia/dieta (la herramienta te lo habrá avisado).',
      },
      newRecipe: NEW_RECIPE_PROP,
    },
    required: ['meal'],
  },
  async handler(
    params: { day?: string; dayIndex?: number; nextWeek?: boolean; meal: string; recipeId?: string; recipeName?: string; confirmRestriction?: boolean; newRecipe?: NewRecipeParam },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const { userId, db } = ctx
    const { meal } = params
    const t = menuDayParam(params)
    if (isMenuDayError(t)) return { data: null, summary: t.error, uiHint: 'text' }
    if (!MEAL_KEYS.includes(meal)) {
      return { data: null, summary: 'meal debe ser breakfast, lunch, snack o dinner. No he cambiado nada.', uiHint: 'text' }
    }
    const dayIndex = t.dayIndex
    // "Comida del sábado 17 de octubre": what the user sees and Mimo repeats.
    const slotLabel = `${MEAL_LABEL[meal]} del ${t.label}`

    // The menu of the week the day falls in — never "the latest menu".
    const menu = await menuOfWeek(ctx, t.weekStart)
    if (!menu) return noMenuFor(t.weekStart)

    const days = menu.days as DayMenu[]

    if (dayIndex >= days.length) {
      return { data: null, summary: 'Indice de dia fuera de rango.', uiHint: 'text' }
    }

    // Manual override path: if the user (or the model) named a specific
    // recipe, look it up and place it directly. Prefer recipes the user
    // owns when matching by name so "mi tortilla" wins over a system one
    // with the same word.
    if (params.recipeId || params.recipeName) {
      let chosen: { id: string; name: string } | null = null
      let approximate = false
      if (params.recipeId) {
        const [row] = await db
          .select({ id: recipes.id, name: recipes.name })
          .from(recipes)
          .where(and(await visibleWhere(ctx), eq(recipes.id, params.recipeId)))
          .limit(1)
        chosen = row ?? null
      } else if (params.recipeName) {
        // Only the Mimoia catalogue + the user's own recipes — never another
        // user's private ones.
        const visible = await visibleWhere(ctx)
        const candidates = await db
          .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
          .from(recipes)
          .where(and(visible, ilike(recipes.name, `%${params.recipeName}%`)))
          .limit(20)
        const owned = candidates.find((c: { authorId: string | null }) => c.authorId === userId)
        chosen = owned ?? candidates[0] ?? null
        if (!chosen) {
          // "filete de vaca" → closest real recipe ("Entrecot a la plancha"),
          // which is only offered: the slot gets the user's dish as a note.
          const words = searchWords(params.recipeName)
          if (words.length > 0) {
            const loose = await db
              .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
              .from(recipes)
              .where(and(visible, or(...words.map((w) => ilike(recipes.name, `%${w}%`)))))
              .limit(50)
            // "hamburguesa Gipsy Chef" names "Hamburguesa perfecta de Gipsy
            // Chef": every word the user said is in it, so that IS the recipe
            // (2026-10-08 it went in as a note and Mimo asked "¿te la cambio?").
            const named = loose.filter((c: { name: string }) => namesAllWords(c.name, params.recipeName!))
            const exactish = named.find((c: { authorId: string | null }) => c.authorId === userId) ?? named[0] ?? null
            const best = exactish ?? bestMatch(loose, params.recipeName, (c: { name: string }) => c.name) ?? loose[0] ?? null
            if (best) {
              chosen = best
              approximate = !exactish
            }
          }
        }
      }
      // A dish that isn't in the user's recipes nor the catalogue goes in as a
      // note with their own words — the menu never blocks on a missing recipe
      // (2026-10-08: "ponme X el jueves" got "no existe, ¿la creo?"). The
      // closest real recipe, if any, is only offered, never swapped in.
      if (params.recipeName && (!chosen || approximate)) {
        // PRO-74: with a `newRecipe`, the dish becomes a household recipe so
        // its ingredients reach the shopping list; the note is the fallback.
        const created = await createDishRecipe(userId, params.recipeName, params.newRecipe)
        if (created) {
          days[dayIndex][meal] = slotWithDishes(days[dayIndex][meal], [{ kind: 'recipe', recipeId: created.id, recipeName: created.name }])
          const [updatedNew] = await db.update(menus).set({ days, skippedDays: unskipDay(menu.skippedDays, dayIndex) }).where(eq(menus.id, menu.id)).returning()
          if (dishNow(updatedNew, dayIndex, meal) !== created.name) return notSaved(slotLabel)
          return {
            data: { ...updatedNew, change: changeOf(t, meal, created.name), recipeId: created.id },
            summary: `Hecho. "${untrustedText(created.name, 80)}" no estaba en sus recetas ni en el catalogo: la he creado como receta del hogar (raciones e ingredientes estimados; se puede revisar en la app) y la he puesto en la ${slotLabel}. Sus ingredientes ya salen en la lista de la compra.${reactivatedLine(menu, t)}${repeatNote(days, t.weekStart, dayIndex, meal, { recipeId: created.id, name: created.name })}`,
            uiHint: 'menu',
          }
        }
        const note = dishNoteText(params.recipeName)
        days[dayIndex][meal] = slotWithDishes(days[dayIndex][meal], [{ kind: 'note', text: note }])
        const [updatedNote] = await db
          .update(menus)
          .set({ days, skippedDays: unskipDay(menu.skippedDays, dayIndex) })
          .where(eq(menus.id, menu.id))
          .returning()
        const closest = chosen ? ` Lo mas parecido que si hay es "${chosen.name}".` : ''
        if (dishNow(updatedNote, dayIndex, meal) !== note) return notSaved(slotLabel)
        return {
          data: { ...updatedNote, change: changeOf(t, meal, note) },
          summary: `Hecho. "${untrustedText(note, 80)}" no esta en sus recetas ni en el catalogo, asi que lo he puesto como nota en la ${slotLabel}.${reactivatedLine(menu, t)}${repeatNote(days, t.weekStart, dayIndex, meal, { name: note })}${closest} ${NOTE_THEN_RECIPE_HINT}${chosen ? ` Si prefiere "${chosen.name}", ofrecele cambiar la nota por esa receta.` : ''}`,
          uiHint: 'menu',
        }
      }
      if (!chosen) {
        return {
          data: null,
          summary: `No he encontrado la receta "${params.recipeId}"; no he cambiado nada.`,
          uiHint: 'text',
        }
      }
      // Allergies / diet are never skipped silently: an explicit request can
      // beat a dislike, not an allergy without the user's confirmation.
      const conflicts = await restrictionConflicts(ctx, chosen.id)
      if (conflicts.length > 0 && !params.confirmRestriction) {
        return {
          data: { recipeId: chosen.id, recipeName: chosen.name, conflicts },
          summary: `No he cambiado nada: "${chosen.name}" no es compatible con sus restricciones (${conflicts.join(', ')}). Avisale y pregunta si aun asi lo quiere; si lo confirma, vuelve a llamar a swap_meal con confirmRestriction: true.`,
          uiHint: 'text',
        }
      }
      days[dayIndex][meal] = slotWithDishes(days[dayIndex][meal], [{ kind: 'recipe', recipeId: chosen.id, recipeName: chosen.name }])
      const [updatedManual] = await db
        .update(menus)
        .set({ days, skippedDays: unskipDay(menu.skippedDays, dayIndex) })
        .where(eq(menus.id, menu.id))
        .returning()
      if (dishNow(updatedManual, dayIndex, meal) !== chosen.name) return notSaved(slotLabel)
      return {
        data: { ...updatedManual, change: changeOf(t, meal, chosen.name) },
        summary: `Hecho. He puesto "${chosen.name}" en la ${slotLabel}.${reactivatedLine(menu, t)}${repeatNote(days, t.weekStart, dayIndex, meal, { recipeId: chosen.id, name: chosen.name })}`,
        uiHint: 'menu',
      }
    }

    // Collect used recipe IDs (excluding the one being replaced)
    const usedRecipeIds = new Set<string>()
    for (let d = 0; d < days.length; d++) {
      for (const m of Object.keys(days[d])) {
        if (d === dayIndex && m === meal) continue
        const slot = days[d][m]
        if (!slot) continue
        for (const dish of recipeDishesOf(slot.dishes)) {
          usedRecipeIds.add(dish.recipeId)
        }
      }
    }

    // The same pick as «Cambiar» in the app (2026-11-19, `menuSlotPick.ts`):
    // everyone's allergies and diet (PRO-305), the ficha (dislikes with whole
    // categories, «sin X» saved as a note, weekly limits, light meals,
    // equipment), favourites and ratings, the week's vetoes, a reasonable time
    // on a working day, never a sweet as lunch or dinner and, while one fits,
    // a main food not already in the week. Before, a random catalogue recipe
    // with only allergies and dislikes: a khachapuri of 151 min for a Tuesday
    // dinner, a sweet mutabbaq as a Sunday dinner, hummus for «sin legumbres».
    const pickCtx = await loadSlotPickContext(menu, userId)
    const pick = await slotPickOptions(pickCtx, menu, dayIndex, meal, usedRecipeIds, days)

    // «Semana tipo» (D-182): another recipe of the type it asks for there.
    const wtType = await weekTypeDishTypeAt(userId, menu.weekStart, dayIndex, meal, 0, db)
    const newRecipe = pickForSlot(pick, null, (p) => poolOfDishType(p, wtType))

    if (!newRecipe) {
      return {
        data: null,
        summary: `No he cambiado nada: no hay ninguna receta que encaje en la ${slotLabel} con lo que sabemos de la casa (gustos y «sin…», reglas del menú, tiempo de ese día, lo que ya hay en la semana). Díselo así y pregúntale qué le apetece; con un plato nombrado, vuelve a llamar con recipeName.`,
        uiHint: 'text',
      }
    }

    // Update the menu (the slot keeps its «Solo hoy», PRO-102)
    days[dayIndex][meal] = slotWithDishes(days[dayIndex][meal], [{ kind: 'recipe', recipeId: newRecipe.id, recipeName: newRecipe.name, ...fromWeekTypeOf(wtType, newRecipe) }])

    const [updated] = await db
      .update(menus)
      .set({ days, skippedDays: unskipDay(menu.skippedDays, dayIndex) })
      .where(eq(menus.id, menu.id))
      .returning()

    if (dishNow(updated, dayIndex, meal) !== newRecipe.name) return notSaved(slotLabel)
    return {
      data: { ...updated, change: changeOf(t, meal, newRecipe.name) },
      summary: `Cambiado: la ${slotLabel} ahora es "${newRecipe.name}".${reactivatedLine(menu, t)}${repeatNote(days, t.weekStart, dayIndex, meal, { recipeId: newRecipe.id, name: newRecipe.name })}`,
      uiHint: 'menu',
    }
  },
}

export const toggleFavorite: SkillDefinition = {
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
      .where(and(await visibleWhere(ctx), or(
        ilike(recipes.name, `%${params.recipeName}%`),
        ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map((w: string) => ilike(recipes.name, `%${w}%`)),
      )))
      .limit(1)

    if (!recipe) {
      return { data: null, summary: `No he encontrado la receta "${params.recipeName}".`, uiHint: 'text' }
    }

    // Check if already favorited
    const existing = await db
      .select()
      .from(userFavorites)
      .where(
        scopeWhere(userFavorites.userId, userFavorites.householdId, await resolveScope(userId, db)),
      )

    const alreadyFav = existing.find((f: any) => f.recipeId === recipe.id)

    if (alreadyFav) {
      await db
        .delete(userFavorites)
        .where(eq(userFavorites.id, alreadyFav.id))

      return { data: { recipeId: recipe.id, favorited: false }, summary: `${recipe.name} eliminada de favoritos.`, uiHint: 'confirmation' }
    } else {
      const householdId = await getPrimaryHouseholdId(userId, db)
      await db
        .insert(userFavorites)
        .values({ userId, householdId, recipeId: recipe.id })

      return { data: { recipeId: recipe.id, favorited: true }, summary: `${recipe.name} anadida a favoritos.`, uiHint: 'confirmation' }
    }
  },
}

export const markMealEaten: SkillDefinition = {
  name: 'mark_meal_eaten',
  description:
    'Marca una comida como comida o no comida en el menu actual. Si comieron otra cosa que la del menu ("al final cenamos tortilla", "pedimos pizza"), pasa en dish lo que dicen: queda apuntado en esa comida como texto, sin crear receta.',
  parameters: {
    type: 'object',
    properties: {
      day: DAY_PROP,
      dayIndex: { type: 'number', description: 'Solo si no usas day: 0=lunes … 6=domingo de esta semana' },
      meal: { type: 'string', description: 'Tipo de comida: breakfast, lunch, snack o dinner' },
      eaten: { type: 'boolean', description: 'true si se ha comido, false si no' },
      dish: { type: 'string', description: 'Solo si comieron otra cosa que la del menu: lo que comieron, con sus palabras ("tortilla", "pizza pedida"). Sustituye los platos de esa comida por ese texto.' },
    },
    required: ['meal', 'eaten'],
  },
  async handler(params: { day?: string; dayIndex?: number; meal: string; eaten: boolean; dish?: string }, ctx: SkillContext): Promise<SkillResult> {
    // PRO-1293: what they ate instead goes in as text, never as a recipe.
    if (params.eaten !== false && typeof params.dish === 'string' && params.dish.trim()) {
      return markEatenAsNote(ctx, { day: params.day, dayIndex: params.dayIndex, meal: params.meal, dish: params.dish })
    }
    const { db } = ctx
    const { meal, eaten } = params
    const t = menuDayParam({ day: params.day, dayIndex: params.dayIndex })
    if (isMenuDayError(t)) return { data: null, summary: t.error, uiHint: 'text' }
    const dayIndex = t.dayIndex

    const menu = await menuOfWeek(ctx, t.weekStart)
    if (!menu) return noMenuFor(t.weekStart)

    const days = menu.days as any[]

    if (dayIndex >= days.length) {
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

    const label = eaten ? 'comida' : 'no comida'
    const recipeName = dishNow(updated ?? menu, dayIndex, meal) ?? MEAL_LABEL[meal] ?? meal
    return {
      data: { ...updated, change: changeOf(t, meal, recipeName) },
      summary: `Hecho: "${recipeName}" (${MEAL_LABEL[meal] ?? meal} del ${t.label}) marcada como ${label}.`,
      uiHint: 'confirmation',
    }
  },
}
