import { AI_DISCLOSURE_FIRST_PERSON, AI_SIGNATURE } from '@ona/shared'
import { WA_BUTTON_BODY_MAX, WA_TEXT_MAX } from './format.js'
import { WA_CAPTION_MAX, type OutboundMessage } from './render.js'

/**
 * Pure: the AI notices the code (not the model) adds to WhatsApp messages
 * (PRO-1169, AI Act art. 50.1, LEG-34):
 *   - `withAiSignature`: a message Mimo sends on its own inside the 24 h
 *     window ends with «— Mimo, asistente con IA»;
 *   - `withReturnDisclosure`: the first message to someone who hadn't
 *     written in 30 days or more starts with `AI_DISCLOSURE_FIRST_PERSON`.
 * When the text would no longer fit (button body, caption), the notice goes
 * as its own text message, after or before.
 */

/** A person who hadn't written in this long hears the AI disclosure again. */
export const RETURN_DISCLOSURE_AFTER_MS = 30 * 24 * 60 * 60 * 1000

export function needsReturnDisclosure(lastInboundAt: Date | null | undefined, now: Date): boolean {
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() >= RETURN_DISCLOSURE_AFTER_MS
}

function maxFor(m: OutboundMessage): number {
  if (m.type === 'buttons') return WA_BUTTON_BODY_MAX
  if (m.type === 'image') return WA_CAPTION_MAX
  return WA_TEXT_MAX
}

function fits(m: OutboundMessage, text: string): OutboundMessage | null {
  return text.length <= maxFor(m) ? { ...m, text } : null
}

const SIGNATURE_SEPARATOR = '\n\n'

export function withAiSignature(messages: OutboundMessage[]): OutboundMessage[] {
  if (messages.length === 0) return messages
  const last = messages[messages.length - 1]
  if (last.text.endsWith(AI_SIGNATURE)) return messages
  const signed = fits(last, `${last.text}${SIGNATURE_SEPARATOR}${AI_SIGNATURE}`)
  if (signed) return [...messages.slice(0, -1), signed]
  return [...messages, { type: 'text', text: AI_SIGNATURE }]
}

export function withReturnDisclosure(messages: OutboundMessage[]): OutboundMessage[] {
  if (messages.length === 0) return messages
  const [first, ...rest] = messages
  if (first.text.startsWith(AI_DISCLOSURE_FIRST_PERSON)) return messages
  const opened = fits(first, `${AI_DISCLOSURE_FIRST_PERSON}\n\n${first.text}`)
  // A picture that fails sends its fallback instead: that one opens with it too.
  if (opened?.type === 'image') return [{ ...opened, fallback: withReturnDisclosure(opened.fallback) }, ...rest]
  if (opened) return [opened, ...rest]
  return [{ type: 'text', text: AI_DISCLOSURE_FIRST_PERSON }, ...messages]
}

/** The signature out of a stored body, so the model never sees it as its own words (and copies it). */
export function stripAiSignature(text: string): string {
  if (text.trim() === AI_SIGNATURE) return ''
  return text.endsWith(`${SIGNATURE_SEPARATOR}${AI_SIGNATURE}`) ? text.slice(0, -(SIGNATURE_SEPARATOR.length + AI_SIGNATURE.length)) : text
}
