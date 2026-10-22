/**
 * «Afina tu menú» (PRO-146, specs/taste.md) — the two Claude Haiku calls:
 *
 * 1. `pickNextWithClaude`: after the starter deck, each batch of 10 is chosen
 *    from what the user has answered — what we still don't know or doubt
 *    («¿pescado al horno sí y frito no?») — avoiding what is already clear.
 *    Null when the model is unavailable, slow or answers garbage: the caller
 *    uses the variety order instead.
 * 2. `analyseTasteReason`: the free text of «¿Es otra cosa? Cuéntamelo» →
 *    memory facts, like Mimo's `update_memory` (an ingredient → dislikes,
 *    «no tengo horno» → equipment, «a mediodía como fuera» → habits, the
 *    rest → notes). Without the model, a few plain rules do the same for the
 *    obvious cases (and run the e2e, which has no API key).
 *
 * Both bill the household through the cost ledger (feature `taste_next`,
 * `taste_reason`), like every other paid call.
 */
import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'
import { recordAnthropicCost } from './costLedger.js'
import { normalizeText } from './dietaryRestrictions.js'
import { dishType, proteinKind, type TasteRecipe } from './tasteDeck.js'
import { CLAUDE_MODEL, LOW_EFFORT, withThinkingRoom } from '../config/models.js'

export const TASTE_MODEL = CLAUDE_MODEL
/** Past this the batch falls back to the variety order (the client asked at card 5, so there is margin). */
export const TASTE_AI_TIMEOUT_MS = 15000

type CreateFn = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Pick<Anthropic.Message, 'content' | 'usage'>>

let testCreate: CreateFn | null = null
/** Test seam: a fake model for every call (null restores the real one). */
export function setTasteModelForTests(fake: CreateFn | null): void {
  testCreate = fake
}

function modelCreate(explicit?: CreateFn): CreateFn | null {
  if (explicit) return explicit
  if (testCreate) return testCreate
  if (!env.ANTHROPIC_API_KEY) return null
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return (p) => client.messages.create(p)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

export function extractJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
}

function textOf(response: Pick<Anthropic.Message, 'content'>): string | null {
  const block = response.content.find((b) => b.type === 'text')
  return block && block.type === 'text' ? block.text : null
}

const VERDICT_LABEL: Record<string, string> = { love: 'ME ENCANTA', like: 'me apetece', nope: 'NO para mí', skip: 'no la conoce o le da igual' }

const PICK_SYSTEM = `Ayudas a Mimoia, un planificador de menús semanales para hogares en España, a conocer los gustos de un usuario. El usuario va diciendo de cada receta si le encanta, le apetece, no es para él, le da igual o no la conoce.

Te paso lo que ha respondido y una lista de recetas candidatas numeradas. Elige las que más información nos darán ahora:
- busca lo que aún no sabemos o es dudoso (p. ej. si dijo sí a un pescado al horno y no a un pescado frito: ¿es el pescado o la fritura?; ¿la cuchara le gusta siempre o solo algunas?);
- prueba tipos de plato, proteínas y técnicas que aún no ha visto;
- evita repetir lo que ya está claro (si dijo no a tres guisos de carne, no le enseñes otro igual);
- alterna: nunca dos recetas muy parecidas seguidas.

Devuelve SOLO JSON, sin markdown: {"picks":[número, número, …]} con exactamente los que se piden, en el orden en que deben salir. Usa solo números de la lista.`

function describe(r: TasteRecipe): string {
  return `${r.name} (${dishType(r)}, ${proteinKind(r)}${r.totalTime || r.prepTime ? `, ${r.totalTime || r.prepTime} min` : ''})`
}

export interface PickInput {
  candidates: readonly TasteRecipe[]
  answered: ReadonlyArray<{ recipe: TasteRecipe; verdict: string; reason?: string | null }>
  dislikes?: readonly string[]
  limit: number
}

/** Pure: the model's answer → candidate ids (valid, unique, at most `limit`). */
export function normalizePicks(raw: unknown, candidates: readonly TasteRecipe[], limit: number): string[] {
  const picks = raw && typeof raw === 'object' ? (raw as { picks?: unknown }).picks : null
  if (!Array.isArray(picks)) return []
  const out: string[] = []
  for (const p of picks) {
    const i = typeof p === 'number' ? p : Number(p)
    const r = Number.isInteger(i) ? candidates[i - 1] : undefined
    if (r && !out.includes(r.id)) out.push(r.id)
    if (out.length >= limit) break
  }
  return out
}

/** Claude's pick for the next batch, or null (no key, error, timeout, nothing usable). */
export async function pickNextWithClaude(input: PickInput, deps: { create?: CreateFn; timeoutMs?: number } = {}): Promise<string[] | null> {
  const create = modelCreate(deps.create)
  if (!create || input.candidates.length === 0) return null
  // Cap the prompt: the 120 first candidates (already in variety order) are plenty to choose 10.
  const candidates = input.candidates.slice(0, 120)
  const answered = input.answered
    .slice(-60)
    .map((a) => `- ${describe(a.recipe)}: ${VERDICT_LABEL[a.verdict] ?? a.verdict}${a.reason ? ` (motivo: ${a.reason})` : ''}`)
    .join('\n')
  const list = candidates.map((r, i) => `${i + 1}. ${describe(r)}`).join('\n')
  const dislikes = input.dislikes?.length ? `\nNo le gusta: ${input.dislikes.join(', ')}.` : ''
  let response
  try {
    response = await withTimeout(
      create({
        model: TASTE_MODEL,
        max_tokens: withThinkingRoom(200),
        ...LOW_EFFORT,
        system: PICK_SYSTEM,
        messages: [{ role: 'user', content: `LO QUE HA RESPONDIDO:\n${answered || '(nada aún)'}${dislikes}\n\nCANDIDATAS:\n${list}\n\nElige ${Math.min(input.limit, candidates.length)}.` }],
      }),
      deps.timeoutMs ?? TASTE_AI_TIMEOUT_MS,
    )
  } catch (err: any) {
    console.warn('[taste] next pick failed, variety fallback:', err?.message ?? err)
    return null
  }
  recordAnthropicCost('taste_next', TASTE_MODEL, response.usage)
  const text = textOf(response)
  const ids = text ? normalizePicks(extractJson(text), candidates, input.limit) : []
  return ids.length > 0 ? ids : null
}

// ─── «¿Es otra cosa? Cuéntamelo» ────────────────────────────

/** What the free text turns into, in `update_memory` terms. */
export interface TasteMemoryFact {
  key: 'dislikes' | 'equipment' | 'prep_habits' | 'notes'
  /** Items to add (lists). */
  value: string[]
  /** Items to take out (equipment the user doesn't have). */
  remove?: string[]
}

const REASON_SYSTEM = `Un usuario de Mimoia (planificador de menús) ha dicho que una receta "no es para él" y ha explicado por qué con sus palabras. Conviértelo en datos para su memoria, como haría el asistente con update_memory. Claves permitidas:
- "dislikes": ingredientes que no le gustan (lista, en minúsculas y singular: "cilantro", "pimiento").
- "equipment": aparatos de cocina. Si dice que NO tiene uno, ponlo en "remove" (p. ej. {"key":"equipment","value":[],"remove":["horno"]}); si dice que tiene uno, en "value".
- "prep_habits": hábitos de casa en una frase corta ("A mediodía come fuera de casa", "Entre semana no cocina por la noche").
- "notes": cualquier otra cosa útil para planificar sus menús, en una frase corta.
Nunca guardes alergias, enfermedades ni datos de salud: si lo que cuenta es de salud, pon solo una nota "Ha comentado algo de salud sobre <receta>; preguntar en el perfil". Si no hay nada útil, devuelve {"facts":[]}.
Devuelve SOLO JSON, sin markdown: {"facts":[{"key":"…","value":["…"],"remove":["…"]}]}`

const KEYS = new Set(['dislikes', 'equipment', 'prep_habits', 'notes'])

/** Pure: the model's answer → allowed facts only. */
export function normalizeReasonFacts(raw: unknown): TasteMemoryFact[] {
  const facts = raw && typeof raw === 'object' ? (raw as { facts?: unknown }).facts : null
  if (!Array.isArray(facts)) return []
  const out: TasteMemoryFact[] = []
  const strs = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().slice(0, 200))
  for (const f of facts) {
    if (!f || typeof f !== 'object') continue
    const key = (f as { key?: unknown }).key
    if (typeof key !== 'string' || !KEYS.has(key)) continue
    const value = strs((f as { value?: unknown }).value)
    const remove = strs((f as { remove?: unknown }).remove)
    if (value.length === 0 && remove.length === 0) continue
    const k = key as TasteMemoryFact['key']
    const minLen = k === 'prep_habits' ? 3 : 1
    out.push({ key: k, value: value.filter((v) => v.length >= minLen), ...(remove.length ? { remove } : {}) })
  }
  return out
}

const EQUIPMENT_WORDS = ['horno', 'microondas', 'freidora de aire', 'freidora', 'olla express', 'olla rapida', 'wok', 'robot de cocina', 'thermomix', 'batidora', 'vaporera', 'plancha', 'barbacoa']

/**
 * Without the model: the obvious cases by rule. «no tengo horno» → equipment
 * without horno; «no me gusta el cilantro» → dislikes; anything else → a note
 * («Sobre <receta>: …»), so nothing the user wrote is lost.
 */
export function ruleBasedReasonFacts(text: string, recipeName: string): TasteMemoryFact[] {
  const n = normalizeText(text)
  const facts: TasteMemoryFact[] = []
  const noTengo = n.match(/\b(?:no tengo|sin|no hay)\s+(?:el |la |un |una )?([a-z ]+)/)
  if (noTengo) {
    const what = EQUIPMENT_WORDS.find((e) => noTengo[1].startsWith(e))
    if (what) facts.push({ key: 'equipment', value: [], remove: [what === 'olla rapida' ? 'olla express' : what] })
  }
  const noGusta = n.match(/\bno me gusta(?:n)?\s+(?:nada\s+)?(?:el |la |los |las )?([a-z ]+)/)
  if (noGusta && facts.length === 0) {
    const ing = noGusta[1].split(/\b(?:y|ni|pero|porque|que)\b/)[0].trim()
    if (ing) facts.push({ key: 'dislikes', value: [ing] })
  }
  if (/\b(a mediodia|al mediodia|entre semana|por la noche|de lunes a viernes|los (lunes|martes|miercoles|jueves|viernes))\b.*\b(como|comemos|cenamos|ceno) fuera\b/.test(n)) facts.push({ key: 'prep_habits', value: [text.trim().slice(0, 200)] })
  if (facts.length === 0) facts.push({ key: 'notes', value: [`Sobre ${recipeName}: ${text.trim().slice(0, 200)}`] })
  return facts
}

/** The free text → memory facts: Claude when available, the rules otherwise. Never throws. */
export async function analyseTasteReason(text: string, recipeName: string, deps: { create?: CreateFn; timeoutMs?: number } = {}): Promise<TasteMemoryFact[]> {
  const create = modelCreate(deps.create)
  if (!create) return ruleBasedReasonFacts(text, recipeName)
  try {
    const response = await withTimeout(
      create({
        model: TASTE_MODEL,
        max_tokens: withThinkingRoom(300),
        ...LOW_EFFORT,
        system: REASON_SYSTEM,
        messages: [{ role: 'user', content: `RECETA: ${recipeName}\nLO QUE HA ESCRITO: ${text.slice(0, 280)}` }],
      }),
      deps.timeoutMs ?? TASTE_AI_TIMEOUT_MS,
    )
    recordAnthropicCost('taste_reason', TASTE_MODEL, response.usage)
    const out = textOf(response)
    const facts = out ? normalizeReasonFacts(extractJson(out)) : []
    // A model that found nothing still keeps the user's words as a note.
    return facts.length > 0 ? facts : [{ key: 'notes', value: [`Sobre ${recipeName}: ${text.trim().slice(0, 200)}`] }]
  } catch (err: any) {
    console.warn('[taste] reason analysis failed, rules instead:', err?.message ?? err)
    return ruleBasedReasonFacts(text, recipeName)
  }
}
