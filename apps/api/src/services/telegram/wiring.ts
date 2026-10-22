import { env } from '../../config/env.js'
import { db } from '../../db/connection.js'
import { chat } from '../assistant/engine.js'
import { buildInboundDeps } from '../whatsapp/wiring.js'
import * as client from './client.js'
import * as store from './store.js'
import type { TelegramDeps } from './inbound.js'

/**
 * Real implementations behind `processTelegramUpdate` (PRO-313). The budget,
 * spend cap, paused-account gate, usage record and week digest are exactly
 * WhatsApp's (`buildInboundDeps`), so both channels meter the same way.
 */
export function buildTelegramDeps(): TelegramDeps {
  const wa = buildInboundDeps()
  return {
    webUrl: env.WEB_PUBLIC_URL,
    supportEmail: env.SUPPORT_EMAIL || undefined,
    now: () => new Date(),
    store,
    client: {
      sendMessage: (chatId, send) => client.sendMessage(chatId, send),
      sendTyping: (chatId) => client.sendTyping(chatId),
    },
    chat: (userId, message, history, opts) => chat(userId, message, history, db, opts),
    checkBudget: wa.checkBudget,
    isPaused: wa.isPaused,
    recordUsage: wa.recordUsage,
    menuDigest: wa.menuDigest,
    typingEveryMs: 4500,
  }
}
