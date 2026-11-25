import type { InboundMessage } from './webhookParser.js'
import type { InboundDeps } from './inbound.js'
import type { HistoryRow } from './history.js'
import type { OutboundMessage } from './render.js'
import type { Lang } from './language.js'
import {
  OPEN_QUESTION_WINDOW_MS,
  OPINION_BLOCKED_TOOLS,
  OPINION_NOTE,
  NOT_NOW_REPLY,
  ambiguousAnswer,
  answerNote,
  askedQuestion,
  askedRow,
  bareYesNo,
  clarifyAnswerOf,
  clarifyMessage,
  isOpinion,
  lastMimoRow,
  notNowOf,
  notThatNote,
  refTime,
  sameMadridDay,
  staleSwapReply,
} from './answerTarget.js'

/**
 * PRO-1295: where the household's answer goes, before the budget gate (what
 * the code answers costs nothing). `done` = answered here; otherwise what the
 * turn to Mimo carries: the text it reads (a «¿a cuál?» tap: the household's
 * own «No»), a note saying which question it answers, the body history keeps
 * and the tools it may not use. Null = nothing to add.
 */
export interface AnswerContext {
  text?: string
  note?: string
  historyBody?: string
  withoutTools?: readonly string[]
}

/** Rows within this of each other are the same message (the question and its buttons). */
const SAME_ROW_MS = 10_000

export async function resolveAnswer(
  msg: InboundMessage,
  userId: string,
  now: Date,
  deps: Pick<InboundDeps, 'store'>,
  opts: {
    onboarding: boolean
    languageOf: () => Promise<Lang>
    out: (kind: string, messages: OutboundMessage[]) => Promise<void>
  },
): Promise<'done' | AnswerContext | null> {
  const { store } = deps
  const loadRows = (since: Date) => store.loadHistoryRows(msg.from, since, userId)
  // `ambiguous`: the «No» that got the «¿a cuál?» (the tap finds it by this mark).
  const processed = (body: string | null, ambiguous = false) =>
    store.updateInbound(msg.wamid, { status: 'processed', userId, body, meta: { tools: [], ...(ambiguous ? { ambiguous: true } : {}) } as { tools: string[] } })

  if (msg.kind === 'interactive') {
    // «¿A cuál contestas?» answered: the household's «No» goes to that question.
    const clarified = clarifyAnswerOf(msg.replyId)
    if (clarified) {
      const at = refTime(clarified.ref)
      const rows = await loadRows(new Date(Math.min(now.getTime() - OPEN_QUESTION_WINDOW_MS, (at?.getTime() ?? now.getTime()) - 60_000)))
      const said = ambiguousBody(rows) ?? (clarified.answer === 'si' ? 'Sí' : 'No')
      const q = askedQuestion(rows, clarified.ref)
      if (!q) return { text: said }
      return clarified.before
        ? { text: said, note: notThatNote(said, q), historyBody: `${said} (a lo que hablábamos antes)` }
        : { text: said, note: answerNote(said, q, now), historyBody: `${said} (a «${q.text}»)` }
    }

    // «Ahora no» of the Sunday menu or the freezer review: closed, by code.
    const notNow = notNowOf(msg.replyId)
    if (notNow) {
      await processed(msg.text)
      await opts.out('reply', [{ type: 'text', text: NOT_NOW_REPLY[notNow][await opts.languageOf()] }])
      return 'done'
    }

    const at = refTime(msg.replyRef)
    if (!at) return null
    // «Cambia a algo rápido» under the reminder of a dinner gone by: tonight's isn't that one.
    if (msg.replyId === 'cooking:swap' && !sameMadridDay(at, now)) {
      await processed(msg.text)
      await opts.out('reply', [{ type: 'text', text: staleSwapReply(at, await opts.languageOf()) }])
      return 'done'
    }
    // Any other tap goes to Mimo; when its question isn't Mimo's last message, with that question.
    const rows = await loadRows(new Date(Math.min(now.getTime() - OPEN_QUESTION_WINDOW_MS, at.getTime() - 60_000)))
    const row = askedRow(rows, msg.replyRef)
    const q = askedQuestion(rows, msg.replyRef)
    const last = lastMimoRow(rows)
    if (!row || !q || !last || Math.abs(last.createdAt.getTime() - row.createdAt.getTime()) <= SAME_ROW_MS) return null
    const said = msg.text?.trim() || ''
    return { note: answerNote(said, q, now), historyBody: `${said} (a «${q.text}»)` }
  }

  if (msg.kind !== 'text' || opts.onboarding) return null
  const text = msg.text?.trim() ?? ''
  const yesNo = bareYesNo(text)
  const opinion = isOpinion(text)
  if (!yesNo && !opinion) return null
  const rows = await loadRows(new Date(now.getTime() - OPEN_QUESTION_WINDOW_MS))

  // A «sí» / «no» that could answer more than one question, or one it hadn't seen: ask which.
  if (yesNo) {
    const amb = ambiguousAnswer(rows, new Date(msg.timestamp * 1000), now)
    if (amb) {
      await processed(text, true)
      await opts.out('clarify', [clarifyMessage(yesNo, amb, await opts.languageOf())])
      return 'done'
    }
  }
  // «Me gusta», «qué rico» to a proposal: no cooked meal (the check-in's answer still is).
  if (opinion && lastMimoRow(rows)?.kind !== 'dinner_checkin') {
    return { note: OPINION_NOTE, withoutTools: OPINION_BLOCKED_TOOLS }
  }
  return null
}

/** The household's «No» that got the «¿a cuál?» (its row is marked `ambiguous`). */
function ambiguousBody(rows: readonly HistoryRow[]): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.direction === 'in' && (r.meta as { ambiguous?: boolean } | null)?.ambiguous) return r.body
  }
  return null
}
