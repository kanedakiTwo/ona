import type { DayMenu } from '@ona/shared'
import type { AssistantResponse } from '../assistant/types.js'
import { recipeLinkLines, recipesOfDay } from '../menuText.js'
import {
  WA_BUTTON_BODY_MAX,
  extractOptions,
  splitMessage,
  toWhatsAppMarkup,
} from './format.js'

/**
 * Pure: assistant reply → the WhatsApp messages to send.
 *
 * The web renders rich cards from `uiHint` + `data`; WhatsApp gets the
 * model's text plus a deep link into the app for anything visual.
 */

export type OutboundMessage =
  | { type: 'text'; text: string }
  | { type: 'buttons'; text: string; buttons: { id: string; title: string }[] }
  | {
      /**
       * A picture with a caption (`text`, ≤ 1024 chars): the week's menu
       * after generating it (2026-10-15). `alt` says what the picture shows,
       * for the conversation history. When the upload or the send fails,
       * `fallback` goes out instead — never a reply lost to a picture.
       */
      type: 'image'
      text: string
      image: Buffer
      mimeType: string
      alt: string
      fallback: OutboundMessage[]
    }

/** WhatsApp's limit for an image caption. */
export const WA_CAPTION_MAX = 1024

export function appLinkFor(
  resp: Pick<AssistantResponse, 'uiHint' | 'data'>,
  webUrl: string,
): string | null {
  const data = resp.data && typeof resp.data === 'object' && !Array.isArray(resp.data)
    ? (resp.data as Record<string, unknown>)
    : null
  const recipeId = typeof data?.recipeId === 'string'
    ? data.recipeId
    // get_recipe_details answers with the recipe itself ({ id, name, … }).
    : resp.uiHint === 'recipe' && typeof data?.id === 'string' && typeof data?.name === 'string' ? data.id : null

  if (typeof data?.navigateTo === 'string' && data.navigateTo.startsWith('/')) {
    return `Ábrelo en la app: ${webUrl}${data.navigateTo}`
  }
  switch (resp.uiHint) {
    case 'menu': {
      // PRO-85: one day's menu (get_todays_menu) → each recipe with its link.
      const day = data?.day && typeof data.day === 'object' ? (data.day as DayMenu) : null
      const links = recipeLinkLines(recipesOfDay(day), webUrl)
      return [...links, `Ver menú: ${webUrl}/menu`].join('\n')
    }
    case 'shopping_list':
      return `Ver lista de la compra: ${webUrl}/shopping`
    case 'recipe':
      return recipeId ? `Ver receta: ${webUrl}/recipes/${recipeId}` : null
    case 'cooking_navigate':
      return recipeId ? `Modo cocina: ${webUrl}/recipes/${recipeId}/cook` : null
    case 'cooking_timer':
    case 'cooking_step':
      return 'Los temporizadores y pasos se controlan desde el modo cocina de la app.'
    default:
      return null
  }
}

export function renderAssistantReply(
  resp: Pick<AssistantResponse, 'message' | 'uiHint' | 'data'>,
  webUrl: string,
): OutboundMessage[] {
  const { text: rawText, options } = extractOptions(resp.message ?? '')
  let text = toWhatsAppMarkup(rawText)
  // History stores replies with their link lines, so the model sometimes
  // copies them into its own text — don't add any of them twice. The week
  // digest carries the menu page in its short form ("mimoia.com/menu"), so
  // compare without scheme / www too (2026-10-15: no second «Ver menú»).
  const link = appLinkFor(resp, webUrl)
    ?.split('\n')
    .filter((line) => {
      const url = line.match(/\S+\/\S+$/)?.[0]
      if (!url) return true
      const bare = url.replace(/^https?:\/\//, '').replace(/^www\./, '')
      return !(text.includes(url) || text.includes(bare))
    })
    .join('\n')
  if (link) text = text ? `${text}\n\n${link}` : link
  if (!text) text = 'Hecho.'

  if (options.length === 0) {
    return splitMessage(text).map((t) => ({ type: 'text' as const, text: t }))
  }

  const buttons = options.map((title, i) => ({ id: `opt:${i}`, title }))
  if (text.length <= WA_BUTTON_BODY_MAX) return [{ type: 'buttons', text, buttons }]
  // Too long for an interactive body: send the text, then the buttons alone.
  return [
    ...splitMessage(text).map((t) => ({ type: 'text' as const, text: t })),
    { type: 'buttons', text: 'Elige una opción:', buttons },
  ]
}

/** Plain text replies (system messages) go through the same splitter. */
export function renderPlainText(text: string): OutboundMessage[] {
  return splitMessage(toWhatsAppMarkup(text)).map((t) => ({ type: 'text' as const, text: t }))
}

/**
 * PRO-141 (Miguel, 2026-10-15): in the WhatsApp sign-up the dishes question
 * came with the buttons of the previous one («Casi a diario / 3-4 días /
 * Poco») — the model repeated its [[opciones]]. Outbound bodies record the
 * buttons they carried (`⟦botones: A | B⟧`, see `outboundBody`); a reply whose
 * buttons are exactly the last ones Mimo sent goes out as plain text.
 */
export const BUTTONS_MARK = /⟦botones: ([^⟧]*)⟧/

export function outboundBody(m: OutboundMessage): string {
  if (m.type === 'buttons') return `${m.text}\n⟦botones: ${m.buttons.map((b) => b.title).join(' | ')}⟧`
  // The picture itself isn't stored: history gets a mark saying what it
  // showed, then the caption that went with it.
  if (m.type === 'image') return `${imageMark(m.alt)}\n${m.text}`
  return m.text
}

/** `⟦imagen enviada: el menú de la semana, día a día⟧` — the engine strips ⟦…⟧ marks if the model copies one. */
export const imageMark = (alt: string) => `⟦imagen enviada: ${alt}⟧`

/** Titles of the buttons in the most recent outbound body that had any (or null). */
export function lastSentButtons(rows: Array<{ direction: string; body: string | null }>): string[] | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.direction !== 'out') continue
    const m = r.body?.match(BUTTONS_MARK)
    if (m) return m[1].split(' | ').map((t) => t.trim())
    return null // the last thing Mimo sent had no buttons
  }
  return null
}

export function dropRepeatedButtons(messages: OutboundMessage[], last: string[] | null): OutboundMessage[] {
  if (!last) return messages
  const same = (titles: string[]) => titles.length === last.length && titles.every((t, i) => t === last[i])
  return messages.flatMap((m): OutboundMessage[] => {
    if (m.type !== 'buttons' || !same(m.buttons.map((b) => b.title))) return [m]
    return m.text === 'Elige una opción:' ? [] : [{ type: 'text', text: m.text }]
  })
}
