/**
 * Mimo on Telegram (PRO-313, piece 1; specs/telegram.md): the update parser,
 * the webhook secret, one-time linking with its 10-minute expiry, everything
 * off without the token, the «sin cuenta» reply, and the health rule (a
 * Telegram turn runs the engine exactly like WhatsApp: nothing about health
 * is stored from here).
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseTelegramUpdate } from '../services/telegram/updateParser.js'
import { verifyWebhookSecret } from '../services/telegram/secret.js'
import { generateTelegramLinkCode, isValidStartPayload, telegramStartLink, TG_LINK_CODE_TTL_MS } from '../services/telegram/linking.js'
import { isTelegramConfigured } from '../services/telegram/config.js'
import { processTelegramUpdate, TELEGRAM_CHAT_OPTIONS, type TelegramDeps } from '../services/telegram/inbound.js'
import { TELEGRAM_COPY } from '../services/telegram/copy.js'
import { toTelegramHtml, toTelegramSends, type TelegramSend } from '../services/telegram/format.js'
import { pruneHistory, type TelegramHistoryEntry } from '../services/telegram/history.js'
import { buildSystemPrompt } from '../services/assistant/systemPrompt.js'
import { skills } from '../services/assistant/skills.js'
import { appSkills } from '../services/assistant/appSkills.js'
import type { AppApi } from '../services/assistant/appApi.js'
import type { ChatOptions } from '../services/assistant/engine.js'
import { chatFeatureFor } from '../services/advisorBudget.js'

const NOW = new Date('2026-10-23T10:00:00Z')
const nowSec = Math.floor(NOW.getTime() / 1000)

function update(message: Record<string, unknown>, updateId = 100) {
  return {
    update_id: updateId,
    message: { message_id: 1, date: nowSec, chat: { id: 4242, type: 'private' }, from: { id: 4242, is_bot: false, first_name: 'Ana' }, ...message },
  }
}

describe('parseTelegramUpdate', () => {
  it('a text message in a private chat', () => {
    expect(parseTelegramUpdate(update({ text: '¿Qué ceno hoy?' }))).toEqual({
      updateId: 100, chatId: '4242', date: nowSec, kind: 'text', text: '¿Qué ceno hoy?', startPayload: null,
    })
  })

  it('/start with the deep-link code, also addressed to the bot', () => {
    expect(parseTelegramUpdate(update({ text: '/start abc_DEF-123' }))).toMatchObject({ kind: 'start', startPayload: 'abc_DEF-123' })
    expect(parseTelegramUpdate(update({ text: '/start@MimoiaBot abc123' }))).toMatchObject({ kind: 'start', startPayload: 'abc123' })
  })

  it('/start without a code, or with an invalid one, carries no payload', () => {
    expect(parseTelegramUpdate(update({ text: '/start' }))).toMatchObject({ kind: 'start', startPayload: null })
    expect(parseTelegramUpdate(update({ text: '/start no.vale!' }))).toMatchObject({ kind: 'start', startPayload: null })
    expect(parseTelegramUpdate(update({ text: `/start ${'a'.repeat(65)}` }))).toMatchObject({ kind: 'start', startPayload: null })
  })

  it('voice notes, photos and stickers are unsupported', () => {
    expect(parseTelegramUpdate(update({ voice: { file_id: 'x' } }))).toMatchObject({ kind: 'unsupported', text: null })
    expect(parseTelegramUpdate(update({ photo: [{ file_id: 'x' }], caption: 'mira' }))).toMatchObject({ kind: 'unsupported' })
  })

  it('ignores groups, channels, other bots, edits and anything malformed', () => {
    expect(parseTelegramUpdate(update({ text: 'hola', chat: { id: -100, type: 'group' } }))).toBeNull()
    expect(parseTelegramUpdate(update({ text: 'hola', from: { id: 9, is_bot: true } }))).toBeNull()
    expect(parseTelegramUpdate({ update_id: 1, edited_message: { text: 'x', chat: { id: 1, type: 'private' } } })).toBeNull()
    expect(parseTelegramUpdate({ update_id: 1, callback_query: { data: 'x' } })).toBeNull()
    expect(parseTelegramUpdate({ message: { text: 'sin update_id' } })).toBeNull()
    expect(parseTelegramUpdate(null)).toBeNull()
    expect(parseTelegramUpdate('texto')).toBeNull()
  })
})

describe('verifyWebhookSecret', () => {
  it('accepts exactly the secret', () => {
    expect(verifyWebhookSecret('s3cr3t_token-x', 's3cr3t_token-x')).toBe(true)
  })
  it('rejects a wrong, shorter, longer or missing header', () => {
    expect(verifyWebhookSecret('s3cr3t_token-y', 's3cr3t_token-x')).toBe(false)
    expect(verifyWebhookSecret('s3cr3t', 's3cr3t_token-x')).toBe(false)
    expect(verifyWebhookSecret('s3cr3t_token-xx', 's3cr3t_token-x')).toBe(false)
    expect(verifyWebhookSecret(undefined, 's3cr3t_token-x')).toBe(false)
    expect(verifyWebhookSecret('', 's3cr3t_token-x')).toBe(false)
  })
  it('never accepts anything when no secret is configured', () => {
    expect(verifyWebhookSecret('', '')).toBe(false)
    expect(verifyWebhookSecret('x', '')).toBe(false)
  })
})

describe('link codes', () => {
  it('are 32 url-safe chars: a valid /start payload, unguessable', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateTelegramLinkCode()))
    expect(codes.size).toBe(50)
    for (const c of codes) {
      expect(c).toMatch(/^[A-Za-z0-9_-]{32}$/)
      expect(isValidStartPayload(c)).toBe(true)
    }
  })
  it('the t.me link carries the code as the start payload', () => {
    expect(telegramStartLink('@MimoiaBot', 'abc')).toBe('https://t.me/MimoiaBot?start=abc')
  })
  it('last 10 minutes, like WhatsApp’s', () => {
    expect(TG_LINK_CODE_TTL_MS).toBe(10 * 60 * 1000)
  })
})

describe('isTelegramConfigured', () => {
  it('is off without the token (or the secret, or the username)', () => {
    expect(isTelegramConfigured({ token: '', secret: 's', username: 'bot' })).toBe(false)
    expect(isTelegramConfigured({ token: 't', secret: '', username: 'bot' })).toBe(false)
    expect(isTelegramConfigured({ token: 't', secret: 's', username: '' })).toBe(false)
    expect(isTelegramConfigured({ token: 't', secret: 's', username: 'bot' })).toBe(true)
  })
})

// ─── The inbound flow, with fakes ──────────────────────────────────

interface Code { userId: string; expiresAt: Date; usedAt: Date | null }

function harness(opts: { paused?: boolean; overBudget?: boolean; reply?: string } = {}) {
  const codes = new Map<string, Code>()
  const links = new Map<string, { userId: string; history: TelegramHistoryEntry[]; lastUpdateId: number | null }>()
  const sent: { chatId: string; send: TelegramSend }[] = []
  const chats: { userId: string; message: string; opts: ChatOptions }[] = []
  const deps: TelegramDeps = {
    webUrl: 'https://mimoia.com',
    now: () => NOW,
    store: {
      getLinkByChat: async (chatId) => links.get(chatId) ?? null,
      // Same rules as store.ts: unknown, used or expired → null; the chat moves to the code's owner.
      consumeLinkCode: async (code, chatId, now) => {
        const c = codes.get(code)
        if (!c || c.usedAt || c.expiresAt <= now) return null
        c.usedAt = now
        for (const [id, l] of links) if (l.userId === c.userId) links.delete(id)
        links.set(chatId, { userId: c.userId, history: [], lastUpdateId: null })
        return { userId: c.userId }
      },
      claimUpdate: async (chatId, updateId) => {
        const l = links.get(chatId)
        if (!l || (l.lastUpdateId !== null && l.lastUpdateId >= updateId)) return false
        l.lastUpdateId = updateId
        return true
      },
      appendHistory: async (chatId, entries) => {
        const l = links.get(chatId)
        if (l) l.history.push(...entries)
      },
    },
    client: {
      sendMessage: async (chatId, send) => {
        sent.push({ chatId, send })
        return 1
      },
      sendTyping: async () => {},
    },
    chat: async (userId, message, _history, o) => {
      chats.push({ userId, message, opts: o })
      return { message: opts.reply ?? 'Hecho:\n- *Jueves*: lentejas', usage: { inputTokens: 1, outputTokens: 1 } as any }
    },
    checkBudget: async () => ({ exceeded: opts.overBudget === true, budgetMicros: 5_000_000 }),
    isPaused: async () => opts.paused === true,
    recordUsage: async () => {},
  }
  const texts = () => sent.map((s) => s.send.text)
  return { deps, codes, links, sent, chats, texts }
}

const inbound = (text: string | null, updateId = 100, extra: Record<string, unknown> = {}) =>
  parseTelegramUpdate(update(text === null ? { voice: { file_id: 'v' }, ...extra } : { text, ...extra }, updateId))!

describe('processTelegramUpdate', () => {
  it('a chat that is not linked gets the «sin cuenta» text, and Mimo is never called', async () => {
    const h = harness()
    await processTelegramUpdate(inbound('hazme el menú'), h.deps)
    expect(h.texts()).toEqual([toTelegramHtml(TELEGRAM_COPY.notLinked)])
    expect(TELEGRAM_COPY.notLinked).toBe(
      'Hola, soy Mimo, de Mimoia, una inteligencia artificial. Para hablar conmigo aquí, conecta Telegram desde tu perfil en mimoia.com.',
    )
    expect(h.chats).toEqual([])
  })

  it('/start <code> links the chat once and sends the approved first message', async () => {
    const h = harness()
    h.codes.set('codigo_ok', { userId: 'u1', expiresAt: new Date(NOW.getTime() + 60_000), usedAt: null })
    await processTelegramUpdate(inbound('/start codigo_ok'), h.deps)
    expect(h.links.get('4242')?.userId).toBe('u1')
    expect(h.texts()).toEqual([toTelegramHtml(TELEGRAM_COPY.linked)])
    expect(TELEGRAM_COPY.linked).toContain('Ya estamos conectados con tu cuenta.')
    expect(TELEGRAM_COPY.linked.split('\n')).toHaveLength(3)

    // The same code from another chat: used up → that chat stays unlinked.
    const other = harness()
    other.codes.set('codigo_ok', h.codes.get('codigo_ok')!)
    await processTelegramUpdate(parseTelegramUpdate({ ...update({ text: '/start codigo_ok' }), message: { ...update({}).message, text: '/start codigo_ok', chat: { id: 777, type: 'private' } } })!, other.deps)
    expect(other.links.size).toBe(0)
    expect(other.texts()).toEqual([toTelegramHtml(TELEGRAM_COPY.notLinked)])
  })

  it('an expired code does not link', async () => {
    const h = harness()
    h.codes.set('viejo', { userId: 'u1', expiresAt: new Date(NOW.getTime() - 1), usedAt: null })
    await processTelegramUpdate(inbound('/start viejo'), h.deps)
    expect(h.links.size).toBe(0)
    expect(h.texts()).toEqual([toTelegramHtml(TELEGRAM_COPY.notLinked)])
  })

  it('a linked chat talks to Mimo with WhatsApp’s engine mode and the history is kept', async () => {
    const h = harness()
    h.links.set('4242', { userId: 'u1', history: [], lastUpdateId: null })
    await processTelegramUpdate(inbound('pon lentejas el jueves', 101), h.deps)
    expect(h.chats).toHaveLength(1)
    expect(h.chats[0]).toMatchObject({ userId: 'u1', message: 'pon lentejas el jueves', opts: { mode: 'whatsapp', surface: 'telegram', onboarding: false } })
    expect(h.texts()).toEqual(['Hecho:\n- <b>Jueves</b>: lentejas'])
    expect(h.links.get('4242')!.history.map((e) => e.direction)).toEqual(['in', 'out'])

    // A retry of the same update is dropped.
    await processTelegramUpdate(inbound('pon lentejas el jueves', 101), h.deps)
    expect(h.chats).toHaveLength(1)
  })

  it('voice notes and photos get the text-only notice; HUMANO the contact; no paid work', async () => {
    const h = harness()
    h.links.set('4242', { userId: 'u1', history: [], lastUpdateId: null })
    await processTelegramUpdate(inbound(null, 102), h.deps)
    await processTelegramUpdate(inbound('HUMANO', 103), h.deps)
    expect(h.texts()[0]).toBe(toTelegramHtml(TELEGRAM_COPY.unsupported))
    expect(h.texts()[1]).toMatch(/persona del equipo/)
    expect(h.chats).toEqual([])
  })

  it('the € budget and the paused account stop the turn before Mimo', async () => {
    const over = harness({ overBudget: true })
    over.links.set('4242', { userId: 'u1', history: [], lastUpdateId: null })
    await processTelegramUpdate(inbound('hola', 104), over.deps)
    expect(over.texts()[0]).toMatch(/límite mensual/)
    expect(over.chats).toEqual([])

    const paused = harness({ paused: true })
    paused.links.set('4242', { userId: 'u1', history: [], lastUpdateId: null })
    await processTelegramUpdate(inbound('hola', 105), paused.deps)
    expect(paused.texts()[0]).toMatch(/en pausa/)
    expect(paused.chats).toEqual([])
  })

  it('[[opciones]] become a one-time reply keyboard', async () => {
    const h = harness({ reply: '¿Lo cambio? [[opciones: Sí | No]]' })
    h.links.set('4242', { userId: 'u1', history: [], lastUpdateId: null })
    await processTelegramUpdate(inbound('cambia el jueves', 106), h.deps)
    expect(h.sent[0].send).toMatchObject({
      text: '¿Lo cambio?',
      reply_markup: { keyboard: [[{ text: 'Sí' }, { text: 'No' }]], one_time_keyboard: true },
    })
  })
})

describe('health rule on Telegram', () => {
  it('a Telegram turn runs the engine in WhatsApp mode, so the skills see channel whatsapp', () => {
    expect(TELEGRAM_CHAT_OPTIONS.mode).toBe('whatsapp')
  })

  it('update_memory and update_profile refuse health data in that channel', async () => {
    const channel = TELEGRAM_CHAT_OPTIONS.mode
    const mem = await skills.find((s) => s.name === 'update_memory')!.handler(
      { facts: [{ key: 'restrictions', value: ['sin gluten'] }] },
      { userId: 'u1', db: null, channel },
    )
    expect(mem.data).toBeNull()
    expect(mem.summary).toMatch(/no guardo datos de salud/)

    const writes: string[] = []
    const api: AppApi = async (method, path) => {
      if (method !== 'GET') writes.push(`${method} ${path}`)
      return { active: true } as any
    }
    await appSkills.find((s) => s.name === 'update_profile')!.handler({ addRestrictions: ['sin lactosa'], weight: 70 }, { userId: 'u1', db: null, api, channel })
    expect(writes).toEqual([])
  })

  it('the prompt says Telegram, keeps the health rule and the shop links’ WhatsApp', () => {
    const p = buildSystemPrompt('ctx', 'whatsapp', { surface: 'telegram' })
    expect(p).toContain('Canal Telegram (instrucciones obligatorias).')
    expect(p).toContain('- Por Telegram nunca guardas datos de salud')
    expect(p).toContain('por Telegram nunca guardas datos de salud')
    expect(p).not.toContain('Canal WhatsApp (instrucciones obligatorias).')
    expect(p).not.toContain('que escriba BAJA')
    expect(p).toContain('abre el WhatsApp del usuario')
    // WhatsApp's own prompt is untouched.
    const wa = buildSystemPrompt('ctx', 'whatsapp')
    expect(wa).toContain('Canal WhatsApp (instrucciones obligatorias).')
    expect(wa).not.toContain('Telegram')
  })

  it('its turns are metered as telegram_chat', () => {
    expect(chatFeatureFor('telegram')).toBe('telegram_chat')
    expect(chatFeatureFor('whatsapp')).toBe('whatsapp_chat')
    expect(chatFeatureFor(null)).toBe('assistant_chat')
  })
})

describe('format and history', () => {
  it('escapes HTML and turns *bold* into <b>, leaving underscores in links alone', () => {
    expect(toTelegramHtml('*Lunes* <3 & https://mimoia.com/a_b_c')).toBe('<b>Lunes</b> &lt;3 &amp; https://mimoia.com/a_b_c')
    expect(toTelegramSends([{ type: 'text', text: 'hola' }])[0]).toMatchObject({ parse_mode: 'HTML', text: 'hola' })
  })

  it('keeps 12 h of history, at most 40 entries', () => {
    const at = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()
    const e = (h: number): TelegramHistoryEntry => ({ direction: 'in', kind: 'text', body: 'x', status: 'processed', createdAt: at(h) })
    expect(pruneHistory([e(13), e(11), e(1)], NOW)).toHaveLength(2)
    expect(pruneHistory(Array.from({ length: 50 }, () => e(0)), NOW)).toHaveLength(40)
  })
})

// ─── Routes: off without the token; the secret guards the webhook ──

describe('routes', () => {
  let server: Server | undefined
  let base = ''
  let env: typeof import('../config/env.js').env

  beforeAll(async () => {
    // Nothing listens here: a request that reached the database would fail.
    process.env.DATABASE_URL ??= 'postgresql://nobody:nothing@127.0.0.1:1/none'
    env = (await import('../config/env.js')).env
    const { default: telegramRoutes } = await import('../routes/telegram.js')
    const a = express()
    a.use(express.json())
    a.use(telegramRoutes)
    server = await new Promise<Server>((resolve) => {
      const s = a.listen(0, '127.0.0.1', () => resolve(s))
    })
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    env.TELEGRAM_BOT_TOKEN = ''
    env.TELEGRAM_WEBHOOK_SECRET = ''
    env.TELEGRAM_BOT_USERNAME = ''
    server?.closeAllConnections()
    server?.close()
  })

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

  it('without TELEGRAM_BOT_TOKEN both routes answer 404', async () => {
    env.TELEGRAM_BOT_TOKEN = ''
    env.TELEGRAM_WEBHOOK_SECRET = 'secreto'
    env.TELEGRAM_BOT_USERNAME = 'MimoiaBot'
    expect((await post('/telegram/webhook', update({ text: 'hola' }), { 'X-Telegram-Bot-Api-Secret-Token': 'secreto' })).status).toBe(404)
    const code = await post('/telegram/link-code', {})
    expect(code.status).toBe(404)
    expect(await code.json()).toMatchObject({ code: 'TELEGRAM_DISABLED' })
  })

  it('switched on, the webhook wants the secret header', async () => {
    env.TELEGRAM_BOT_TOKEN = 'token'
    env.TELEGRAM_WEBHOOK_SECRET = 'secreto'
    env.TELEGRAM_BOT_USERNAME = 'MimoiaBot'
    expect((await post('/telegram/webhook', update({ text: 'hola' }))).status).toBe(401)
    expect((await post('/telegram/webhook', update({ text: 'hola' }), { 'X-Telegram-Bot-Api-Secret-Token': 'otro' })).status).toBe(401)
    // A group message: accepted (200) and ignored.
    const group = update({ text: 'hola', chat: { id: -1, type: 'group' } })
    expect((await post('/telegram/webhook', group, { 'X-Telegram-Bot-Api-Secret-Token': 'secreto' })).status).toBe(200)
    // The link code still needs a signed-in user.
    expect((await post('/telegram/link-code', {})).status).toBe(401)
  })
})
