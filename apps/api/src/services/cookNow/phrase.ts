/**
 * Mimo's line on the preferred «Cocinar ahora» recipe (specs/cook-now.md):
 * one short sentence written only from the facts given. The only live AI
 * call of the feature; billed as `cook_now_phrase`, outside Mimo's monthly
 * cap; a paused account gets none. Never throws: null on any failure or
 * after 5 s.
 */
import Anthropic from '@anthropic-ai/sdk'
import { env } from '../../config/env.js'
import { CLAUDE_MODEL, LOW_EFFORT, withThinkingRoom } from '../../config/models.js'
import { isOnFreePlan } from '../accountAccess.js'
import { anthropicUnits, recordCost } from '../costLedger.js'

export interface PhraseFactsInput {
  recipeName: string
  uses: string[]
  expiring: string[]
  lastCookedDaysAgo: number | null
  repeat: boolean
  missingSecondary: string[]
}

export const COOK_NOW_PHRASE_PROMPT = `Eres Mimo, el asistente de Mimoia. Alguien va a cocinar ahora y Mimoia le propone una receta. Escribe UNA frase corta (15 palabras como mucho), en español de España y tuteando, que diga por qué esta receta le encaja ahora. Usa solo los datos que te doy; no inventes ingredientes, fechas ni gustos. Sin emojis ni comillas.`

export function phraseFacts(f: PhraseFactsInput): string {
  const lines = [`Receta: ${f.recipeName}`]
  if (f.uses.length) lines.push(`Usa de su despensa: ${f.uses.join(', ')}`)
  if (f.expiring.length) lines.push(`Caduca pronto: ${f.expiring.join(', ')}`)
  if (f.lastCookedDaysAgo != null) lines.push(`La cocinó por última vez hace ${f.lastCookedDaysAgo} días`)
  if (f.repeat) lines.push('La marcó como «Repetir a menudo»')
  if (f.missingSecondary.length) lines.push(`Puede hacerla sin: ${f.missingSecondary.join(', ')}`)
  return lines.join('\n')
}

export function cleanPhrase(raw: string): string | null {
  const first = raw.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const unquoted = first.replace(/^[«"“']+|[»"”']+$/g, '').trim()
  return unquoted ? unquoted.slice(0, 160) : null
}

type CreateFn = (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<{ content: Array<{ type: string; text?: string }>; usage?: unknown }>

export async function cookNowPhrase(
  userId: string,
  facts: PhraseFactsInput,
  deps: { create?: CreateFn; paused?: (id: string) => Promise<boolean>; timeoutMs?: number; householdId?: string | null } = {},
): Promise<string | null> {
  try {
    if (await (deps.paused ?? ((id) => isOnFreePlan(id, new Date())))(userId)) return null
    let create = deps.create
    if (!create) {
      if (!env.ANTHROPIC_API_KEY) return null
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
      create = (p) => client.messages.create(p) as any
    }
    const call = create({
      model: CLAUDE_MODEL,
      max_tokens: withThinkingRoom(80),
      ...LOW_EFFORT,
      system: COOK_NOW_PHRASE_PROMPT,
      messages: [{ role: 'user', content: phraseFacts(facts) }],
    } as Anthropic.MessageCreateParamsNonStreaming)
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), deps.timeoutMs ?? 5000))
    const response = await Promise.race([call, timeout])
    if (!response) return null
    // Outside Mimo's monthly cap: billed to the household, not to the user's
    // monthly sum (getUserMonthlySpendEur reads cost_events by user_id).
    if (response.usage) {
      recordCost({ feature: 'cook_now_phrase', provider: 'anthropic', model: CLAUDE_MODEL, units: anthropicUnits(response.usage as any), userId: null, householdId: deps.householdId ?? null })
    }
    const text = response.content.find((b) => b.type === 'text')?.text ?? ''
    return cleanPhrase(text)
  } catch (err) {
    console.warn('[cook-now-phrase] failed:', (err as Error)?.message ?? err)
    return null
  }
}
