/**
 * «El menú dice cuánto ha acertado» (PRO-155, specs/menus.md → Acierto).
 *
 * Right after a week is generated (web `POST /menu/generate`, Mimo's
 * `generate_weekly_menu` / `complete_onboarding`), one small Claude Haiku
 * call compares the week with what we know the household likes — the
 * favourite dishes it told us and its «Me encanta» — and answers:
 *   - `score` 0–100 and its level (alto ≥ 70, medio ≥ 40, bajo);
 *   - which liked things the week has, and with which recipe;
 *   - which it doesn't and why: **no está en el catálogo** (we have nothing
 *     like it) or **no cabía esta semana** (we have it, it didn't come out).
 *
 * The model judges what words can't («cremas y sopas» is met by «Crema de
 * calabaza»). The reason is checked by hand afterwards: when a recipe of
 * the catalogue covers every word of the dish (`catalogCoversDish`), it's
 * never «no está en el catálogo». Missing favourites become «deseos del
 * catálogo» (PRO-154, source `evaluador`).
 *
 * Best effort, always: no key, an error, a slow or garbled answer → null,
 * the menu goes out the same and nothing is shown. Billed to the household
 * through the cost ledger (feature `menu_fit`).
 */
import Anthropic from '@anthropic-ai/sdk'
import { and, eq, sql } from 'drizzle-orm'
import { menuFitLevel, type DayMenu, type MenuFit, type MenuFitMissReason, type RecipeAddMethod } from '@ona/shared'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { menus, recipes, recipeVerdicts, users } from '../db/schema.js'
import { recordAnthropicCost } from './costLedger.js'
import { catalogCoversDish, publishedCatalogNames, recordCatalogWish, wishWords } from './catalogWishes.js'
import { CLAUDE_MODEL, LOW_EFFORT, withThinkingRoom } from '../config/models.js'

type Db = typeof defaultDb

export const MENU_FIT_MODEL = CLAUDE_MODEL
export const MENU_FIT_FEATURE = 'menu_fit'
/** The user is waiting for the menu: past this it goes out without the line. */
export const MENU_FIT_TIMEOUT_MS = 12000
/** Caps that keep the call small. */
const MAX_PREFERENCES = 20
const MAX_CANDIDATES = 8

type CreateFn = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Pick<Anthropic.Message, 'content' | 'usage'>>

let testCreate: CreateFn | null = null
/** Test seam: a fake model for every call (null restores the real one). */
export function setMenuFitModelForTests(fake: CreateFn | null): void {
  testCreate = fake
}

function modelCreate(explicit?: CreateFn): CreateFn | null {
  if (explicit) return explicit
  if (testCreate) return testCreate
  if (!env.ANTHROPIC_API_KEY) return null
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return (p) => client.messages.create(p)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
}

// ─── Pure ───────────────────────────────────────────────────────

/** A liked thing: a dish they told us (`plato`) or a recipe they marked «Me encanta». */
export interface FitPreference {
  text: string
  source: 'plato' | 'me_encanta'
}

export interface FitInput {
  preferences: FitPreference[]
  /** Recipe names of the generated week (repeats out). */
  menuRecipes: string[]
  /** Everything the generator could have picked: catalogue + own recipes. */
  catalogNames: string[]
  unusedAddMethods: RecipeAddMethod[]
}

/** Pure: unique recipe names of a week, in order. */
export function menuRecipeNames(days: readonly DayMenu[] | null | undefined): string[] {
  const out: string[] = []
  for (const day of days ?? []) {
    for (const slot of Object.values(day ?? {})) {
      for (const d of (slot?.dishes ?? []) as Array<{ kind?: string; recipeName?: string }>) {
        const name = d?.kind === 'recipe' ? d.recipeName?.trim() : undefined
        if (name && !out.includes(name)) out.push(name)
      }
    }
  }
  return out
}

/** Pure: catalogue recipes sharing a significant word with the dish (what the model checks against). */
export function candidateRecipes(dish: string, catalogNames: readonly string[], limit = MAX_CANDIDATES): string[] {
  const words = wishWords(dish)
  if (words.length === 0) return []
  // Loose on purpose (the model decides): a prefix is enough, because the
  // stemmer turns «sopas» into «sop» but leaves «sopa» as it is.
  const same = (a: string, b: string) => a.startsWith(b) || b.startsWith(a)
  const scored = catalogNames
    .map((name) => ({ name, hits: wishWords(name).filter((w) => words.some((d) => same(w, d))).length }))
    .filter((c) => c.hits > 0)
    .sort((a, b) => b.hits - a.hits)
  return [...new Set(scored.map((c) => c.name))].slice(0, limit)
}

export const FIT_SYSTEM = `Ayudas a Mimoia, un planificador de menús semanales para hogares en España. Acabamos de generar el menú de la semana de un hogar y quieres saber cuánto se acerca a lo que le gusta.

Te paso lo que sabemos que le gusta (platos que nos dijo y recetas que marcó «Me encanta»), las recetas del menú de esta semana y, para cada gusto, las recetas parecidas que hay en el catálogo.

Para cada gusto decide:
- "si": el menú tiene ese plato o uno que lo cumple de verdad («cremas y sopas» lo cumple una crema de calabaza; «pastel de carne» NO lo cumple una menestra con carne: compartir un ingrediente no basta). Di qué receta del menú.
- "no_cabia": el menú no lo tiene, pero en las recetas parecidas del catálogo hay una que lo cumple.
- "no_catalogo": ni el menú ni el catálogo tienen nada que lo cumpla.

Después da un "acierto" de 0 a 100: cuánto se parece el menú, en conjunto, a lo que le gusta (0 = nada de lo que le gusta; 100 = está casi todo). Sé exigente: un menú sin ninguno de sus platos es un acierto bajo aunque sea sano.

Devuelve SOLO JSON, sin markdown:
{"acierto": número, "gustos": [{"n": número del gusto, "estado": "si" | "no_cabia" | "no_catalogo", "receta": "nombre exacto de la receta del menú o null"}]}`

/** Pure: the user message for the model. */
export function buildFitPrompt(input: FitInput): string {
  const prefs = input.preferences
    .map((p, i) => {
      const cands = p.source === 'me_encanta' ? [p.text] : candidateRecipes(p.text, input.catalogNames)
      const tag = p.source === 'me_encanta' ? ' (receta que marcó «Me encanta»)' : ''
      return `${i + 1}. ${p.text}${tag}\n   Parecidas en el catálogo: ${cands.length ? cands.join('; ') : 'ninguna'}`
    })
    .join('\n')
  return `Lo que le gusta:\n${prefs}\n\nMenú de esta semana:\n${input.menuRecipes.map((r) => `- ${r}`).join('\n') || '- (vacío)'}`
}

/**
 * Pure: the model's answer → MenuFit, or null when it's unusable. Every
 * preference gets an answer (one the model skipped counts as not met). A
 * dish the catalogue covers word for word is never «no está en el
 * catálogo», and a «Me encanta» is a recipe we have by definition.
 */
export function normalizeFit(raw: unknown, input: FitInput, now: Date = new Date()): MenuFit | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { acierto?: unknown; gustos?: unknown }
  if (!Array.isArray(r.gustos)) return null
  const byIndex = new Map<number, { estado: string; receta: string | null }>()
  for (const g of r.gustos as Array<Record<string, unknown>>) {
    const n = Number(g?.n)
    if (!Number.isInteger(n) || n < 1 || n > input.preferences.length || byIndex.has(n)) continue
    byIndex.set(n, { estado: String(g?.estado ?? ''), receta: typeof g?.receta === 'string' && g.receta.trim() ? g.receta.trim() : null })
  }
  if (byIndex.size === 0) return null

  const known = [...input.catalogNames, ...input.menuRecipes]
  const met: MenuFit['met'] = []
  const missed: MenuFit['missed'] = []
  input.preferences.forEach((p, i) => {
    const a = byIndex.get(i + 1)
    if (a?.estado === 'si') {
      met.push({ preference: p.text, recipe: a.receta && input.menuRecipes.includes(a.receta) ? a.receta : null })
      return
    }
    let reason: MenuFitMissReason = a?.estado === 'no_cabia' ? 'no_cabia' : 'no_catalogo'
    if (p.source === 'me_encanta' || catalogCoversDish(p.text, known)) reason = 'no_cabia'
    missed.push({ preference: p.text, reason })
  })

  const ratio = Math.round((met.length / input.preferences.length) * 100)
  const said = Number(r.acierto)
  const score = Number.isFinite(said) ? Math.max(0, Math.min(100, Math.round(said))) : ratio
  return { score, level: menuFitLevel(score), met, missed, unusedAddMethods: [...input.unusedAddMethods], evaluatedAt: now.toISOString() }
}

/** Claude's verdict on a week, or null (no key, nothing to compare, error, timeout, garbage). */
export async function evaluateMenuFit(
  input: FitInput,
  deps: { create?: CreateFn; timeoutMs?: number; userId?: string | null; now?: Date } = {},
): Promise<MenuFit | null> {
  const create = modelCreate(deps.create)
  if (!create || input.preferences.length === 0 || input.menuRecipes.length === 0) return null
  try {
    const response = await withTimeout(
      create({
        model: MENU_FIT_MODEL,
        max_tokens: withThinkingRoom(900),
        ...LOW_EFFORT,
        system: FIT_SYSTEM,
        messages: [{ role: 'user', content: buildFitPrompt(input) }],
      }),
      deps.timeoutMs ?? MENU_FIT_TIMEOUT_MS,
    )
    recordAnthropicCost(MENU_FIT_FEATURE, MENU_FIT_MODEL, response.usage, deps.userId)
    const block = response.content.find((b) => b.type === 'text')
    const text = block && block.type === 'text' ? block.text : ''
    return normalizeFit(extractJson(text), input, deps.now)
  } catch (err) {
    console.warn('[menuFit] evaluation failed (menu goes out without it):', (err as Error)?.message ?? err)
    return null
  }
}

const METHOD_LABEL: Record<RecipeAddMethod, string> = {
  foto: 'mandarme una foto de la receta',
  enlace: 'pasarme el enlace de una receta (web, YouTube, Instagram)',
  escrita: 'escribirmela por aqui (ingredientes y pasos, o solo el nombre y la creo yo)',
}

/** Pure: the lines `generate_weekly_menu` hands to Mimo (the prompt says how to tell it). */
export function menuFitSummary(fit: MenuFit | null): string {
  if (!fit) return ''
  const list = (items: string[]) => items.join(', ')
  const notInCatalog = fit.missed.filter((m) => m.reason === 'no_catalogo').map((m) => m.preference)
  const didntFit = fit.missed.filter((m) => m.reason === 'no_cabia').map((m) => m.preference)
  const lines = [`Acierto con sus gustos: ${fit.score}/100 (${fit.level}).`]
  if (fit.met.length) lines.push(`Se cumplen: ${list(fit.met.map((m) => (m.recipe ? `${m.preference} (${m.recipe})` : m.preference)))}.`)
  if (notInCatalog.length) lines.push(`No estan en el catalogo: ${list(notInCatalog)}.`)
  if (didntFit.length) lines.push(`No cabian esta semana (las tenemos): ${list(didntFit)}.`)
  if (fit.level === 'bajo') {
    const methods = fit.unusedAddMethods.length ? fit.unusedAddMethods : (['foto', 'enlace', 'escrita'] as RecipeAddMethod[])
    lines.push(`Formas de añadir recetas que este hogar aun no ha usado: ${methods.map((m) => METHOD_LABEL[m]).join('; ')}.`)
  }
  return lines.join(' ')
}

// ─── Loading + saving ───────────────────────────────────────────

/** Favourite dishes of the sign-up and «Me encanta» recipes, deduped, capped. */
export async function loadFitPreferences(userId: string, db: Db = defaultDb): Promise<FitPreference[]> {
  const [user] = await db.select({ favoriteDishes: users.favoriteDishes }).from(users).where(eq(users.id, userId)).limit(1)
  const loved = await db
    .select({ name: recipes.name })
    .from(recipeVerdicts)
    .innerJoin(recipes, eq(recipes.id, recipeVerdicts.recipeId))
    .where(and(eq(recipeVerdicts.userId, userId), eq(recipeVerdicts.verdict, 'love')))
    .limit(MAX_PREFERENCES)
  const out: FitPreference[] = []
  const seen = new Set<string>()
  const push = (text: string, source: FitPreference['source']) => {
    const t = text.trim().replace(/\s+/g, ' ')
    const key = t.toLowerCase()
    if (!t || seen.has(key) || out.length >= MAX_PREFERENCES) return
    seen.add(key)
    out.push({ text: t, source })
  }
  for (const d of user?.favoriteDishes ?? []) push(d, 'plato')
  for (const r of loved) push(r.name, 'me_encanta')
  return out
}

/** Pure: the ways to add a recipe this user hasn't used, from their `recipe_imported` / `recipe_created` events. */
export function unusedAddMethodsFrom(events: ReadonlyArray<{ name: string; source?: string | null }>): RecipeAddMethod[] {
  const used = new Set<RecipeAddMethod>()
  for (const e of events) {
    if (e.name === 'recipe_created') used.add('escrita')
    else if (e.name === 'recipe_imported') used.add(e.source === 'photo' || e.source === 'whatsapp_photo' ? 'foto' : 'enlace')
  }
  return (['foto', 'enlace', 'escrita'] as RecipeAddMethod[]).filter((m) => !used.has(m))
}

async function loadUnusedAddMethods(userId: string, db: Db): Promise<RecipeAddMethod[]> {
  const res = await db.execute(sql`
    SELECT DISTINCT name, props->>'source' AS source FROM usage_events
     WHERE user_id = ${userId}::uuid AND name IN ('recipe_imported', 'recipe_created')
  `)
  return unusedAddMethodsFrom((res.rows as Array<{ name: string; source: string | null }>) ?? [])
}

async function loadOwnRecipeNames(userId: string, db: Db): Promise<string[]> {
  const rows = await db.select({ name: recipes.name }).from(recipes).where(eq(recipes.authorId, userId))
  return rows.map((r) => r.name)
}

/**
 * «No está en el catálogo» → a catalogue wish (PRO-154, source `evaluador`),
 * one per dish they told us. Returns the dishes recorded. Never throws.
 */
export async function recordFitWishes(
  fit: MenuFit,
  preferences: readonly FitPreference[],
  userId: string,
  record: typeof recordCatalogWish = recordCatalogWish,
): Promise<string[]> {
  const sources = new Map(preferences.map((p) => [p.text, p.source]))
  const out: string[] = []
  for (const m of fit.missed) {
    if (m.reason !== 'no_catalogo' || sources.get(m.preference) !== 'plato') continue
    try {
      await record({ dish: m.preference, source: 'evaluador', userId })
      out.push(m.preference)
    } catch (err) {
      console.warn('[menuFit] wish failed (ignored):', (err as Error)?.message ?? err)
    }
  }
  return out
}

export interface MenuFitDeps {
  create?: CreateFn
  timeoutMs?: number
  /** Where «no está en el catálogo» goes (default: the catalogue wishes, PRO-154). */
  recordWish?: typeof recordCatalogWish
  now?: Date
}

/**
 * After generating: evaluate, store it on the menu row (so the web shows
 * the line after a reload) and add the missing favourites to the wishes.
 * Never throws; null = no line.
 */
export async function evaluateAndSaveMenuFit(
  input: { userId: string; menuId: string; days: readonly DayMenu[] },
  db: Db = defaultDb,
  deps: MenuFitDeps = {},
): Promise<MenuFit | null> {
  try {
    // No model → no work at all (and no DB reads): the menu goes out as before.
    if (!modelCreate(deps.create)) return null
    const preferences = await loadFitPreferences(input.userId, db)
    const menuRecipes = menuRecipeNames(input.days)
    if (preferences.length === 0 || menuRecipes.length === 0) return null
    const [catalog, own, unusedAddMethods] = await Promise.all([
      publishedCatalogNames(db),
      loadOwnRecipeNames(input.userId, db),
      loadUnusedAddMethods(input.userId, db).catch(() => ['foto', 'enlace', 'escrita'] as RecipeAddMethod[]),
    ])
    const fit = await evaluateMenuFit(
      { preferences, menuRecipes, catalogNames: [...catalog, ...own], unusedAddMethods },
      { create: deps.create, timeoutMs: deps.timeoutMs, userId: input.userId, now: deps.now },
    )
    if (!fit) return null
    await db.update(menus).set({ fit }).where(eq(menus.id, input.menuId))
    const record = deps.recordWish ?? (db === defaultDb ? recordCatalogWish : null)
    if (record) await recordFitWishes(fit, preferences, input.userId, record)
    return fit
  } catch (err) {
    console.warn('[menuFit] failed (menu goes out without it):', (err as Error)?.message ?? err)
    return null
  }
}
