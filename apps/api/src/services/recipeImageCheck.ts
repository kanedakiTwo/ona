/**
 * The two model calls around a recipe photo (specs/recipes.md → Photos):
 *
 *   - `describeDish`: name + ingredients + steps → one short visual
 *     description of the finished, plated dish. Feeds the Imagen prompt so
 *     the picture shows *this* dish (the name alone gave lentejas for a
 *     menestra, a whole chicken for "Arroz con pollo"…).
 *   - `checkRecipeImage`: does a photo show this dish, in the house style?
 *     Used after every automatic generation (one retry on a miss) and by
 *     `scripts/auditRecipeImages.ts` over the catalogue.
 *
 * Both return null when the model is unavailable or answers garbage — the
 * caller decides (generate anyway / keep the image).
 */

import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'
import { recordAnthropicCost } from './costLedger.js'
import { extractJson } from './shopOrders/quoteParser.js'

const DESCRIBE_MODEL = 'claude-haiku-4-5-20251001'
const CHECK_MODEL = 'claude-sonnet-5-5'

type CreateFn = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Pick<Anthropic.Message, 'content' | 'usage'>>

function defaultCreate(): CreateFn | null {
  if (!env.ANTHROPIC_API_KEY) return null
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return (p) => client.messages.create(p)
}

function textOf(res: Pick<Anthropic.Message, 'content'>): string | null {
  const block = res.content.find((b) => b.type === 'text')
  return block && block.type === 'text' ? block.text : null
}

export interface DishInput {
  name: string
  /** "300 g ternera (picada)" style lines, in recipe order. */
  ingredients: string[]
  steps: string[]
}

const DESCRIBE_PROMPT = `Describes cómo se ve un plato ya terminado y emplatado, para que un fotógrafo lo reproduzca. Te paso el nombre, los ingredientes y los pasos de la receta.

Escribe UNA o DOS frases en español (máx. 60 palabras) con lo que se VE: forma del plato (guiso con caldo, crema lisa, ensalada, piezas a la plancha, bol, bocadillo…), ingredientes visibles y su corte, colores, salsa y guarnición, y el recipiente (plato llano, plato hondo, cazuela de barro, bol, tabla…).
- Solo lo que la receta produce de verdad: si es un guiso, no lo describas como un asado; si va triturado, no se ven trozos.
- Nada de luz, fondo, estilo ni cámara: eso lo pone el fotógrafo.
- Responde solo con la descripción, sin comillas.`

/** One-line visual description of the plated dish; null if the model isn't available. */
export async function describeDish(input: DishInput, deps: { create?: CreateFn } = {}): Promise<string | null> {
  const create = deps.create ?? defaultCreate()
  if (!create) return null
  const body = [
    `PLATO: ${input.name}`,
    `INGREDIENTES:\n${input.ingredients.slice(0, 25).join('\n')}`,
    input.steps.length ? `PASOS:\n${input.steps.slice(0, 15).map((s, i) => `${i + 1}. ${s}`).join('\n').slice(0, 3000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  try {
    const res = await create({ model: DESCRIBE_MODEL, max_tokens: 300, system: DESCRIBE_PROMPT, messages: [{ role: 'user', content: body }] })
    recordAnthropicCost('recipe_image_describe', DESCRIBE_MODEL, res.usage)
    const text = textOf(res)?.trim().replace(/^["«]|["»]$/g, '')
    return text ? text.slice(0, 500) : null
  } catch (err) {
    console.warn('[recipeImage] describe failed:', (err as Error)?.message ?? err)
    return null
  }
}

export interface ImageVerdict {
  /** The photo shows this dish (the right preparation and main ingredients). */
  matchesDish: boolean
  /** Overhead/three-quarter editorial cookbook shot on cream/wood/linen, warm light, no text. */
  houseStyle: boolean
  /** Short reason in Spanish, for the audit report and logs. */
  reason: string
}

const CHECK_PROMPT = `Revisas la foto de portada de una receta en una app de cocina. Te paso la receta y la foto. Contesta SOLO con JSON:
{"matches_dish": true|false, "house_style": true|false, "reason": "…"}

matches_dish = true si la foto muestra ESTE plato: la preparación correcta (guiso, crema, ensalada, asado, bocadillo…) y sus ingredientes principales reconocibles. false si es otro plato, si falta el ingrediente principal, si muestra ingredientes crudos en vez del plato hecho, o si no es comida (persona, texto, logo, captura de vídeo).

house_style = true si es una foto realista de libro de cocina: plato o recipiente de cerámica sobre madera natural, lino crudo o fondo crema; luz natural cálida y suave; composición limpia; sin texto, sin logos, sin marcas de agua, sin manos ni personas, sin fondos oscuros, saturados o de colores. Una captura de vídeo, un collage o una foto de móvil en una cocina no cumplen.

reason: una frase corta en español (qué falla, o "ok").`

/** Vision check of a photo against the recipe; null when the model isn't available. */
export async function checkRecipeImage(
  input: DishInput & { image: Buffer; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' },
  deps: { create?: CreateFn } = {},
): Promise<ImageVerdict | null> {
  const create = deps.create ?? defaultCreate()
  if (!create) return null
  const recipe = `RECETA: ${input.name}\nINGREDIENTES: ${input.ingredients.slice(0, 15).join('; ')}`
  try {
    const res = await create({
      model: CHECK_MODEL,
      max_tokens: 1500,
      system: CHECK_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: input.mimeType, data: input.image.toString('base64') } },
            { type: 'text', text: recipe },
          ],
        },
      ],
    })
    recordAnthropicCost('recipe_image_check', CHECK_MODEL, res.usage)
    return normalizeVerdict(extractJson(textOf(res) ?? ''))
  } catch (err) {
    console.warn('[recipeImage] check failed:', (err as Error)?.message ?? err)
    return null
  }
}

/** Pure: model JSON → verdict; null on anything unexpected. */
export function normalizeVerdict(raw: unknown): ImageVerdict | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.matches_dish !== 'boolean' || typeof r.house_style !== 'boolean') return null
  const reason = typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim().slice(0, 200) : r.matches_dish && r.house_style ? 'ok' : 'sin motivo'
  return { matchesDish: r.matches_dish, houseStyle: r.house_style, reason }
}

export function verdictOk(v: ImageVerdict): boolean {
  return v.matchesDish && v.houseStyle
}
