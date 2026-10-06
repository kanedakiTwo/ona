import { env } from '../../config/env.js'
import { db } from '../../db/connection.js'
import { chat } from '../assistant/engine.js'
import { checkAdvisorBudget, recordAdvisorUsage } from '../advisorBudget.js'
import { isUserAllowed } from './config.js'
import * as store from './store.js'
import * as client from './client.js'
import type { InboundDeps } from './inbound.js'
import type { InboundMessage } from './webhookParser.js'

/** Real implementations behind `processInbound`'s deps. */
export function buildInboundDeps(): InboundDeps {
  return {
    webUrl: env.WEB_PUBLIC_URL,
    now: () => new Date(),
    isUserAllowed: (email) => isUserAllowed(email),
    store,
    client,
    chat: (userId, message, history, opts) => chat(userId, message, history, db, opts),
    checkBudget: (userId) => checkAdvisorBudget(userId, db),
    recordUsage: (userId, usage) => recordAdvisorUsage(userId, usage, db),
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
