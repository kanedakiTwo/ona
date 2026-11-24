import type { AssistantResponse, ChatMessage, ToolTrace } from '../assistant/types.js'
import type { ChatOptions } from '../assistant/engine.js'
import { BUDGET_WARNING_LINE, crossesBudgetWarning, type TokenUsage } from '../advisorBudget.js'
import type { InboundMessage } from './webhookParser.js'
import type { LinkWithUser } from './store.js'
import { buildChatHistory, HISTORY_WINDOW_MS, type HistoryRow } from './history.js'
import { LATE_CHECKIN_LOOKBACK_MS, lateDinnerCheckinNote } from './lateCheckin.js'
import { connectUrl, extractLinkCodeCandidates, isLinkAttempt } from './linking.js'
import { dropRepeatedButtons, lastSentButtons, outboundBody, renderAssistantReply, renderPlainText, WA_CAPTION_MAX, type OutboundMessage } from './render.js'
import { extractOptions, toWhatsAppMarkup } from './format.js'
import { shoppingItemsOf, shoppingListDigest } from '../shoppingText.js'
import { captionVariants, type WeekView } from '../menuText.js'
import { captionWithoutInvite, signupCaption, signupWords } from './signupReply.js'
import { createCoalescer } from './coalesce.js'
import { refTime } from './answerTarget.js'
import { resolveAnswer, type AnswerContext } from './answerTurn.js'
import { AI_DISCLOSURE_FIRST_PERSON, BRAND_SUPPORT_EMAIL, PLAN_GRATIS_MESSAGE, NotASchoolMenuError, SchoolMenuFileError, schoolLunchLines, type SchoolLunch } from '@ona/shared'
import { guidedMeta, type GuideSpec, type GuidedResult } from './guided.js'
import { controlCommand, OPT_IN_NO, OPT_IN_YES } from './commands.js'
import { trackEvent } from '../usageEvents.js'
import { recordServiceMessageCost } from './serviceCost.js'
import { needsReturnDisclosure, stripAiSignature, withReturnDisclosure } from './aiNotice.js'
import {
  CHECKIN_ANSWER_WINDOW_MS,
  CHECKIN_REF_WINDOW_MS,
  checkinAnswerOf,
  checkinConfirmation,
  checkinReplyIdOfEmoji,
  dinnerCheckinPending,
  type CheckinAnswer,
} from './checkinButtons.js'
import { COOKING_OK_REPLY, COOKING_SWAP_REQUEST } from './proactive.js'
import { fatigueAnswerOf, fatigueConfirmation, type FatigueKind } from './fatigue.js'
import { optOutReasonOf, optOutReasonThanks, optOutWithReason, type OptOutReason } from './optOutReason.js'
import type { Lang } from './language.js'
import { API_SALDO_REPLY, noteApiBalanceError } from '../apiSaldo.js'
import {
  ASK_SOURCE_COPY,
  PHOTO_SOURCE_WINDOW_MS,
  firstUrl,
  pendingSourceQuestion,
  unreadLinkForScreenshot,
  type PhotoSourceMeta,
} from './photoSource.js'

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
    consumeLinkCode: (
      code: string,
      phone: string,
      profileName: string | null,
      currentUserId?: string | null,
    ) => Promise<{ userId: string; onboardingDone?: boolean; sameUser?: boolean } | null>
    touchInbound: (phone: string, at: Date) => Promise<void>
    updateInbound: (
      wamid: string,
      patch: {
        status: string
        body?: string | null
        userId?: string | null
        errorMessage?: string | null
        meta?: { tools?: string[]; corrections?: string[]; ms?: number; toolTrace?: ToolTrace[]; /** PRO-1292: answered by the code (its kind), no model. */ codeReply?: string } & PhotoSourceMeta
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
      meta?: { guided?: 'guide' | 'fallback'; guidedReason?: string } | null
    }) => Promise<void>
    loadHistoryRows: (phone: string, since: Date, userId: string) => Promise<HistoryRow[]>
    hasRecentOutbound: (phone: string, kinds: string[], since: Date) => Promise<boolean>
    /** Latest time each outbound kind was sent to `phone` since `since`. */
    recentOutboundKinds: (phone: string, since: Date) => Promise<Map<string, Date>>
    setNotify: (userId: string, notify: boolean) => Promise<boolean>
  }
  /** Where to reach a human (env SUPPORT_EMAIL). Empty → hola@mimoia.com (PRO-179). */
  supportEmail?: string
  /**
   * PRO-248: the avisos answer. `markDeclined` records a «No, gracias» or a
   * BAJA; `claimReoffer` is true only the one time the extra offer is due
   * (optInOffer.ts). Absent → no record, no extra offer.
   */
  optIn?: {
    markDeclined: (userId: string) => Promise<void>
    claimReoffer: (userId: string, now: Date) => Promise<boolean>
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
  /** `spentMicros`: Mimo's spend so far this month (for the 80 % notice); absent → no notice. */
  checkBudget: (userId: string) => Promise<{ exceeded: boolean; budgetMicros: number; spentMicros?: number }>
  /**
   * PRO-385: the household is on Gratis (trial over, no plan; never before
   * launch day). No Mimo: its messages get, once a day, the notice to choose
   * a plan. Absent → never on Gratis.
   */
  isPaused?: (userId: string) => Promise<boolean>
  /**
   * Meters a turn: always in the cost ledger; in Mimo's monthly total unless
   * `countsTowardBudget` is false (the WhatsApp sign-up and its first menu,
   * 18-nov). Returns the micro-euros added to that total (void → 0).
   */
  recordUsage: (userId: string, usage: TokenUsage, opts?: { countsTowardBudget?: boolean }) => Promise<number | void>
  /**
   * 18-nov: a tapped «¿hiciste la cena?» button, recorded on the day the
   * check-in went out (`checkinAt`) without the model. Null = that day has no
   * dinner recipe to record (the tap goes to Mimo). Absent → always Mimo.
   */
  recordDinnerCheckin?: (userId: string, answer: CheckinAnswer, checkinAt: Date) => Promise<{ name: string } | null>
  /**
   * PRO-1292: a message the code answers without the model («¿qué hay hoy?»,
   * «mándame el menú»): the reply, shaped like a model turn, and its kind for
   * `mimo_code_reply`. Null → Mimo answers. Absent → always Mimo.
   */
  codeReply?: (userId: string, text: string) => Promise<{ kind: string; response: AssistantResponse } | null>
  /** 19-nov: the language this number writes in, for the fixed lines (language.ts). Absent → Spanish. */
  language?: (phone: string) => Promise<Lang>
  /** 19-nov: «¿Te sigo avisando de…?» answered (fatigue.ts): the kind on or off. Absent → Mimo answers. */
  setAvisoKind?: (userId: string, kind: FatigueKind, on: boolean) => Promise<void>
  /** 19-nov: why they wrote BAJA (optOutReason.ts), as an opinion. Absent → no question, no record. */
  saveOptOutReason?: (userId: string, reason: OptOutReason, text: string) => Promise<void>
  /** Speech-to-text for voice notes. Absent → voice notes get a polite "escríbemelo". */
  transcribe?: (audio: Buffer, mimeType: string) => Promise<string>
  /** Silence before the generic "me pongo con ello" (ms). Tests shorten it. */
  ackAfterMs?: number
  /**
   * Compact text of a week's menu, appended to the reply of a turn that
   * generated it (or that asked to see it, `view`) so the user can read it
   * and iterate here (menuId = the one the turn touched, null = the user's
   * latest). Absent → no digest.
   */
  menuDigest?: (userId: string, menuId: string | null, view: WeekView) => Promise<string | null>
  /**
   * The same week as one picture plus a short caption (2026-10-15), sent
   * instead of the digest text. Throwing → the digest text. Null (nothing to
   * draw) → the digest text after generating, the model's words after a read.
   */
  menuImage?: (userId: string, menuId: string | null, view: WeekView) => Promise<WeekImage | null>
  /**
   * Photo of a recipe → saved recipe. Absent → photos get a polite "todavía no".
   * `sourceUrl` = the link saved as its source (PRO-66); `looksLikeScreenshot`
   * comes from the same vision call that reads the recipe.
   */
  importRecipeFromImage?: (
    image: Buffer,
    mimeType: string,
    userId: string,
    opts?: { sourceUrl?: string },
  ) => Promise<{ recipeId: string; name: string; warnings: string[]; looksLikeScreenshot?: boolean }>
  /**
   * PRO-224: a photo or PDF of the school's monthly menu → read, saved for the
   * household, and the days back to show. Throws NotASchoolMenuError when it
   * isn't one. Absent → those files go the usual way.
   */
  readSchoolMenu?: (file: Buffer, mimeType: string, userId: string) => Promise<SchoolLunch[]>
  /** The link to the original of a screenshot's recipe (PRO-66). False = not the user's recipe. */
  setRecipeSource?: (userId: string, recipeId: string, url: string) => Promise<boolean>
  /**
   * PRO-156: write a message from its guide (Claude Haiku), or return the
   * fixed text. Absent → the fixed text (COPY).
   */
  guided?: (userId: string, phone: string, spec: GuideSpec, fallback: string) => Promise<GuidedResult>
}

/** Skills after which the reply carries the week's menu (not just a link to it). */
const MENU_DIGEST_TOOLS = new Set(['generate_weekly_menu', 'complete_onboarding'])
/** The read that shows the whole week (2026-10-15): the same picture, a «Tu menú…» caption. */
const WEEK_READ_TOOL = 'get_weekly_menu'
/** Menu reads: a turn made only of these has nothing to say that the week doesn't. */
const MENU_READ_TOOLS = new Set([WEEK_READ_TOOL, 'get_todays_menu'])
/** …and the shopping list. */
const SHOPPING_DIGEST_TOOLS = new Set(['get_shopping_list'])

/**
 * "genera el menú" / "dame la lista" used to answer "Hecho" + a link, so the
 * user had to open the app to see what was proposed. Append the compact
 * digest instead: the week read back from the DB after the whole turn (so later
 * swaps in the same turn show too), and the list from the skill's own items.
 */
export async function withDigests(
  response: AssistantResponse,
  userId: string,
  deps: Pick<InboundDeps, 'menuDigest'>,
): Promise<AssistantResponse> {
  const view = weekViewOf(response)
  const digest = await loadMenuDigest(response, userId, deps, view)
  return withWeekText(response, view, digest)
}

/** The week picture the WhatsApp reply carries: the JPG and its caption. */
export interface WeekImage {
  jpeg: Buffer
  caption: string
}

/**
 * Why this turn's reply shows the whole week: Mimo generated it, the user
 * asked to see it (get_weekly_menu, with the menu it read), or neither.
 * One-day reads (get_todays_menu) are neither: they stay text with links.
 */
export function weekViewOf(response: AssistantResponse): WeekView | null {
  const tools = response.toolsUsed ?? []
  const digestTools = tools.filter((t) => MENU_DIGEST_TOOLS.has(t))
  // 21-nov (reviewer, `menu.tarjeta_listo_sin_generar`): a call that changed
  // nothing (the week already had a menu, a question first) or failed is no
  // «Listo». Without a trace (older callers), any call counts, as before.
  const generated = response.toolTrace
    ? response.toolTrace.some((t) => MENU_DIGEST_TOOLS.has(t.name) && !t.error && !t.unchanged)
    : digestTools.length > 0
  if (generated) return 'generated'
  // A week with nothing planned answers without menu data: no picture, the
  // model's words as before. The week a generation left as it was is shown
  // as a read («Tu menú de la semana…»), with Mimo's question.
  if ((tools.includes(WEEK_READ_TOOL) || digestTools.length > 0) && menuIdOf(response)) return 'viewing'
  return null
}

/** The menu the turn touched (null = the user's latest). */
function menuIdOf(response: AssistantResponse): string | null {
  const data = response.data && typeof response.data === 'object' && !Array.isArray(response.data)
    ? (response.data as Record<string, unknown>)
    : null
  return typeof data?.menuId === 'string'
    ? data.menuId
    : typeof data?.id === 'string' && Array.isArray(data?.days) ? data.id : null
}

async function loadMenuDigest(
  response: AssistantResponse,
  userId: string,
  deps: Pick<InboundDeps, 'menuDigest'>,
  view: WeekView | null,
): Promise<string | null> {
  if (!deps.menuDigest || !view) return null
  try {
    return await deps.menuDigest(userId, menuIdOf(response), view)
  } catch (err) {
    console.warn('[whatsapp] menuDigest failed (sending the reply without it):', err)
    return null
  }
}

function shoppingDigestOf(response: AssistantResponse): string | null {
  const tools = response.toolsUsed ?? []
  if (!tools.some((t) => SHOPPING_DIGEST_TOOLS.has(t))) return null
  const items = shoppingItemsOf(response.data)
  return items ? shoppingListDigest(items) : null
}

/**
 * The model's words that go with the week. Its "menú listo" lines go (the
 * opener says it). After a read, nothing: the week IS the answer — its own
 * day-by-day list is exactly what the picture replaces — unless the turn
 * also changed something ("Hecho: - Martes 20, …"), which stays.
 */
function modelWordsWithWeek(response: AssistantResponse, view: WeekView): string {
  const tools = response.toolsUsed ?? []
  if (view === 'viewing' && tools.every((t) => MENU_READ_TOOLS.has(t))) return ''
  return withoutMenuReadyLines(response.message?.trim() ?? '')
}

/**
 * The reply as text: the model's words, the week digest, the shopping list.
 * The digest links the menu page, so no "Ver menú" (nor one day's recipe
 * links) again. Without a digest the model's words stay as they were.
 */
function withWeekText(response: AssistantResponse, view: WeekView | null, digest: string | null): AssistantResponse {
  const shopping = shoppingDigestOf(response)
  if (!view || !digest) {
    if (!shopping) return response
    return { ...response, message: [response.message?.trim() ?? '', shopping].filter(Boolean).join('\n\n') }
  }
  return {
    ...response,
    message: [modelWordsWithWeek(response, view), digest, shopping].filter(Boolean).join('\n\n'),
    uiHint: response.uiHint === 'menu' ? undefined : response.uiHint,
  }
}

/** What the history says the week picture showed. */
export const WEEK_IMAGE_ALT = 'el menú de la semana, día a día'

/**
 * The WhatsApp messages answering a turn. A turn that generated the week —
 * or asked to see it (get_weekly_menu, 2026-10-15) — sends ONE picture of it
 * with a short caption (Miguel: the text digest was «overwhelming»): the
 * model's own words (minus its "menú listo" line; none at all after a plain
 * read), then the opener («Listo: …» / «Tu menú de esta semana»), the menu
 * link and the invite. If the picture can't be drawn, or its upload/send
 * fails later, the text digest goes out instead — exactly what a turn without
 * the picture sends. A read whose week has nothing to draw keeps the model's
 * words, as before.
 *
 * When the model's words carry buttons (or a shopping list came in the same
 * turn, or it all doesn't fit in a caption even without the caption's invite
 * and link lines, PRO-277), they go after the picture as usual, so the
 * buttons stay last.
 */
export async function replyMessages(
  response: AssistantResponse,
  userId: string,
  deps: Pick<InboundDeps, 'menuDigest' | 'menuImage' | 'webUrl'>,
  lastButtons: string[] | null,
): Promise<OutboundMessage[]> {
  const asText = (r: AssistantResponse) => dropRepeatedButtons(renderAssistantReply(r, deps.webUrl), lastButtons)
  const view = weekViewOf(response)
  const digest = await loadMenuDigest(response, userId, deps, view)
  const textVersion = asText(withWeekText(response, view, digest))
  if (!deps.menuImage || !view) return textVersion

  let image: WeekImage | null = null
  try {
    image = await deps.menuImage(userId, menuIdOf(response), view)
  } catch (err) {
    console.warn('[whatsapp] week image failed (sending the text digest):', err)
    return textVersion
  }
  // Nothing to draw: the digest after generating; after a read, the model's
  // words as before (it said what there is, or that there's nothing).
  if (!image) return view === 'viewing' ? asText(response) : textVersion

  const picture = (caption: string, fallback: OutboundMessage[]): OutboundMessage => ({
    type: 'image',
    text: caption,
    image: image!.jpeg,
    mimeType: 'image/jpeg',
    alt: WEEK_IMAGE_ALT,
    fallback,
  })
  // 19-nov: the sign-up ends in ONE message — the picture, one line, one
  // question at most (signupReply.ts).
  const signup = (response.toolsUsed ?? []).includes('complete_onboarding')
  const modelWords = modelWordsWithWeek(response, view)
  const rest = signup ? signupWords(modelWords) : modelWords
  const shopping = shoppingDigestOf(response)
  const { text: restText, options } = extractOptions(rest)
  // Mimo's words already ask something: no «¿Cambio algo?» under them.
  const caption = signup ? signupCaption(image.caption, !!restText.trim()) : restText.includes('?') ? captionWithoutInvite(image.caption) : image.caption
  if (!shopping && options.length === 0) {
    // PRO-277: one message. If Mimo's words and the caption don't fit,
    // the caption's fixed lines (invite, then link) go before splitting.
    const words = toWhatsAppMarkup(restText).trim()
    for (const fixed of captionVariants(caption)) {
      const caption = [words, fixed].filter(Boolean).join('\n\n')
      if (caption.length <= WA_CAPTION_MAX) return [picture(caption, textVersion)]
    }
  }
  // The model's words (and buttons) after the picture. The caption already
  // links the menu page, so no "Ver menú" line again.
  const after = rest || shopping
    ? asText({
        ...response,
        message: [rest, shopping].filter(Boolean).join('\n\n'),
        uiHint: response.uiHint === 'menu' ? undefined : response.uiHint,
      })
    : []
  return [picture(caption.slice(0, WA_CAPTION_MAX), digest ? renderPlainText(digest) : []), ...after]
}

/** Accents off, lower case, `*bold*` / `_italic_` marks off: what the "menú listo" match compares. */
function foldLine(line: string): string {
  return line.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[*_~]/g, '').trim()
}

/**
 * The model's "menu ready" line in all the shapes seen (2026-10-15): "- Menú
 * de la semana que viene listo (semana del 19 de octubre)", "• Tu primer menú
 * de esta semana está listo.", "*Menú para la semana del 19 de octubre
 * generado*", "Hecho: menú de la semana listo"… Matched on the folded line
 * (no accents, lower case, no bold marks).
 */
// "de la semana", "para esta semana que viene", "de la semana del 19 al 25 de octubre"…
const WEEK_WORDS =
  '(?:\\s+(?:de|para)\\s+(?:(?:la|esta|tu)\\s+)?(?:(?:proxima|siguiente)\\s+)?semana' +
  '(?:\\s+(?:que\\s+viene|proxima|siguiente|actual|del?\\s+\\d{1,2}(?:\\s+de\\s+[a-z]+)?(?:\\s+al\\s+\\d{1,2}(?:\\s+de\\s+[a-z]+)?)?))?)?'
/** "(semana del 19 de octubre)", then closing punctuation or an emoji. */
const LINE_END = '(?:\\s*\\([^)]*\\))?[\\s.!:✅👌🍽️\\uFE0F]*$'
const MENU_WORD = '(?:ya\\s+)?(?:tienes\\s+)?(?:(?:tu|el)\\s+)?(?:primer\\s+)?menu(?:\\s+(?:semanal|nuevo))?'
const BULLET = '(?:[-•·–]\\s*)?'
const MENU_READY_LINES = [
  // "- Tu primer menú de la semana que viene (ya) está listo (…)"
  new RegExp(`^(?:hecho\\s*[:.!]?\\s*)?${BULLET}${MENU_WORD}${WEEK_WORDS}(?:\\s+ya)?(?:\\s+(?:esta|queda))?(?:\\s+ya)?\\s+(?:listo|generado|preparado|hecho|creado)${LINE_END}`, 'u'),
  // "Listo: tu menú de la semana que viene", "Hecho, tu primer menú de esta semana"
  new RegExp(`^${BULLET}(?:listo|hecho)\\s*[:,.!]?\\s+${MENU_WORD}${WEEK_WORDS}${LINE_END}`, 'u'),
]
/** A line that only acknowledges: "Hecho:", "Hecho.", "Listo." (folded). */
const BARE_ACK_LINE = /^(?:hecho|listo|vale)\s*[:.!]?$/

/**
 * Pure: the model's reply to a turn that generated the menu, minus the
 * "menú listo" line the opener already says. What's left only stays when it
 * says something else (another change of the turn, a warning); a "Hecho:"
 * with nothing under it goes too.
 */
export function withoutMenuReadyLines(message: string): string {
  const lines = message.split('\n').filter((l) => !MENU_READY_LINES.some((re) => re.test(foldLine(l))))
  if (lines.every((l) => !l.trim() || BARE_ACK_LINE.test(foldLine(l)))) return ''
  // A "Hecho:" whose only change was the menu, with a warning further down:
  // drop the empty header, keep the warning. One with changes under it stays.
  const out = lines.filter((l, i) => {
    if (!BARE_ACK_LINE.test(foldLine(l))) return true
    const next = lines.slice(i + 1).find((x) => x.trim())
    return next !== undefined && /^\s*[-•·–*]\s/.test(next)
  })
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** PRO-156: what the end of the sign-up must carry when it's written from its guide. */
export function firstStepsGuide(url: string): GuideSpec {
  return {
    kind: 'first_steps',
    facts: [
      'Acaba de terminar el alta por WhatsApp y de contestar si quiere avisos.',
      'Ejemplos: mandar una foto o un enlace de una receta (la proceso y la guardo en sus recetas); «¿Qué cenamos hoy?»; «Hazme la lista de la compra».',
      `En la web tiene su menú de la semana y un recorrido rápido por todo lo demás: ${url}`,
    ],
    required: ['¿Qué cenamos hoy?', 'Hazme la lista de la compra', url],
  }
}

/**
 * Where to reach a person (PRO-179): `SUPPORT_EMAIL` when set, else the public
 * address hola@mimoia.com, as the footer and Mimo do. Never "quien te invitó":
 * with open sign-up nobody invites anybody.
 */
export const humanContact = (email?: string) => `escribe a ${email?.trim() || BRAND_SUPPORT_EMAIL}`

/**
 * PRO-245 (D-064, Miguel 2026-10-19): the WhatsApp sign-up asks exactly these,
 * and its first message announces as many as it lists. Since 19-nov (Miguel)
 * four, and all of them go to the ficha (complete_onboarding): who they are;
 * which meals they cook («6 cenas y 1 comida» → the «semana tipo»); three
 * dishes they make often (into the first menu); what doesn't go in (dislikes).
 * `complete_onboarding` needs the first two.
 */
export const WHATSAPP_ONBOARDING_QUESTIONS = [
  '¿Quiénes sois en casa? Dime adultos y niños de 2 a 10 años.',
  '¿Qué comidas cocináis en casa a la semana? Por ejemplo: «6 cenas y 1 comida».',
  'Tres platos que hacéis a menudo.',
  '¿Hay algo que no entre en casa? Un alimento o un plato que no os guste.',
] as const

const COUNT_WORDS = ['cero', 'una', 'dos', 'tres', 'cuatro', 'cinco']
export const countWord = (n: number) => COUNT_WORDS[n] ?? String(n)

export const COPY = {
  /**
   * WhatsApp-first sign-up (2026-10-10): a new account that links before doing
   * the first steps gets them here, in the chat. The opt-in for proactive
   * messages waits until the first menu is ready.
   */
  /**
   * First message of the WhatsApp sign-up, in Miguel's words (2026-10-15). It
   * keeps the three parts of the AI disclosure (AI, can be wrong, not a health
   * professional; AI Act art. 50) and announces and lists exactly the questions
   * of the sign-up (`WHATSAPP_ONBOARDING_QUESTIONS`, PRO-245; four since
   * 19-nov).
   */
  linkedOnboarding: (name: string | null) =>
    `¡Hola${name ? `, ${name}` : ''}! Ya estás conectado: soy Mimo, de Mimoia. Soy un asistente de inteligencia artificial (IA) especializado en cocina: puedo equivocarme y no sustituyo a un profesional sanitario, pero puedo encargarme de las tareas rutinarias para que cocinar vuelva a ser divertido.\n\nPuedes escribirme o mandarme notas de voz, como te sea más cómodo.\n\nPara entrar en calor te propongo preparar tu primer menú en un momento: solo necesito saber ${countWord(WHATSAPP_ONBOARDING_QUESTIONS.length)} cosas.\n\n${WHATSAPP_ONBOARDING_QUESTIONS.map((q, i) => `*${i + 1}.* ${q}`).join('\n')}`,
  /** ~10 min after the first menu (signupFollowUps.ts): health data goes to the web, never through WhatsApp (PRO-24). */
  healthOnWeb: (url: string) =>
    `Si en casa hay alergias, intolerancias o algo que no podáis o queráis comer, añádelo aquí con tu permiso y lo tendré en cuenta: ${url}\nPor WhatsApp no me dejan guardar datos de salud.`,
  linked: (name: string | null) =>
    `¡Listo${name ? `, ${name}` : ''}! Tu WhatsApp ya está conectado con Mimoia. Pregúntame qué toca hoy, pídeme la lista de la compra, mándame un audio o compárteme una receta (enlace o foto) para guardarla.\n\n${AI_DISCLOSURE_FIRST_PERSON}`,
  /** Explicit opt-in for proactive messages: right after linking an account; ~10 min after the WhatsApp sign-up's first menu, after the health link (signupFollowUps.ts). */
  optInPrompt:
    '¿Quieres que también te escriba yo? No escribo mucho, solo lo importante: un aviso antes de cocinar (congelados, tiempos) y la lista de la compra los sábados. Si quieres el menú cada mañana, pídemelo. Puedes cambiarlo cuando quieras simplemente pidiéndomelo.',
  optInDeclined: 'Vale, no te escribiré por mi cuenta. Si cambias de idea, escribe ALTA.',
  /**
   * Last message of the WhatsApp-first sign-up (PRO-07): once the opt-in
   * question is answered (yes or no), three things to try. Sent once.
   */
  firstSteps: (url: string) =>
    `Te cuento ejemplos de cosas que puedes pedirme ya:\n📸 Mándame una foto o un enlace de una receta, la proceso y la guardo en tus recetas.\n🍽️ «¿Qué cenamos hoy?»\n🛒 «Hazme la lista de la compra»\n\nY cuando quieras, vuelve a Mimoia en la web: allí tienes tu menú de la semana y un recorrido rápido por todo lo demás.\n${url}`,
  /** A linked number sends a code that is its own account's: nothing to do. */
  alreadyLinked: 'Este WhatsApp ya está conectado a tu cuenta de Mimoia: no hace falta ningún código. ¿Qué te preparo?',
  /** A linked number sends another account's code: it moves to that account. */
  movedAccount: 'Este WhatsApp estaba conectado a otra cuenta de Mimoia. Desde ahora está conectado a la cuenta de la que has sacado el código.',
  /** A linked number sends an invalid or expired code. */
  badCodeLinked:
    'Ese código no es válido o ha caducado (duran 10 minutos). Este WhatsApp sigue conectado a tu cuenta de siempre. Si querías conectarlo a otra cuenta, saca un código nuevo desde esa cuenta y mándamelo.',
  stopped:
    'Hecho: no te enviaré más avisos por WhatsApp. Puedes seguir escribiéndome cuando quieras. Para volver a recibirlos, escribe ALTA.',
  stoppedEn: "Done: I won't send you any more notifications on WhatsApp. You can still write to me whenever you like. To get them back, write START.",
  stoppedUnlinked: 'De acuerdo, no te volveré a escribir.',
  started:
    'Hecho: vuelvo a enviarte avisos (aviso antes de cocinar, lista de la compra). Escribe BAJA para dejar de recibirlos.',
  human: (email?: string) =>
    `Soy un asistente con IA. Para hablar con una persona del equipo de Mimoia, ${humanContact(email)}. Si es sobre tu menú, la compra o una receta, cuéntamelo y lo hago.`,
  badCode: 'Ese código no es válido o ha caducado. Genera uno nuevo en Mimoia → Perfil → Mimo en WhatsApp.',
  connect: (url: string) =>
    `Hola, soy Mimo, el asistente de cocina de Mimoia. ${AI_DISCLOSURE_FIRST_PERSON}\n\nPara hablar conmigo por aquí, conecta tu cuenta:\n${url}\n\nEntra (o crea tu cuenta) y te daré un código para enviarme desde este chat.`,
  suspended: (email?: string) =>
    `Tu cuenta de Mimoia está suspendida. Si crees que es un error, ${humanContact(email)}.`,
  notAllowed: 'WhatsApp todavía no está disponible para tu cuenta de Mimoia.',
  /** PRO-248: the one extra offer of the avisos, in one line, with the same two buttons. */
  optInReoffer:
    'Por cierto, ¿quieres que también te escriba yo? Solo lo importante: un aviso antes de cocinar y la lista de la compra los sábados. Solo te lo pregunto esta vez.',
  /** PRO-248: the first «sí» to the avisos: `started` saying «te enviaré», not «vuelvo a enviarte». */
  get startedFirst(): string {
    return this.started.replace('vuelvo a enviarte', 'te enviaré')
  },
  /** PRO-385 (D-158): the Gratis plan has no Mimo. What it hears, once a day, with the link to Suscripción (Legal reviews it). */
  gratis: (url: string) => `${PLAN_GRATIS_MESSAGE}\n\nElige tu plan aquí:\n${url}`,
  budget: (euros: string) =>
    `Has alcanzado tu límite mensual del asistente (€${euros}). Se renueva el mes que viene.`,
  unsupported: 'Todavía no entiendo ese tipo de mensaje. Escríbeme, mándame una nota de voz o una foto de una receta.',
  audioUnavailable: 'Ahora mismo no puedo escuchar audios. ¿Me lo escribes?',
  audioFailed: 'No he podido entender el audio. ¿Me lo repites o me lo escribes?',
  imageUnavailable: 'Todavía no puedo leer fotos por aquí. Mándame el enlace de la receta o escríbemela.',
  imageNotRecipe: 'No he encontrado ninguna receta en esa foto. Prueba con una foto más nítida de la receta (ingredientes y pasos).',
  imageFailed: 'No he podido procesar la foto. Inténtalo de nuevo en un momento.',
  /** PRO-66: a link answered «¿Tienes el enlace del original?». */
  sourceSaved: (name: string) => `Hecho: he guardado el enlace como fuente de *${name}*. Lo verás en «Ver fuente».`,
  error: 'Vaya, algo ha fallado. Inténtalo de nuevo en un momento.',
  working: 'Un momento, me pongo con ello…',
  ackPhoto: 'Recibida la foto. Voy a leer la receta, dame unos segundos…',
  ackSchoolMenu: 'Recibido. Voy a leer el menú del cole, dame unos segundos…',
  schoolMenuNotFound: 'No he encontrado el menú del cole en ese archivo. Prueba con una foto más nítida o con el PDF del cole.',
  schoolMenuFailed: 'No he podido leer el menú del cole. Inténtalo de nuevo en un momento.',
  /** PRO-355: a file the reader can't take, and what to send instead. */
  schoolMenuHeic: 'Esa foto está en HEIC, el formato del iPhone, y no la puedo leer. Mándamela como foto (no como documento) o haz una captura de pantalla y mándame la captura.',
  schoolMenuTooBig: 'Ese archivo es demasiado grande para leerlo. Mándame solo la página del menú del mes, o una foto de esa página.',
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
/** PRO-385: Mimo tells a Gratis household about the plans once a day, not on every message. */
const GRATIS_NOTICE_COOLDOWN_MS = 24 * 60 * 60 * 1000

/**
 * Pure: a text that is only emoji (and spaces or punctuation) — «👍», «❤️❤️»,
 * «😂😂», «🙏🏻» —, with no letter or digit. «Ok 👍» or «2 🍕» are not.
 */
export function isEmojiOnly(text: string | null | undefined): boolean {
  const t = (text ?? '').trim()
  return t.length > 0 && !/[\p{L}\p{N}]/u.test(t) && /\p{Extended_Pictographic}/u.test(t)
}

/**
 * Miguel, 2026-11-18: Mimo doesn't answer emoji reactions nor a message that
 * is only emoji. Before, a reaction got «Todavía no entiendo ese tipo de
 * mensaje…» (6 times from 20-oct to 17-nov).
 */
export function isSilentEmoji(msg: InboundMessage): boolean {
  if (msg.rawType === 'reaction') return true
  return msg.kind === 'text' && isEmojiOnly(msg.text)
}

/**
 * Words of a message that only thanks or acknowledges («gracias», «muchas
 * gracias», «vale», «ok», «genial», «perfecto», «muy bien»…). `CORE`: at
 * least one of these, so «de» or «muy» alone aren't one.
 */
const COURTESY_CORE = new Set([
  'gracias', 'vale', 'ok', 'okay', 'okey', 'oki', 'genial', 'perfecto', 'perfecta', 'bien', 'estupendo', 'estupenda',
  'guay', 'fenomenal', 'entendido', 'acuerdo', 'super', 'buenisimo',
])
const COURTESY_EXTRA = new Set(['muchas', 'muchisimas', 'mil', 'muy', 'de', 'mimo'])

/**
 * Pure: a text that is only thanks or an acknowledgement, in any mix, with
 * emoji or punctuation: «Gracias!», «vale, gracias 👍», «Perfecto, muchas
 * gracias Mimo». «Sí», «No» or anything that asks for something are not.
 */
export function isCourtesyOnly(text: string | null | undefined): boolean {
  const words = (text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-zñ0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    // «graciass», «vaaale», «okk»: no word of the list has a doubled letter.
    .map((w) => w.replace(/([a-z])\1+/g, '$1'))
  return words.length > 0 && words.every((w) => COURTESY_CORE.has(w) || COURTESY_EXTRA.has(w)) && words.some((w) => COURTESY_CORE.has(w))
}

/** How recent Mimo's question has to be for «vale» / «ok» to answer it. */
export const COURTESY_ANSWER_WINDOW_MS = 30 * 60 * 1000

/**
 * Pure: Mimo's last message (in `rows`, oldest first) went out in the last
 * 30 min and ends in a question or carries buttons: a «vale» / «ok» now is
 * its answer and goes to Mimo.
 */
export function awaitsAnswer(rows: readonly HistoryRow[], now: Date): boolean {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.direction !== 'out' || r.status !== 'sent' || r.kind === 'ack') continue
    if (now.getTime() - r.createdAt.getTime() > COURTESY_ANSWER_WINDOW_MS) return false
    const body = stripAiSignature(r.body ?? '')
    if (/⟦botones:/.test(body)) return true
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
    return (lines.at(-1) ?? '').includes('?')
  }
  return false
}

/**
 * 18-nov (6b): the reply of the turn that takes Mimo's spend past 80 % of the
 * month's cap carries one fixed line (once a month: the spend only grows).
 */
export function withBudgetWarning(messages: OutboundMessage[]): OutboundMessage[] {
  const last = messages.at(-1)
  if (last?.type === 'text') return [...messages.slice(0, -1), { ...last, text: `${last.text}\n\n${BUDGET_WARNING_LINE}` }]
  return [...messages, { type: 'text', text: BUDGET_WARNING_LINE }]
}

export async function processInbound(msg: InboundMessage, deps: InboundDeps): Promise<void> {
  const { store, client } = deps
  const now = deps.now()
  const command = msg.kind === 'text' || msg.kind === 'interactive' ? controlCommand(msg.text) : null

  // Opt-out / opt-in / "a human" run before every other gate — even for a
  // late (stale), suspended, not-allowed or over-budget sender: an opt-out
  // must always stick.
  if (now.getTime() - msg.timestamp * 1000 > STALE_MESSAGE_MS && command !== 'stop') {
    await store.updateInbound(msg.wamid, { status: 'ignored', errorMessage: 'stale' })
    return
  }

  // A reaction or a message of only emoji: kept (the daily review sees it),
  // never answered, no «escribiendo…». 20-nov: unless it is an answer — a
  // typed 👍 / 👎 right after the dinner check-in counts as that button (1c),
  // and an emoji right after Mimo asked something (≤ 30 min) goes to Mimo,
  // like a «vale». A reaction never answers.
  let typedCheckin: CheckinAnswer | null = null
  if (isSilentEmoji(msg)) {
    const link = await store.getLinkByPhone(msg.from)
    let answers = false
    if (link && msg.rawType !== 'reaction') {
      const rows = await store.loadHistoryRows(msg.from, new Date(now.getTime() - CHECKIN_ANSWER_WINDOW_MS), link.userId)
      typedCheckin = dinnerCheckinPending(rows, now) ? checkinAnswerOf(checkinReplyIdOfEmoji(msg.text)) : null
      answers = typedCheckin != null || awaitsAnswer(rows, now)
    }
    if (!answers) {
      await store.updateInbound(msg.wamid, { status: 'ignored', userId: link?.userId ?? null, errorMessage: 'emoji' })
      return
    }
  }

  // 18-nov: only thanks or an acknowledgement («gracias», «vale», «ok»…):
  // kept, never answered, no model — unless Mimo's last message (≤ 30 min)
  // asked something or has buttons waiting: then «vale» is a «sí» for Mimo.
  if (!command && msg.kind === 'text' && isCourtesyOnly(msg.text)) {
    const link = await store.getLinkByPhone(msg.from)
    if (link) {
      const rows = await store.loadHistoryRows(msg.from, new Date(now.getTime() - COURTESY_ANSWER_WINDOW_MS), link.userId)
      if (!awaitsAnswer(rows, now)) {
        // It still opens Meta's 24 h window (but a return after 30+ days keeps its AI notice for the next reply).
        if (!needsReturnDisclosure(link.lastInboundAt, now)) await store.touchInbound(msg.from, now)
        await store.updateInbound(msg.wamid, { status: 'ignored', userId: link.userId, errorMessage: 'courtesy' })
        return
      }
    }
  }

  // PRO-1169: set once the sender is known to be back after 30+ days; the
  // first message Mimo sends then opens with the AI disclosure.
  let returnDisclosure = false
  const send = async (userId: string | null, kind: string, messages: OutboundMessage[], meta?: ReturnType<typeof guidedMeta>) => {
    if (returnDisclosure && messages.length > 0) {
      messages = withReturnDisclosure(messages)
      returnDisclosure = false
    }
    for (const m of messages) {
      const body = outboundBody(m)
      try {
        const wamid = await client.sendMessage(msg.from, m)
        void recordServiceMessageCost(userId)
        await store.insertOutbound({ phone: msg.from, userId, kind, body, status: 'sent', wamid, ...(meta ? { meta } : {}) })
      } catch (err: any) {
        console.error('[whatsapp] send failed:', err?.message ?? err)
        const fallback = m.type === 'image' ? m.fallback : []
        await store.insertOutbound({
          phone: msg.from,
          userId,
          // A picture whose text version goes out instead is not part of the
          // conversation (failed replies otherwise stay in history).
          kind: fallback.length > 0 ? 'image_failed' : kind,
          body,
          status: 'failed',
          errorMessage: String(err?.message ?? err).slice(0, 500),
        })
        if (fallback.length > 0) await send(userId, kind, fallback)
      }
    }
  }
  const sendOptInPrompt = (userId: string) =>
    send(userId, 'optin_prompt', [
      {
        type: 'buttons',
        text: COPY.optInPrompt,
        buttons: [
          { id: 'optin_yes', title: OPT_IN_YES },
          { id: 'optin_no', title: OPT_IN_NO },
        ],
      },
    ])
  const sendText = (userId: string | null, kind: string, text: string) => send(userId, kind, renderPlainText(text))
  /**
   * PRO-07: the WhatsApp-first sign-up ends with three suggestions, right
   * after the person answers the opt-in question. Only for numbers that did
   * the first steps here (an 'onboarding' message went out) and got the
   * opt-in question, and only once per number ('first_steps' kind).
   */
  const signupEnding = async () => {
    const sent = await store.recentOutboundKinds(msg.from, new Date(0))
    return sent.has('onboarding') && sent.has('optin_prompt') && !sent.has('first_steps')
  }
  const sendFirstSteps = async (userId: string) => {
    const url = `${deps.webUrl.replace(/\/$/, '')}/menu`
    const fixed = COPY.firstSteps(url)
    if (!deps.guided) return sendText(userId, 'first_steps', fixed)
    // PRO-156: written from its guide; the fixed text is the safety net.
    const written = await deps.guided(userId, msg.from, firstStepsGuide(url), fixed)
    return send(userId, 'first_steps', renderPlainText(written.text), guidedMeta(written))
  }

  await client.markReadWithTyping(msg.wamid)
  let langP: Promise<Lang> | null = null
  const languageOf = () => (langP ??= deps.language ? deps.language(msg.from).catch(() => 'es' as const) : Promise.resolve('es' as const))

  // ── 0. Control words ───────────────────────────────────────────
  const link = await store.getLinkByPhone(msg.from)
  if (command) {
    const userId = link?.userId ?? null
    await store.updateInbound(msg.wamid, { status: 'ignored', userId })
    if (command === 'stop') {
      if (link) await store.setNotify(link.userId, false)
      if (link) await deps.optIn?.markDeclined(link.userId)
      // 19-nov: the first BAJA of a number also asks why, with three buttons.
      const firstStop = link && deps.saveOptOutReason ? !(await store.recentOutboundKinds(msg.from, new Date(0))).has('optout') : false
      if (link && firstStop) {
        const lang = await languageOf()
        await send(userId, 'optout', [optOutWithReason(lang === 'en' ? COPY.stoppedEn : COPY.stopped, lang)])
      } else {
        await sendText(userId, 'optout', link ? COPY.stopped : COPY.stoppedUnlinked)
      }
    } else if (command === 'start') {
      if (link) {
        await store.setNotify(link.userId, true)
        // PRO-248: the confirmation always goes out (also at the end of the
        // WhatsApp sign-up, before the suggestions), and the first time it
        // says «te enviaré», not «vuelvo a enviarte».
        const sentKinds = await store.recentOutboundKinds(msg.from, new Date(0))
        const first = !sentKinds.has('optin') && !sentKinds.has('optout')
        const ending = await signupEnding()
        await sendText(userId, 'optin', first ? COPY.startedFirst : COPY.started)
        if (ending) await sendFirstSteps(link.userId)
      } else {
        await sendText(null, 'optin', COPY.connect(connectUrl(deps.webUrl)))
      }
    } else {
      await sendText(userId, 'system', COPY.human(deps.supportEmail))
    }
    return
  }
  // "No, gracias" only means something as the answer to the opt-in question.
  // PRO-1295: its button always answers it, whatever Mimo sent after.
  const optInButton = msg.kind === 'interactive' && msg.replyId === 'optin_no'
  if (link && msg.text && (optInButton || msg.text.trim().toLowerCase() === OPT_IN_NO.toLowerCase())) {
    const kinds = await store.recentOutboundKinds(msg.from, new Date(now.getTime() - 24 * 60 * 60 * 1000))
    const prompt = kinds.get('optin_prompt')
    if (optInButton || (prompt && [...kinds.values()].every((t) => t <= prompt))) {
      await store.updateInbound(msg.wamid, { status: 'ignored', userId: link.userId })
      await deps.optIn?.markDeclined(link.userId)
      // PRO-248: the answer is always confirmed, also before the suggestions.
      const ending = await signupEnding()
      await sendText(link.userId, 'system', COPY.optInDeclined)
      if (ending) await sendFirstSteps(link.userId)
      return
    }
  }

  // ── 1a. A number already linked sends a link code (2026-10-15: Miguel
  // tried the WhatsApp sign-up of a new account from his linked phone and the
  // code went to Mimo, who answered «no puedo vincular cuentas»). Its own
  // code: nothing to do; another account's code: the number moves there.
  if (link && msg.kind === 'text' && isLinkAttempt(msg.text)) {
    for (const code of extractLinkCodeCandidates(msg.text)) {
      const linked = await store.consumeLinkCode(code, msg.from, msg.profileName, link.userId)
      if (!linked) continue
      await store.updateInbound(msg.wamid, { status: 'ignored', userId: linked.userId })
      if (linked.sameUser) {
        await sendText(linked.userId, 'system', COPY.alreadyLinked)
        return
      }
      trackEvent('whatsapp_linked', { userId: linked.userId, channel: 'whatsapp' })
      await sendText(linked.userId, 'system', COPY.movedAccount)
      if (linked.onboardingDone === false) {
        await sendText(linked.userId, 'onboarding', COPY.linkedOnboarding(msg.profileName))
        return
      }
      await sendText(linked.userId, 'system', COPY.linked(msg.profileName))
      await sendOptInPrompt(linked.userId)
      return
    }
    await store.updateInbound(msg.wamid, { status: 'ignored', userId: link.userId })
    await sendText(link.userId, 'link', COPY.badCodeLinked)
    return
  }

  // ── 1. Who is this? ────────────────────────────────────────────
  if (!link) {
    const candidates = msg.kind === 'text' ? extractLinkCodeCandidates(msg.text) : []
    for (const code of candidates) {
      const linked = await store.consumeLinkCode(code, msg.from, msg.profileName)
      if (linked) {
        trackEvent('whatsapp_linked', { userId: linked.userId, channel: 'whatsapp' })
        await store.updateInbound(msg.wamid, { status: 'ignored', userId: linked.userId })
        if (linked.onboardingDone === false) {
          // WhatsApp-first sign-up: the first steps happen here; the opt-in
          // comes after the first menu (see the end of the turn).
          await sendText(linked.userId, 'onboarding', COPY.linkedOnboarding(msg.profileName))
          return
        }
        await sendText(linked.userId, 'system', COPY.linked(msg.profileName))
        // New links start with proactive messages OFF: ask explicitly.
        await sendOptInPrompt(linked.userId)
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
    // A number that wrote BAJA never gets the hint again (until ALTA).
    const kinds = await store.recentOutboundKinds(msg.from, new Date(0))
    const optedOut = kinds.get('optout')
    const optedIn = kinds.get('optin')
    if (optedOut && (!optedIn || optedIn < optedOut)) return
    if (!(await store.hasRecentOutbound(msg.from, ['link'], since))) {
      await sendText(null, 'link', COPY.connect(connectUrl(deps.webUrl)))
    }
    return
  }

  const userId = link.userId
  returnDisclosure = needsReturnDisclosure(link.lastInboundAt, now)
  await store.touchInbound(msg.from, now)

  if (link.suspendedAt) {
    await store.updateInbound(msg.wamid, { status: 'ignored', userId })
    await sendText(userId, 'system', COPY.suspended(deps.supportEmail))
    return
  }
  if (!deps.isUserAllowed(link.email)) {
    await store.updateInbound(msg.wamid, { status: 'ignored', userId })
    await sendText(userId, 'system', COPY.notAllowed)
    return
  }
  // PRO-385 (D-158): on Gratis, no Mimo; the notice to choose a plan, at most once a day.
  if (deps.isPaused && (await deps.isPaused(userId))) {
    await store.updateInbound(msg.wamid, { status: 'ignored', userId, errorMessage: 'plan-gratis' })
    if (!(await store.hasRecentOutbound(msg.from, ['gratis'], new Date(now.getTime() - GRATIS_NOTICE_COOLDOWN_MS)))) {
      await sendText(userId, 'gratis', COPY.gratis(`${deps.webUrl.replace(/\/$/, '')}/profile/suscripcion`))
    }
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
    // ── 1b. The link that answers «¿Tienes el enlace del original?» (PRO-66):
    // it becomes the source of that recipe, not a new import. No paid work.
    if ((msg.kind === 'text' || msg.kind === 'interactive') && deps.setRecipeSource && firstUrl(msg.text)) {
      if (await attachSourceLink(msg, userId, now, deps, outText)) return
    }

    // ── 1c. A «¿hiciste la cena?» button (18-nov), or its 👍 / 👎 typed
    // (20-nov): recorded here with a fixed confirmation, no model, also with
    // the monthly cap used up.
    const checkin = msg.kind === 'interactive' ? checkinAnswerOf(msg.replyId) : typedCheckin
    if (checkin && deps.recordDinnerCheckin) {
      // PRO-1295: a tapped button says which check-in it answers (an old one
      // too, up to a week): that day's dinner. Without its ref, the last one.
      const askedAt = msg.kind === 'interactive' ? refTime(msg.replyRef) : null
      const sentAt = askedAt
        ? now.getTime() - askedAt.getTime() <= CHECKIN_REF_WINDOW_MS ? askedAt : undefined
        : (await store.recentOutboundKinds(msg.from, new Date(now.getTime() - CHECKIN_ANSWER_WINDOW_MS))).get('dinner_checkin')
      const done = sentAt
        ? await deps.recordDinnerCheckin(userId, checkin, sentAt).catch((err) => {
            console.warn('[whatsapp] check-in button not recorded (Mimo answers instead):', err?.message ?? err)
            return null
          })
        : null
      if (done) {
        const tools = checkin.cooked ? ['log_cooked', ...(checkin.rating ? ['update_recipe_notes'] : [])] : []
        const reply = checkinConfirmation(checkin, done.name, await languageOf())
        await store.updateInbound(msg.wamid, {
          status: 'processed',
          userId,
          body: msg.text,
          meta: { tools, toolTrace: tools.map((name) => ({ name, input: JSON.stringify({ boton: msg.replyId ?? msg.text }), summary: reply })) },
        })
        await outText('reply', reply)
        return
      }
    }

    // ── 1c'. PRO-1295: each answer to its question. A «¿a cuál?» first when a
    // written «sí» / «no» could answer more than one (or one not seen yet), a
    // closed «Ahora no» by code, the rest to Mimo with the question it answers.
    const answer: AnswerContext | null = await (async () => {
      const r = await resolveAnswer(msg, userId, now, deps, { onboarding: link.onboardingDone === false, languageOf, out })
      return r === 'done' ? null : (r ?? {})
    })()
    if (!answer) return

    // ── 1d. The other avisos' buttons answered without the model (19-nov):
    // «Lo hago» under «hora de cocinar», «¿Te sigo avisando…?» and why BAJA.
    if (msg.kind === 'interactive' && (await answerAvisoButton(msg, userId, deps, languageOf, outText))) return

    // ── 1e. PRO-1292: «¿qué hay hoy?», «mándame el menú»… read by the code
    // (no model, no cost, also with the monthly cap used up). Not in the
    // sign-up, nor for whoever writes in English (the reply is Spanish).
    if (msg.kind === 'text' && link.onboardingDone !== false && deps.codeReply && msg.text?.trim()) {
      const text = msg.text.trim()
      const coded = await deps.codeReply(userId, text).catch((err) => {
        console.warn('[whatsapp] code reply failed (Mimo answers):', err?.message ?? err)
        return null
      })
      if (coded && (await languageOf()) === 'es') {
        const { response } = coded
        await store.updateInbound(msg.wamid, {
          status: 'processed',
          userId,
          body: text,
          // Same trace as a model turn: the next turns see ⟦hecho: …⟧.
          meta: { tools: response.toolsUsed ?? [], toolTrace: response.toolTrace ?? [], codeReply: coded.kind, ms: deps.now().getTime() - now.getTime() },
        })
        trackEvent('mimo_message', { userId, channel: 'whatsapp', props: { kind: 'text' } })
        trackEvent('mimo_code_reply', { userId, channel: 'whatsapp', props: { kind: coded.kind } })
        // One day's menu: its lines, no links nobody asked for. The week: the picture, as always.
        const reply = response.toolsUsed?.includes('get_weekly_menu') ? response : { ...response, uiHint: undefined }
        await out('reply', await replyMessages(reply, userId, deps, null))
        return
      }
    }

    // ── 2. Budget gate (same cap as the web chat), before ANY paid work:
    // transcription, photo extraction and the chat itself.
    let spentBefore: number | null = null
    let budgetLimit = 0
    if (msg.kind !== 'unsupported') {
      const budget = await deps.checkBudget(userId)
      if (budget.exceeded) {
        await store.updateInbound(msg.wamid, { status: 'ignored', userId })
        await outText('system', COPY.budget((budget.budgetMicros / 1_000_000).toFixed(0)))
        return
      }
      spentBefore = budget.spentMicros ?? null
      budgetLimit = budget.budgetMicros
    }
    acker.arm()

    // ── 3. Normalise the message to text ───────────────────────
    let text: string | null = null
    // A photo Mimo has to look at (a question about it, or one that wasn't a recipe).
    let images: { mediaType: string; data: string }[] | undefined
    let historyBody: string | null = null
    switch (msg.kind) {
      case 'text':
        text = msg.text?.trim() || null
        break
      case 'interactive':
        // 19-nov: «Cambia a algo rápido» reaches Mimo as a clear request, so it swaps tonight's dinner.
        text = answer.text ?? (msg.replyId === 'cooking:swap' ? COOKING_SWAP_REQUEST[await languageOf()] : msg.text?.trim() || null)
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
      case 'document': {
        // PRO-224: a PDF is read only as the school menu.
        if (await handleSchoolMenu(msg, userId, now, deps, out, acker, true)) return
        await store.updateInbound(msg.wamid, { status: 'ignored', userId })
        await outText('system', COPY.unsupported)
        return
      }
      case 'image': {
        if (await handleSchoolMenu(msg, userId, now, deps, out, acker, false)) return
        const photo = await handleImage(msg, userId, now, deps, out, acker)
        if (photo === 'done') return
        text = photo.text
        images = photo.images
        historyBody = `[Foto] ${msg.text?.trim() ?? ''}`.trim()
        break
      }
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
    // 19-nov: far enough back for last night's check-in (the late-answer note, until 13:00).
    const rows = await store.loadHistoryRows(msg.from, new Date(now.getTime() - Math.max(HISTORY_WINDOW_MS, LATE_CHECKIN_LOOKBACK_MS)), userId)
    const history = buildChatHistory(rows, now)
    // PRO-250: a reply after midnight to last night's «¿hiciste la cena?» is about that day.
    const lateCheckin = lateDinnerCheckinNote(rows, now)
    const chatText = [lateCheckin, answer.note, text].filter(Boolean).join('\n\n')
    const { usage, ...response } = await deps.chat(userId, chatText, history, {
      mode: 'whatsapp',
      ...(images ? { images } : {}),
      ...(answer.withoutTools ? { withoutTools: answer.withoutTools } : {}),
      // WhatsApp-first sign-up: Mimo asks the first steps until complete_onboarding.
      onboarding: link.onboardingDone === false,
      // PRO-1298: when it was sent (a repeat queued behind the menu's turn
      // doesn't make a second one) and, for a button, what it answered
      // (PRO-1295: the question its ref points at, else Mimo's last message).
      requestedAt: sentAt(msg, now),
      ...(msg.kind === 'interactive' && (answer.text ?? msg.text)?.trim()
        ? {
            button: {
              title: (answer.text ?? msg.text)!.trim(),
              asked: answer.asked !== undefined ? answer.asked : ([...history].reverse().find((m) => m.role === 'assistant')?.content ?? null),
            },
          }
        : {}),
      onToolStart: (names) => {
        const ack = ackTextForTools(names)
        if (ack) acker.now(ack)
      },
    })
    // 18-nov: the WhatsApp sign-up (and the first menu it ends with) doesn't
    // count toward Mimo's monthly cap; the cost ledger still sees it.
    let added = 0
    try {
      added = (await deps.recordUsage(userId, usage, { countsTowardBudget: link.onboardingDone !== false })) || 0
    } catch (err) {
      console.warn('[whatsapp] recordUsage failed (continuing):', err)
    }
    const nearCap = spentBefore !== null && crossesBudgetWarning(spentBefore, added, budgetLimit)
    trackEvent('mimo_message', { userId, channel: 'whatsapp', props: { kind: msg.kind === 'audio' ? 'voice_note' : images ? 'photo' : 'text' } })

    // Mark the inbound processed BEFORE replying so it precedes the reply in
    // history even if a send fails half-way.
    await store.updateInbound(msg.wamid, {
      status: 'processed',
      userId,
      body: historyBody ?? answer.historyBody ?? text,
      meta: {
        tools: response.toolsUsed ?? [],
        corrections: response.corrections ?? [],
        ms: deps.now().getTime() - now.getTime(),
        // What each tool got and returned: the next turns see it in history
        // (⟦hecho: …⟧) and the daily review sees what really happened.
        toolTrace: response.toolTrace ?? [],
        ...(images ? { photo: true } : {}),
      },
    })
    const reply = await replyMessages(response, userId, deps, lastSentButtons(rows))
    await out('reply', nearCap ? withBudgetWarning(reply) : reply)
    // 19-nov: a survey always goes as a message of its own (never stuck to the
    // reply nor under another question's buttons).
    if (response.survey) await out('survey', renderPlainText(response.survey))
    // 19-nov: after the sign-up's first menu nothing else goes now; the
    // health link and the avisos question come ~10 min later, one at a time
    // (signupFollowUps.ts, from the scheduler).
    if (link.onboardingDone !== false && !response.offerAdded && deps.optIn && (await deps.optIn.claimReoffer(userId, now).catch(() => false))) {
      // PRO-248: whoever never answered the avisos question hears it one more
      // time, in one line, after their first week with a menu and the list.
      await acker.settle()
      await send(userId, 'optin_prompt', [
        {
          type: 'buttons',
          text: COPY.optInReoffer,
          buttons: [
            { id: 'optin_yes', title: OPT_IN_YES },
            { id: 'optin_no', title: OPT_IN_NO },
          ],
        },
      ])
    }
  } catch (err: any) {
    console.error('[whatsapp] processing failed:', err?.message ?? err)
    await store.updateInbound(msg.wamid, {
      status: 'failed',
      userId,
      errorMessage: String(err?.message ?? err).slice(0, 500),
    })
    // PRO-1101: Anthropic sin saldo → el texto propio de Mimo (y queda apuntado).
    await outText('system', noteApiBalanceError(err) ? API_SALDO_REPLY : COPY.error)
  } finally {
    // Whatever path ended the turn, no "me pongo con ello" after this point.
    await acker.settle()
  }
}

/**
 * 19-nov: the avisos' buttons answered with a fixed line and no model (they
 * cost no turn and work with the monthly cap used up). True = handled.
 *   - «Lo hago» (`cooking:ok`) under «hora de cocinar»;
 *   - «¿Te sigo avisando de…?» Sí / No (fatigue.ts): the kind on or off;
 *   - why BAJA (optOutReason.ts): an opinion tagged `baja_avisos`.
 */
async function answerAvisoButton(
  msg: InboundMessage,
  userId: string,
  deps: InboundDeps,
  languageOf: () => Promise<Lang>,
  outText: (kind: string, text: string) => Promise<void>,
): Promise<boolean> {
  const processed = (tools: string[] = []) =>
    deps.store.updateInbound(msg.wamid, { status: 'processed', userId, body: msg.text, meta: { tools } })
  if (msg.replyId === 'cooking:ok') {
    await processed()
    await outText('reply', COOKING_OK_REPLY[await languageOf()])
    return true
  }
  const fatigue = fatigueAnswerOf(msg.replyId)
  if (fatigue && deps.setAvisoKind) {
    await deps.setAvisoKind(userId, fatigue.kind, fatigue.keep)
    await processed(['update_alert_prefs'])
    await outText('reply', fatigueConfirmation(fatigue.keep, await languageOf()))
    return true
  }
  const reason = optOutReasonOf(msg.replyId)
  if (reason && deps.saveOptOutReason) {
    await deps.saveOptOutReason(userId, reason, msg.text ?? reason).catch((err) =>
      console.warn('[whatsapp] BAJA reason not saved:', err?.message ?? err),
    )
    await processed()
    await outText('system', optOutReasonThanks(await languageOf()))
    return true
  }
  return false
}

/**
 * What a photo is for, from its caption. A question ("¿cómo cambia la receta
 * con esta plancha?") goes to Mimo, who sees the photo; anything else (no
 * caption, "la de mi abuela", "guárdala") is a recipe to import. Until 2026-10-12 every photo went to recipe import,
 * so a question with a photo got "No he encontrado ninguna receta".
 */
export function photoIntent(caption: string | null | undefined): 'import' | 'ask' {
  const c = (caption ?? '').trim()
  if (!c) return 'import'
  if (/\?/.test(c)) return 'ask'
  if (/^(¿\s*)?(c[oó]mo|qu[eé]|cu[aá]nt|cu[aá]l|puedo|se puede|sirve|me ayudas|ayúdame|ayudame|dime|expl[ií]ca)/i.test(c)) return 'ask'
  // "la de mi abuela", "guárdala": a recipe to keep (and if it isn't one, Mimo looks at it).
  return 'import'
}

/**
 * PRO-66: a link right after «¿Tienes el enlace del original?» (30 min) is
 * saved as the source of that recipe. True = handled (nothing else to do).
 */
async function attachSourceLink(
  msg: InboundMessage,
  userId: string,
  now: Date,
  deps: InboundDeps,
  outText: (kind: string, text: string) => Promise<void>,
): Promise<boolean> {
  const url = firstUrl(msg.text)
  if (!url || !deps.setRecipeSource) return false
  const rows = await deps.store.loadHistoryRows(msg.from, new Date(now.getTime() - PHOTO_SOURCE_WINDOW_MS), userId)
  const pending = pendingSourceQuestion(rows, now)
  if (!pending) return false
  if (!(await deps.setRecipeSource(userId, pending.recipeId, url))) return false
  await deps.store.updateInbound(msg.wamid, {
    status: 'processed',
    userId,
    body: `[Enlace del original de «${pending.name}»: ${url}]`,
    meta: { sourceAttachedTo: pending.recipeId },
  })
  const recipeUrl = `${deps.webUrl.replace(/\/$/, '')}/recipes/${pending.recipeId}`
  await outText('reply', `${COPY.sourceSaved(pending.name)}\nVer receta: ${recipeUrl}`)
  return true
}

/** PRO-224: «menú del cole / comedor» in the caption or in a message of the last 30 min. */
const SCHOOL_MENU_RE = /\b(men[uú]s?\s+(del|de\s+el)\s+(cole|colegio|comedor)|comedor\s+(escolar|del\s+cole)|men[uú]\s+escolar)\b/i
export const SCHOOL_MENU_WINDOW_MS = 30 * 60 * 1000

export function schoolMenuIntent(caption: string | null | undefined, rows: readonly HistoryRow[], now: Date): boolean {
  if (SCHOOL_MENU_RE.test(caption ?? '')) return true
  return rows.some(
    (r) => r.direction === 'in' && now.getTime() - r.createdAt.getTime() <= SCHOOL_MENU_WINDOW_MS && SCHOOL_MENU_RE.test(r.body ?? '') && !/^\[menú del cole\]/i.test(r.body ?? ''),
  )
}

/** Pure: the reply after reading the school menu. */
export function schoolMenuReply(days: SchoolLunch[]): string {
  return [
    `He apuntado el menú del cole (${days.length} ${days.length === 1 ? 'día' : 'días'}):`,
    ...schoolLunchLines(days),
    '',
    'Las cenas de esos días no repetirán lo que coman allí. Si algo no está bien, dímelo (p. ej. «el martes 4 era merluza»).',
  ].join('\n')
}

/** True = handled (read, or explained why not). False = not a school menu message. */
async function handleSchoolMenu(
  msg: InboundMessage,
  userId: string,
  now: Date,
  deps: InboundDeps,
  out: (kind: string, messages: OutboundMessage[]) => Promise<void>,
  acker: ReturnType<typeof createAcker>,
  isPdf: boolean,
): Promise<boolean> {
  const { store, client } = deps
  if (!deps.readSchoolMenu || !msg.mediaId) return false
  const rows = await store.loadHistoryRows(msg.from, new Date(now.getTime() - SCHOOL_MENU_WINDOW_MS), userId)
  // A PDF is only ever a school menu here; a photo needs the words.
  if (!isPdf && !schoolMenuIntent(msg.text, rows, now)) return false
  acker.now(COPY.ackSchoolMenu)
  const caption = msg.text?.trim() ?? ''
  try {
    const media = await client.downloadMedia(msg.mediaId)
    const days = await deps.readSchoolMenu(media.buffer, msg.mimeType ?? media.mimeType ?? 'image/jpeg', userId)
    await store.updateInbound(msg.wamid, {
      status: 'processed',
      userId,
      body: `[Menú del cole] ${caption}`.trim(),
      meta: { tools: ['school_menu_read'], toolTrace: [{ name: 'school_menu_read', input: '{}', summary: schoolLunchLines(days).join('; ') }] },
    })
    await out('reply', renderPlainText(schoolMenuReply(days)))
  } catch (err: any) {
    const fileProblem = err instanceof SchoolMenuFileError ? err.reason : null
    const notMenu = err instanceof NotASchoolMenuError || fileProblem !== null
    if (!notMenu) console.error('[whatsapp] school menu read failed:', err?.message ?? err)
    await store.updateInbound(msg.wamid, { status: notMenu ? 'processed' : 'failed', userId, errorMessage: notMenu ? undefined : String(err?.message ?? err).slice(0, 500) })
    const copy =
      fileProblem === 'heic' ? COPY.schoolMenuHeic : fileProblem === 'too_big' ? COPY.schoolMenuTooBig : notMenu ? COPY.schoolMenuNotFound : COPY.schoolMenuFailed
    await out('system', renderPlainText(copy))
  }
  return true
}

/** How long after the Sunday message a bare photo still answers «¿Qué te queda en la nevera?». */
export const FRIDGE_PHOTO_WINDOW_MS = 12 * 60 * 60 * 1000

/** True when the last thing Mimo sent (in the rows given) is the Sunday planning message. */
export function askedForFridge(rows: ReadonlyArray<{ direction?: string | null; kind?: string | null; status?: string | null }>): boolean {
  const lastOut = [...rows].reverse().find((r) => r.direction === 'out' && r.status !== 'failed' && r.kind !== 'ack')
  return lastOut?.kind === 'weekly_nudge'
}

async function handleImage(
  msg: InboundMessage,
  userId: string,
  now: Date,
  deps: InboundDeps,
  out: (kind: string, messages: OutboundMessage[]) => Promise<void>,
  acker: ReturnType<typeof createAcker>,
): Promise<'done' | { text: string; images: { mediaType: string; data: string }[] }> {
  const { store, client } = deps
  if (!msg.mediaId) {
    await store.updateInbound(msg.wamid, { status: 'ignored', userId })
    await out('system', renderPlainText(COPY.imageUnavailable))
    return 'done'
  }
  const media = await client.downloadMedia(msg.mediaId)
  const mimeType = msg.mimeType ?? media.mimeType ?? 'image/jpeg'
  const forMimo = {
    text: msg.text?.trim() || '¿Qué me dices de esta foto?',
    images: [{ mediaType: mimeType, data: media.buffer.toString('base64') }],
  }
  if (photoIntent(msg.text) === 'ask' || !deps.importRecipeFromImage) return forMimo
  // PRO-229: a photo with no caption right after the Sunday «¿Qué te queda en
  // la nevera?» is the fridge, not a recipe: Mimo reads it.
  if (!msg.text?.trim()) {
    const recent = await store.loadHistoryRows(msg.from, new Date(now.getTime() - FRIDGE_PHOTO_WINDOW_MS), userId)
    if (askedForFridge(recent)) return { ...forMimo, text: 'Esto es lo que me queda en la nevera.' }
  }

  // Reading a recipe photo always takes a while (vision + ingredient matching).
  acker.now(COPY.ackPhoto)
  // PRO-66: an Instagram/TikTok link we couldn't read in the last 30 min is
  // the original of this screenshot.
  const historyRows = await store.loadHistoryRows(msg.from, new Date(now.getTime() - PHOTO_SOURCE_WINDOW_MS), userId)
  const sourceUrl = unreadLinkForScreenshot(historyRows, now)
  let saved: { recipeId: string; name: string; warnings: string[]; looksLikeScreenshot?: boolean }
  try {
    saved = sourceUrl
      ? await deps.importRecipeFromImage(media.buffer, mimeType, userId, { sourceUrl })
      : await deps.importRecipeFromImage(media.buffer, mimeType, userId)
  } catch (err: any) {
    const notRecipe = /no se pudo identificar|no parece/i.test(String(err?.message ?? ''))
    // Not a recipe after all (a fridge, a pan, a dish): Mimo looks at it and answers.
    if (notRecipe) return forMimo
    console.error('[whatsapp] image import failed:', err?.message ?? err)
    await store.updateInbound(msg.wamid, {
      status: 'failed',
      userId,
      errorMessage: String(err?.message ?? err).slice(0, 500),
    })
    await out('system', renderPlainText(COPY.imageFailed))
    return 'done'
  }

  trackEvent('recipe_imported', { userId, channel: 'whatsapp', props: { source: 'whatsapp_photo' } })
  // History gets a readable trace so "ponla el jueves para cenar" works next.
  const askSource = !sourceUrl && saved.looksLikeScreenshot === true && !!deps.setRecipeSource
  await store.updateInbound(msg.wamid, {
    status: 'processed',
    userId,
    body: `[Foto de una receta${msg.text ? `: ${msg.text}` : ''}]`,
    meta: {
      photoRecipeId: saved.recipeId,
      photoRecipeName: saved.name,
      ...(sourceUrl ? { photoSourceUrl: sourceUrl } : {}),
      ...(askSource ? { sourceAsked: true } : {}),
    },
  })
  const reviewNote = saved.warnings.length > 0
    ? ' Revisa los ingredientes en la app: alguno no lo he reconocido del todo.'
    : ''
  const sourceNote = sourceUrl ? ' Le he puesto como fuente el enlace que me mandaste.' : ''
  // One question per message: the link to the original, or the menu.
  const question = askSource ? ASK_SOURCE_COPY : '¿Quieres que la ponga en el menú de algún día?'
  await out(
    'reply',
    renderAssistantReply(
      {
        message: `He guardado *${saved.name}* en tus recetas.${sourceNote}${reviewNote} ${question}`,
        uiHint: 'recipe',
        data: { recipeId: saved.recipeId },
      },
      deps.webUrl,
    ),
  )
  return 'done'
}

/** PRO-1298: when the person sent the message (Meta's seconds); `now` when it's missing or in the future. */
export function sentAt(msg: Pick<InboundMessage, 'timestamp'>, now: Date): Date {
  const ms = Number(msg.timestamp) * 1000
  return Number.isFinite(ms) && ms > 0 && ms <= now.getTime() ? new Date(ms) : now
}

// ─── Per-phone serial queue ──────────────────────────────────────
//
// Two quick messages from the same phone must be answered in order, and the
// second must see the first in its history. Railway runs one API instance,
// so an in-process promise chain per phone is enough. Since 19-nov the plain
// texts sent one after another (8 s apart at most) are one turn first
// (coalesce.ts): «2 adultos» + «Casi a diario» reach Mimo together.
const queues = new Map<string, Promise<void>>()
const turnDeps = new Map<string, InboundDeps>()

function queueTurn(msg: InboundMessage, absorbed: string[], deps: InboundDeps): Promise<void> {
  const prev = queues.get(msg.from) ?? Promise.resolve()
  const next = prev
    .then(async () => {
      // The texts joined into this turn: kept, out of the history (the turn's row has them all).
      for (const wamid of absorbed) await deps.store.updateInbound(wamid, { status: 'ignored', errorMessage: 'merged' })
      await processInbound(msg, deps)
    })
    .catch((err) => console.error('[whatsapp] inbound queue error:', err))
  queues.set(msg.from, next)
  void next.finally(() => {
    if (queues.get(msg.from) !== next) return
    queues.delete(msg.from)
    // PRO-1295: the texts that arrived during the turn go now, as one turn.
    coalescer.idle(msg.from)
  })
  return next
}

const coalescer = createCoalescer({
  run: (turn, absorbed) => queueTurn(turn, absorbed, turnDeps.get(turn.from)!),
  // PRO-1295: what arrives while Mimo answers waits for that answer.
  busy: (phone) => queues.has(phone),
  // «escribiendo…» right away while the next text may still come.
  onWait: (msg) => void turnDeps.get(msg.from)?.client.markReadWithTyping(msg.wamid).catch(() => undefined),
})

export function enqueueInbound(msg: InboundMessage, deps: InboundDeps): Promise<void> {
  turnDeps.set(msg.from, deps)
  return coalescer.push(msg)
}
