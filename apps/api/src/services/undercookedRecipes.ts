/**
 * PRO-1181 (D-1009, seguridad de la dieta): recipes with a runny yolk (or raw
 * yolk) and with minced meat left pink.
 *
 * Miguel, 2026-11-12: (a) they carry a hidden tag (`internalTags`) and the
 * menu never gives them to a household with someone aged 0 to 2 (a person
 * of the ficha with the age band «0-2»); (b) Mimoia doesn't keep pregnancy,
 * so in those recipes, for everyone, a step says how to cook it through
 * («Para embarazo o bebés: tapa 4 minutos más, hasta que la yema esté
 * firme», and its equivalent for the mince). No «Embarazo» in the profile.
 *
 * The list is Cocina's (COC-510, `departments/cocina/auditoria.md`, up to
 * 2026-11-12): 19 with runny or raw yolk and 3 with pink mince. Catalogue
 * recipes are found by their production id or by name (drafts and staging
 * have other ids); users' copies of them get the tag only — their steps are
 * theirs. Runs on every boot after `db:migrate`, like `catalogRecipeFixes.ts`:
 * it only adds (a tag, a line) and never twice.
 */
import { eq, inArray, isNull } from 'drizzle-orm'
import { recipes, recipeSteps } from '../db/schema.js'
import { normalizeRecipeName } from './catalogSourceLinks.js'

export const LIQUID_YOLK_TAG = 'yema-liquida'
export const UNDERCOOKED_MINCE_TAG = 'carne-picada-poco-hecha'
const BABY_TAGS: readonly string[] = [LIQUID_YOLK_TAG, UNDERCOOKED_MINCE_TAG]

/** Every safety line starts like this; a step that has it isn't touched again. */
export const SAFETY_PREFIX = 'Para embarazo o bebés:'

const YOLK_LINE = `${SAFETY_PREFIX} tapa 4 minutos más, hasta que la yema esté firme.`
const EGG_STEP = /\b(yemas?|huevos?)\b/i
const MINCE_STEP = /\b(cordero|carne|picad[oa]s?|rosad[oa]s?)\b/i

export interface UndercookedRecipe {
  /** As Cocina names it (and as the catalogue does, when published). */
  name: string
  /** Production id, when it's published (Cocina's index of 2026-11-12). */
  id?: string
  tag: typeof LIQUID_YOLK_TAG | typeof UNDERCOOKED_MINCE_TAG
  /** The line added to its steps, for everyone. */
  line: string
}

const yolk = (name: string, id?: string, line = YOLK_LINE): UndercookedRecipe => ({ name, id, tag: LIQUID_YOLK_TAG, line })
const mince = (name: string, id: string | undefined, line: string): UndercookedRecipe => ({ name, id, tag: UNDERCOOKED_MINCE_TAG, line })

export const UNDERCOOKED_RECIPES: readonly UndercookedRecipe[] = [
  yolk('Huevos al plato con tomate y guisantes', '05193c38-d577-4501-874d-1304bfd940b7'),
  yolk('Revuelto de setas', '363fe9e4-a8b1-4e20-8654-b5d88e58b759', `${SAFETY_PREFIX} cuájalo 2 minutos más, hasta que no quede huevo líquido.`),
  yolk('Alubias con huevo y pimentón', '0edaa727-88c8-46c5-a015-f9891b2ad7fb'),
  yolk('Salteado de setas con huevo'),
  yolk('Tostada de aguacate con huevo poché', undefined, `${SAFETY_PREFIX} escalfa el huevo 5 minutos, hasta que la yema esté firme.`),
  yolk('Patatas viudas con huevo escalfado', 'b0090f5c-0d05-4ad2-97cf-2223f73c4d0b', `${SAFETY_PREFIX} escalfa los huevos 5 minutos, hasta que la yema esté firme.`),
  yolk('Repollo salteado con huevos', '2eb93b55-5550-49c8-9f92-efa38164dc9f'),
  yolk('Arroz de coliflor a la cubana'),
  yolk('Shakshuka', 'b180ad84-d7f4-425f-9ae4-66701b296be7'),
  yolk('Huevos con cordero, tahini y zumaque', '4da166a7-2f0d-48ed-8354-19f828d85782'),
  yolk('Brick de huevo (empanadilla tunecina frita)', 'e7a4cf2a-035b-4238-a7a0-c0c2c1b4a561', `${SAFETY_PREFIX} fríe la empanadilla a fuego más suave, 2 minutos más por cada lado, hasta que la yema esté firme.`),
  yolk('Khachapuri acharuli (barquitas de queso y huevo)', '1595692d-ddc8-4489-b541-c063fe2d61a9', `${SAFETY_PREFIX} hornea 4 minutos más, hasta que la yema esté firme.`),
  yolk('Galettes de pimiento rojo con huevo', undefined, `${SAFETY_PREFIX} hornea 4 minutos más, hasta que la yema esté firme.`),
  yolk('Huevos pasados por agua con soldaditos', '27820116-5c3f-44d9-aed6-1febe775a48d', `${SAFETY_PREFIX} cuécelos 10 minutos, hasta que la yema esté firme, y sírvelos en rodajas.`),
  yolk('Cintas a la carbonara', '07a66de1-628f-4137-99be-b571dd31e0f6', `${SAFETY_PREFIX} calienta la salsa con las yemas a fuego suave, removiendo, hasta que espese (unos 2 minutos, que llegue a 70 °C).`),
  yolk('Sopa de pan y ajo', '4ac9650f-0225-4b69-bbd9-6238f749b88d', `${SAFETY_PREFIX} escalfa el huevo 5 minutos, hasta que la yema esté firme.`),
  yolk('Ramen casero', '8cd4b0ad-d89f-484f-86ba-34e993a23791', `${SAFETY_PREFIX} cuece los huevos 10 minutos, hasta que la yema esté firme.`),
  yolk('Ensalada César', 'f3a1eca6-5865-407a-b0a8-ed93b0f498ee', `${SAFETY_PREFIX} usa mayonesa de bote (pasteurizada) en lugar de la yema cruda.`),
  yolk('Cogollos a la plancha con vinagreta de menta', '6b130617-4a83-4546-8603-047999a77213', `${SAFETY_PREFIX} usa mayonesa de bote (pasteurizada) en lugar de las yemas crudas.`),
  mince('Hummus kawarma (con cordero especiado y salsa de limón)', 'dd01cce0-7f1a-4972-8112-c1f380350957', `${SAFETY_PREFIX} saltea el cordero 2 minutos más, hasta que no quede nada rosa.`),
  mince('Sfiha (pizzetas de cordero especiado)', '79e6992c-5135-4110-b4c9-966c27dc9418', `${SAFETY_PREFIX} hornéalas 3 minutos más, hasta que la carne no quede nada rosa.`),
  mince('Hamburguesa casera', 'c881bf3e-ebae-4fe7-9637-5c43520a24df', `${SAFETY_PREFIX} hazla hasta que por dentro no quede nada rosa (71 °C).`),
]

/** Pure: is there someone aged 0 to 2 in the household (ficha persons)? */
export function hasBabyAtHome(persons: ReadonlyArray<{ ageBand: string }> | null | undefined): boolean {
  return (persons ?? []).some((p) => p.ageBand === '0-2')
}

/** Pure: a recipe the menu never gives to a household with a baby. */
export function notForBabies(internalTags: readonly string[] | null | undefined): boolean {
  return (internalTags ?? []).some((t) => BABY_TAGS.includes(t))
}

/** Pure: name as compared — accents, case and a trailing «(…)» aside. */
const nameKey = (name: string) => normalizeRecipeName(name.replace(/\s*\([^)]*\)\s*$/, ''))

/** Pure: the list entry for a catalogue recipe (by id, else by name), or null. */
export function undercookedEntryFor(r: { id: string; name: string }): UndercookedRecipe | null {
  return UNDERCOOKED_RECIPES.find((u) => u.id === r.id) ?? UNDERCOOKED_RECIPES.find((u) => nameKey(u.name) === nameKey(r.name)) ?? null
}

/**
 * Pure: the step the line goes into — the last one that names the egg (or
 * the meat), else the last step; -1 if the recipe already has a safety line
 * or no steps.
 */
export function safetyStepIndex(steps: readonly string[], tag: UndercookedRecipe['tag']): number {
  if (steps.length === 0 || steps.some((s) => s.includes(SAFETY_PREFIX))) return -1
  const re = tag === LIQUID_YOLK_TAG ? EGG_STEP : MINCE_STEP
  for (let i = steps.length - 1; i >= 0; i--) if (re.test(steps[i])) return i
  return steps.length - 1
}

export interface UndercookedMarksResult {
  tagged: number
  stepLines: number
  /** Names of the list not found in the catalogue (drafts not imported yet…). */
  missing: string[]
}

type Db = typeof import('../db/connection.js').db

export async function applyUndercookedMarks(db: Db, log: (line: string) => void = console.log): Promise<UndercookedMarksResult> {
  const result: UndercookedMarksResult = { tagged: 0, stepLines: 0, missing: [] }
  const catalogue = await db
    .select({ id: recipes.id, name: recipes.name, internalTags: recipes.internalTags })
    .from(recipes)
    .where(isNull(recipes.authorId))
  const found = new Set<UndercookedRecipe>()
  const sourceTag = new Map<string, UndercookedRecipe['tag']>()

  for (const r of catalogue) {
    const entry = undercookedEntryFor(r)
    if (!entry) continue
    found.add(entry)
    sourceTag.set(r.id, entry.tag)
    if (!(r.internalTags ?? []).includes(entry.tag)) {
      await db.update(recipes).set({ internalTags: [...(r.internalTags ?? []), entry.tag] }).where(eq(recipes.id, r.id))
      result.tagged++
    }
    const steps = await db
      .select({ id: recipeSteps.id, text: recipeSteps.text })
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, r.id))
      .orderBy(recipeSteps.index)
    const i = safetyStepIndex(steps.map((s) => s.text), entry.tag)
    if (i >= 0) {
      await db.update(recipeSteps).set({ text: `${steps[i].text.trimEnd()} ${entry.line}` }).where(eq(recipeSteps.id, steps[i].id))
      result.stepLines++
    }
  }

  // Users' copies of them: the tag only.
  if (sourceTag.size) {
    const copies = await db
      .select({ id: recipes.id, from: recipes.copiedFromRecipeId, internalTags: recipes.internalTags })
      .from(recipes)
      .where(inArray(recipes.copiedFromRecipeId, [...sourceTag.keys()]))
    for (const c of copies) {
      const tag = c.from ? sourceTag.get(c.from) : undefined
      if (!tag || (c.internalTags ?? []).includes(tag)) continue
      await db.update(recipes).set({ internalTags: [...(c.internalTags ?? []), tag] }).where(eq(recipes.id, c.id))
      result.tagged++
    }
  }

  result.missing = UNDERCOOKED_RECIPES.filter((u) => !found.has(u)).map((u) => u.name)
  log(`[undercooked-marks] ${result.tagged} etiquetas, ${result.stepLines} líneas en los pasos; sin encontrar: ${result.missing.length ? result.missing.join(', ') : 'ninguna'}`)
  return result
}
