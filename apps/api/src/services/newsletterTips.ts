/**
 * Receta y truco para cada persona en la newsletter (PRO-1020, D-122 punto 4;
 * specs/newsletter.md → «Receta y truco por persona»).
 *
 *   - El truco: `pickTip(persona)` con las reglas del §6.3 de los trucos de
 *     Marketing (`departments/marketing/trucos.md`): candidatos en producción
 *     y sin pausa, la condición de cada uno, fuera lo que ya usa (la tabla de
 *     uso de PRO-1023, `household_feature_usage`, o el estado de la cuenta),
 *     fuera lo que dijo que no, descanso de 4 semanas (12 tras 2 veces sin
 *     adoptar, 3 veces como mucho), el orden del §5 por semanas desde el alta,
 *     luego la prioridad, y un truco de compartir como mucho al mes. Si no
 *     queda ninguno, un A que usó y lleva 60 días sin tocar; si tampoco, el
 *     truco general del número (`content.tip`).
 *   - La receta: `pickRecipe` entre las que el número propone (`content.recipes`),
 *     sin las que rompen las alergias o la dieta de alguien de la casa, las de
 *     «Mejor no» / «No para mí» y las que ya le mandamos; entre las que quedan,
 *     un orden estable por persona para repartirlas. Si no queda ninguna, la
 *     receta de la semana (`content.star`), como hasta ahora.
 *   - El registro `newsletter_tip_log` (número, persona, truco, receta,
 *     `shown_at`, `clicked_at`, `adopted_at`): solo lo lee el compositor,
 *     dentro del servidor. Se borra con la cuenta (CASCADE).
 *
 * Solo se enseñan trucos cuyo uso se puede medir hoy (si no, no se puede
 * aplicar «no repetir lo usado»). Lo de «En pausa» (§2 de los trucos) no está.
 * Partido como el resto: lo puro aquí arriba (tests/newsletterTips.test.ts),
 * Postgres en `createDbNewsletterTipsRepo` (tests/newsletterTips.smoke.ts).
 */
import { createHash } from 'node:crypto'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { ASSISTANT_NAME, type FeatureId } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import {
  householdFeatureUsage,
  householdMembers,
  households,
  ingredients,
  newsletterTipLog,
  pushSubscriptions,
  recipeIngredients,
  recipeSteps,
  recipes,
  users,
  whatsappLinks,
} from '../db/schema.js'
import { compileRestrictions, violatesRestrictions, type RestrictableRecipe } from './dietaryRestrictions.js'
import { withHouseholdRestrictions } from './householdAllergies.js'
import { loadHouseholdRatingSets } from './householdRatings.js'
import { unlistedDietMentions } from './stepDietMentions.js'
import { loadUserRestrictions } from './withWhatIHave.js'

type Db = typeof defaultDb

const DAY_MS = 24 * 60 * 60 * 1000

// ─── Persona ─────────────────────────────────────────────────────

export interface FeatureUse {
  firstUsedAt: Date
  lastUsedAt: Date
}

/** Un truco que se le enseñó (una fila de `newsletter_tip_log`). */
export interface TipShown {
  tip: string
  shownAt: Date
}

/** Lo que el compositor sabe de una persona para elegir su truco. Solo cifras, fechas y sí/no. */
export interface TipPersona {
  userId: string
  householdId: string
  signedUpAt: Date
  /** Tiene WhatsApp conectado; `notify`: avisos encendidos; `declined`: dijo que no a los avisos. */
  whatsapp: { linked: boolean; notify: boolean; declined: boolean }
  /** Notificaciones del móvil activas. */
  push: boolean
  /** Cuentas en el hogar, si es el dueño, y adultos y niños de su plantilla. */
  accounts: number
  isOwner: boolean
  adults: number
  /** «No» a invitar a casa (`family_invite_offers.mimoDeclined`) y a invitar a otro hogar (`invite_offer_declined_at`). */
  familyInviteDeclined: boolean
  inviteOfferDeclined: boolean
  /** Funciones usadas (PRO-1023): las del hogar y las de esta persona. */
  usage: Partial<Record<FeatureId, FeatureUse>>
  /** Trucos ya enseñados en la newsletter, cualquier número. */
  shown: TipShown[]
}

// ─── Catálogo de trucos ──────────────────────────────────────────

export type TipPriority = 'A' | 'B' | 'C'

export interface NewsletterTip {
  /** Estable: es lo que se guarda en el registro y va en el enlace del hueco. */
  id: string
  /** Número del truco en `trucos.md`. */
  n: number
  priority: TipPriority
  /** Semana del orden del §5 (desde el alta) en que toca; sin ella, solo por prioridad. */
  week?: number
  /** Compartir (57–59): como mucho uno al mes, porque «Corre la voz» va en todos los números. */
  share?: boolean
  /** La función del catálogo de uso que dice si ya lo usa (y si lo adoptó). */
  feature?: FeatureId
  title: string
  /** La línea tal cual la diría Mimo (trucos.md, §1). */
  body: string
  /** El destino real en la web. */
  path: string
  /** Lo usa por el estado de su cuenta, sin evento (WhatsApp conectado, avisos, dos cuentas…). */
  usedState?: (p: TipPersona) => boolean
  /** «Para quién»: la condición del catálogo. */
  when?: (p: TipPersona) => boolean
  /** Dijo que no: no se le vuelve a proponer nunca. */
  declined?: (p: TipPersona) => boolean
  /** Solo lo que la app hace hoy en producción. */
  enProduccion: boolean
  /** En pausa (§2 de los trucos), con la PRO que lo suelta. */
  enPausa?: string
}

const used = (p: TipPersona, f: FeatureId) => !!p.usage[f]

/**
 * Los trucos de `trucos.md` (validados por Miguel el 2026-10-23) cuyo uso se
 * mide hoy, con su número. Los demás entran cuando su métrica exista (§6.2).
 */
export const NEWSLETTER_TIPS: readonly NewsletterTip[] = [
  {
    id: 'whatsapp',
    n: 39,
    priority: 'A',
    week: 1,
    feature: 'mimo_whatsapp',
    title: `${ASSISTANT_NAME}, también por WhatsApp`,
    body: `Escríbeme por WhatsApp «¿qué cenamos hoy?» y te contesto con la receta y su enlace, sin abrir la app.`,
    path: '/whatsapp/conectar',
    usedState: (p) => p.whatsapp.linked,
    when: (p) => !p.whatsapp.linked,
    enProduccion: true,
  },
  {
    id: 'avisos_whatsapp',
    n: 50,
    priority: 'A',
    week: 1,
    title: 'Que te escriba yo',
    body: 'Escríbeme «Sí, avísame» y te escribo yo: el sábado la compra y el domingo el menú. Como mucho 4 mensajes a la semana.',
    path: '/profile/avisos',
    usedState: (p) => p.whatsapp.linked && p.whatsapp.notify,
    when: (p) => p.whatsapp.linked && !p.whatsapp.notify,
    declined: (p) => p.whatsapp.declined,
    enProduccion: true,
  },
  {
    id: 'tachar_lista',
    n: 33,
    priority: 'A',
    week: 2,
    feature: 'marcar_lista',
    title: 'Tacha la lista en el súper',
    body: 'La lista se hace sola con tu menú: tacha lo que vas metiendo en el carro y sabrás de un vistazo qué falta.',
    path: '/shopping',
    when: (p) => used(p, 'lista_compra'),
    enProduccion: true,
  },
  {
    id: 'receta_enlace',
    n: 21,
    priority: 'A',
    week: 5,
    feature: 'receta_enlace',
    title: 'Guarda la receta que viste',
    body: '¿Has visto una receta en Instagram, TikTok, YouTube o un blog? Mándame el enlace y la guardo en tus recetas, con su lista de ingredientes.',
    path: '/recipes',
    enProduccion: true,
  },
  {
    id: 'receta_foto',
    n: 22,
    priority: 'A',
    week: 5,
    feature: 'receta_foto',
    title: 'La receta de casa, con una foto',
    body: 'La receta de tu madre, en un libro o escrita a mano: hazle una foto y la paso a tus recetas.',
    path: '/recipes',
    enProduccion: true,
  },
  {
    id: 'invitar_casa',
    n: 45,
    priority: 'A',
    week: 6,
    title: 'La misma lista para los dos',
    body: 'Invita a quien compra contigo: veis el mismo menú y la misma lista, y lo que tacha uno lo ve el otro.',
    path: '/profile/casa',
    usedState: (p) => p.accounts >= 2,
    when: (p) => p.accounts === 1 && p.isOwner && p.adults >= 2,
    declined: (p) => p.familyInviteDeclined,
    enProduccion: true,
  },
  {
    id: 'pedido_tiendas',
    n: 47,
    priority: 'B',
    week: 10,
    feature: 'pedido_tiendas',
    title: 'El pedido a tus tiendas',
    body: 'Guarda tu frutería o tu pescadería y dime «hazme la compra»: te preparo un pedido por tienda para mandarlo desde tu WhatsApp.',
    path: '/compra/tiendas',
    when: (p) => used(p, 'lista_compra'),
    enProduccion: true,
  },
  {
    id: 'afinar_menu',
    n: 1,
    priority: 'A',
    feature: 'afinar_menu',
    title: 'Afina tu menú',
    body: 'Desliza 10 platos en «Afina tu menú»: en un minuto tu menú empieza a parecerse a tu casa.',
    path: '/afinar',
    enProduccion: true,
  },
  {
    id: 'modo_cocina',
    n: 24,
    priority: 'B',
    feature: 'modo_cocina',
    title: 'Cocina paso a paso',
    body: 'Dale a «Empezar a cocinar»: un paso cada vez, letra grande, la pantalla no se apaga y los temporizadores van solos.',
    path: '/menu',
    when: (p) => used(p, 'menu_semanal'),
    enProduccion: true,
  },
  {
    id: 'app_instalada',
    n: 4,
    priority: 'B',
    feature: 'app_instalada',
    title: 'Mimoia en tu pantalla de inicio',
    body: 'Pon Mimoia en tu pantalla de inicio: se abre con un toque y la lista se ve aunque en el súper no haya cobertura.',
    path: '/menu',
    when: (p) => used(p, 'menu_semanal') || used(p, 'lista_compra'),
    enProduccion: true,
  },
  {
    id: 'notificaciones',
    n: 54,
    priority: 'B',
    feature: 'avisos',
    title: 'Avisos en el móvil',
    body: '¿Sin WhatsApp? Activa las notificaciones del móvil y te aviso igual de sacar del congelador o de poner en remojo.',
    path: '/profile/avisos',
    usedState: (p) => p.push,
    when: (p) => !p.whatsapp.linked,
    enProduccion: true,
  },
  {
    id: 'invitar_otro_hogar',
    n: 59,
    priority: 'B',
    share: true,
    feature: 'invitar_hogar',
    title: 'Para quien siempre pregunta «¿qué cenamos?»',
    body: '¿Conoces a alguien que siempre está con el «¿qué cenamos?»? Pásale tu enlace de «Invitar a otro hogar».',
    path: '/profile',
    when: (p) => used(p, 'menu_semanal'),
    declined: (p) => p.inviteOfferDeclined,
    enProduccion: true,
  },
]

export function tipById(id: string, catalog: readonly NewsletterTip[] = NEWSLETTER_TIPS): NewsletterTip | null {
  return catalog.find((t) => t.id === id) ?? null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Where a click on a person's recipe or tip goes (the slots `receta` and
 * `truco`): built here, our recipe page or the tip's screen, never a URL from
 * the request. A malformed recipe id or an unknown tip → null (404).
 */
export function personalSlotDestination(slot: 'receta' | 'truco', origin: string, id: unknown): string | null {
  const web = origin.replace(/\/+$/, '')
  if (typeof id !== 'string') return null
  if (slot === 'receta') return UUID_RE.test(id) ? `${web}/recipes/${id}` : null
  const tip = tipById(id)
  return tip ? `${web}${tip.path}` : null
}

// ─── pickTip (§6.3) ──────────────────────────────────────────────

/** Descanso tras enseñarlo (regla 5). */
export const TIP_REST_DAYS = 28
/** Tras 2 veces sin adoptar. */
export const TIP_LONG_REST_DAYS = 84
export const TIP_MAX_SHOWS = 3
/** Un truco de compartir como mucho una vez en este tiempo (regla 8). */
export const TIP_SHARE_EVERY_DAYS = 30
/** «Por si se te había olvidado» (regla 7). */
export const TIP_FORGOTTEN_DAYS = 60
/** Adoptado = la primera vez dentro de estos días después del envío. */
export const TIP_ADOPTION_DAYS = 14

const PRIORITY_ORDER: Record<TipPriority, number> = { A: 0, B: 1, C: 2 }

/** Semana desde el alta (la del alta es la 1). */
export function weeksSinceSignup(signedUpAt: Date, now: Date): number {
  return Math.max(1, Math.floor((now.getTime() - signedUpAt.getTime()) / (7 * DAY_MS)) + 1)
}

export function tipUsed(tip: NewsletterTip, p: TipPersona): boolean {
  return (tip.feature ? used(p, tip.feature) : false) || !!tip.usedState?.(p)
}

/** Regla 5: el descanso (4 semanas; 12 tras 2 veces; 3 veces como mucho). */
function resting(tip: NewsletterTip, p: TipPersona, now: Date): boolean {
  const mine = p.shown.filter((s) => s.tip === tip.id)
  if (mine.length === 0) return false
  if (mine.length >= TIP_MAX_SHOWS) return true
  const last = Math.max(...mine.map((s) => s.shownAt.getTime()))
  const rest = mine.length >= 2 ? TIP_LONG_REST_DAYS : TIP_REST_DAYS
  return now.getTime() - last < rest * DAY_MS
}

/** Regla 8: ya se le enseñó uno de compartir en los últimos 30 días. */
function sharedRecently(p: TipPersona, now: Date, catalog: readonly NewsletterTip[]): boolean {
  return p.shown.some((s) => tipById(s.tip, catalog)?.share && now.getTime() - s.shownAt.getTime() < TIP_SHARE_EVERY_DAYS * DAY_MS)
}

export interface PickedTip {
  tip: NewsletterTip
  /** `nuevo`: no lo ha usado; `olvidado`: lo usó y lleva 60 días sin tocarlo (regla 7). */
  reason: 'nuevo' | 'olvidado'
}

/**
 * Puro: el truco de esta persona para un número que sale en `now`, o null
 * (= el truco general del número). Reglas del §6.3 de los trucos.
 */
export function pickTip(p: TipPersona, now: Date, catalog: readonly NewsletterTip[] = NEWSLETTER_TIPS): PickedTip | null {
  const week = weeksSinceSignup(p.signedUpAt, now)
  const noShare = sharedRecently(p, now, catalog)
  // 1. En producción y sin pausa; 4. sin un «no»; 5. sin descanso; 8. compartir, uno al mes.
  const open = catalog.filter(
    (t) => t.enProduccion && !t.enPausa && !t.declined?.(p) && !resting(t, p, now) && !(t.share && noShare),
  )
  // 2. Para quién; 3. no lo ha usado.
  const fresh = open.filter((t) => (t.when ? t.when(p) : true) && !tipUsed(t, p))
  const timesShown = (t: NewsletterTip) => p.shown.filter((s) => s.tip === t.id).length
  // 6. Primero lo que ya le toca en el orden del §5, después por prioridad; empate: el menos enseñado.
  const due = (t: NewsletterTip) => (t.week !== undefined && t.week <= week ? t.week : Infinity)
  const ranked = fresh
    .map((t, i) => ({ t, i }))
    .sort(
      (a, b) =>
        due(a.t) - due(b.t) ||
        PRIORITY_ORDER[a.t.priority] - PRIORITY_ORDER[b.t.priority] ||
        timesShown(a.t) - timesShown(b.t) ||
        a.i - b.i,
    )
  if (ranked.length > 0) return { tip: ranked[0].t, reason: 'nuevo' }
  // 7. Un A que usó y no toca hace 60 días o más; el que lleva más tiempo sin tocarse.
  const forgotten = open
    .filter((t) => t.priority === 'A' && t.feature && p.usage[t.feature])
    .map((t) => ({ t, last: p.usage[t.feature!]!.lastUsedAt.getTime() }))
    .filter((x) => now.getTime() - x.last >= TIP_FORGOTTEN_DAYS * DAY_MS)
    .sort((a, b) => a.last - b.last)
  return forgotten.length > 0 ? { tip: forgotten[0].t, reason: 'olvidado' } : null
}

/**
 * Puro: ¿lo adoptó? = la función se usó por primera vez dentro de los 14 días
 * después de enseñarlo. Los trucos sin función (se miden por el estado) no se
 * pueden fechar: null.
 */
export function tipAdoptedAt(tipId: string, shownAt: Date, usage: TipPersona['usage'], catalog: readonly NewsletterTip[] = NEWSLETTER_TIPS): Date | null {
  const t = tipById(tipId, catalog)
  const u = t?.feature ? usage[t.feature] : undefined
  if (!u) return null
  const first = u.firstUsedAt.getTime()
  return first >= shownAt.getTime() && first <= shownAt.getTime() + TIP_ADOPTION_DAYS * DAY_MS ? u.firstUsedAt : null
}

// ─── pickRecipe ──────────────────────────────────────────────────

export interface RecipeFacts {
  /** Rompe la alergia o la dieta de alguien de la casa, no le gusta, o «Mejor no» / «No para mí». */
  blocked: ReadonlySet<string>
  /** Ya se la mandamos en otro número. */
  sentBefore: ReadonlySet<string>
}

/**
 * Puro: la receta de esta persona entre las que propone el número, o null
 * (= la receta de la semana). Entre las que puede comer y no ha recibido, un
 * orden estable por persona y número, para que no todas reciban la misma.
 */
export function pickRecipe(candidateIds: readonly string[], facts: RecipeFacts, seed: string): string | null {
  const ok = candidateIds.filter((id) => !facts.blocked.has(id) && !facts.sentBefore.has(id))
  if (ok.length === 0) return null
  const rank = (id: string) => createHash('sha256').update(`${seed}|${id}`).digest('hex')
  return [...ok].sort((a, b) => rank(a).localeCompare(rank(b)))[0]
}

// ─── Repo ────────────────────────────────────────────────────────

export interface TipLogRow {
  id: string
  userId: string
  issueId: string
  tip: string | null
  recipeId: string | null
  shownAt: Date
  adoptedAt: Date | null
}

export interface NewsletterTipsRepo {
  /** Las personas de estas cuentas (sin hogar → fuera) con lo que ya se les enseñó. */
  personas(userIds: string[]): Promise<Map<string, TipPersona & { log: TipLogRow[] }>>
  /** Para cada cuenta, las recetas del número que no puede recibir. */
  recipeFacts(userIds: string[], candidateIds: string[]): Promise<Map<string, RecipeFacts>>
  /** Apunta lo que se le mandó a cada uno (una fila por número y persona). */
  record(issueId: string, rows: Array<{ userId: string; householdId: string; tip: string | null; recipeId: string | null }>): Promise<void>
  markAdopted(rows: Array<{ id: string; adoptedAt: Date }>): Promise<void>
  /** La cuenta de un email (la prueba de un admin). */
  userIdByEmail(email: string): Promise<string | null>
}

/** Las recetas del número, con lo que mira el filtro de alergias y dieta (como `loadMatchableRecipes`). */
async function restrictableRecipes(db: Db, ids: string[]): Promise<Array<RestrictableRecipe & { id: string }>> {
  if (ids.length === 0) return []
  const rs = await db.select({ id: recipes.id, name: recipes.name, allergens: recipes.allergens }).from(recipes).where(inArray(recipes.id, ids))
  const ing = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientName: ingredients.name,
      allergenTags: ingredients.allergenTags,
      containsTags: ingredients.containsTags,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(inArray(recipeIngredients.recipeId, ids))
  const steps = await db
    .select({ recipeId: recipeSteps.recipeId, index: recipeSteps.index, text: recipeSteps.text })
    .from(recipeSteps)
    .where(inArray(recipeSteps.recipeId, ids))
  return rs.map((r) => {
    const lines = ing.filter((i) => i.recipeId === r.id)
    const texts = steps
      .filter((s) => s.recipeId === r.id)
      .sort((a, b) => a.index - b.index)
      .map((s) => s.text ?? '')
    return {
      id: r.id,
      name: r.name,
      allergens: r.allergens ?? [],
      ingredients: lines.map((l) => ({ ingredientName: l.ingredientName, allergenTags: l.allergenTags ?? [], containsTags: l.containsTags ?? [] })),
      stepMentions: unlistedDietMentions(texts, lines.map((l) => l.ingredientName)).map(({ term, category }) => ({ term, category })),
    }
  })
}

export function createDbNewsletterTipsRepo(db: Db = defaultDb): NewsletterTipsRepo {
  return {
    async personas(userIds) {
      const out = new Map<string, TipPersona & { log: TipLogRow[] }>()
      if (userIds.length === 0) return out
      const people = await db
        .select({
          id: users.id,
          createdAt: users.createdAt,
          adults: users.adults,
          householdId: users.primaryHouseholdId,
          familyInviteOffers: users.familyInviteOffers,
          inviteOfferDeclinedAt: users.inviteOfferDeclinedAt,
          ownerId: households.ownerId,
        })
        .from(users)
        .innerJoin(households, eq(households.id, users.primaryHouseholdId))
        .where(inArray(users.id, userIds))
      if (people.length === 0) return out
      const hids = [...new Set(people.map((p) => p.householdId!))]
      const members = await db
        .select({ householdId: householdMembers.householdId, n: sql<number>`count(*)::int` })
        .from(householdMembers)
        .where(inArray(householdMembers.householdId, hids))
        .groupBy(householdMembers.householdId)
      const wa = await db
        .select({ userId: whatsappLinks.userId, notify: whatsappLinks.notify, declinedAt: whatsappLinks.optInDeclinedAt })
        .from(whatsappLinks)
        .where(inArray(whatsappLinks.userId, userIds))
      const push = await db
        .select({ userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .where(inArray(pushSubscriptions.userId, userIds))
      const usage = await db
        .select({
          householdId: householdFeatureUsage.householdId,
          userId: householdFeatureUsage.userId,
          feature: householdFeatureUsage.feature,
          firstUsedAt: householdFeatureUsage.firstUsedAt,
          lastUsedAt: householdFeatureUsage.lastUsedAt,
        })
        .from(householdFeatureUsage)
        .where(
          and(
            inArray(householdFeatureUsage.householdId, hids),
            or(isNull(householdFeatureUsage.userId), inArray(householdFeatureUsage.userId, userIds)),
          ),
        )
      const log = await db.select().from(newsletterTipLog).where(inArray(newsletterTipLog.userId, userIds))
      for (const p of people) {
        const mineUsage: TipPersona['usage'] = {}
        for (const u of usage) {
          if (u.householdId !== p.householdId || (u.userId !== null && u.userId !== p.id)) continue
          mineUsage[u.feature as FeatureId] = { firstUsedAt: u.firstUsedAt, lastUsedAt: u.lastUsedAt }
        }
        const link = wa.find((w) => w.userId === p.id)
        const mineLog: TipLogRow[] = log
          .filter((l) => l.userId === p.id)
          .map((l) => ({ id: l.id, userId: l.userId, issueId: l.issueId, tip: l.tip, recipeId: l.recipeId, shownAt: l.shownAt, adoptedAt: l.adoptedAt }))
        const offers = (p.familyInviteOffers ?? {}) as { mimoDeclined?: string }
        out.set(p.id, {
          userId: p.id,
          householdId: p.householdId!,
          signedUpAt: p.createdAt ?? new Date(),
          whatsapp: { linked: !!link, notify: !!link?.notify, declined: !!link?.declinedAt },
          push: push.some((x) => x.userId === p.id),
          accounts: members.find((m) => m.householdId === p.householdId)?.n ?? 1,
          isOwner: p.ownerId === p.id,
          adults: p.adults,
          familyInviteDeclined: !!offers.mimoDeclined,
          inviteOfferDeclined: !!p.inviteOfferDeclinedAt,
          usage: mineUsage,
          shown: mineLog.filter((l) => l.tip).map((l) => ({ tip: l.tip!, shownAt: l.shownAt })),
          log: mineLog,
        })
      }
      return out
    },
    async recipeFacts(userIds, candidateIds) {
      const out = new Map<string, RecipeFacts>()
      if (userIds.length === 0 || candidateIds.length === 0) return out
      const candidates = await restrictableRecipes(db, candidateIds)
      const sent = await db
        .select({ userId: newsletterTipLog.userId, recipeId: newsletterTipLog.recipeId })
        .from(newsletterTipLog)
        .where(and(inArray(newsletterTipLog.userId, userIds), inArray(newsletterTipLog.recipeId, candidateIds)))
      for (const userId of userIds) {
        const own = await loadUserRestrictions(userId, db)
        const restrictions = await withHouseholdRestrictions(own.restrictions, userId, db)
        const rules = compileRestrictions(restrictions, own.dislikes)
        const rated = await loadHouseholdRatingSets(userId, db)
        const blocked = new Set<string>(rated.exclude)
        for (const r of candidates) if (violatesRestrictions(r, rules)) blocked.add(r.id)
        // A recipe that no longer exists can't be checked: never sent.
        for (const id of candidateIds) if (!candidates.some((r) => r.id === id)) blocked.add(id)
        out.set(userId, { blocked, sentBefore: new Set(sent.filter((s) => s.userId === userId).map((s) => s.recipeId!)) })
      }
      return out
    },
    async record(issueId, rows) {
      if (rows.length === 0) return
      for (let i = 0; i < rows.length; i += 500) {
        await db
          .insert(newsletterTipLog)
          .values(rows.slice(i, i + 500).map((r) => ({ issueId, ...r })))
          .onConflictDoNothing()
      }
    },
    async markAdopted(rows) {
      for (const r of rows) {
        await db.update(newsletterTipLog).set({ adoptedAt: r.adoptedAt }).where(and(eq(newsletterTipLog.id, r.id), isNull(newsletterTipLog.adoptedAt)))
      }
    },
    async userIdByEmail(email) {
      const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`).limit(1)
      return u?.id ?? null
    },
  }
}
