/**
 * Pure parser: Meta webhook payload → the inbound messages Mimoia cares about.
 *
 * Meta batches `entry[].changes[].value.messages[]`; the same payload shape
 * also carries delivery `statuses[]` (sent/delivered/read) which we ignore.
 * Anything malformed is skipped rather than thrown — the webhook must still
 * answer 200 or Meta retries the batch forever.
 */

export type InboundKind = 'text' | 'audio' | 'image' | 'interactive' | 'unsupported'

export interface InboundMessage {
  wamid: string
  /** Sender wa_id: digits only, country code included. */
  from: string
  /** Epoch seconds as reported by Meta. */
  timestamp: number
  profileName: string | null
  kind: InboundKind
  /** text body · image caption · tapped button/list title. */
  text: string | null
  /** Media id for audio/image (download via Graph `/{media-id}`). */
  mediaId: string | null
  mimeType: string | null
  /** Id of the tapped reply button / list row (interactive only). */
  replyId: string | null
  /** Raw Meta type, kept for logging unsupported kinds. */
  rawType: string
}

export function parseWebhookPayload(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = []
  const p = payload as any
  if (!p || p.object !== 'whatsapp_business_account' || !Array.isArray(p.entry)) return out

  for (const entry of p.entry) {
    if (!Array.isArray(entry?.changes)) continue
    for (const change of entry.changes) {
      if (change?.field !== 'messages') continue
      const value = change.value ?? {}
      const contacts: any[] = Array.isArray(value.contacts) ? value.contacts : []
      const messages: any[] = Array.isArray(value.messages) ? value.messages : []
      for (const m of messages) {
        const parsed = parseMessage(m, contacts)
        if (parsed) out.push(parsed)
      }
    }
  }
  return out
}

function parseMessage(m: any, contacts: any[]): InboundMessage | null {
  if (!m || typeof m.id !== 'string' || typeof m.from !== 'string') return null
  const from = m.from.replace(/\D/g, '')
  if (!from) return null
  const contact = contacts.find((c) => c?.wa_id === m.from) ?? contacts[0]
  const base: InboundMessage = {
    wamid: m.id,
    from,
    timestamp: Number(m.timestamp) || Math.floor(Date.now() / 1000),
    profileName: typeof contact?.profile?.name === 'string' ? contact.profile.name : null,
    kind: 'unsupported',
    text: null,
    mediaId: null,
    mimeType: null,
    replyId: null,
    rawType: typeof m.type === 'string' ? m.type : 'unknown',
  }

  switch (m.type) {
    case 'text':
      if (typeof m.text?.body !== 'string') return base
      return { ...base, kind: 'text', text: m.text.body }
    case 'audio':
      if (typeof m.audio?.id !== 'string') return base
      return { ...base, kind: 'audio', mediaId: m.audio.id, mimeType: m.audio.mime_type ?? null }
    case 'image':
      if (typeof m.image?.id !== 'string') return base
      return {
        ...base,
        kind: 'image',
        mediaId: m.image.id,
        mimeType: m.image.mime_type ?? null,
        text: typeof m.image.caption === 'string' ? m.image.caption : null,
      }
    case 'interactive': {
      const reply = m.interactive?.button_reply ?? m.interactive?.list_reply
      if (!reply || typeof reply.title !== 'string') return base
      return { ...base, kind: 'interactive', text: reply.title, replyId: reply.id ?? null }
    }
    case 'button':
      // Quick-reply button on a template message.
      if (typeof m.button?.text !== 'string') return base
      return { ...base, kind: 'interactive', text: m.button.text, replyId: m.button.payload ?? null }
    default:
      return base
  }
}
