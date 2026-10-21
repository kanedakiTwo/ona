/**
 * Database side of the catalogue import (PRO-154, specs/catalog-import.md):
 * the real `CatalogImportDeps` and the batch commands (sample, review,
 * publish). The orchestration and the rules live in catalogImport.ts.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Unit } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { ingredients, recipes, type CatalogSourceInfo } from '../db/schema.js'
import { matchIngredients } from './recipeExtractor.js'
import { persistRecipe } from './recipePersistence.js'
import { applyCatalogTimeTrim } from './recipeTimeTrim.js'
import { markWishesCovered } from './catalogWishes.js'
import { DRAFT, PUBLISHED } from './recipeVisibility.js'
import { catalogSourceRecord, planBatchPublish, reviewDecision, type BatchRecipe, type CatalogImportDeps, type CatalogRewrite, type CatalogDraftInput, type DraftIngredient, type MatchedIngredient, type PersistDraftInput } from './catalogImport.js'

type Db = typeof defaultDb
/** The database or a transaction on it (the admin page publishes and audits in one). */
type DbOrTx = Pick<Db, 'select' | 'update'>

/** Every catalogue name, drafts included (a draft is already «in» for duplicates). */
export async function allCatalogNames(db: Db = defaultDb): Promise<string[]> {
  const rows = await db.select({ name: recipes.name }).from(recipes).where(isNull(recipes.authorId))
  return rows.map((r) => r.name)
}

/** Match by name (token match → AI → new ingredient created) + weights for the audit. */
export async function matchDraftIngredients(recipeName: string, ings: DraftIngredient[], db: Db = defaultDb): Promise<MatchedIngredient[]> {
  const { matched } = await matchIngredients(
    ings.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit })),
    { recipeName },
  )
  const ids = matched.map((m) => m.ingredientId).filter((x): x is string => !!x)
  const info = ids.length
    ? await db.select({ id: ingredients.id, name: ingredients.name, unitWeight: ingredients.unitWeight, density: ingredients.density, edibleFraction: ingredients.edibleFraction }).from(ingredients).where(inArray(ingredients.id, ids))
    : []
  const byId = new Map(info.map((r) => [r.id, r]))
  return matched.map((m, i) => {
    const row = m.ingredientId ? byId.get(m.ingredientId) : undefined
    // «al gusto» / «pizca» keep their unit; matchIngredients only knows the canonical ones.
    const unit = (ings[i].unit === 'al_gusto' || ings[i].unit === 'pizca' ? ings[i].unit : m.unit) as Unit
    return {
      ingredientId: m.ingredientId,
      name: row?.name ?? m.ingredientName ?? ings[i].name,
      quantity: m.quantity,
      unit,
      unitWeight: row?.unitWeight ?? null,
      edibleFraction: row?.edibleFraction ?? null,
      density: row?.density ?? null,
    }
  })
}

/**
 * Save as a draft. The row is created as `draft` first and then filled by
 * `persistRecipe` in update mode, so the recipe is never visible, not even
 * for a moment. Reviewer (lint) errors → the empty row is removed.
 */
export async function persistCatalogDraft(input: PersistDraftInput, db: Db = defaultDb): Promise<{ ok: true; recipeId: string } | { ok: false; errors: string[] }> {
  const catalogSource = catalogSourceRecord(input.catalogSource)
  const [row] = await db
    .insert(recipes)
    .values({ name: input.name, servings: input.servings, authorId: null, status: DRAFT, importBatch: input.catalogSource.batch, catalogSource })
    .returning({ id: recipes.id })
  try {
    const res = await persistRecipe(
      {
        name: input.name,
        servings: input.servings,
        servingsConfidence: 'explicit',
        prepTime: input.prepTime,
        cookTime: input.cookTime,
        difficulty: input.difficulty,
        meals: input.meals,
        seasons: input.seasons,
        course: input.course,
        equipment: input.equipment,
        tags: input.tags,
        internalTags: input.internalTags,
        tips: input.tips,
        ingredients: input.ingredients,
        steps: input.steps,
      },
      { authorId: null, recipeId: row.id },
    )
    if (!res.ok) {
      await db.delete(recipes).where(eq(recipes.id, row.id))
      return { ok: false, errors: res.errors.map((e) => e.message) }
    }
    // PRO-284: the same total rule as the boot fix (prep done while the
    // oven or the pot go by themselves); the rewriter's prep is already
    // realistic, so it is not cut again.
    await applyCatalogTimeTrim(db, console.log, { ids: [row.id], trimPrep: false })
    return { ok: true, recipeId: row.id }
  } catch (err) {
    await db.delete(recipes).where(eq(recipes.id, row.id))
    throw err
  }
}

export function createDbCatalogImportDeps(
  rewrite: (draft: CatalogDraftInput, opts: { avoidPhrases?: string[] }) => Promise<CatalogRewrite>,
  log?: (line: string) => void,
): CatalogImportDeps {
  return {
    catalogNames: () => allCatalogNames(),
    rewrite,
    matchIngredients: (name, ings) => matchDraftIngredients(name, ings),
    persistDraft: (input) => persistCatalogDraft(input),
    log,
  }
}

// ─── Batch commands ─────────────────────────────────────────────

export async function loadBatch(batch: string, db: Pick<Db, 'select'> = defaultDb): Promise<BatchRecipe[]> {
  const rows = await db
    .select({ id: recipes.id, name: recipes.name, status: recipes.status, catalogSource: recipes.catalogSource, imageUrl: recipes.imageUrl })
    .from(recipes)
    .where(and(eq(recipes.importBatch, batch), isNull(recipes.authorId)))
  return rows.map((r) => {
    const s = (r.catalogSource ?? {}) as Partial<CatalogSourceInfo>
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      origin: s.origin === 'miguel' ? 'miguel' : 'cocina',
      auditIssues: s.auditIssues ?? [],
      allergenDoubt: !!s.allergenDoubt,
      sampled: !!s.sampled,
      reviewOk: typeof s.reviewOk === 'boolean' ? s.reviewOk : undefined,
      hasPhoto: !!r.imageUrl,
    }
  })
}

async function patchSource(ids: readonly string[], patch: Partial<CatalogSourceInfo>, db: DbOrTx): Promise<void> {
  if (ids.length === 0) return
  const rows = await db.select({ id: recipes.id, catalogSource: recipes.catalogSource }).from(recipes).where(inArray(recipes.id, [...ids]))
  for (const r of rows) {
    await db.update(recipes).set({ catalogSource: { ...(r.catalogSource as CatalogSourceInfo), ...patch } }).where(eq(recipes.id, r.id))
  }
}

/**
 * Mark the drafts handed to Miguel for review (D-099: all of them). Verdicts
 * already given are kept, so running `sample` again never undoes a review.
 */
export async function saveSample(ids: readonly string[], db: DbOrTx = defaultDb): Promise<void> {
  await patchSource(ids, { sampled: true }, db)
}

export async function saveReview(ids: readonly string[], ok: boolean, db: DbOrTx = defaultDb): Promise<void> {
  await patchSource(ids, { reviewOk: ok, reviewedAt: new Date().toISOString() }, db)
}

/** Publish these drafts and close the wishes they now cover. */
export async function publishRecipes(ids: readonly string[], db: DbOrTx = defaultDb): Promise<{ published: number; wishesCovered: number }> {
  if (ids.length === 0) return { published: 0, wishesCovered: 0 }
  const done = await db
    .update(recipes)
    .set({ status: PUBLISHED, updatedAt: new Date() })
    .where(and(inArray(recipes.id, [...ids]), eq(recipes.status, DRAFT), isNull(recipes.authorId)))
    .returning({ id: recipes.id, name: recipes.name })
  const wishesCovered = await markWishesCovered(done, db)
  return { published: done.length, wishesCovered }
}

/**
 * Called by catalogPhotos.ts once a draft has its photo: if its publish was
 * waiting for it (`publishWhenPhoto`), it goes out now — when the rule still
 * allows it (Miguel may have said «no» or the audit may hold it since). The
 * flag is cleared either way once the photo is there. True when published.
 */
export async function publishIfWaitingForPhoto(id: string, db: Db = defaultDb): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: recipes.status, imageUrl: recipes.imageUrl, catalogSource: recipes.catalogSource })
      .from(recipes)
      .where(and(eq(recipes.id, id), isNull(recipes.authorId)))
      .for('update')
    if (!row || row.status !== DRAFT || !row.imageUrl) return false
    const s = (row.catalogSource ?? {}) as Partial<CatalogSourceInfo>
    if (!s.publishWhenPhoto) return false
    const { publishWhenPhoto: _waiting, ...rest } = s
    await tx.update(recipes).set({ catalogSource: rest as CatalogSourceInfo }).where(eq(recipes.id, id))
    const decision = reviewDecision({
      origin: s.origin === 'miguel' ? 'miguel' : 'cocina',
      auditIssues: s.auditIssues ?? [],
      reviewOk: typeof s.reviewOk === 'boolean' ? s.reviewOk : undefined,
      hasPhoto: true,
    })
    if (decision !== 'publicable') return false
    return (await publishRecipes([id], tx)).published > 0
  })
}

/**
 * Publishing was asked for, but the photo isn't made yet: catalogPhotos.ts
 * publishes these as soon as it saves their photo.
 */
export async function markPublishWhenPhoto(ids: readonly string[], db: DbOrTx = defaultDb): Promise<void> {
  await patchSource(ids, { publishWhenPhoto: true }, db)
}

/**
 * `publish --batch=…` and the admin page's «Publicar las aprobadas»: what the
 * rule allows (`planBatchPublish`) goes out; the rest waits, with its reason.
 * The ones waiting only for their photo go out by themselves when it lands.
 */
export async function publishBatch(
  batch: string,
  opts: { dryRun?: boolean } = {},
  db: DbOrTx = defaultDb,
): Promise<{ plan: ReturnType<typeof planBatchPublish>; published: number; wishesCovered: number }> {
  const plan = planBatchPublish(await loadBatch(batch, db))
  if (opts.dryRun) return { plan, published: 0, wishesCovered: 0 }
  await markPublishWhenPhoto(plan.hold.filter((h) => h.reason === 'sin_foto').map((h) => h.id), db)
  return { plan, ...(await publishRecipes(plan.publish, db)) }
}
