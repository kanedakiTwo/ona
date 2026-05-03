/**
 * Admin (ex-Curator) routes.
 *
 * Surfaces the catalog gaps a curator needs to close manually:
 *   - ingredients without USDA mapping (`fdcId IS NULL`)
 *   - missing density / unitWeight on rows that should have one
 *   - aisle === 'otros' (the catch-all bucket)
 *   - allergen suggestions (heuristic > current tags)
 *   - recipes with `nutritionPerServing.kcal` falsy + which ingredients block them
 *   - recipes missing totalTime / equipment / difficulty default
 *   - LLM regen failures / skips parsed from `apps/api/scripts/output/`
 *
 * Plus user-management + audit-log endpoints (see Task 5/6 of the
 * roles-and-dual-curator plan):
 *   - GET    /admin/users
 *   - GET    /admin/users/:id
 *   - POST   /admin/users/:id/suspend
 *   - POST   /admin/users/:id/unsuspend
 *   - POST   /admin/users/:id/reset-password-token
 *   - GET    /admin/audit-log
 *
 * Plus the catalog write endpoints (paths kept as-is, not /admin-prefixed):
 *   - PATCH /ingredients/:id            — partial update (aisle/density/unitWeight/allergenTags)
 *   - PATCH /ingredients/:id/remap      — re-fetch USDA per-100 g and refresh nutrition
 *
 * Every mutation is wrapped in a Drizzle transaction whose `tx` client is
 * passed to `auditLog.record(...)`, so an audit failure rolls back the
 * mutation it was tracking. The one exception is the USDA-fetch step in
 * `/ingredients/:id/remap`: we do the network call OUTSIDE the transaction
 * (we don't want to keep a DB tx open during a flaky 3rd-party request) and
 * then run the update + audit insert atomically.
 *
 * Spec: ../../../../specs/admin-dashboard.md, admin-audit-log.md, user-management.md
 */

import { Router } from 'express'
import { z } from 'zod'
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from 'drizzle-orm'
import path from 'path'
import { promises as fs } from 'fs'
import { db } from '../db/connection.js'
import {
  adminAuditLog,
  ingredients,
  menus,
  recipes,
  recipeIngredients,
  users,
} from '../db/schema.js'
import {
  authMiddleware,
  requireAdmin,
  type AuthRequest,
} from '../middleware/auth.js'
import { AISLES } from '@ona/shared'
import {
  inferAllergenTagsFromName,
  ALLERGEN_TAGS,
} from '../services/nutrition/allergens.js'
import { createUsdaClient } from '../services/nutrition/usdaClient.js'
import { diff, record, type AdminAction } from '../services/auditLog.js'
import { mintToken } from '../services/passwordReset.js'

const router = Router()

// ─── Heuristics ────────────────────────────────────────────────

const DENSITY_KEYWORDS = [
  'aceite',
  'leche',
  'nata',
  'vinagre',
  'caldo',
  'salsa',
  'sirope',
  'crema',
  'jarabe',
  'miel',
]

// Bulk leafy/loose produce — unit weight doesn't apply.
const BULK_PRODUCE_KEYWORDS = [
  'verde',
  'espinaca',
  'lechuga',
  'rucula',
  'rúcula',
  'acelga',
  'canónigo',
  'canonigo',
  'kale',
  'berro',
  'germinado',
  'brote',
  'hierba',
  'perejil',
  'cilantro',
  'albahaca',
  'menta',
  'romero',
  'tomillo',
]

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .trim()
}

function nameContainsAny(name: string, needles: readonly string[]): boolean {
  const n = normalize(name)
  for (const needle of needles) {
    if (n.includes(normalize(needle))) return true
  }
  return false
}

// ─── GET /admin/ingredient-gaps ───────────────────────────────

router.get(
  '/admin/ingredient-gaps',
  authMiddleware,
  requireAdmin,
  async (_req: AuthRequest, res) => {
    try {
      const all = await db.select().from(ingredients)

      const missingFdcId: Array<{
        id: string
        name: string
        aisle: string | null
        allergenTags: string[] | null
      }> = []
      const missingDensity: Array<{ id: string; name: string; aisle: string | null }> = []
      const missingUnitWeight: Array<{ id: string; name: string; aisle: string | null }> = []
      const aisleOtros: Array<{ id: string; name: string }> = []
      const allergenSuggestions: Array<{
        id: string
        name: string
        currentTags: string[]
        suggestedTags: string[]
      }> = []

      for (const row of all) {
        if (row.fdcId == null) {
          missingFdcId.push({
            id: row.id,
            name: row.name,
            aisle: row.aisle,
            allergenTags: row.allergenTags ?? [],
          })
        }

        if (row.density == null && nameContainsAny(row.name, DENSITY_KEYWORDS)) {
          missingDensity.push({ id: row.id, name: row.name, aisle: row.aisle })
        }

        if (
          row.unitWeight == null &&
          row.aisle === 'produce' &&
          !nameContainsAny(row.name, BULK_PRODUCE_KEYWORDS)
        ) {
          missingUnitWeight.push({ id: row.id, name: row.name, aisle: row.aisle })
        }

        if (row.aisle === 'otros' || row.aisle == null) {
          aisleOtros.push({ id: row.id, name: row.name })
        }

        const current = (row.allergenTags ?? []) as string[]
        const suggested = inferAllergenTagsFromName(row.name)
        const currentSet = new Set(current)
        const newOnes = suggested.filter((t) => !currentSet.has(t))
        if (newOnes.length > 0) {
          allergenSuggestions.push({
            id: row.id,
            name: row.name,
            currentTags: current,
            suggestedTags: suggested,
          })
        }
      }

      res.json({
        missingFdcId,
        missingDensity,
        missingUnitWeight,
        aisleOtros,
        allergenSuggestions,
      })
    } catch (err) {
      console.error('admin/ingredient-gaps error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

// ─── GET /admin/recipe-gaps ──────────────────────────────────

router.get(
  '/admin/recipe-gaps',
  authMiddleware,
  requireAdmin,
  async (_req: AuthRequest, res) => {
    try {
      const allRecipes = await db.select().from(recipes)

      const missingNutritionRecipes = allRecipes.filter((r) => {
        const npp = r.nutritionPerServing as { kcal?: number | null } | null
        return !npp || !npp.kcal
      })

      // For each recipe with missing nutrition, find which of its ingredients
      // are missing fdcId (those are the bottleneck).
      const recipeIds = missingNutritionRecipes.map((r) => r.id)
      const ingredientLinks = recipeIds.length
        ? await db
            .select({
              recipeId: recipeIngredients.recipeId,
              ingredientId: recipeIngredients.ingredientId,
              ingredientFdcId: ingredients.fdcId,
            })
            .from(recipeIngredients)
            .leftJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
            .where(inArray(recipeIngredients.recipeId, recipeIds))
        : []

      const blockersByRecipe = new Map<string, string[]>()
      for (const link of ingredientLinks) {
        if (link.ingredientFdcId == null) {
          const arr = blockersByRecipe.get(link.recipeId) ?? []
          arr.push(link.ingredientId)
          blockersByRecipe.set(link.recipeId, arr)
        }
      }

      const missingNutrition = missingNutritionRecipes.map((r) => {
        const npp = r.nutritionPerServing as { kcal?: number | null } | null
        return {
          id: r.id,
          name: r.name,
          kcal: npp?.kcal ?? 0,
          missingIngredientIds: blockersByRecipe.get(r.id) ?? [],
        }
      })

      const missingTotalTime = allRecipes
        .filter((r) => r.totalTime == null || r.totalTime === 0)
        .map((r) => ({ id: r.id, name: r.name }))

      const missingEquipment = allRecipes
        .filter((r) => !r.equipment || (r.equipment as string[]).length === 0)
        .map((r) => ({ id: r.id, name: r.name }))

      // Heuristic: difficulty defaulted to 'medium' is the schema default;
      // we surface it for review. (We can't tell "explicitly set to medium"
      // from "default medium" — list every 'medium' so the curator can audit.)
      const missingDifficulty = allRecipes
        .filter((r) => r.difficulty === 'medium')
        .map((r) => ({
          id: r.id,
          name: r.name,
          difficulty: r.difficulty ?? 'medium',
        }))

      res.json({
        missingNutrition,
        missingTotalTime,
        missingEquipment,
        missingDifficulty,
      })
    } catch (err) {
      console.error('admin/recipe-gaps error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

// ─── GET /admin/regen-output ─────────────────────────────────

interface RegenEntry {
  source: 'failed' | 'skipped'
  recipeName: string
  errors: Array<{ code?: string; message?: string; path?: string }>
  warnings: Array<{ code?: string; message?: string; path?: string }>
}

async function readJsonl(filePath: string, source: 'failed' | 'skipped'): Promise<RegenEntry[]> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    return []
  }
  const out: RegenEntry[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as {
        recipe?: { name?: string; _source?: { name?: string } }
        errors?: Array<{ code?: string; message?: string; path?: string }>
        warnings?: Array<{ code?: string; message?: string; path?: string }>
      }
      const recipeName =
        parsed.recipe?._source?.name ??
        parsed.recipe?.name ??
        '(sin nombre)'
      out.push({
        source,
        recipeName,
        errors: parsed.errors ?? [],
        warnings: parsed.warnings ?? [],
      })
    } catch {
      // skip malformed lines silently
    }
  }
  return out
}

router.get(
  '/admin/regen-output',
  authMiddleware,
  requireAdmin,
  async (_req: AuthRequest, res) => {
    try {
      const baseDir =
        process.env.REGEN_OUTPUT_DIR ??
        path.join(process.cwd(), 'apps/api/scripts/output')
      const failed = await readJsonl(path.join(baseDir, 'regen-failed.jsonl'), 'failed')
      const skipped = await readJsonl(path.join(baseDir, 'regen-skipped.jsonl'), 'skipped')
      res.json([...failed, ...skipped])
    } catch (err) {
      console.error('admin/regen-output error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

// ─── PATCH /ingredients/:id ────────────────────────────────────
// Whitelisted partial update for the admin dashboard.
// Other fields go through PUT /ingredients/:id (covered by updateIngredientSchema).

const patchBodySchema = z.object({
  aisle: z.enum(AISLES).nullable().optional(),
  density: z.number().positive().nullable().optional(),
  unitWeight: z.number().positive().nullable().optional(),
  allergenTags: z.array(z.enum(ALLERGEN_TAGS)).optional(),
})

router.patch(
  '/ingredients/:id',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const parsed = patchBodySchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues })
        return
      }
      const update: Record<string, unknown> = { updatedAt: new Date() }
      if ('aisle' in parsed.data) update.aisle = parsed.data.aisle
      if ('density' in parsed.data) update.density = parsed.data.density
      if ('unitWeight' in parsed.data) update.unitWeight = parsed.data.unitWeight
      if ('allergenTags' in parsed.data) update.allergenTags = parsed.data.allergenTags

      const id = String(req.params.id)
      const adminId = req.user!.id

      const updated = await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(ingredients)
          .where(eq(ingredients.id, id))
          .limit(1)
        if (!before) return null

        const [after] = await tx
          .update(ingredients)
          .set(update)
          .where(eq(ingredients.id, id))
          .returning()

        const beforeFields = {
          aisle: before.aisle,
          density: before.density,
          unitWeight: before.unitWeight,
          allergenTags: before.allergenTags,
        }
        const afterFields = {
          aisle: after.aisle,
          density: after.density,
          unitWeight: after.unitWeight,
          allergenTags: after.allergenTags,
        }
        const changes = diff(
          beforeFields as Record<string, unknown>,
          afterFields as Record<string, unknown>,
        )

        await record(
          {
            adminId,
            action: 'ingredient.update',
            targetType: 'ingredient',
            targetId: id,
            payload: changes,
          },
          tx,
        )

        return after
      })

      if (!updated) {
        res.status(404).json({ error: 'Ingredient not found' })
        return
      }
      res.json(updated)
    } catch (err) {
      console.error('PATCH /ingredients/:id error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

// ─── PATCH /ingredients/:id/remap ──────────────────────────────
// Re-map an existing ingredient to a USDA fdcId and refresh per-100 g nutrition.
// Body: { fdcId: number }. Used by the "Re-mapear a USDA" action on the dashboard.

const remapBodySchema = z.object({
  fdcId: z.number().int().positive(),
})

router.patch(
  '/ingredients/:id/remap',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const parsed = remapBodySchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues })
        return
      }
      const id = String(req.params.id)
      const adminId = req.user!.id

      // USDA fetch happens outside the tx (it's a network call; we don't want
      // to keep a DB transaction open for it).
      const [existing] = await db
        .select()
        .from(ingredients)
        .where(eq(ingredients.id, id))
        .limit(1)
      if (!existing) {
        res.status(404).json({ error: 'Ingredient not found' })
        return
      }

      const client = createUsdaClient()
      const profile = await client.fetchByFdcId(parsed.data.fdcId)

      const updated = await db.transaction(async (tx) => {
        const [after] = await tx
          .update(ingredients)
          .set({
            fdcId: parsed.data.fdcId,
            calories: profile.per100g.kcal,
            protein: profile.per100g.proteinG,
            carbs: profile.per100g.carbsG,
            fat: profile.per100g.fatG,
            fiber: profile.per100g.fiberG,
            salt: profile.per100g.saltG,
            updatedAt: new Date(),
          })
          .where(eq(ingredients.id, id))
          .returning()

        const beforeSnap = {
          fdcId: existing.fdcId,
          calories: existing.calories,
          protein: existing.protein,
          carbs: existing.carbs,
          fat: existing.fat,
          fiber: existing.fiber,
          salt: existing.salt,
        }
        const afterSnap = {
          fdcId: after.fdcId,
          calories: after.calories,
          protein: after.protein,
          carbs: after.carbs,
          fat: after.fat,
          fiber: after.fiber,
          salt: after.salt,
        }

        await record(
          {
            adminId,
            action: 'ingredient.remap',
            targetType: 'ingredient',
            targetId: id,
            payload: { before: beforeSnap, after: afterSnap },
          },
          tx,
        )

        return after
      })

      res.json(updated)
    } catch (err) {
      console.error('PATCH /ingredients/:id/remap error:', err)
      const status = (err as { status?: number })?.status === 429 ? 429 : 500
      res.status(status).json({
        error:
          status === 429
            ? 'USDA rate limit exceeded; try again shortly.'
            : 'Internal server error',
      })
    }
  },
)

// ════════════════════════════════════════════════════════════════
// Audit log
// ════════════════════════════════════════════════════════════════

const auditLogQuerySchema = z.object({
  adminId: z.string().uuid().optional(),
  action: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().optional(),
  perPage: z.coerce.number().int().positive().max(200).optional(),
})

router.get(
  '/admin/audit-log',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const parsed = auditLogQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: 'Invalid query', issues: parsed.error.issues })
        return
      }
      const page = parsed.data.page ?? 1
      const perPage = parsed.data.perPage ?? 50

      const conditions = []
      if (parsed.data.adminId) {
        conditions.push(eq(adminAuditLog.adminId, parsed.data.adminId))
      }
      if (parsed.data.action) {
        conditions.push(eq(adminAuditLog.action, parsed.data.action))
      }
      if (parsed.data.from) {
        conditions.push(gte(adminAuditLog.createdAt, new Date(parsed.data.from)))
      }
      if (parsed.data.to) {
        conditions.push(lte(adminAuditLog.createdAt, new Date(parsed.data.to)))
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const [{ total }] = await db
        .select({ total: count() })
        .from(adminAuditLog)
        .where(whereClause)

      const rows = await db
        .select({
          id: adminAuditLog.id,
          adminId: adminAuditLog.adminId,
          adminUsername: users.username,
          adminEmail: users.email,
          action: adminAuditLog.action,
          targetType: adminAuditLog.targetType,
          targetId: adminAuditLog.targetId,
          payload: adminAuditLog.payload,
          createdAt: adminAuditLog.createdAt,
        })
        .from(adminAuditLog)
        .leftJoin(users, eq(adminAuditLog.adminId, users.id))
        .where(whereClause)
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(perPage)
        .offset((page - 1) * perPage)

      res.json({ rows, total: Number(total), page, perPage })
    } catch (err) {
      console.error('GET /admin/audit-log error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

// ════════════════════════════════════════════════════════════════
// User management
// ════════════════════════════════════════════════════════════════

const usersListQuerySchema = z.object({
  search: z.string().min(1).optional(),
  suspended: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  page: z.coerce.number().int().positive().optional(),
  perPage: z.coerce.number().int().positive().max(200).optional(),
})

router.get(
  '/admin/users',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const parsed = usersListQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: 'Invalid query', issues: parsed.error.issues })
        return
      }
      const page = parsed.data.page ?? 1
      const perPage = parsed.data.perPage ?? 25

      const conditions = []
      if (parsed.data.search) {
        const like = `%${parsed.data.search}%`
        conditions.push(or(ilike(users.username, like), ilike(users.email, like)))
      }
      if (parsed.data.suspended === true) {
        conditions.push(isNotNull(users.suspendedAt))
      } else if (parsed.data.suspended === false) {
        conditions.push(isNull(users.suspendedAt))
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const [{ total }] = await db
        .select({ total: count() })
        .from(users)
        .where(whereClause)

      const rows = await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          role: users.role,
          suspendedAt: users.suspendedAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(whereClause)
        .orderBy(desc(users.createdAt))
        .limit(perPage)
        .offset((page - 1) * perPage)

      // TODO: `lastLoginAt` is not yet tracked in schema. Returning null until
      // we add a `users.last_login_at` column (separate migration).
      const enriched = rows.map((r) => ({ ...r, lastLoginAt: null as Date | null }))

      res.json({ rows: enriched, total: Number(total), page, perPage })
    } catch (err) {
      console.error('GET /admin/users error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

const userIdParamSchema = z.object({ id: z.string().uuid() })

router.get(
  '/admin/users/:id',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const parsed = userIdParamSchema.safeParse(req.params)
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid id' })
        return
      }
      const id = parsed.data.id

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1)
      if (!user) {
        res.status(404).json({ error: 'User not found' })
        return
      }

      const [recetasCount] = await db
        .select({ c: count() })
        .from(recipes)
        .where(eq(recipes.authorId, id))
      const [menusCount] = await db
        .select({ c: count() })
        .from(menus)
        .where(eq(menus.userId, id))

      const { passwordHash: _ph, ...rest } = user
      res.json({
        ...rest,
        // TODO: `lastLoginAt` not tracked in schema yet; add once we record it.
        lastLoginAt: null,
        recetasCreadas: Number(recetasCount?.c ?? 0),
        menusGenerados: Number(menusCount?.c ?? 0),
      })
    } catch (err) {
      console.error('GET /admin/users/:id error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

router.post(
  '/admin/users/:id/suspend',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const parsed = userIdParamSchema.safeParse(req.params)
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid id' })
        return
      }
      const id = parsed.data.id
      const adminId = req.user!.id

      if (id === adminId) {
        res.status(400).json({
          error: 'No puedes suspender tu propia cuenta.',
          code: 'CANNOT_SELF_SUSPEND',
        })
        return
      }

      const updated = await db.transaction(async (tx) => {
        const [before] = await tx
          .select({ id: users.id, suspendedAt: users.suspendedAt })
          .from(users)
          .where(eq(users.id, id))
          .limit(1)
        if (!before) return null

        const now = new Date()
        const [after] = await tx
          .update(users)
          .set({ suspendedAt: now })
          .where(eq(users.id, id))
          .returning({ id: users.id, suspendedAt: users.suspendedAt })

        await record(
          {
            adminId,
            action: 'user.suspend',
            targetType: 'user',
            targetId: id,
            payload: {
              before: { suspendedAt: before.suspendedAt },
              after: { suspendedAt: after.suspendedAt },
            },
          },
          tx,
        )

        return after
      })

      if (!updated) {
        res.status(404).json({ error: 'User not found' })
        return
      }
      res.json({ ok: true, suspendedAt: updated.suspendedAt })
    } catch (err) {
      console.error('POST /admin/users/:id/suspend error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

router.post(
  '/admin/users/:id/unsuspend',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const parsed = userIdParamSchema.safeParse(req.params)
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid id' })
        return
      }
      const id = parsed.data.id
      const adminId = req.user!.id

      const updated = await db.transaction(async (tx) => {
        const [before] = await tx
          .select({ id: users.id, suspendedAt: users.suspendedAt })
          .from(users)
          .where(eq(users.id, id))
          .limit(1)
        if (!before) return null

        const [after] = await tx
          .update(users)
          .set({ suspendedAt: null })
          .where(eq(users.id, id))
          .returning({ id: users.id, suspendedAt: users.suspendedAt })

        await record(
          {
            adminId,
            action: 'user.unsuspend',
            targetType: 'user',
            targetId: id,
            payload: {
              before: { suspendedAt: before.suspendedAt },
              after: { suspendedAt: after.suspendedAt },
            },
          },
          tx,
        )

        return after
      })

      if (!updated) {
        res.status(404).json({ error: 'User not found' })
        return
      }
      res.json({ ok: true, suspendedAt: updated.suspendedAt })
    } catch (err) {
      console.error('POST /admin/users/:id/unsuspend error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

router.post(
  '/admin/users/:id/reset-password-token',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const parsed = userIdParamSchema.safeParse(req.params)
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid id' })
        return
      }
      const id = parsed.data.id
      const adminId = req.user!.id

      const [exists] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id))
        .limit(1)
      if (!exists) {
        res.status(404).json({ error: 'User not found' })
        return
      }

      const result = await db.transaction(async (tx) => {
        const minted = await mintToken(id, tx)
        await record(
          {
            adminId,
            action: 'user.reset_password.generate',
            targetType: 'user',
            targetId: id,
            payload: {
              token_id: minted.id,
              expires_at: minted.expiresAt.toISOString(),
            },
          },
          tx,
        )
        return minted
      })

      res.json({
        token: result.token,
        link: result.link,
        expires_at: result.expiresAt.toISOString(),
      })
    } catch (err) {
      console.error('POST /admin/users/:id/reset-password-token error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

// Re-export `AdminAction` so consumers (e.g. tests) can import it from the
// route module if convenient.
export type { AdminAction }

export default router
