import Anthropic from '@anthropic-ai/sdk'
import { env } from '../../config/env.js'
import { clockNote, loadUserContext } from './contextLoader.js'
import { buildSystemParts, type AssistantMode, type ChatSurface } from './systemPrompt.js'
import { skills, getToolDefinitions } from './skills.js'
import type { AssistantResponse, ChatMessage, SkillContext, SkillDefinition, SkillResult, ToolTrace } from './types.js'
import { recordSkillActivity } from '../activityEvents.js'
import { recordSkillUsage } from '../usageEvents.js'
import { claimsAction, toolMadeChange } from './claims.js'
import { ensureHealthDisclaimer, talksHealthEffects } from './healthGuard.js'
import { maybeAppendInviteOffer, recordInviteOfferAnswer } from '../inviteOffer.js'
import { maybeAppendFamilyInviteOffer, recordFamilyInviteAnswer } from '../familyInviteMimo.js'
import { maybeAppendLeftoversQuestion, recordLeftoversAnswer } from '../leftoversQuestion.js'
import {
  EMPTY_USAGE,
  addAnthropicUsage,
  type TokenUsage,
} from '../advisorBudget.js'
import { CLAUDE_MODEL } from '../../config/models.js'

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (!client) {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured')
    }
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  }
  return client
}

export interface ChatOptions {
  /** Prompt flavour per channel. The web chat uses the default `'text'`. */
  mode?: AssistantMode
  /**
   * Called right before a round of tools runs, with their names. WhatsApp uses
   * it to send "me pongo con ello" as soon as a slow skill (menu generation,
   * recipe import…) starts, instead of leaving the chat silent for 20+ s.
   * Must not throw; errors are swallowed.
   */
  onToolStart?: (toolNames: string[]) => void
  /**
   * WhatsApp-first sign-up: the user hasn't done the first steps yet, so Mimo
   * asks them in the chat and finishes with `complete_onboarding`.
   */
  onboarding?: boolean
  /** Photos sent with the message (WhatsApp): Mimo sees them and answers about them. */
  images?: { mediaType: string; data: string }[]
  /**
   * PRO-313: the chat app the `whatsapp` mode really runs in. Telegram keeps
   * the WhatsApp mode (same tools, same health rule: `ctx.channel` stays
   * 'whatsapp') and only rewords the channel in the prompt; the offers at the
   * end of a reply (family, other household, leftovers) are WhatsApp-only.
   */
  surface?: ChatSurface
}

/**
 * Core chat orchestrator. Sends the user message to Claude with tool definitions,
 * handles tool_use responses, and returns the final assistant response.
 */
export async function chat(
  userId: string,
  message: string,
  history: ChatMessage[],
  db: any,
  opts: ChatOptions = {},
): Promise<AssistantResponse & { usage: TokenUsage }> {
  const anthropic = getClient()
  const mode = opts.mode ?? 'text'

  // 1. Load user context
  const userContext = await loadUserContext(userId, db)

  // 2. System prompt in two blocks: the instructions (identical for every
  // user of a channel → cached) and this user's data (date, menu, memory →
  // changes when the menu or memory does, so it goes after the instructions'
  // breakpoint). Until 2026-10-12 it was one block with "son las HH:MM"
  // inside, so the cache never survived from one message to the next; until
  // 2026-10-16 the time was still in the context block, which re-wrote the
  // context and the history on every message. The clock now rides on the
  // newest message (buildTurnMessages).
  const { instructions, context } = buildSystemParts(userContext, mode, { onboarding: opts.onboarding === true, surface: opts.surface })
  const system = [
    { type: 'text' as const, text: instructions, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: context },
  ]

  // 3. History (cache breakpoint at its end) + the new message with the clock.
  const messages = buildTurnMessages(history, message, opts.images ?? [], new Date())

  // 4. Tools for this channel, the last one marked as a cache breakpoint.
  const baseTools = getToolDefinitions({ mode, onboarding: opts.onboarding === true })
  const tools = baseTools.map((t, i) =>
    i === baseTools.length - 1
      ? { ...t, cache_control: { type: 'ephemeral' as const } }
      : t,
  )

  // PRO-164: a «no» right after Mimo's offer to invite another household turns it off for good.
  // PRO-313: none of the reply offers on Telegram (their texts and budgets are WhatsApp's).
  const offersOn = opts.onboarding !== true && opts.surface !== 'telegram'
  const offerApplies = (mode === 'text' || mode === 'whatsapp') && offersOn
  if (offerApplies) await recordInviteOfferAnswer(userId, message, history)
  // PRO-262: a «no» right after Mimo's offer to invite the family turns it off for good.
  const familyOfferMode = (mode === 'text' || mode === 'whatsapp') && offersOn ? mode : null
  if (familyOfferMode) await recordFamilyInviteAnswer(userId, message, history)
  // PRO-285: the message right after Mimo's leftovers question is its answer (tagged `sobras`).
  if (mode === 'whatsapp' && offersOn) await recordLeftoversAnswer(userId, message, history)

  // 5. Model ↔ tools loop (see runToolLoop).
  const result = await runToolLoop({
    client: anthropic,
    system,
    tools,
    messages,
    skills,
    ctx: { userId, db, channel: mode },
    onToolStart: opts.onToolStart,
  })

  // 6. After the first resolved week, once, an invite line at the end of
  // this reply (a reply, so on WhatsApp always inside the 24 h window). The
  // family offer (PRO-262, inside the weekly aviso budget) goes first; the
  // other-household offer (PRO-164) only when this reply didn't carry it.
  if (familyOfferMode && result.message) {
    const done = await appendReplyOffers(userId, result.message, { mode: familyOfferMode, invite: offerApplies })
    result.message = done.message
    if (done.offerAdded) result.offerAdded = true
  }
  return result
}

export interface ReplyOfferSteps {
  family: (userId: string, reply: string, channel: 'text' | 'whatsapp') => Promise<string>
  invite: (userId: string, reply: string) => Promise<string>
  leftovers: typeof maybeAppendLeftoversQuestion
}

const REPLY_OFFER_STEPS: ReplyOfferSteps = {
  family: (userId, reply, channel) => maybeAppendFamilyInviteOffer(userId, reply, channel),
  invite: (userId, reply) => maybeAppendInviteOffer(userId, reply),
  leftovers: maybeAppendLeftoversQuestion,
}

/**
 * At most ONE line at the end of a reply (never two offers together): the
 * family offer (PRO-262) first; the other-household offer (PRO-164) only
 * when that one didn't go; Mimo's leftovers question (PRO-285, WhatsApp only)
 * only when neither did. `offerAdded` then holds back the avisos re-offer
 * (PRO-248) for this turn.
 */
export async function appendReplyOffers(
  userId: string,
  reply: string,
  opts: { mode: 'text' | 'whatsapp'; invite: boolean },
  steps: ReplyOfferSteps = REPLY_OFFER_STEPS,
): Promise<{ message: string; offerAdded: boolean }> {
  let message = await steps.family(userId, reply, opts.mode)
  if (opts.invite && message === reply) message = await steps.invite(userId, message)
  if (message === reply) message = await steps.leftovers(userId, message, { mode: opts.mode, otherOffer: false })
  return { message, offerAdded: message !== reply }
}

/**
 * Model behind Mimo (web chat and WhatsApp). Haiku 4.5 until 2026-10-12:
 * replaying 9 real WhatsApp turns, it failed 7 (refused cooking questions,
 * claimed changes it hadn't made, invented menu facts, ran out of tokens);
 * Sonnet 5.5 got none badly wrong. `advisorBudget.ts` prices its tokens.
 */
export const ASSISTANT_MODEL = CLAUDE_MODEL
/** Thinking depth. `medium` is enough for multi-change requests; `low` lost steps in the replay. */
export const ASSISTANT_EFFORT = 'medium'
/** Thinking + text + tool input share it; 1024 cut long create_recipe calls mid-way. */
export const ASSISTANT_MAX_TOKENS = 8000
/**
 * Tool rounds per turn (each round can run several tools in parallel).
 * "Cambia el jueves, el sábado cenamos fuera y apunta leche" plus a lookup
 * or two fits comfortably in six. The round after the
 * last one runs with `tool_choice: none` so the model must answer in text.
 */
export const MAX_TOOL_ROUNDS = 6

/** Server-side fallback when Sonnet's safety classifiers decline (routes by category). */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export const TRUNCATED_NOTE =
  '[Nota del sistema, no la menciones] Tu respuesta anterior era demasiado larga y se ha cortado antes de terminar, asi que no se ha ejecutado. Hazlo por partes: menos herramientas a la vez y textos mas cortos (por ejemplo, una receta con los pasos justos).'

/**
 * PRO-239: the reply says it changed something ("Hecho", "ya está apuntado")
 * but no tool that changes anything ran this turn (none, or only reads like
 * `get_shopping_list`). The engine gives the model ONE more round with this
 * note instead of sending the claim.
 */
export const UNBACKED_CLAIM_NOTE =
  '[Nota del sistema, no la menciones] En este turno no has hecho ningun cambio: no ha corrido ninguna herramienta que cambie algo. Si el usuario te ha pedido un cambio, hazlo ahora con la herramienta. Si no puedes hacerlo, o ya estaba asi de antes y lo has comprobado, dilo con claridad sin afirmar que acabas de hacerlo. No pidas perdon por esta nota ni hables de herramientas.'

const REFUSAL_REPLY = 'Perdona, con eso no te puedo ayudar. ¿Te echo una mano con el menú, una receta o la compra?'

type MessagesClient = { messages: { create: (args: any, options?: any) => Promise<any> } }

/**
 * Messages for one turn: the history, with a cache breakpoint on its last
 * block, then the new user message: the clock first (`clockNote`), up to 4
 * photos, then the text. The next turn's history starts with exactly the same
 * messages, so it reads context + history from the cache written here (as
 * long as the 5-minute cache is alive and the menu/memory didn't change).
 * Breakpoints in a request: tools, instructions, history end and the newest
 * block (`withLastMessageCached`) — the API's maximum of 4.
 */
export function buildTurnMessages(
  history: readonly { role: 'user' | 'assistant'; content: string }[],
  message: string,
  images: readonly { mediaType: string; data: string }[],
  now: Date,
): Anthropic.MessageParam[] {
  const messages = withLastMessageCached(history.map((msg) => ({ role: msg.role, content: msg.content })))
  messages.push({
    role: 'user',
    content: [
      { type: 'text' as const, text: clockNote(now) },
      ...images.slice(0, 4).map((img) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mediaType as 'image/jpeg', data: img.data },
      })),
      ...(message || images.length ? [{ type: 'text' as const, text: message || '(foto sin texto)' }] : []),
    ],
  })
  return messages
}

/** Copy of `messages` with a cache breakpoint on the last block, so later rounds of the same turn reuse the prefix. */
export function withLastMessageCached(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages
  const out = messages.slice(0, -1)
  const last = messages[messages.length - 1]
  const blocks: any[] = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...(last.content as any[])]
  const i = blocks.length - 1
  if (i >= 0 && blocks[i] && blocks[i].type !== 'thinking' && blocks[i].type !== 'redacted_thinking') {
    blocks[i] = { ...blocks[i], cache_control: { type: 'ephemeral' } }
  }
  out.push({ role: last.role, content: blocks } as Anthropic.MessageParam)
  return out
}

/**
 * The model ↔ tools loop, separated from `chat()` so it can be unit-tested
 * with a fake client. Executes EVERY `tool_use` block of a response and
 * returns all results in one user message (the API rejects a follow-up that
 * leaves a tool_use unanswered), then loops until the model answers in text.
 *
 * The full response content (thinking blocks included) goes back unchanged:
 * Sonnet 5.5 needs its own thinking blocks to continue a tool loop.
 */
export async function runToolLoop(params: {
  client: MessagesClient
  system: unknown
  tools: unknown[]
  messages: Anthropic.MessageParam[]
  skills: SkillDefinition[]
  ctx: SkillContext
  maxRounds?: number
  onToolStart?: (toolNames: string[]) => void
  /** Model and effort for this turn (default `ASSISTANT_MODEL` / `ASSISTANT_EFFORT`); `scripts/compareMimoModels.ts` runs the same turn on several. */
  model?: string
  effort?: string
}): Promise<AssistantResponse & { usage: TokenUsage }> {
  const maxRounds = params.maxRounds ?? MAX_TOOL_ROUNDS
  const model = params.model ?? ASSISTANT_MODEL
  const effort = params.effort ?? ASSISTANT_EFFORT
  const messages = [...params.messages]
  const executed: ExecutedTool[] = []
  let usage: TokenUsage = EMPTY_USAGE
  let retriedTruncation = false
  let retriedClaim = false
  const flags: string[] = []

  for (let round = 0; ; round += 1) {
    const response = await params.client.messages.create(
      {
        model,
        max_tokens: ASSISTANT_MAX_TOKENS,
        output_config: { effort },
        fallbacks: 'default',
        system: params.system,
        messages: withLastMessageCached(messages),
        tools: params.tools,
        ...(round >= maxRounds ? { tool_choice: { type: 'none' } } : {}),
      },
      { headers: { 'anthropic-beta': FALLBACK_BETA } },
    )
    usage = addAnthropicUsage(usage, response.usage)

    if (response.stop_reason === 'refusal') {
      flags.push('refusal')
      return buildResponse(REFUSAL_REPLY, executed, usage, flags)
    }

    const content: any[] = Array.isArray(response.content) ? response.content : []
    const toolUses = content.filter((b) => b?.type === 'tool_use') as Anthropic.ToolUseBlock[]
    const text = content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim()

    // Cut off before finishing: a half-written tool call must not run, and
    // half a sentence shouldn't go out as if complete. One retry asking for
    // smaller steps (2026-10-06: a long create_recipe died at 1024 tokens and
    // the user got "error del sistema").
    if (response.stop_reason === 'max_tokens') {
      flags.push('truncated')
      if (!retriedTruncation && round < maxRounds) {
        retriedTruncation = true
        console.warn('[assistant] response hit max_tokens; retrying in smaller steps')
        messages.push({ role: 'user', content: TRUNCATED_NOTE })
        continue
      }
      if (toolUses.length > 0 || !text) {
        return buildResponse('Se me ha hecho muy largo y no lo he terminado. ¿Me lo pides por partes?', executed, usage, flags)
      }
      return buildResponse(`${text}…`, executed, usage, flags)
    }

    if (toolUses.length === 0 || round >= maxRounds) {
      // Saying "hecho / ya está apuntado" when no tool that changes something
      // ran this turn (none, or only reads): one more round asking the model
      // to do it with the tool or say it hasn't (PRO-239, 2026-10-19). Until
      // 2026-10-12 the engine rewrote the reply, which produced the oddest
      // replies of all; since then it only flagged turns with no tool at all,
      // so «Ya está apuntado como cocinado» after `get_shopping_list` slipped
      // through. The note goes as an extra round, never shown to the user.
      const changed = executed.some((e) => toolMadeChange(e.name, e.result.summary, e.isError))
      if (!changed && claimsAction(text)) {
        if (!retriedClaim && round < maxRounds) {
          retriedClaim = true
          flags.push('claim_retry')
          console.warn('[assistant] claimed a change without a changing tool; one more round')
          messages.push({ role: 'assistant', content: content as any })
          messages.push({ role: 'user', content: UNBACKED_CLAIM_NOTE })
          continue
        }
        flags.push('unverified_claim')
      }
      return buildResponse(text, executed, usage, flags)
    }

    console.log(`[assistant] round ${round}: ${toolUses.map((t) => t.name).join(', ')}`)
    try {
      params.onToolStart?.(toolUses.map((t) => t.name))
    } catch (err) {
      console.warn('[assistant] onToolStart failed (ignored):', err)
    }
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const toolUse of toolUses) {
      const skill = params.skills.find((s) => s.name === toolUse.name)
      let result: SkillResult
      let isError = false
      if (!skill) {
        result = { data: null, summary: `Herramienta desconocida: ${toolUse.name}`, uiHint: 'text' }
        isError = true
      } else {
        try {
          result = await skill.handler(toolUse.input, params.ctx)
          recordSkillActivity(skill.name, params.ctx.userId, result)
          recordSkillUsage(skill.name, params.ctx, result, toolUse.input)
        } catch (err: any) {
          console.error(`[assistant] Skill ${skill.name} error:`, err?.message ?? err)
          result = { data: null, summary: `Error ejecutando ${skill.name}: ${err?.message ?? err}`, uiHint: 'text' }
          isError = true
        }
      }
      executed.push({ name: toolUse.name, input: toolUse.input, result, isError })
      results.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result.summary,
        ...(isError ? { is_error: true } : {}),
      })
    }

    messages.push({ role: 'assistant', content: content as any })
    messages.push({ role: 'user', content: results })
  }
}

interface ExecutedTool {
  name: string
  input: unknown
  result: SkillResult
  isError: boolean
}

// claimsAction lives in claims.ts (no imports) so the conversation flags can use it without the engine.
export { claimsAction }

/** One line per tool for history and review: what ran, with what, and what came back. */
export function traceOf(executed: ExecutedTool[]): ToolTrace[] {
  return executed.map((e) => ({
    name: e.name,
    input: compactJson(e.input, 300),
    summary: String(e.result.summary ?? '').replace(/\s+/g, ' ').slice(0, 400),
    ...(e.isError ? { error: true } : {}),
  }))
}

function compactJson(value: unknown, max: number): string {
  let s = ''
  try {
    s = JSON.stringify(value ?? {})
  } catch {
    s = String(value)
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/**
 * The web client renders one card per turn from `uiHint` + `data` (and
 * WhatsApp derives its app link from it), so pick the most visual skill result
 * — "genera el menú y dime qué toca hoy" should show the menu, not the
 * plain-text lookup after it.
 */
function buildResponse(
  text: string,
  executed: ExecutedTool[],
  usage: TokenUsage,
  flags: string[] = [],
): AssistantResponse & { usage: TokenUsage } {
  // A ⟦hecho: …⟧ mark is history bookkeeping (whatsapp/history.ts): never shown.
  text = text.replace(/⟦[^⟧]*⟧\s*/g, '').trim()
  // Mimo is not a doctor (PRO-62, constitution §6): a reply that sends the
  // user to a health professional always carries the mandatory sentence, and
  // one that talks about body effects anyway is flagged for the daily review.
  text = ensureHealthDisclaimer(text)
  if (talksHealthEffects(text) && !flags.includes('health_talk')) flags.push('health_talk')
  const trace = { toolsUsed: executed.map((e) => e.name), corrections: flags, toolTrace: traceOf(executed) }
  if (executed.length === 0) {
    return { message: text || 'No he podido generar una respuesta.', actionTaken: false, usage, ...trace }
  }
  // Most visual wins (menu / list / recipe / cooking > nutrition >
  // confirmation > text); among equals, the latest. So "cambia el jueves y
  // recuerda que como vacuno" still links the menu, not the memory update.
  const rank = (hint?: string) =>
    hint === 'menu' || hint === 'shopping_list' || hint === 'recipe' || hint?.startsWith('cooking_') ? 3
      : hint === 'nutrition' ? 2
      : hint === 'confirmation' ? 1
      : 0
  const primary = executed.reduce((best, e) => (rank(e.result.uiHint) >= rank(best.result.uiHint) ? e : best))
  return {
    message: text || 'Hecho.',
    skillUsed: primary.name,
    data: primary.result.data,
    uiHint: primary.result.uiHint,
    actionTaken: true,
    usage,
    ...trace,
  }
}
