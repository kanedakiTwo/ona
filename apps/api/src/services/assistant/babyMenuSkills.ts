/**
 * PRO-1035 (Marta y Jorge, 2026-10-24 and 2026-10-30; Leo, 10 months): asked
 * for a week «que sirva para Leo todo», Mimo said it had changed what didn't
 * suit him and left on Friday chicken wings marinated with soy and honey; it
 * admitted it hadn't looked at what every dish carried. Then a salmon
 * marinated in soy, and the chard «sin problema».
 *
 * `check_menu_for_baby` reads the ingredients, the name and the steps of
 * EVERY dish of a week's menu and says which ones carry something of the list
 * that doesn't go in a baby's portion before the age of 1 (Miguel,
 * 2026-11-03, D-161): honey, added salt (the strong kind: stock cubes, salt
 * cod, anchovies…; plain salt is the set-aside step of every recipe), cured
 * meat, whole nuts, raw or marinated fish, soy and leafy greens. Kitchen
 * words only, no reasons nor effects (constitution §6, red line 4); Cocina
 * and Legal review the list and the wording afterwards.
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import { recipeDishesOf, type DayMenu, type Dish } from '@ona/shared'
import { ingredients, menus, recipeIngredients, recipes, recipeSteps } from '../../db/schema.js'
import { resolveScope, scopeWhere } from '../scopeResolver.js'
import { fillRecipeNames } from '../menuNames.js'
import { madridWeekStart } from '../madridTime.js'
import { DAY_PROP, dateLabel, isMenuDayError, menuDayOf, resolveMenuDay } from './menuDay.js'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'

export type BabyFlagKind = 'miel' | 'sal' | 'embutido' | 'frutos-secos' | 'pescado-crudo' | 'soja' | 'verdura-hoja'

/** How each kind reads for the model (Miguel's list), in the order the summary gives them. */
export const BABY_FLAG_LABELS: Record<BabyFlagKind, string> = {
  miel: 'miel',
  soja: 'soja',
  embutido: 'embutido',
  sal: 'sal añadida fuerte',
  'verdura-hoja': 'verduras de hoja',
  'pescado-crudo': 'pescado crudo o marinado',
  'frutos-secos': 'frutos secos enteros',
}
const KINDS = Object.keys(BABY_FLAG_LABELS) as BabyFlagKind[]

const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const HONEY_RE = /\bmiel\b/
const SOY_RE = /\b(soja|tamari|miso)\b/
const CURED_RE = /\b(embutid\w*|chorizo|jamon|bacon|beicon|panceta|guanciale|tocino|salchichon|salchichas?|fuet|lomo embuchado|sobrasada|morcilla|salami|mortadela|pepperoni|cecina|longaniza|butifarra|lacon|fiambre)\b/
const STRONG_SALT_RE = /\b(pastillas? de caldo|caldo de pastilla|cubitos?|caldo concentrado|bacalao salado|en salazon|salazon|anchoas?|mojama|alcaparras?|aceitunas?|pecorino|parmesano|grana padano|queso curado)\b/
const NUT_RE = /\b(almendras?|avellanas?|nuez|nueces|cacahuetes?|pistachos?|anacardos?|pinones|pinon|macadamias?|pecanas?|frutos secos)\b/
/** A nut that isn't whole: ground, flour, cream, drink… (not in the list). */
const NUT_NOT_WHOLE_RE = /\b(molid[oa]s?|harina|crema|pasta|bebida|leche|aceite|en polvo)\b/
const LEAFY_RE = /\b(acelgas?|espinacas?|borrajas?)\b/
const FISH_RE = /\b(pescado|salmon|atun|bonito|bacalao|merluza|boquerones?|sardinas?|caballa|lubina|dorada|trucha|rape|gallo|anchoas?|gambas?|langostinos?|pulpo|calamar\w*|sepia|mejillon\w*|almejas?)\b/
const RAW_RE = /\b(marinad\w*|macerad\w*|en crudo|crud[oa]s?|tartar|ceviche|carpaccio|sashimi|sushi|poke|ahumad[oa]s?|en vinagre)\b/
/** Salt per serving above which the dish counts as strongly salted (g). */
const SALT_G_STRONG = 1.5

export interface BabyRecipeInput {
  name: string
  ingredientNames: string[]
  stepTexts: string[]
  /** Salt per serving, from `nutritionPerServing.saltG` (g), if known. */
  saltG?: number | null
}

export interface BabyFlag {
  kind: BabyFlagKind
  /** What carries it: the ingredient names, or the dish name / a step. */
  what: string[]
}

/**
 * Pure: what of the list a recipe carries. Ingredient names first; the name
 * and the steps count for what is said there and not in the ingredients
 * («alitas marinadas», «échale un chorro de soja»).
 */
export function babyFlagsOf(r: BabyRecipeInput): BabyFlag[] {
  const names = r.ingredientNames.map((n) => String(n ?? '').trim()).filter(Boolean)
  const foldedNames = names.map(fold)
  const name = fold(r.name)
  const steps = r.stepTexts.map(fold).join(' \n ')
  const all = [name, ...foldedNames, steps].join(' \n ')
  const hits = (re: RegExp, skip?: RegExp) => names.filter((_, i) => re.test(foldedNames[i]) && !(skip && skip.test(foldedNames[i])))
  const inText = (re: RegExp) => re.test(name) || re.test(steps)

  const out: BabyFlag[] = []
  const add = (kind: BabyFlagKind, what: string[], fallback: boolean) => {
    if (what.length > 0) out.push({ kind, what: [...new Set(what)] })
    else if (fallback) out.push({ kind, what: [re2word(kind)] })
  }
  add('miel', hits(HONEY_RE), inText(HONEY_RE))
  const strongSalt = hits(STRONG_SALT_RE)
  add('sal', strongSalt, inText(STRONG_SALT_RE) || (typeof r.saltG === 'number' && r.saltG > SALT_G_STRONG))
  add('embutido', hits(CURED_RE), inText(CURED_RE))
  add('frutos-secos', hits(NUT_RE, NUT_NOT_WHOLE_RE), false)
  // A fish anywhere, and raw / marinated / smoked said of the dish, a step or a fish ingredient.
  if (FISH_RE.test(all) && (RAW_RE.test(name) || RAW_RE.test(steps) || foldedNames.some((n) => FISH_RE.test(n) && RAW_RE.test(n)))) {
    const fish = hits(FISH_RE).slice(0, 3)
    out.push({ kind: 'pescado-crudo', what: fish.length > 0 ? fish : ['pescado'] })
  }
  add('soja', hits(SOY_RE), inText(SOY_RE))
  add('verdura-hoja', hits(LEAFY_RE), inText(LEAFY_RE))
  return out.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))
}

/** What a flag says when only the name or the steps carry it. */
function re2word(kind: BabyFlagKind): string {
  return kind === 'sal' ? 'mucha sal' : `${BABY_FLAG_LABELS[kind]} (en el nombre o los pasos)`
}

const MEAL_LABEL: Record<string, string> = { breakfast: 'desayuno', lunch: 'comida', snack: 'merienda', dinner: 'cena' }
const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner']

export interface BabyWeekDish {
  /** «viernes 30 de octubre, cena». */
  where: string
  name: string
  flags: BabyFlag[]
}

/**
 * Pure: the week's review as the model reads it. `checked` are the recipe
 * dishes looked at, `notes` the dishes with no recipe (nothing to look at).
 */
export function describeBabyWeek(weekStart: string, checked: BabyWeekDish[], notes: Array<{ where: string; text: string }>): string {
  const flagged = checked.filter((d) => d.flags.length > 0)
  const clean = checked.filter((d) => d.flags.length === 0)
  const lines = [`Ingredientes mirados de los ${checked.length} platos con receta de la semana del ${dateLabel(weekStart)}, para la racion del bebe. Lo que se mira: ${KINDS.map((k) => BABY_FLAG_LABELS[k]).join(', ')}.`]
  if (flagged.length > 0) {
    lines.push(`Llevan algo de eso (${flagged.length}): en cada uno, cambialo con swap_meal o di en ese plato como sale su racion (apartarla antes de echarlo; si no se puede apartar, como un adobo, un marinado, la salsa o la verdura de hoja del plato, para el otra cosa):`)
    for (const d of flagged) {
      lines.push(`- ${d.where}: ${d.name}: ${d.flags.map((f) => `${BABY_FLAG_LABELS[f.kind]} (${f.what.join(', ')})`).join('; ')}`)
    }
  } else {
    lines.push('Ninguno lleva nada de eso.')
  }
  if (clean.length > 0) lines.push(`Sin nada de eso: ${clean.map((d) => `${d.where}: ${d.name}`).join('; ')}.`)
  if (notes.length > 0) lines.push(`No los he podido mirar (son notas, sin receta): ${notes.map((n) => `${n.where}: ${n.text}`).join('; ')}. Dilo asi.`)
  lines.push('En todos, la sal y las especias de su racion siguen la regla de apartarla antes.')
  return lines.join('\n')
}

/** The week a call means: `day` (any day of it), `nextWeek`, or this week. */
function weekOf(params: { day?: unknown; nextWeek?: unknown }): string | { error: string } {
  if (typeof params?.day === 'string' && params.day.trim()) {
    const t = resolveMenuDay({ day: params.day, nextWeek: params.nextWeek })
    return isMenuDayError(t) ? t : t.weekStart
  }
  return madridWeekStart(new Date(), params?.nextWeek === true ? 1 : 0)
}

export const checkMenuForBabySkill: SkillDefinition = {
  name: 'check_menu_for_baby',
  description:
    'Mira los ingredientes, el nombre y los pasos de TODOS los platos del menu de una semana y dice cuales llevan algo que no va en la racion de un bebe de menos de 1 año: miel, soja, embutido, sal añadida fuerte, verduras de hoja, pescado crudo o marinado o frutos secos enteros. Usala siempre que en casa haya un bebe de menos de 1 año y generes, cambies o repases un menu de la semana, o te pidan que valga para el. Una llamada por semana.',
  parameters: {
    type: 'object',
    properties: {
      day: { ...DAY_PROP, description: 'Un dia de la semana a mirar ("el lunes 26", "la semana que viene", AAAA-MM-DD). Sin el, esta semana.' },
      nextWeek: { type: 'boolean', description: 'true si es la semana que viene.' },
    },
    required: [],
  },
  async handler(params: { day?: string; nextWeek?: boolean }, ctx: SkillContext): Promise<SkillResult> {
    const weekStart = weekOf(params ?? {})
    if (typeof weekStart !== 'string') return { data: null, summary: weekStart.error, uiHint: 'text' }
    const [row] = await ctx.db
      .select()
      .from(menus)
      .where(and(scopeWhere(menus.userId, menus.householdId, await resolveScope(ctx.userId, ctx.db)), eq(menus.weekStart, weekStart)))
      .orderBy(desc(menus.createdAt))
      .limit(1)
    if (!row) return { data: null, summary: `No hay menu para la semana del ${dateLabel(weekStart)}: no hay platos que mirar.`, uiHint: 'text' }
    const days = (await fillRecipeNames(row.days, ctx.db)) as DayMenu[]
    const skipped = new Set<number>(row.skippedDays ?? [])

    const slots: Array<{ where: string; recipeId: string; name: string }> = []
    const notes: Array<{ where: string; text: string }> = []
    ;(days ?? []).forEach((day, i) => {
      if (skipped.has(i)) return
      for (const meal of MEAL_ORDER) {
        const dishes = ((day as any)?.[meal]?.dishes ?? []) as Dish[]
        const where = `${menuDayOf(weekStart, i).label}, ${MEAL_LABEL[meal]}`
        for (const d of recipeDishesOf(dishes)) slots.push({ where, recipeId: d.recipeId, name: d.recipeName ?? 'plato' })
        for (const d of dishes) if (d.kind === 'note' && d.text) notes.push({ where, text: d.text })
      }
    })
    if (slots.length === 0 && notes.length === 0) {
      return { data: null, summary: `La semana del ${dateLabel(weekStart)} no tiene platos todavia.`, uiHint: 'text' }
    }

    const ids = [...new Set(slots.map((s) => s.recipeId))]
    const recipeRows: any[] = ids.length ? await ctx.db.select({ id: recipes.id, name: recipes.name, nutritionPerServing: recipes.nutritionPerServing }).from(recipes).where(inArray(recipes.id, ids)) : []
    const ingRows: any[] = ids.length
      ? await ctx.db
          .select({ recipeId: recipeIngredients.recipeId, name: ingredients.name })
          .from(recipeIngredients)
          .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
          .where(inArray(recipeIngredients.recipeId, ids))
      : []
    const stepRows: any[] = ids.length ? await ctx.db.select({ recipeId: recipeSteps.recipeId, text: recipeSteps.text }).from(recipeSteps).where(inArray(recipeSteps.recipeId, ids)) : []

    const flagsById = new Map<string, BabyFlag[]>()
    for (const id of ids) {
      const r = (recipeRows ?? []).find((x) => x.id === id)
      const saltG = r?.nutritionPerServing?.saltG
      flagsById.set(
        id,
        babyFlagsOf({
          name: r?.name ?? slots.find((s) => s.recipeId === id)?.name ?? '',
          ingredientNames: (ingRows ?? []).filter((x) => x.recipeId === id).map((x) => x.name),
          stepTexts: (stepRows ?? []).filter((x) => x.recipeId === id).map((x) => x.text ?? ''),
          saltG: typeof saltG === 'number' ? saltG : null,
        }),
      )
    }
    const checked: BabyWeekDish[] = slots.map((s) => ({ where: s.where, name: s.name, flags: flagsById.get(s.recipeId) ?? [] }))
    return {
      data: { weekStart, checked: checked.length, flagged: checked.filter((d) => d.flags.length > 0), notes },
      summary: describeBabyWeek(weekStart, checked, notes),
      uiHint: 'text',
    }
  },
}

export const babyMenuSkills: SkillDefinition[] = [checkMenuForBabySkill]
