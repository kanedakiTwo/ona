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

/**
 * Last line of every message Mimo sends on its own inside WhatsApp's 24 h
 * window (PRO-1169, LEG-34 text 5). Added by the code, never by the model.
 */
export const AI_SIGNATURE = `— ${ASSISTANT_NAME}, asistente con IA`

/**
 * Footer of the WhatsApp templates (outside the 24 h window; LEG-34 text 4).
 * Registered by hand in WhatsApp Manager (MIG-05), not sent by the code:
 * kept here so the text lives in one place. Meta's limit is 60 characters.
 */
export const AI_TEMPLATE_FOOTER = `${ASSISTANT_NAME}, asistente con IA. Responde BAJA para no recibir avisos`
