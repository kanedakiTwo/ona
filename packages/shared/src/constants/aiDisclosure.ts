import { ASSISTANT_NAME } from './brand.js'

/**
 * EU AI Act art. 50(1) (in force since 2026-08-02): people must be told they
 * are interacting with an AI system, clearly, no later than the first
 * interaction. Every surface where a user talks to the assistant (Mimo) — web
 * chat, voice mode, WhatsApp — shows one of these. Keep them in sync here,
 * never inline.
 */

/** Third person, for UI captions next to the chat or voice surface. */
export const AI_DISCLOSURE =
  `${ASSISTANT_NAME} es un asistente de inteligencia artificial (IA): puede equivocarse y no sustituye a un profesional sanitario.`

/** First person, for the assistant's own first message in a conversation (WhatsApp). */
export const AI_DISCLOSURE_FIRST_PERSON =
  'Soy un asistente de inteligencia artificial (IA): puedo equivocarme y no sustituyo a un profesional sanitario.'

/** Short form for tight spaces where the full sentence doesn't fit (voice overlay). */
export const AI_DISCLOSURE_SHORT = 'Estás hablando con una IA.'
