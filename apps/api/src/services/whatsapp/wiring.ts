import { env } from '../../config/env.js'
import { db } from '../../db/connection.js'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { menus, recipes, users } from '../../db/schema.js'
import { resolveScope, scopeWhere } from '../scopeResolver.js'
import { weekMenuCaption, weekMenuDigest, type WeekMenuInput } from '../menuText.js'
import { weekMenuImage } from '../weekImage/index.js'
import { madridParts } from '../madridTime.js'
import { spendCapStatus } from '../spendCap.js'
import { chat } from '../assistant/engine.js'
import { checkAdvisorBudget, recordAdvisorUsage } from '../advisorBudget.js'
import { isSttConfigured, transcribeAudio } from '../stt.js'
import { importRecipeFromImage, setRecipeSourceUrl } from '../recipeImport.js'
import { isUserAllowed } from './config.js'
import * as store from './store.js'
import * as client from './client.js'
import type { InboundDeps } from './inbound.js'
import type { InboundMessage } from './webhookParser.js'

/**
 * The week the turn just generated (or the user's latest), read back after
 * the whole turn, scoped to the caller's household like every menu read.
 */
async function loadWeekMenu(userId: string, menuId: string | null): Promise<WeekMenuInput | null> {
  const scope = scopeWhere(menus.userId, menus.householdId, await resolveScope(userId, db))
  const [row] = await db
    .select({ weekStart: menus.weekStart, days: menus.days, skippedDays: menus.skippedDays })
    .from(menus)
    .where(menuId ? and(scope, eq(menus.id, menuId)) : scope)
    .orderBy(desc(menus.createdAt))
    .limit(1)
  if (!row) return null
  return { weekStart: String(row.weekStart), days: row.days as any, skippedDays: row.skippedDays }
}

/** recipe id → `image_url` (the menu JSON doesn't store photos). */
async function recipePhotoUrls(ids: string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map()
  const rows = await db.select({ id: recipes.id, imageUrl: recipes.imageUrl }).from(recipes).where(inArray(recipes.id, ids))
  return new Map(rows.map((r) => [r.id, r.imageUrl]))
}

/** Real implementations behind `processInbound`'s deps. */
export function buildInboundDeps(): InboundDeps {
  return {
    webUrl: env.WEB_PUBLIC_URL,
    supportEmail: env.SUPPORT_EMAIL || undefined,
    now: () => new Date(),
    isUserAllowed: (email) => isUserAllowed(email),
    store,
    client,
    chat: (userId, message, history, opts) => chat(userId, message, history, db, opts),
    // The chat's own € budget AND the monthly cap on all paid AI work
    // (spendCap.ts), both before any paid step. Admins are exempt from the cap.
    checkBudget: async (userId) => {
      const advisor = await checkAdvisorBudget(userId, db)
      if (advisor.exceeded) return advisor
      const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
      if (row?.role === 'admin') return advisor
      const cap = await spendCapStatus(userId)
      return cap.exceeded ? { exceeded: true, budgetMicros: Math.round(cap.capEur * 1_000_000) } : advisor
    },
    recordUsage: (userId, usage) => recordAdvisorUsage(userId, usage, db),
    // The week the turn just generated (or the user's latest), read back after
    // the whole turn, scoped to the caller's household like every menu read.
    menuDigest: async (userId, menuId) => {
      const menu = await loadWeekMenu(userId, menuId)
      if (!menu) return null
      return weekMenuDigest(menu, { today: madridParts(new Date()).isoDate, webUrl: env.WEB_PUBLIC_URL })
    },
    // The same week as a picture + short caption (2026-10-15). Throws or
    // returns null → inbound sends the digest text above instead.
    menuImage: async (userId, menuId) => {
      const menu = await loadWeekMenu(userId, menuId)
      if (!menu) return null
      const today = madridParts(new Date()).isoDate
      const t0 = Date.now()
      const jpeg = await weekMenuImage(menu, { today, webUrl: env.WEB_PUBLIC_URL, photoUrls: recipePhotoUrls })
      if (!jpeg) return null
      console.log(`[whatsapp] week image drawn in ${Date.now() - t0} ms (${Math.round(jpeg.length / 1024)} KB)`)
      return { jpeg, caption: weekMenuCaption(menu, { today, webUrl: env.WEB_PUBLIC_URL }) }
    },
    transcribe: isSttConfigured() ? transcribeAudio : undefined,
    importRecipeFromImage: env.ANTHROPIC_API_KEY ? importRecipeFromImage : undefined,
    setRecipeSource: setRecipeSourceUrl,
  }
}

/** What we store for an inbound row before processing fills in the real text. */
export function initialInboundBody(msg: InboundMessage): string | null {
  switch (msg.kind) {
    case 'text':
    case 'interactive':
      return msg.text
    case 'audio':
      return '[nota de voz]'
    case 'image':
      return msg.text ? `[foto] ${msg.text}` : '[foto]'
    default:
      return `[${msg.rawType}]`
  }
}
