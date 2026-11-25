import { madridParts } from '../madridTime.js'
import { dateLabel } from '../assistant/menuDay.js'
import { stripAiSignature } from './aiNotice.js'
import { BUTTONS_MARK, type OutboundMessage } from './render.js'
import type { HistoryRow } from './history.js'
import type { Lang } from './language.js'

/**
 * PRO-1295 (examen del histórico, letra E): every answer goes to the question
 * it answers. Until 24-nov a tap or a written «sí» / «no» was read against
 * Mimo's LAST message: a «No» to the ficha's question was taken as «no
 * cambies nada», a «No» typed before the menu arrived answered its «¿Cambio
 * algo?», a «me gusta» to a proposal was logged as a cooked dinner.
 *
 *   1. Every button Mimo sends carries its question in its id: `<id>~<ref>`,
 *      `ref` = the second it went out, base 36 (`tagButtonId`, added by the
 *      client when it sends; the parser splits it back, `replyRef`). A tap is
 *      resolved against that question: the check-in of THAT day, a «hora de
 *      cocinar» of a dinner gone by, a closed «Ahora no» by code, the rest to
 *      Mimo with the question it answers (`answerNote`).
 *   2. A written «sí» / «no» with more than one question open, or with the
 *      last one sent after the message was written, runs nothing: Mimo asks
 *      which one, one button per question (`ambiguousAnswer`, `clarifyMessage`).
 *   3. An opinion («me gusta», «qué rico») is no cooked meal (`isOpinion`).
 *
 * Pure, except nothing: the inbound turn loads the rows and acts.
 */

/** Between a button's own id and its question's ref. Never used in a base id. */
export const REF_SEP = '~'
/** Meta's limit for a reply button id. */
const BUTTON_ID_MAX = 256

/** The question's ref: the second it went out, in base 36 (7 chars until 2059). */
export function questionRef(at: Date): string {
  return Math.floor(at.getTime() / 1000).toString(36)
}

/** The second a ref stands for; null for anything that isn't one. */
export function refTime(ref: string | null | undefined): Date | null {
  if (!ref || !/^[0-9a-z]{6,8}$/.test(ref)) return null
  const sec = parseInt(ref, 36)
  // From 2026 to 2100: anything else is not a ref of ours.
  if (!Number.isFinite(sec) || sec < 1_767_225_600 || sec > 4_102_444_800) return null
  return new Date(sec * 1000)
}

/** `cooking:swap` + ref → `cooking:swap~t5x9k2a`. An id that has one already keeps it. */
export function tagButtonId(id: string, ref: string): string {
  if (id.includes(REF_SEP)) return id
  const tagged = `${id}${REF_SEP}${ref}`
  return tagged.length <= BUTTON_ID_MAX ? tagged : id
}

/** Every button of a message with the question's ref (texts and pictures untouched). */
export function tagButtons(msg: OutboundMessage, at: Date): OutboundMessage {
  if (msg.type !== 'buttons') return msg
  const ref = questionRef(at)
  return { ...msg, buttons: msg.buttons.map((b) => ({ ...b, id: tagButtonId(b.id, ref) })) }
}

/** A tapped id → its own id and its question's ref (null for the ids sent before 24-nov). */
export function splitButtonId(id: string | null | undefined): { base: string | null; ref: string | null } {
  if (!id) return { base: id ?? null, ref: null }
  const at = id.lastIndexOf(REF_SEP)
  if (at < 0) return { base: id, ref: null }
  return { base: id.slice(0, at), ref: id.slice(at + 1) || null }
}

/** Kinds that never ask the household anything (notices, «me pongo con ello», our own «¿a cuál?»). */
const NOT_A_QUESTION = new Set(['ack', 'system', 'link', 'review', 'optin', 'optout', 'image_failed', 'clarify'])
/** How far back a question can still be open. */
export const OPEN_QUESTION_WINDOW_MS = 12 * 60 * 60 * 1000
/** Rows of one reply split in several messages (the picture, then the words with buttons). */
const SAME_MESSAGE_MS = 10_000

export interface AskedQuestion {
  at: Date
  ref: string
  kind: string
  /** The question as the household read it (its last sentence with «?», or the message's last line). */
  text: string
  buttons: string[]
}

/** Lines that close a message without asking: links, «Hecho con Mimo», the AI line. */
const TRAILER_LINE = /(https?:\/\/|mimoia\.com|^ver (menú|receta|lista)|^→ )/i

/** The body without its marks: the buttons, the picture, the AI line. */
function plainBody(body: string): string {
  return stripAiSignature(body)
    .replace(BUTTONS_MARK, '')
    .replace(/⟦[^⟧]*⟧/g, '')
    .trim()
}

/** Pure: an outbound body that asks the household something (buttons, or it ends in a question). */
export function asksSomething(body: string | null | undefined): boolean {
  if (!body) return false
  if (BUTTONS_MARK.test(body)) return true
  const lines = plainBody(body).split('\n').map((l) => l.trim()).filter((l) => l && !TRAILER_LINE.test(l))
  return (lines.at(-1) ?? '').includes('?')
}

/** Pure: the question of an outbound body, short enough to quote. */
export function questionText(body: string): string {
  const text = plainBody(body)
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !TRAILER_LINE.test(l))
  const last = lines.at(-1) ?? ''
  // The last sentence with a «?»: «¿Qué tal ha salido hoy la cena (*X*)?».
  const sentences = last.match(/[^.!?¿¡]*[¿¡]?[^.!?¿¡]*\?/g)
  const q = (sentences?.at(-1) ?? last).trim()
  const one = q.replace(/\*/g, '').replace(/\s+/g, ' ')
  return one.length > 140 ? `${one.slice(0, 139)}…` : one
}

function buttonsOf(body: string): string[] {
  const m = body.match(BUTTONS_MARK)
  return m ? m[1].split(' | ').map((t) => t.trim()) : []
}

function toQuestion(r: HistoryRow): AskedQuestion {
  const body = r.body ?? ''
  return { at: r.createdAt, ref: questionRef(r.createdAt), kind: r.kind ?? '', text: questionText(body), buttons: buttonsOf(body) }
}

/**
 * Pure: the questions Mimo left open (`rows` oldest first): the ones it sent
 * after the household's last answered turn, in the last 12 h, each reply
 * counted once (its rows within 10 s of each other are one message). Oldest
 * first.
 */
export function openQuestions(rows: readonly HistoryRow[], now: Date): AskedQuestion[] {
  let from = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].direction === 'in' && rows[i].status === 'processed') {
      from = i + 1
      break
    }
  }
  const out = rows
    .slice(from)
    .filter((r) => r.direction === 'out' && r.status === 'sent' && !NOT_A_QUESTION.has(r.kind ?? ''))
    .filter((r) => now.getTime() - r.createdAt.getTime() <= OPEN_QUESTION_WINDOW_MS)
  // One reply in several messages: only its last row speaks for it.
  const messages = out.filter((r, i) => {
    const next = out[i + 1]
    return !(next && next.kind === r.kind && next.createdAt.getTime() - r.createdAt.getTime() <= SAME_MESSAGE_MS)
  })
  return messages.filter((r) => asksSomething(r.body)).map(toQuestion)
}

/** Pure: the outbound row a ref points at (the message with buttons sent in that second, or just after). */
export function askedRow(rows: readonly HistoryRow[], ref: string | null | undefined): HistoryRow | null {
  const at = refTime(ref)
  if (!at) return null
  const t = at.getTime()
  // The row is written right after Meta answers the send: the same second or a few after.
  const near = rows.filter((r) => r.direction === 'out' && r.createdAt.getTime() >= t - 1000 && r.createdAt.getTime() <= t + 60_000)
  return near.find((r) => BUTTONS_MARK.test(r.body ?? '')) ?? near[0] ?? null
}

/** The question a ref points at, quoted (null when its row isn't there). */
export function askedQuestion(rows: readonly HistoryRow[], ref: string | null | undefined): AskedQuestion | null {
  const row = askedRow(rows, ref)
  return row ? { ...toQuestion(row), ref: ref! } : null
}

/** Pure: the last thing Mimo said to the household (not a notice nor «me pongo con ello»). */
export function lastMimoRow(rows: readonly HistoryRow[]): HistoryRow | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.direction === 'out' && r.status === 'sent' && !NOT_A_QUESTION.has(r.kind ?? '')) return r
  }
  return null
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-zñ0-9]+/g, ' ')
    .trim()

const YES_WORDS = new Set(['si', 'sii', 'sip', 'vale', 'ok', 'okay', 'claro', 'venga', 'dale', 'yes'])
const NO_WORDS = new Set(['no', 'nop', 'nope', 'nada'])
const FILLER = new Set(['gracias', 'por', 'favor', 'mimo', 'de', 'acuerdo', 'que', 'tambien', 'eso', 'mejor', 'vale'])

/**
 * Pure: a message that is only a «sí» or a «no» (with «vale», «claro»,
 * «gracias», punctuation or emoji around it): what it says, else null.
 * «No, ponme pescado» says more: it is no bare «no».
 */
export function bareYesNo(text: string | null | undefined): 'si' | 'no' | null {
  const words = fold(text ?? '').split(' ').filter(Boolean)
  if (words.length === 0 || words.length > 4) return null
  const yes = words.some((w) => YES_WORDS.has(w) && w !== 'vale')
  const no = words.some((w) => NO_WORDS.has(w))
  if (!words.every((w) => YES_WORDS.has(w) || NO_WORDS.has(w) || FILLER.has(w))) return null
  if (no && !yes) return 'no'
  if (yes && !no) return 'si'
  return null
}

/**
 * Pure: a written «sí» / «no» that can't be read against one question — more
 * than one open (`openQuestions`), or the last one sent after the household
 * wrote it (`writtenAt`, Meta's timestamp: it hadn't seen it). Then the
 * questions to ask about (oldest first; at most the last 3), and whether the
 * last one came after the message. Null = one question, the answer is its.
 */
export function ambiguousAnswer(
  rows: readonly HistoryRow[],
  writtenAt: Date,
  now: Date,
): { questions: AskedQuestion[]; unseen: boolean } | null {
  const open = openQuestions(rows, now)
  if (open.length === 0) return null
  const unseen = open[open.length - 1].at.getTime() > writtenAt.getTime()
  if (open.length < 2 && !unseen) return null
  // With the last one unseen, one button stays for «lo de antes».
  return { questions: open.slice(unseen ? -2 : -3), unseen }
}

/** WhatsApp's limit for a reply button title. */
const BUTTON_TITLE_MAX = 20

function buttonTitle(i: number, q: AskedQuestion): string {
  const label = `${i + 1}. ${q.text.replace(/^¿/, '').replace(/\?$/, '')}`
  return label.length <= BUTTON_TITLE_MAX ? label : `${label.slice(0, BUTTON_TITLE_MAX - 1).trimEnd()}…`
}

const ANSWER_WORD: Record<Lang, Record<'si' | 'no', string>> = {
  es: { si: 'Sí', no: 'No' },
  en: { si: 'Yes', no: 'No' },
}

/**
 * The «¿a cuál?» message: each open question in full, one button per question
 * (`cual:<si|no>:<ref>`), and «Lo de antes» (`…:prev`) when the last one came
 * after the household wrote. Sent without the model.
 */
export function clarifyMessage(answer: 'si' | 'no', amb: { questions: AskedQuestion[]; unseen: boolean }, lang: Lang = 'es'): OutboundMessage {
  const word = ANSWER_WORD[lang][answer]
  const lines = amb.questions.map((q, i) => `${i + 1}. ${q.text}`)
  const buttons = amb.questions.map((q, i) => ({ id: `cual:${answer}:${q.ref}`, title: buttonTitle(i, q) }))
  if (amb.unseen) {
    // «Lo de antes»: not the last question (the one it hadn't seen), its ref + `:antes`.
    const last = amb.questions[amb.questions.length - 1]
    lines.push(lang === 'en' ? `${lines.length + 1}. What we were talking about before` : `${lines.length + 1}. Lo que hablábamos antes`)
    buttons.push({ id: `cual:${answer}:${last.ref}:antes`, title: lang === 'en' ? `${buttons.length + 1}. Before` : `${buttons.length + 1}. Lo de antes` })
  }
  const head =
    lang === 'en'
      ? `So I don't get it wrong: which one does your «${word}» answer?`
      : `Para no equivocarme: ¿a qué contestas «${word}»?`
  return { type: 'buttons', text: `${head}\n${lines.join('\n')}`, buttons }
}

/**
 * A tapped «¿a cuál?» button → the answer and the question it goes to;
 * `before`: «Lo de antes», i.e. NOT that question (the one it hadn't seen).
 */
export function clarifyAnswerOf(replyId: string | null | undefined): { answer: 'si' | 'no'; ref: string; before: boolean } | null {
  const m = /^cual:(si|no):([0-9a-z]+)(:antes)?$/.exec(replyId ?? '')
  return m ? { answer: m[1] as 'si' | 'no', ref: m[2], before: !!m[3] } : null
}

function whenLabel(at: Date, now: Date): string {
  const p = madridParts(at)
  const hh = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
  return p.isoDate === madridParts(now).isoDate ? `hoy a las ${hh}` : `el ${dateLabel(p.isoDate)} a las ${hh}`
}

/**
 * The note Mimo gets with an answer that goes to a question other than its
 * last message (never stored, never said). `answer`: what the household said.
 */
export function answerNote(answer: string, q: AskedQuestion, now: Date): string {
  return (
    `[Nota del sistema, no la menciones] «${answer}» contesta a tu mensaje de ${whenLabel(q.at, now)}: «${q.text}». ` +
    'Responde a esa pregunta y haz solo lo que pide esa respuesta; no la tomes como respuesta a ninguna otra.'
  )
}

/** The note for «Lo de antes»: the answer is NOT to the message it hadn't seen. */
export function notThatNote(answer: string, q: AskedQuestion): string {
  return (
    `[Nota del sistema, no la menciones] «${answer}» lo escribió antes de ver tu mensaje «${q.text}»: no contesta a eso, ` +
    'sino a lo que hablabais antes. Si no está claro a qué, pregúntaselo en una frase.'
  )
}

/** Same day (Madrid) as `now`? A «hora de cocinar» of a dinner gone by can't swap tonight's. */
export function sameMadridDay(a: Date, b: Date): boolean {
  return madridParts(a).isoDate === madridParts(b).isoDate
}

/** «Cambia a algo rápido» tapped under the reminder of a dinner already gone. */
export function staleSwapReply(at: Date, lang: Lang = 'es'): string {
  const day = dateLabel(madridParts(at).isoDate)
  return lang === 'en'
    ? `That reminder was for the dinner of ${day}, which has gone by. If you want to change tonight's, just tell me.`
    : `Ese aviso era de la cena del ${day}, que ya pasó. Si quieres cambiar la de hoy, dímelo.`
}

/** «Ahora no» of the avisos that only ask (the Sunday menu, the freezer): answered by code, no model. */
export const NOT_NOW_REPLY: Record<'nudge' | 'freezer', Record<Lang, string>> = {
  nudge: {
    es: 'Vale, no lo preparo. Cuando quieras el menú de la semana que viene, pídemelo.',
    en: "Fine, I won't make it. Whenever you want next week's menu, just ask.",
  },
  freezer: {
    es: 'Vale, lo dejo en el congelador.',
    en: "Fine, I'll leave it in the freezer.",
  },
}

/** `nudge:no` / `freezer:no` → which aviso; anything else → null. */
export function notNowOf(replyId: string | null | undefined): 'nudge' | 'freezer' | null {
  if (replyId === 'nudge:no') return 'nudge'
  if (replyId === 'freezer:no') return 'freezer'
  return null
}

const OPINION = /\b(me gusta|nos gusta|me encanta|nos encanta|me apetece|que rico|que rica|que ricos|que ricas|que bueno|que buena|que buenos|que buenas|buena pinta|que pinta|suena bien|suena genial|suena rico|tiene buena pinta|delicioso|deliciosa|riquisimo|riquisima|buenisimo|buenisima|que hambre|mmm+|ñam)\b/
/** Words that say it was cooked or eaten: then it is a report, not an opinion. */
const COOKED =
  /\b(hice|hicimos|hecho|hecha|cocine|cocinamos|cocinado|cocinada|cenamos|comimos|cenado|comido|salio|salido|estaba|estaban|estuvo|estuvieron|probamos|probado|gusto|gustaron|ha gustado|han gustado|quedo|quedado)\b/

/**
 * Pure: an opinion on a dish («me gusta», «qué rico», «buena pinta»), not a
 * report that it was cooked («la hice», «nos gustó», «estaba rica»).
 */
export function isOpinion(text: string | null | undefined): boolean {
  const t = fold(text ?? '')
  return OPINION.test(t) && !COOKED.test(t)
}

/** What an opinion turn may not do: log a meal as cooked or eaten. */
export const OPINION_BLOCKED_TOOLS = ['log_cooked', 'mark_meal_eaten'] as const

export const OPINION_NOTE =
  '[Nota del sistema, no la menciones] Es una opinión sobre lo que le has propuesto: no dice que lo haya cocinado ni comido, así que no lo apuntes como hecho.'
