// Mimo's WhatsApp-first sign-up (complete_onboarding). Split out of skills.ts (PRO-400).
import { saveWeekTypeSlots } from '../weekType.js'
import { eq } from 'drizzle-orm'
import { users } from '../../db/schema.js'
import { firstMenuWeeks } from '@ona/shared'
import { COOKING_STYLES, isCookingStyle } from '@ona/shared'
import { getPrimaryHouseholdId } from '../scopeResolver.js'
import { loadMatchableRecipes } from '../matchableRecipes.js'
import { loadPreviousWeek } from '../menuWeek.js'
import { cookingFreqForMealCounts, recipeForDish, weekTypeForMealCounts, type SignupDish } from '../signupFirstMenu.js'
import { withHouseholdRestrictions } from '../householdAllergies.js'
import { withMenuOnlyRestrictions } from '../menuOnlyRestrictions.js'
import { saidRestrictionsLine } from '../saidRestrictions.js'
import { compileRestrictions, violatesRestrictions } from '../dietaryRestrictions.js'
import { type SkillDefinition, type SkillContext, type SkillResult } from './types.js'
import { saveOnboarding } from '../onboarding.js'
import { shopperInviteForSignUp } from '../shopperInvite.js'
import { SHOPPERS, asksShopper, isShopper, shopperInvites } from '@ona/shared'
import { weekHasDishes, generateWeeklyMenu, generateAndSaveWeek } from './menuSkills.js'
import { restrictionsFor, saidForMenu, RESTRICTIONS_SAID_PROP } from './skillHelpers.js'

/**
 * The sign-up's dishes with the recipe each comes in as (PRO-1041 + the
 * sign-up's dishes of 19-nov): never one with what someone in the household
 * can't eat, saved or said to Mimo in the conversation (`said`) — the same
 * list the generator's own picks go through. `blocked`: the dishes whose
 * recipe has it. They are left out, not turned into a note: Mimo's
 * `swap_meal` by name would bring that same recipe back.
 */
async function signupDishes(ctx: SkillContext, said: readonly string[], favoriteDishes: readonly string[]): Promise<{ dishes: SignupDish[]; blocked: string[] }> {
  if (favoriteDishes.length === 0) return { dishes: [], blocked: [] }
  const pool = await loadMatchableRecipes(ctx.userId, ctx.db).catch(() => [])
  const cantEat = await withMenuOnlyRestrictions(said, () =>
    restrictionsFor(ctx).then((own) => withHouseholdRestrictions(own.restrictions, ctx.userId, ctx.db)),
  ).catch(() => [...said])
  const rules = compileRestrictions(cantEat)
  const allowed = pool.filter((r) => !violatesRestrictions(r, rules))
  const dishes: SignupDish[] = []
  const blocked: string[] = []
  for (const dish of favoriteDishes) {
    const recipe = recipeForDish(dish, allowed, ctx.userId)
    if (!recipe && recipeForDish(dish, pool, ctx.userId)) blocked.push(dish)
    else dishes.push({ dish, recipe })
  }
  return { dishes, blocked }
}

const COOKING_FREQS = ['daily', '3_4_times', 'rarely'] as const
const PRIORITIES = ['quick', 'varied', 'healthy', 'cheap'] as const

/**
 * WhatsApp-first sign-up (2026-10-10): Mimo asks the first-steps questions in
 * the chat and, with the answers, saves them (same as the web onboarding,
 * without health data) and builds the first week's menu in one go.
 *
 * 19-nov (Miguel): four questions, and all of it where the menu reads it from
 * day one — who they are; which meals they cook («6 cenas y 1 comida» →
 * the «semana tipo» and how often they cook); three dishes they make often
 * (favourites, and into the first menu for sure: `signupFirstMenu.ts`); what
 * doesn't go in (the dislikes, families included). The first menu starts with
 * the next meal that hasn't gone by. `cookingStyle` / `cookingFreq` stay for
 * an answer that says how they cook.
 */
export const completeOnboarding: SkillDefinition = {
  name: 'complete_onboarding',
  description:
    'Solo durante los primeros pasos de un hogar nuevo por WhatsApp: guarda cuantos son en casa, que comidas cocinan, los platos que hacen a menudo y lo que no quieren en el menu, marca los primeros pasos como hechos y genera su primer menu (empieza en la siguiente comida que no ha pasado y lleva sus platos; no hace falta llamar ademas a generate_weekly_menu). Llamalo una sola vez, cuando tengas adultos, niños y que comidas cocinan.',
  parameters: {
    type: 'object',
    properties: {
      adults: { type: 'integer', minimum: 1, maximum: 20, description: 'Adultos en casa (a partir de 11 años).' },
      kidsCount: { type: 'integer', minimum: 0, maximum: 20, description: 'Niños de 2 a 10 años; los menores de 2 no cuentan. 0 si no hay.' },
      lunches: { type: 'integer', minimum: 0, maximum: 7, description: 'Cuantas comidas (mediodia) cocinan en casa a la semana. "6 cenas y 1 comida" → 1; "comemos fuera entre semana" → 2; "todas" → 7.' },
      dinners: { type: 'integer', minimum: 0, maximum: 7, description: 'Cuantas cenas cocinan en casa a la semana. "6 cenas y 1 comida" → 6; "solo cenamos entre semana" → 5.' },
      cookingStyle: {
        type: 'string',
        enum: [...COOKING_STYLES],
        description: 'Solo si dice como cocinan: daily = cada dia (o casi); cook_and_reuse = unos dias y aprovechan para otros; batch = cocinan una o dos veces y dejan hecha la semana; improvise = improvisan, deciden cada dia.',
      },
      cookingFreq: {
        type: 'string',
        enum: [...COOKING_FREQS],
        description: 'Solo si dice cuanto cocinan sin decir que comidas ("poco", "casi nunca"): rarely = poco; 3_4_times = unos 3-4 dias; daily = casi a diario. Con lunches/dinners o cookingStyle, omitelo.',
      },
      favoriteDishes: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 30,
        description: 'Los platos que dice que hacen a menudo (o que les gustan), todos los que diga (sin limite), tal como los dice, cada uno por separado: "salmon al horno con patatas", "pollo a la plancha con brocoli". Entran en su primer menu. Si no ha dicho ninguno, omitelo.',
      },
      dislikes: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 30,
        description: 'Lo que no entra en casa, tal como lo dice: alimentos o familias ("pescado", "legumbres", "cerdo", "picante") o platos. Nunca alergias ni intolerancias (eso va en la web). Si no ha dicho nada, omitelo.',
      },
      priority: {
        type: 'string',
        enum: [...PRIORITIES],
        description: 'Solo si dice lo que mas le importa (quick = rapido, varied = variado, healthy = sano, cheap = barato). No lo preguntes; si no lo ha dicho, omitelo.',
      },
      shopper: {
        type: 'string',
        enum: [...SHOPPERS],
        description: 'Solo si con 2 adultos o mas ha dicho quien hace la compra (no lo preguntes): me = el usuario; other = otra persona de casa; shared = se turnan. Con other o shared la herramienta devuelve el mensaje con el enlace de invitacion para esa persona.',
      },
      restrictions_said: RESTRICTIONS_SAID_PROP,
    },
    required: ['adults', 'kidsCount'],
  },
  async handler(
    params: { adults?: number; kidsCount?: number; lunches?: number; dinners?: number; cookingStyle?: string; cookingFreq?: string; favoriteDishes?: string[]; dislikes?: string[]; priority?: string; shopper?: string; restrictions_said?: string[] },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const { userId, db } = ctx
    const [current] = await db.select({ onboardingDone: users.onboardingDone }).from(users).where(eq(users.id, userId)).limit(1)
    if (current?.onboardingDone) {
      return { data: null, summary: 'Los primeros pasos ya estaban hechos; no he cambiado nada. Si quiere un menu nuevo, usa generate_weekly_menu.' }
    }
    const adults = Number.isInteger(params?.adults) ? Number(params.adults) : NaN
    const kidsCount = Number.isInteger(params?.kidsCount) ? Number(params.kidsCount) : 0
    const count = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 7 ? n : undefined)
    const lunches = count(params?.lunches)
    const dinners = count(params?.dinners)
    const cookingStyle = isCookingStyle(params?.cookingStyle) ? params.cookingStyle : undefined
    const saidFreq = !cookingStyle && (COOKING_FREQS as readonly string[]).includes(String(params?.cookingFreq)) ? (params.cookingFreq as (typeof COOKING_FREQS)[number]) : undefined
    // «6 cenas y 1 comida» also says how often they cook.
    const cookingFreq = saidFreq ?? (cookingStyle ? undefined : cookingFreqForMealCounts(lunches, dinners))
    const priority = (PRIORITIES as readonly string[]).includes(String(params?.priority)) ? (params.priority as (typeof PRIORITIES)[number]) : undefined
    const list = (xs: unknown) => (Array.isArray(xs) ? xs : []).map((d) => String(d).trim()).filter(Boolean).slice(0, 30)
    const favoriteDishes = list(params?.favoriteDishes)
    const dislikes = list(params?.dislikes)
    const missing = [
      !(adults >= 1 && adults <= 20) && 'cuantos adultos son',
      !(kidsCount >= 0 && kidsCount <= 20) && 'cuantos niños',
      !cookingStyle && !cookingFreq && 'que comidas cocinan en casa',
    ].filter(Boolean)
    if (missing.length > 0) {
      return { data: null, summary: `No he guardado nada: falta ${missing.join(', ')}. Preguntaselo.` }
    }
    // PRO-383: who does the shopping is only kept with 2 adults or more.
    const shopper = asksShopper(adults) && isShopper(params?.shopper) ? params.shopper : undefined
    // No restrictions or consent here: health data never goes through WhatsApp.
    await saveOnboarding(userId, { adults, kidsCount, cookingStyle, cookingFreq, favoriteDishes, priority, shopper, via: 'whatsapp' }, db)
    // 19-nov: the meals they cook → the «semana tipo»; what doesn't go in →
    // the dislikes (families included). Before the first menu, which reads both.
    const weekTypeChanges = weekTypeForMealCounts(lunches, dinners)
    if (weekTypeChanges.length > 0) {
      try {
        const householdId = await getPrimaryHouseholdId(userId, db)
        if (householdId) {
          await saveWeekTypeSlots(householdId, weekTypeChanges, db, { track: { userId, channel: 'whatsapp' } })
        }
      } catch (err) {
        console.warn('[assistant.complete_onboarding] week type not saved (menu with every lunch and dinner):', err)
      }
    }
    if (dislikes.length > 0) {
      try {
        const { getMemoryForUser, setMemoryBatch } = await import('../userMemoryStore.js')
        const known = (await getMemoryForUser(userId).catch(() => null))?.dislikes?.value
        const merged = [...new Set([...(Array.isArray(known) ? (known as string[]) : []), ...dislikes])]
        await setMemoryBatch(userId, [{ key: 'dislikes', value: merged }], 'inferred', { signal: 'whatsapp' })
      } catch (err) {
        console.warn('[assistant.complete_onboarding] dislikes not saved:', err)
      }
    }
    // Someone else buys, or they take turns: the same invitation as the web's «Mandar invitación».
    const invite = shopperInvites(shopper) ? await shopperInviteForSignUp(userId).catch(() => null) : null
    const inviteLine = invite
      ? ` Invitacion para quien hace la compra (dale este mensaje tal cual, en un bloque aparte, para que se lo reenvie; asi le llegara la lista cada semana):\n${invite.message}\n`
      : ''
    // PRO-320: a pass of the ficha's refiner at the moment (in the background).
    void import('../profile/refiner.js').then((m) => m.refineHouseholdSoon(userId, 'onboarding')).catch(() => undefined)
    // Same first menu as the web sign-up (PRO-65, PRO-244), from the next
    // meal that hasn't gone by (19-nov): a 22:00 sign-up starts tomorrow, a
    // 15:00 one with tonight's dinner. Friday to Sunday next week comes too.
    // The reply (and the WhatsApp picture) shows the first week; next week is
    // waiting in the app. Their dishes go in the first week (what doesn't
    // fit, in the next).
    const plan = firstMenuWeeks(new Date(), { fromNextMeal: true })
    // PRO-1041: «soy celíaca» in the first message is not saved here, but the first menu applies it.
    const said = await saidForMenu(ctx, params?.restrictions_said)
    // Their dishes, but never as a recipe with what the household can't eat (said or saved).
    const theirs = await signupDishes(ctx, said?.apply ?? [], favoriteDishes)
    let dishes = theirs.dishes
    const blockedLine = theirs.blocked.length > 0
      ? `\nNo he puesto ${theirs.blocked.map((d) => `«${d}»`).join(', ')}: su receta lleva algo que en casa no pueden comer. No lo pongas tu con swap_meal; diselo en una linea.`
      : ''
    // A dish without a recipe is a note Mimo turns into the household's recipe in this turn.
    const ownVersionLine = said && dishes.some((d) => !d.recipe)
      ? `\nLas recetas de la casa que crees en este turno tienen que respetarlo tambien (${said.apply.join(', ')}).`
      : ''
    const results: SkillResult[] = []
    for (const weekStart of plan.weeks) {
      const previous = await loadPreviousWeek(userId, weekStart, db)
      if (weekHasDishes(previous.days)) continue
      const signup = { pastMeals: plan.pastMeals, dishes }
      const week = await withMenuOnlyRestrictions(said?.apply ?? [], () =>
        generateAndSaveWeek(ctx, weekStart, previous, plan.today, undefined, false, signup),
      )
      dishes = week.left ?? []
      results.push(week)
    }
    const menu = results[0] ?? (await generateWeeklyMenu.handler({ restrictions_said: params?.restrictions_said }, ctx))
    const nextLine = results.length > 1 ? ` Tambien he generado la semana que viene (${results[1].summary})` : ''
    const saidLine = said && results.length > 0 ? `\n${saidRestrictionsLine(said, ctx.channel)}${ownVersionLine}` : ''
    return {
      data: menu.data,
      uiHint: menu.uiHint,
      summary: `Primeros pasos guardados (${adults} adultos, ${kidsCount} niños).${inviteLine} ${menu.summary}${nextLine}${blockedLine}${saidLine}`,
    }
  },
}
