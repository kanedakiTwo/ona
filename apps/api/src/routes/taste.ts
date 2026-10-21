/**
 * «Afina tu menú» (PRO-146, specs/taste.md).
 *
 *   GET    /taste/next?limit=10&exclude=<ids>&avoid=carne,pescado
 *            → next cards: the starter deck first, then Claude's pick
 *              (variety order when it fails or is slow)
 *   POST   /taste                { recipeId, verdict, reason? } → upsert (idempotent)
 *   DELETE /taste/:recipeId       → forget one verdict («Lo que recuerdo de ti»)
 *   GET    /taste/status          → rated / total / offers / flags
 *   GET    /taste/verdicts        → every verdict with name and photo
 *   POST   /taste/offers          { event } → stamp an offer (never repeats)
 *   POST   /taste/flags           { group } → «No coméis carne?» to confirm later
 *
 * Per-route auth (no catch-all), mounted before the catch-all routers.
 */
import { Router } from 'express'
import { z } from 'zod'
import { TASTE_BATCH_SIZE, TASTE_PROTEIN_GROUPS, tasteVerdictSchema, type TasteNextResponse, type TasteProteinGroup } from '@ona/shared'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { candidatePool, starterBatch, toCard, varietyBatch, varietyOrder, type TasteRecipe } from '../services/tasteDeck.js'
import { analyseTasteReason, pickNextWithClaude, type TasteMemoryFact } from '../services/tasteAI.js'
import {
  applyTasteFacts,
  deleteVerdict,
  listVerdictRows,
  listVerdicts,
  loadTasteCatalog,
  patchTasteState,
  getTasteState,
  recipeExists,
  saveVerdict,
  tasteRoundEnded,
  tasteStatus,
  verdictCount,
} from '../services/tasteStore.js'
import { refineHouseholdSoon } from '../services/profile/refiner.js'
import { getMemoryForUser } from '../services/userMemoryStore.js'

const router = Router()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function idList(q: unknown): Set<string> {
  return new Set(String(q ?? '').split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s)))
}

/**
 * The next batch. Pure orchestration over the store and the model, exported
 * for the unit tests (`pick` is the model: Claude in production, a fake in tests).
 */
export async function nextBatch(input: {
  catalog: readonly TasteRecipe[]
  verdicts: ReadonlyArray<{ recipeId: string; verdict: string; reason?: unknown }>
  excludeIds: ReadonlySet<string>
  avoid: ReadonlySet<TasteProteinGroup>
  limit: number
  dislikes?: readonly string[]
  pick: typeof pickNextWithClaude
}): Promise<{ recipes: TasteRecipe[]; source: TasteNextResponse['source'] }> {
  const byId = new Map(input.catalog.map((r) => [r.id, r]))
  const ratedIds = new Set(input.verdicts.map((v) => v.recipeId))
  const history = input.verdicts.map((v) => byId.get(v.recipeId)).filter((r): r is TasteRecipe => Boolean(r))
  const base = { catalog: input.catalog, ratedIds, excludeIds: input.excludeIds, avoid: input.avoid, history, limit: input.limit }

  const starter = starterBatch(base)
  if (starter) return { recipes: starter, source: 'starter' }

  const pool = candidatePool(base)
  if (pool.length === 0) return { recipes: [], source: 'variety' }
  const ordered = varietyOrder(pool, history)
  const answered = input.verdicts
    .map((v) => {
      const recipe = byId.get(v.recipeId)
      const reason = v.reason && typeof v.reason === 'object' ? (v.reason as { kind?: string; text?: string }) : null
      const why = reason?.text ? reason.text : reason?.kind === 'long' ? 'es muy largo' : reason?.kind === 'dish' ? 'el plato en sí' : null
      return recipe ? { recipe, verdict: v.verdict, reason: why } : null
    })
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
  const ids = await input.pick({ candidates: ordered, answered, dislikes: input.dislikes, limit: input.limit }).catch(() => null)
  if (ids && ids.length > 0) {
    const picked = ids.map((id) => byId.get(id)).filter((r): r is TasteRecipe => Boolean(r))
    const fill = ordered.filter((r) => !picked.includes(r)).slice(0, Math.max(0, input.limit - picked.length))
    return { recipes: [...picked, ...fill].slice(0, input.limit), source: 'ai' }
  }
  return { recipes: varietyBatch(base), source: 'variety' }
}

router.get('/taste/next', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!
    const limit = Math.max(1, Math.min(20, Number(req.query.limit) || TASTE_BATCH_SIZE))
    const avoid = new Set(
      String(req.query.avoid ?? '')
        .split(',')
        .filter((g): g is TasteProteinGroup => (TASTE_PROTEIN_GROUPS as readonly string[]).includes(g)),
    )
    const [catalog, verdicts, memory] = await Promise.all([
      loadTasteCatalog(userId),
      listVerdicts(userId),
      getMemoryForUser(userId).catch(() => ({}) as Record<string, never>),
    ])
    const dislikesValue = (memory as { dislikes?: { value?: unknown } }).dislikes?.value
    const { recipes, source } = await nextBatch({
      catalog,
      verdicts,
      excludeIds: idList(req.query.exclude),
      avoid,
      limit,
      dislikes: Array.isArray(dislikesValue) ? (dislikesValue as string[]) : [],
      pick: pickNextWithClaude,
    })
    const catalogIds = new Set(catalog.map((r) => r.id))
    const body: TasteNextResponse = {
      cards: recipes.map(toCard),
      source,
      rated: verdicts.filter((v) => v.verdict !== 'skip' && catalogIds.has(v.recipeId)).length,
      total: catalog.length,
    }
    res.json(body)
  } catch (err) {
    console.error('[taste] next error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/taste', authMiddleware, validate(tasteVerdictSchema), async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!
    const { recipeId, verdict, reason } = req.body as z.infer<typeof tasteVerdictSchema>
    const recipe = await recipeExists(recipeId)
    if (!recipe) {
      res.status(404).json({ error: 'Recipe not found' })
      return
    }
    await saveVerdict(userId, { recipeId, verdict, reason: reason ?? null })
    // «¿Qué es lo que no?»: an ingredient goes to dislikes; the free text is
    // read like Mimo's update_memory (Claude, or plain rules without it).
    let facts: TasteMemoryFact[] = []
    if (verdict === 'nope' && reason?.text) {
      if (reason.kind === 'ingredient') facts = [{ key: 'dislikes', value: [reason.text.toLowerCase()] }]
      else if (reason.kind === 'other') facts = await analyseTasteReason(reason.text, recipe.name)
    }
    try {
      await applyTasteFacts(userId, facts)
    } catch (err) {
      console.warn('[taste] memory write failed (verdict kept):', err)
      facts = []
    }
    res.json({ ok: true, facts })
    // PRO-320: a round of 10 just ended → a pass of the ficha's refiner at the moment (background).
    void Promise.resolve()
      .then(() => verdictCount(userId))
      .then((n) => (tasteRoundEnded(n, TASTE_BATCH_SIZE) ? refineHouseholdSoon(userId, 'afina') : undefined))
      .catch(() => undefined)
  } catch (err) {
    console.error('[taste] save error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/taste/:recipeId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const recipeId = String(req.params.recipeId)
    if (!UUID_RE.test(recipeId)) {
      res.status(400).json({ error: 'Invalid recipe id' })
      return
    }
    await deleteVerdict(req.userId!, recipeId)
    res.status(204).send()
  } catch (err) {
    console.error('[taste] delete error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/taste/status', authMiddleware, async (req: AuthRequest, res) => {
  try {
    res.json(await tasteStatus(req.userId!))
  } catch (err) {
    console.error('[taste] status error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/taste/verdicts', authMiddleware, async (req: AuthRequest, res) => {
  try {
    res.json({ verdicts: await listVerdictRows(req.userId!) })
  } catch (err) {
    console.error('[taste] verdicts error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export const tasteOfferSchema = z.object({
  /** intro_start / intro_later: the «Novedad» screen; card_dismiss: «Ahora no» on the card; onboarding: the sign-up step was shown. */
  event: z.enum(['intro_start', 'intro_later', 'card_dismiss', 'onboarding']),
})

router.post('/taste/offers', authMiddleware, validate(tasteOfferSchema), async (req: AuthRequest, res) => {
  try {
    const now = new Date().toISOString()
    const event = (req.body as z.infer<typeof tasteOfferSchema>).event
    const patch =
      event === 'intro_start'
        ? { introAt: now, introChoice: 'start' as const }
        : event === 'intro_later'
          ? { introAt: now, introChoice: 'later' as const }
          : event === 'card_dismiss'
            ? { cardDismissedAt: now }
            : { onboardingAt: now }
    await patchTasteState(req.userId!, patch)
    res.json({ ok: true })
  } catch (err) {
    console.error('[taste] offer error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

const flagSchema = z.object({ group: z.enum(TASTE_PROTEIN_GROUPS) })

router.post('/taste/flags', authMiddleware, validate(flagSchema), async (req: AuthRequest, res) => {
  try {
    const { group } = req.body as z.infer<typeof flagSchema>
    const { state } = await getTasteState(req.userId!)
    const flags = Array.from(new Set([...(state.flags ?? []), group]))
    await patchTasteState(req.userId!, { flags })
    res.json({ ok: true, flags })
  } catch (err) {
    console.error('[taste] flag error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
