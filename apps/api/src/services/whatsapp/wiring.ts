import { env } from '../../config/env.js'
import { db } from '../../db/connection.js'
import { eq } from 'drizzle-orm'
import { users } from '../../db/schema.js'
import { spendCapStatus } from '../spendCap.js'
import { chat } from '../assistant/engine.js'
import { checkAdvisorBudget, recordAdvisorUsage } from '../advisorBudget.js'
import { isSttConfigured, transcribeAudio } from '../stt.js'
import { importRecipeFromImage } from '../recipeImport.js'
import { isUserAllowed } from './config.js'
import * as store from './store.js'
import * as client from './client.js'
import type { InboundDeps } from './inbound.js'
import type { InboundMessage } from './webhookParser.js'

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
    transcribe: isSttConfigured() ? transcribeAudio : undefined,
    importRecipeFromImage: env.ANTHROPIC_API_KEY ? importRecipeFromImage : undefined,
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
