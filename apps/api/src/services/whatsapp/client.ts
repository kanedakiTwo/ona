import { env } from '../../config/env.js'
import type { OutboundMessage } from './render.js'

/**
 * Thin WhatsApp Cloud API (Graph) client. Every call is a plain fetch so the
 * base URL can point at a local mock (`WHATSAPP_GRAPH_BASE_URL`) in E2E.
 */

export class GraphApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'GraphApiError'
    this.status = status
  }
}

const TIMEOUT_MS = 20_000
/** Voice notes and photos are small; anything bigger is not for us. */
const MAX_MEDIA_BYTES = 16 * 1024 * 1024

function graphUrl(path: string): string {
  return `${env.WHATSAPP_GRAPH_BASE_URL}/${env.WHATSAPP_GRAPH_VERSION}/${path.replace(/^\//, '')}`
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` }
}

async function postMessages(body: Record<string, unknown>): Promise<any> {
  const r = await fetch(graphUrl(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const json: any = await r.json().catch(() => ({}))
  if (!r.ok) {
    throw new GraphApiError(r.status, json?.error?.message ?? `Graph API ${r.status}`)
  }
  return json
}

/** Returns Meta's wamid for the sent message. */
export async function sendMessage(to: string, msg: OutboundMessage): Promise<string | null> {
  const body =
    msg.type === 'text'
      ? { to, type: 'text', text: { body: msg.text, preview_url: false } }
      : {
          to,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: msg.text },
            action: {
              buttons: msg.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
            },
          },
        }
  const json = await postMessages(body)
  return json?.messages?.[0]?.id ?? null
}

/**
 * Approved template with one `{{1}}` body variable — the only way to start a
 * conversation outside Meta's 24 h customer-service window.
 */
export async function sendTemplate(
  to: string,
  name: string,
  lang: string,
  bodyText: string,
): Promise<string | null> {
  const json = await postMessages({
    to,
    type: 'template',
    template: {
      name,
      language: { code: lang },
      components: [{ type: 'body', parameters: [{ type: 'text', text: bodyText.slice(0, 1000) }] }],
    },
  })
  return json?.messages?.[0]?.id ?? null
}

/** Blue ticks + "escribiendo…" while the assistant works. Best effort. */
export async function markReadWithTyping(wamid: string): Promise<void> {
  try {
    await postMessages({ status: 'read', message_id: wamid, typing_indicator: { type: 'text' } })
  } catch (err: any) {
    console.warn('[whatsapp] markRead failed (ignored):', err?.message ?? err)
  }
}

/** Two-step media fetch: `/{media-id}` → short-lived URL → bytes (both need the token). */
export async function downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const meta = await fetch(graphUrl(mediaId), {
    headers: authHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const info: any = await meta.json().catch(() => ({}))
  if (!meta.ok || typeof info?.url !== 'string') {
    throw new GraphApiError(meta.status, info?.error?.message ?? 'No se pudo obtener el archivo')
  }
  if (typeof info.file_size === 'number' && info.file_size > MAX_MEDIA_BYTES) {
    throw new GraphApiError(413, 'Archivo demasiado grande')
  }
  const file = await fetch(info.url, { headers: authHeaders(), signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!file.ok) throw new GraphApiError(file.status, 'No se pudo descargar el archivo')
  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > MAX_MEDIA_BYTES) throw new GraphApiError(413, 'Archivo demasiado grande')
  return { buffer, mimeType: (info.mime_type as string) ?? file.headers.get('content-type') ?? 'application/octet-stream' }
}
