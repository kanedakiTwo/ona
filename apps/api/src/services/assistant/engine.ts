import Anthropic from '@anthropic-ai/sdk'
import { env } from '../../config/env.js'
import { loadUserContext } from './contextLoader.js'
import { buildSystemPrompt, type AssistantMode } from './systemPrompt.js'
import { skills, getToolDefinitions } from './skills.js'
import type { AssistantResponse, ChatMessage, SkillContext, SkillDefinition, SkillResult } from './types.js'
import { recordSkillActivity } from '../activityEvents.js'
import {
  EMPTY_USAGE,
  addAnthropicUsage,
  type TokenUsage,
} from '../advisorBudget.js'

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

  // 1. Load user context
  const userContext = await loadUserContext(userId, db)

  // 2. Build system prompt
  const systemPrompt = buildSystemPrompt(userContext, opts.mode ?? 'text', { onboarding: opts.onboarding === true })

  // 3. Build messages array from history + new message
  const messages: Anthropic.MessageParam[] = history.map(msg => ({
    role: msg.role,
    content: msg.content,
  }))
  messages.push({ role: 'user', content: message })

  // 4. Get tool definitions, marking the last one with `cache_control` so
  // Anthropic prompt-caches the entire (system + tools) prefix on first
  // turn and reuses it (~10% cost) on every following turn within the 5-min
  // TTL. With ONA's ~5k-token prefix (10 mandamientos KB + 27 tool defs),
  // this typically cuts the per-turn cost ~70% on multi-turn conversations
  // and 30–50% even on single-turn ones thanks to the cached system block.
  const baseTools = getToolDefinitions()
  const tools = baseTools.map((t, i) =>
    i === baseTools.length - 1
      ? { ...t, cache_control: { type: 'ephemeral' as const } }
      : t,
  )

  // System prompt is itself a cache breakpoint: this caches the system block
  // independently of the tools, so even if we later tweak the tool list we
  // keep the system prefix cached.
  const cachedSystem = [
    { type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } },
  ]

  // 5. Model ↔ tools loop (see runToolLoop).
  return runToolLoop({
    client: anthropic,
    system: cachedSystem,
    tools,
    messages,
    skills,
    ctx: { userId, db, channel: opts.mode ?? 'text' },
    onToolStart: opts.onToolStart,
  })
}

/** Model used by the text assistant. `advisorBudget.ts` prices its tokens. */
export const ASSISTANT_MODEL = 'claude-haiku-4-5-20251001'
/**
 * Tool rounds per turn (each round can run several tools in parallel).
 * "Cambia el jueves, el sábado cenamos fuera y apunta leche" plus a lookup
 * or two fits comfortably in six. The round after the
 * last one runs with `tool_choice: none` so the model must answer in text.
 */
export const MAX_TOOL_ROUNDS = 6

type MessagesClient = { messages: { create: (args: any) => Promise<any> } }

/**
 * The model ↔ tools loop, separated from `chat()` so it can be unit-tested
 * with a fake client. Executes EVERY `tool_use` block of a response and
 * returns all results in one user message (the API rejects a follow-up that
 * leaves a tool_use unanswered), then loops until the model answers in text.
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
}): Promise<AssistantResponse & { usage: TokenUsage }> {
  const maxRounds = params.maxRounds ?? MAX_TOOL_ROUNDS
  const messages = [...params.messages]
  const executed: { name: string; result: SkillResult }[] = []
  let usage: TokenUsage = EMPTY_USAGE
  let claimCheckDone = false
  const corrections: string[] = []

  for (let round = 0; ; round += 1) {
    const response = await params.client.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 1024,
      system: params.system,
      messages,
      tools: params.tools,
      ...(round >= maxRounds ? { tool_choice: { type: 'none' } } : {}),
    })
    usage = addAnthropicUsage(usage, response.usage)

    const content: any[] = Array.isArray(response.content) ? response.content : []
    const toolUses = content.filter((b) => b?.type === 'tool_use') as Anthropic.ToolUseBlock[]

    if (toolUses.length === 0 || round >= maxRounds) {
      const text = content
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
        .trim()
      // Hallucinated action: the model says "cambiado/guardado/hecho" but ran
      // no tool this turn. Give it one corrective round to either call the
      // tool or tell the truth — a false "listo" is worse than a slow answer,
      // especially on WhatsApp where there's no screen to notice it.
      // Same one-shot nudge when it gives up without trying ("no puedo
      // cambiar eso porque…") — usually a stored dislike or a missing lookup,
      // both of which the tools can handle.
      const claim = claimsAction(text)
      const noTools = executed.length === 0
      // "Dame un momento y luego te la pongo": the assistant can't act after
      // replying, so a promise means the work is simply never done.
      const correction =
        noTools && claim ? UNVERIFIED_ACTION_CORRECTION
          : noTools && refusesAction(text) ? REFUSAL_CORRECTION
          : promisesLater(text) ? PROMISE_CORRECTION
          : null
      if (!claimCheckDone && round < maxRounds && correction) {
        claimCheckDone = true
        corrections.push(correction === PROMISE_CORRECTION ? 'promise' : correction === REFUSAL_CORRECTION ? 'refusal' : 'unverified_claim')
        console.warn(`[assistant] corrective round: ${correction === PROMISE_CORRECTION ? 'promise to act later' : claim ? 'unverified action claim' : 'refusal without trying'}`)
        messages.push({ role: 'assistant', content: content as any })
        messages.push({ role: 'user', content: correction })
        continue
      }
      return buildResponse(text, executed, usage, corrections)
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
        } catch (err: any) {
          console.error(`[assistant] Skill ${skill.name} error:`, err?.message ?? err)
          result = { data: null, summary: `Error ejecutando ${skill.name}: ${err?.message ?? err}`, uiHint: 'text' }
          isError = true
        }
      }
      executed.push({ name: toolUse.name, result })
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

/**
 * Spanish past-tense "I did it" claims. Only checked when no tool ran this
 * turn, so a legit "He cambiado la cena" after swap_meal never trips it.
 */
const ACTION_CLAIM_RE =
  /\b(?:he|hemos|ya)\s+(?:cambiado|generado|guardado|marcado|a[ñn]adido|actualizado|apuntado|creado|quitado|eliminado|borrado|puesto|sustituido|registrado)\b|(?:^|[.!?,;]\s*)(?:hecho|listo|cambiado|guardado|apuntado)\s*[.!,:]/im

export function claimsAction(text: string): boolean {
  return ACTION_CLAIM_RE.test(text)
}

const PROMISE_RE =
  /\b(?:dame un (?:momento|segundo|minuto)|en (?:un|unos) (?:momento|minuto|minutos|segundos)\b.*\b(?:te|la|lo)\b|luego te|y luego (?:te )?(?:la |lo )?(?:pongo|añado|creo)|te aviso cuando|ahora mismo (?:te )?(?:la|lo) (?:creo|pongo|añado))/i

export function promisesLater(text: string): boolean {
  return PROMISE_RE.test(text)
}

export const PROMISE_CORRECTION =
  '[Nota del sistema, no la menciones] Has prometido hacer algo despues ("dame un momento", "luego te la pongo"), pero no puedes actuar despues de responder: si no lo haces ahora, no se hara nunca. Hazlo ahora con las herramientas. Si un paso fallo (por ejemplo no se pudo leer un enlace y el usuario quiere esa receta), resuelvelo tu: crea la receta con create_recipe y usala con swap_meal. Luego responde solo con lo hecho.'

const REFUSAL_RE = /\bno\s+(?:puedo|podemos|es posible|he podido|se puede)\b/i

export function refusesAction(text: string): boolean {
  return REFUSAL_RE.test(text)
}

export const REFUSAL_CORRECTION =
  '[Nota del sistema, no la menciones] Has dicho que no puedes sin haber llamado a ninguna herramienta. Lo que el usuario pide explicitamente manda sobre gustos y disgustos guardados (no sobre alergias o restricciones de salud: con esas, avisa y pide confirmacion). Si alguna herramienta puede hacer lo que pide (cambiar platos, notas, lista, despensa, perfil…), llamala ahora y haz TODO lo que pidio. Solo si de verdad no existe herramienta para ello, explicalo en una linea.'

export const UNVERIFIED_ACTION_CORRECTION =
  '[Nota del sistema, no la menciones] Tu respuesta afirma que has hecho un cambio, pero en este turno no has llamado a ninguna herramienta. Si solo estabas recordando algo que ya se hizo en un turno anterior de la conversacion, NO lo repitas ni llames a ninguna herramienta: vuelve a escribir tu respuesta tal cual. Si el usuario acaba de pedir un cambio, llama ahora a la herramienta adecuada. Si no es posible (por ejemplo, la receta no existe en el catalogo), dile la verdad y ofrece una alternativa real.'

/**
 * The web client renders one card per turn from `uiHint` + `data` (and
 * WhatsApp derives its app link from it), so pick the most visual skill result
 * — "genera el menú y dime qué toca hoy" should show the menu, not the
 * plain-text lookup after it.
 */
function buildResponse(
  text: string,
  executed: { name: string; result: SkillResult }[],
  usage: TokenUsage,
  corrections: string[] = [],
): AssistantResponse & { usage: TokenUsage } {
  const trace = { toolsUsed: executed.map((e) => e.name), corrections }
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
    message: text || primary.result.summary,
    skillUsed: primary.name,
    data: primary.result.data,
    uiHint: primary.result.uiHint,
    actionTaken: true,
    usage,
    ...trace,
  }
}
