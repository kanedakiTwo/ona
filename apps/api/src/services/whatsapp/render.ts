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
  // copies them into its own text — don't add any of them twice.
  const link = appLinkFor(resp, webUrl)
    ?.split('\n')
    .filter((line) => {
      const url = line.match(/\S+\/\S+$/)?.[0]
      return !(url && text.includes(url))
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
