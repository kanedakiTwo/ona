import type { AssistantResponse, ChatMessage } from '../assistant/types.js'
import type { ChatOptions } from '../assistant/engine.js'
import type { TokenUsage } from '../advisorBudget.js'
import type { InboundMessage } from './webhookParser.js'
import type { LinkWithUser } from './store.js'
import { buildChatHistory, HISTORY_WINDOW_MS, type HistoryRow } from './history.js'
import { connectUrl, extractLinkCodeCandidates } from './linking.js'
import { renderAssistantReply, renderPlainText, type OutboundMessage } from './render.js'
import { AI_DISCLOSURE_FIRST_PERSON } from '@ona/shared'

/**
 * Inbound orchestrator: one WhatsApp message in → zero or more replies out.
 *
 * Everything with side effects arrives through `deps`, so the whole flow
 * (linking, gating, budget, transcription, recipe import, chat) is unit-tested
 * with fakes in `whatsappInbound.test.ts`. The webhook route wires the real
 * implementations in `wiring.ts`.
 */

export interface InboundDeps {
  webUrl: string
  now: () => Date
  isUserAllowed: (email: string) => boolean
  store: {
    getLinkByPhone: (phone: string) => Promise<LinkWithUser | null>
    consumeLinkCode: (code: string, phone: string, profileName: string | null) => Promise<{ userId: string } | null>
    touchInbound: (phone: string, at: Date) => Promise<void>
    updateInbound: (
      wamid: string,
      patch: {
        status: string
        body?: string | null
        userId?: string | null
        errorMessage?: string | null
        meta?: { tools?: string[]; corrections?: string[]; ms?: number }
      },
    ) => Promise<void>
    insertOutbound: (row: {
      phone: string
      userId: string | null
      kind: string
      body: string
      status: 'sent' | 'failed'
      wamid?: string | null
      errorMessage?: string | null
    }) => Promise<void>
    loadHistoryRows: (phone: string, since: Date, userId: string) => Promise<HistoryRow[]>
    hasRecentOutbound: (phone: string, kinds: string[], since: Date) => Promise<boolean>
  }
  client: {
    sendMessage: (to: string, msg: OutboundMessage) => Promise<string | null>
    markReadWithTyping: (wamid: string) => Promise<void>
    downloadMedia: (mediaId: string) => Promise<{ buffer: Buffer; mimeType: string }>
  }
  chat: (
    userId: string,
    message: string,
    history: ChatMessage[],
    opts: ChatOptions,
  ) => Promise<AssistantResponse & { usage: TokenUsage }>
  checkBudget: (userId: string) => Promise<{ exceeded: boolean; budgetMicros: number }>
  recordUsage: (userId: string, usage: TokenUsage) => Promise<void>
  /** Speech-to-text for voice notes. Absent → voice notes get a polite "escríbemelo". */
  transcribe?: (audio: Buffer, mimeType: string) => Promise<string>
  /** Silence before the generic "me pongo con ello" (ms). Tests shorten it. */
  ackAfterMs?: number
  /** Photo of a recipe → saved recipe. Absent → photos get a polite "todavía no". */
  importRecipeFromImage?: (
    image: Buffer,
    mimeType: string,
    userId: string,
  ) => Promise<{ recipeId: string; name: string; warnings: string[] }>
}

export const COPY = {
  linked: (name: string | null) =>
    `¡Listo${name ? `, ${name}` : ''}! Tu WhatsApp ya está conectado con ONA. Pregúntame qué toca hoy, pídeme la lista de la compra, mándame un audio o compárteme una receta (enlace o foto) para guardarla.\n\n${AI_DISCLOSURE_FIRST_PERSON}`,
  badCode: 'Ese código no es válido o ha caducado. Genera uno nuevo en ONA → Perfil → Ona en WhatsApp.',
  connect: (url: string) =>
    `Hola, soy ONA, tu asistente de cocina. ${AI_DISCLOSURE_FIRST_PERSON}\n\nPara hablar conmigo por aquí, conecta tu cuenta:\n${url}\n\nEntra (o crea tu cuenta) y te daré un código para enviarme desde este chat.`,
  suspended: 'Tu cuenta de ONA está suspendida. Contacta con el equipo de ONA si crees que es un error.',
  notAllowed: 'WhatsApp todavía no está disponible para tu cuenta de ONA.',
  budget: (euros: string) =>
    `Has alcanzado tu límite mensual del asistente (€${euros}). Se renueva el mes que viene.`,
  unsupported: 'Todavía no entiendo ese tipo de mensaje. Escríbeme, mándame una nota de voz o una foto de una receta.',
  audioUnavailable: 'Ahora mismo no puedo escuchar audios. ¿Me lo escribes?',
  audioFailed: 'No he podido entender el audio. ¿Me lo repites o me lo escribes?',
  imageUnavailable: 'Todavía no puedo leer fotos por aquí. Mándame el enlace de la receta o escríbemela.',
  imageNotRecipe: 'No he encontrado ninguna receta en esa foto. Prueba con una foto más nítida de la receta (ingredientes y pasos).',
  imageFailed: 'No he podido procesar la foto. Inténtalo de nuevo en un momento.',
  error: 'Vaya, algo ha fallado. Inténtalo de nuevo en un momento.',
  working: 'Un momento, me pongo con ello…',
  ackPhoto: 'Recibida la foto. Voy a leer la receta, dame unos segundos…',
}

/** Slow skills get an immediate, specific "on it" instead of waiting for the timer. */
const SLOW_SKILL_ACK: Record<string, string> = {
  generate_weekly_menu: 'Vale, preparo el menú. Dame unos segundos…',
  import_recipe_from_url: 'Voy a leer esa receta, tardo un momento…',
  recipe_variation: 'Preparo la variación de la receta, dame unos segundos…',
  create_recipe: 'Guardando la receta, un momento…',
}

export function ackTextForTools(toolNames: string[]): string | null {
  for (const name of toolNames) if (SLOW_SKILL_ACK[name]) return SLOW_SKILL_ACK[name]
  return null
}

/** Default silence before the generic ack — the user asked for one past ~10 s. */
export const ACK_AFTER_MS = 8_000

/**
 * "Me pongo con ello" — at most one per turn, never after the reply. `now()`
 * sends immediately (slow skill / photo); `arm()` sends the generic text if the
 * turn is still silent after `delayMs`; `settle()` must run before the final
 * reply: it cancels the timer and waits for an in-flight ack so the ack can't
 * land after the answer.
 */
export function createAcker(send: (text: string) => Promise<void>, delayMs: number) {
  let state: 'idle' | 'sent' | 'settled' = 'idle'
  let inflight: Promise<void> = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | null = null
  const now = (text: string) => {
    if (state !== 'idle') return
    state = 'sent'
    if (timer) clearTimeout(timer)
    inflight = send(text).catch(() => {})
  }
  return {
    now,
    arm(text: string = COPY.working) {
      if (state === 'idle' && delayMs > 0) timer = setTimeout(() => now(text), delayMs)
    },
    async settle() {
      if (state === 'idle') state = 'settled'
      if (timer) clearTimeout(timer)
      await inflight
    },
  }
}

/**
 * Meta retries undelivered webhooks for days. Answering "¿qué ceno hoy?"
 * two days late is worse than silence, so stale messages are dropped.
 */
export const STALE_MESSAGE_MS = 2 * 60 * 60 * 1000
/** Unlinked numbers get the "conecta tu cuenta" hint at most once an hour. */
const CONNECT_HINT_COOLDOWN_MS = 60 * 60 * 1000

export async function processInbound(msg: InboundMessage, deps: InboundDeps): Promise<void> {
  const { store, client } = deps
  const now = deps.now()

  if (now.getTime() - msg.timestamp * 1000 > STALE_MESSAGE_MS) {
    await store.updateInbound(msg.wamid, { status: 'ignored', errorMessage: 'stale' })
    return
  }

  const send = async (userId: string | null, kind: string, messages: OutboundMessage[]) => {
    for (const m of messages) {
      const body = m.text
      try {
        const wamid = await client.sendMessage(msg.from, m)
        await store.insertOutbound({ phone: msg.from, userId, kind, body, status: 'sent', wamid })
      } catch (err: any) {
        console.error('[whatsapp] send failed:', err?.message ?? err)
        await store.insertOutbound({
          phone: msg.from,
          userId,
          kind,
          body,
          status: 'failed',
          errorMessage: String(err?.message ?? err).slice(0, 500),
        })
      }
    }
  }
  const sendText = (userId: string | null, kind: string, text: string) => send(userId, kind, renderPlainText(text))

  await client.markReadWithTyping(msg.wamid)

  // ── 1. Who is this? ────────────────────────────────────────────
  const link = await store.getLinkByPhone(msg.from)
  if (!link) {
    const candidates = msg.kind === 'text' ? extractLinkCodeCandidates(msg.text) : []
    for (const code of candidates) {
      const linked = await store.consumeLinkCode(code, msg.from, msg.profileName)
      if (linked) {
        await store.updateInbound(msg.wamid, { status: 'ignored', userId: linked.userId })
        await sendText(linked.userId, 'system', COPY.linked(msg.profileName))
        return
      }
    }
    await store.updateInbound(msg.wamid, { status: 'ignored' })
    if (candidates.length > 0) {
      await sendText(null, 'link', COPY.badCode)
      return
    }
    // WhatsApp-first linking (Instinct-style "just text it"): point to the
    // connect page, which has the logged-in user send a code back from this
    // phone. At most one such message per number per hour.
    const since = new Date(now.getTime() - CONNECT_HINT_COOLDOWN_MS)
    if (!(await store.hasRecentOutbound(msg.from, ['link'], since))) {
      await sendText(null, 'link', COPY.connect(connectUrl(deps.webUrl)))
    }
    return
  }

  const userId = link.userId
  await store.touchInbound(msg.from, now)

  if (link.suspendedAt) {
    await store.updateInbound(msg.wamid, { status: 'ignored', userId })
    await sendText(userId, 'system', COPY.suspended)
    return
  }
  if (!deps.isUserAllowed(link.email)) {
    await store.updateInbound(msg.wamid, { status: 'ignored', userId })
    await sendText(userId, 'system', COPY.notAllowed)
    return
  }

  // From here on a turn can take a while (transcription, the model, a menu
  // generation): every outbound goes through `out`/`outText`, which settle the
  // ack first so "me pongo con ello" never arrives after the answer.
  const acker = createAcker((text) => sendText(userId, 'ack', text), deps.ackAfterMs ?? ACK_AFTER_MS)
  const out = async (kind: string, messages: OutboundMessage[]) => {
    await acker.settle()
    await send(userId, kind, messages)
  }
  const outText = (kind: string, text: string) => out(kind, renderPlainText(text))

  try {
    // ── 2. Budget gate (same cap as the web chat), before ANY paid work:
    // transcription, photo extraction and the chat itself.
    if (msg.kind !== 'unsupported') {
      const budget = await deps.checkBudget(userId)
      if (budget.exceeded) {
        await store.updateInbound(msg.wamid, { status: 'ignored', userId })
        await outText('system', COPY.budget((budget.budgetMicros / 1_000_000).toFixed(0)))
        return
      }
    }
    acker.arm()

    // ── 3. Normalise the message to text ───────────────────────
    let text: string | null = null
    switch (msg.kind) {
      case 'text':
      case 'interactive':
        text = msg.text?.trim() || null
        break
      case 'audio': {
        if (!deps.transcribe || !msg.mediaId) {
          await store.updateInbound(msg.wamid, { status: 'ignored', userId })
          await outText('system', COPY.audioUnavailable)
          return
        }
        try {
          const media = await client.downloadMedia(msg.mediaId)
          text = (await deps.transcribe(media.buffer, msg.mimeType ?? media.mimeType)).trim() || null
        } catch (err: any) {
          console.error('[whatsapp] transcription failed:', err?.message ?? err)
          text = null
        }
        if (!text) {
          await store.updateInbound(msg.wamid, { status: 'failed', userId, errorMessage: 'transcription-empty-or-failed' })
          await outText('system', COPY.audioFailed)
          return
        }
        break
      }
      case 'image':
        await handleImage(msg, userId, deps, out, outText, acker)
        return
      default:
        await store.updateInbound(msg.wamid, { status: 'ignored', userId })
        await outText('system', COPY.unsupported)
        return
    }

    if (!text) {
      await acker.settle()
      await store.updateInbound(msg.wamid, { status: 'ignored', userId })
      return
    }

    // ── 4. Chat ────────────────────────────────────────────────
    const rows = await store.loadHistoryRows(msg.from, new Date(now.getTime() - HISTORY_WINDOW_MS), userId)
    const history = buildChatHistory(rows, now)
    const { usage, ...response } = await deps.chat(userId, text, history, {
      mode: 'whatsapp',
      onToolStart: (names) => {
        const ack = ackTextForTools(names)
        if (ack) acker.now(ack)
      },
    })
    try {
      await deps.recordUsage(userId, usage)
    } catch (err) {
      console.warn('[whatsapp] recordUsage failed (continuing):', err)
    }

    // Mark the inbound processed BEFORE replying so it precedes the reply in
    // history even if a send fails half-way.
    await store.updateInbound(msg.wamid, {
      status: 'processed',
      userId,
      body: text,
      meta: { tools: response.toolsUsed ?? [], corrections: response.corrections ?? [], ms: deps.now().getTime() - now.getTime() },
    })
    await out('reply', renderAssistantReply(response, deps.webUrl))
  } catch (err: any) {
    console.error('[whatsapp] processing failed:', err?.message ?? err)
    await store.updateInbound(msg.wamid, {
      status: 'failed',
      userId,
      errorMessage: String(err?.message ?? err).slice(0, 500),
    })
    await outText('system', COPY.error)
  } finally {
    // Whatever path ended the turn, no "me pongo con ello" after this point.
    await acker.settle()
  }
}

async function handleImage(
  msg: InboundMessage,
  userId: string,
  deps: InboundDeps,
  out: (kind: string, messages: OutboundMessage[]) => Promise<void>,
  outText: (kind: string, text: string) => Promise<void>,
  acker: ReturnType<typeof createAcker>,
): Promise<void> {
  const { store, client } = deps
  if (!deps.importRecipeFromImage || !msg.mediaId) {
    await store.updateInbound(msg.wamid, { status: 'ignored', userId })
    await outText('system', COPY.imageUnavailable)
    return
  }
  // Reading a recipe photo always takes a while (vision + ingredient matching).
  acker.now(COPY.ackPhoto)
  let saved: { recipeId: string; name: string; warnings: string[] }
  try {
    const media = await client.downloadMedia(msg.mediaId)
    saved = await deps.importRecipeFromImage(media.buffer, msg.mimeType ?? media.mimeType, userId)
  } catch (err: any) {
    const notRecipe = /no se pudo identificar|no parece/i.test(String(err?.message ?? ''))
    if (!notRecipe) console.error('[whatsapp] image import failed:', err?.message ?? err)
    await store.updateInbound(msg.wamid, {
      status: 'failed',
      userId,
      errorMessage: String(err?.message ?? err).slice(0, 500),
    })
    await outText('system', notRecipe ? COPY.imageNotRecipe : COPY.imageFailed)
    return
  }

  // History gets a readable trace so "ponla el jueves para cenar" works next.
  await store.updateInbound(msg.wamid, {
    status: 'processed',
    userId,
    body: `[Foto de una receta${msg.text ? `: ${msg.text}` : ''}]`,
  })
  const reviewNote = saved.warnings.length > 0
    ? ' Revisa los ingredientes en la app: alguno no lo he reconocido del todo.'
    : ''
  await out(
    'reply',
    renderAssistantReply(
      {
        message: `He guardado *${saved.name}* en tus recetas.${reviewNote} ¿Quieres que la ponga en el menú de algún día?`,
        uiHint: 'recipe',
        data: { recipeId: saved.recipeId },
      },
      deps.webUrl,
    ),
  )
}

// ─── Per-phone serial queue ──────────────────────────────────────
//
// Two quick messages from the same phone must be answered in order, and the
// second must see the first in its history. Railway runs one API instance,
// so an in-process promise chain per phone is enough.
const queues = new Map<string, Promise<void>>()

export function enqueueInbound(msg: InboundMessage, deps: InboundDeps): Promise<void> {
  const prev = queues.get(msg.from) ?? Promise.resolve()
  const next = prev
    .then(() => processInbound(msg, deps))
    .catch((err) => console.error('[whatsapp] inbound queue error:', err))
  queues.set(msg.from, next)
  void next.finally(() => {
    if (queues.get(msg.from) === next) queues.delete(msg.from)
  })
  return next
}
