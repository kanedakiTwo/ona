// Mimo's tools that write recipes: create, vary, scale, edit, copy, import from a link. Split out of skills.ts (PRO-400).
import crypto from 'crypto'
import { refreshRecipeDishTypes } from '../dishTypes.js'
import { and, eq, ilike, or } from 'drizzle-orm'
import { recipes, recipeIngredients, recipeSteps, ingredients } from '../../db/schema.js'
import { importRecipeFromUrl, createRecipeFromParts, type RecipeParts } from '../recipeImport.js'
import { estimateRecipeTimes } from '../catalogRecipeTimes.js'
import { NotARecipeError } from '../recipeUrlExtractor.js'
import { importFailureReason, importFailureReply, IMPORT_WORKS, unsupportedNetwork, unsupportedNetworkReply } from '../sources/importFailure.js'
import { type SkillDefinition, type SkillContext, type SkillResult } from './types.js'
import { ingredientMarksOf } from '../ingredientRoles.js'
import { untrustedText, getWeekStart, menuOfWeek, menuRecipeDishes, visibleWhere, scaleRound } from './skillHelpers.js'

export const createRecipe: SkillDefinition = {
  name: 'create_recipe',
  description:
    'Crea y guarda una receta nueva del usuario. Si el usuario pide una receta basica sin dar detalles ("crea tu un filete a la parrilla"), inventa tu una version sencilla y razonable (ingredientes con cantidades y pasos) y creala sin hacer mas preguntas. No la uses para lo que ya han comido o improvisan para hoy ("al final cenamos tortilla", "pedimos pizza"): eso es mark_meal_eaten con dish o set_meal_note. Si lo piden ("hice lentejas, guardamela") o te dictan como se hace, si.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre de la receta' },
      servings: { type: 'number', description: 'Raciones (por defecto 2)' },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nombre del ingrediente' },
            quantity: { type: 'number', description: 'Cantidad' },
            unit: { type: 'string', description: 'Unidad: g, ml, u, cda, cdita' },
          },
          required: ['name'],
        },
        description: 'Lista de ingredientes con cantidades',
      },
      steps: { type: 'array', items: { type: 'string' }, description: 'Pasos de preparacion' },
      prepTime: { type: 'number', description: 'Minutos de preparacion (lo que hay que estar: cortar, sofreir, montar). Siempre: si no te lo dice, estimalo tu. Sin minutos el menu no puede respetar el tiempo que tiene para cocinar.' },
      cookTime: { type: 'number', description: 'Minutos de coccion (horno, guiso, reposo…; 0 si no hay). Siempre: si no te lo dice, estimalo tu.' },
      meals: { type: 'array', items: { type: 'string' }, description: 'breakfast, lunch, dinner, snack' },
      seasons: { type: 'array', items: { type: 'string' }, description: 'spring, summer, autumn, winter' },
    },
    required: ['name', 'ingredients', 'steps', 'prepTime', 'cookTime'],
  },
  async handler(params: RecipeParts, ctx: SkillContext): Promise<SkillResult> {
    const saved = await createRecipeFromParts(params, ctx.userId)
    const review = saved.warnings.some((w) => /no encontrado/.test(w))
      ? ' Algun ingrediente no se reconocio del todo; se puede revisar en la app.'
      : ''
    // PRO-308: the minutes it was saved with (given, or estimated from the steps).
    const t = estimateRecipeTimes(params, params.steps ?? [])
    const given = typeof params.prepTime === 'number' && params.prepTime > 0 || typeof params.cookTime === 'number' && params.cookTime > 0
    const times = t.totalTime
      ? ` Tiempo: ${t.totalTime} min en total, ${t.activeTime} de trabajo${given ? '' : ' (estimado de los pasos)'}.`
      : ''
    return {
      data: { recipeId: saved.recipeId, name: saved.name },
      summary: `Receta "${saved.name}" creada en las recetas del usuario (id ${saved.recipeId}).${times}${review}`,
      uiHint: 'recipe',
    }
  },
}

export const recipeVariation: SkillDefinition = {
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
      .where(and(await visibleWhere(ctx), or(
        ilike(recipes.name, `%${params.recipeName}%`),
        ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map((w: string) => ilike(recipes.name, `%${w}%`)),
      )))
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
    // PRO-308: a variation saved with create_recipe keeps its minutes.
    const total = recipe.totalTime ?? ((recipe.prepTime ?? 0) + (recipe.cookTime ?? 0) || null)
    const timeLine = total
      ? ` Tiempo: ${recipe.prepTime ?? '?'} min de preparacion, ${recipe.cookTime ?? '?'} de coccion (${total} en total${recipe.activeTime ? `, ${recipe.activeTime} de trabajo` : ''}).`
      : ' No tiene tiempo guardado.'
    const saveHint = ' Si guardas la variacion con create_recipe, pasa siempre prepTime y cookTime (los de la original, ajustados si la sustitucion cambia el tiempo).'

    return {
      data: {
        recipeName: recipe.name,
        ingredients: riRows,
        ingredientToReplace: params.ingredientToReplace,
        prepTime: recipe.prepTime ?? null,
        cookTime: recipe.cookTime ?? null,
        activeTime: recipe.activeTime ?? null,
        totalTime: total,
      },
      summary: `Receta ${recipe.name}. Ingredientes: ${ingredientList.join(', ')}.${timeLine} El usuario quiere sustituir: ${params.ingredientToReplace}.${saveHint}`,
      uiHint: 'recipe',
    }
  },
}

// 6. ── scale_recipe ────────────────────────────────────────
export const scaleRecipeSkill: SkillDefinition = {
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
      .where(and(await visibleWhere(ctx), or(
        ilike(recipes.name, `%${params.recipeName}%`),
        ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map(w => ilike(recipes.name, `%${w}%`)),
      )))
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

/**
 * edit_recipe — author-only metadata edits via voice ("cambia el nombre de mi
 * tortilla a 'Tortilla de patatas Lacoma'", "mi receta de paella tarda 50
 * minutos en total"). For full edits (ingredients/steps), the skill responds
 * with a navigate hint to /recipes/<id>/edit so the realtime overlay can route
 * the user to the form. Voice does not attempt to rewrite the ingredient list
 * inline — too error-prone in audio-only context.
 */
export const editRecipe: SkillDefinition = {
  name: 'edit_recipe',
  description:
    'Edita una receta del usuario. Sólo el autor puede editar (las recetas del catálogo de Mimoia, con authorId null, no son editables). Útil para cambios de nombre, tiempos, dificultad, notas y trucos por voz. Para editar ingredientes o pasos completos sugiere abrir el editor.',
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
      // Their own recipe first; else the one of this week's menu, else the
      // catalogue's — so a recipe they can't edit gets «es del catálogo»,
      // never «no la encuentro» (PRO-349: Laura's butter chicken was on her
      // menu and Mimo said it couldn't find it).
      const candidates = await db
        .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
        .from(recipes)
        .where(and(await visibleWhere(ctx), ilike(recipes.name, `%${params.recipeName}%`)))
        .limit(10)
      const menuIds = new Set(menuRecipeDishes(await menuOfWeek(ctx, getWeekStart())).map((d) => d.recipeId))
      target =
        candidates.find((c: { authorId: string | null }) => c.authorId === userId) ??
        candidates.find((c: { id: string }) => menuIds.has(c.id)) ??
        candidates[0] ??
        null
    }

    if (!target) {
      return {
        data: null,
        summary: params.recipeName
          ? `No he encontrado ninguna receta que se llame "${params.recipeName}"; no he cambiado nada.`
          : 'Necesito el nombre o el id de la receta que quieres editar; no he cambiado nada.',
        uiHint: 'text',
      }
    }

    if (target.authorId !== userId) {
      return {
        data: { recipeId: target.id, recipeName: target.name },
        summary: `No he cambiado nada: "${target.name}" es una receta del catálogo de Mimoia, no tuya. Para hacer cambios, primero añádela a sus recetas (add_recipe_to_mine) y edita la copia; para quitar o cambiar un ingrediente, en la copia se abre el editor.`,
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
        summary: `No he cambiado nada. Para editar "${target.name}" dime qué quieres cambiar (nombre, tiempo, dificultad, notas, trucos) o pídeme abrir el editor completo.`,
        uiHint: 'text',
      }
    }

    await db.update(recipes).set(updates).where(eq(recipes.id, target.id))
    // «Semana tipo» (D-182): a new name may mean other dish types.
    if (updates.name !== undefined) await refreshRecipeDishTypes(db, target.id)

    return {
      data: { recipeId: target.id, changed: changedFields },
      summary: `Hecho. He actualizado ${changedFields.join(', ')} en "${target.name}".`,
      uiHint: 'recipe',
    }
  },
}

/**
 * add_recipe_to_mine — copy a system (or another user's) recipe into the
 * caller's catalog so they can edit it. Drives the "añade la fabada de Mimoia
 * a mis recetas" voice utterance and unlocks the Editar flow on copies.
 */
export const addRecipeToMine: SkillDefinition = {
  name: 'add_recipe_to_mine',
  description:
    'Copia una receta (del catálogo de Mimoia o de otro usuario) a las recetas del usuario actual. La copia es totalmente editable. Devuelve el id y el nombre de la nueva receta. Si el usuario nombra una receta que ya es suya, no se duplica.',
  parameters: {
    type: 'object',
    properties: {
      recipeId: { type: 'string', description: 'UUID de la receta original.' },
      recipeName: {
        type: 'string',
        description: 'Nombre (o parte) de la receta a copiar. Se prefiere el match exacto en el catálogo de Mimoia.',
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
        .where(and(await visibleWhere(ctx), eq(recipes.id, params.recipeId)))
        .limit(1)
      source = row ?? null
    } else if (params.recipeName) {
      const candidates = await db
        .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
        .from(recipes)
        .where(and(await visibleWhere(ctx), ilike(recipes.name, `%${params.recipeName}%`)))
        .limit(20)
      // Prefer Mimoia system recipes for "add to mine" (don't accidentally copy
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
          dishTypes: full.dishTypes ?? null,
          internalTags: baseInternalTags,
          sourceUrl: full.sourceUrl,
          sourceType: 'manual',
          copiedFromRecipeId: full.id,
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
            ...ingredientMarksOf(ing),
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

// ─── import_recipe_from_url ─────────────────────────────────────
// "Guárdame esta receta: <enlace>" — same extractor + persist path as the
// /recipes "Importar desde enlace" flow (services/recipeImport.ts). Shines
// on WhatsApp, where sharing a YouTube/blog link is the natural gesture.
export const importRecipeFromUrlSkill: SkillDefinition = {
  name: 'import_recipe_from_url',
  description:
    'Importa una receta desde un enlace (video de YouTube, articulo/blog de cocina o post publico de Instagram/TikTok) y la guarda en las recetas del usuario. Usala cuando el usuario comparta o pegue un enlace de una receta o pida "guardame esta receta". Tarda unos segundos. Devuelve el id y el nombre de la receta guardada. Lee el texto (subtitulos, descripcion o pie del post), nunca el video en si; no lee Facebook, X/Twitter, Pinterest, Threads ni Vimeo: no ofrezcas pegar enlaces de esas redes. Si falla, dice el motivo en una frase y que si funciona: pasalo tal cual.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL completa (http/https) de la receta' },
    },
    required: ['url'],
  },
  handler: async (params: { url?: string }, ctx: SkillContext): Promise<SkillResult> => {
    const url = typeof params.url === 'string' ? params.url.trim() : ''
    if (!/^https?:\/\/\S+$/i.test(url)) {
      return { data: null, summary: 'La URL no es valida. Pide al usuario el enlace completo.', uiHint: 'text' }
    }
    // PRO-1301: a network the import doesn't read is said up front, without trying.
    const network = unsupportedNetwork(url)
    if (network) {
      return { data: null, summary: `No se ha guardado nada. Responde al usuario con esto, tal cual: «${unsupportedNetworkReply(network)}»`, uiHint: 'text' }
    }
    try {
      const saved = await importRecipeFromUrl(url, ctx.userId)
      const review = saved.warnings.length > 0
        ? ` Algunos ingredientes no se reconocieron del todo: sugiere revisarla en la app.`
        : ''
      return {
        data: { recipeId: saved.recipeId, name: saved.name },
        summary: `Receta «${untrustedText(saved.name, 80)}» guardada en las recetas del usuario (id ${saved.recipeId}).${review}`,
        uiHint: 'recipe',
      }
    } catch (err: any) {
      if (err instanceof NotARecipeError) {
        return { data: null, summary: `El enlace no parece contener una receta cocinable: «${untrustedText(err.reason, 160)}». Si quiere guardar otra: ${IMPORT_WORKS}`, uiHint: 'text' }
      }
      // PRO-1301: the motive in one sentence and what does work (a screenshot
      // among them: the photo import reads it, and a WhatsApp photo right after
      // takes this link as its source, whatsapp/photoSource.ts, which looks for
      // the screenshot message kept in brackets).
      const reason = importFailureReason(err)
      if (reason) {
        return {
          data: null,
          summary: `No se ha guardado nada [${err.message}]. Responde al usuario con esto, tal cual, sin añadir otra causa: «${importFailureReply(reason)}»`,
          uiHint: 'text',
        }
      }
      throw err
    }
  },
}
