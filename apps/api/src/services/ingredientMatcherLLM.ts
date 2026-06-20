/**
 * LLM-driven ingredient disambiguation.
 *
 * Used as the second stage of the matcher cascade in
 * `recipeExtractor.matchIngredients`, between the pure token-set match
 * and the USDA-backed auto-create.
 *
 * Why a separate stage:
 *
 *   - The token matcher refuses any case where the user's input adds
 *     unrecognised tokens to the catalogue name ("pechuga de pollo" vs
 *     "pollo"). That's correct for AVOIDING false positives, but it
 *     leaves legitimate aliases on the floor — e.g. "chuletón" really
 *     IS "chuleta de vaca" in the catalogue, but no amount of token
 *     manipulation will surface that.
 *
 *   - USDA auto-create then runs as the last resort and ingests the
 *     missing ingredient. That works, but it bloats the catalogue with
 *     pseudo-duplicates ("chuletón" + "chuleta de vaca" + ...) and
 *     loses the user-facing benefit of a normalised library.
 *
 * The LLM stage looks at every unmatched name from a single import +
 * the full catalogue + the recipe title for context, and returns, for
 * each name, either an existing catalogue id (alias resolved) or
 * `null` (genuinely new — fall through to USDA). One batch call per
 * recipe import keeps the cost bounded.
 *
 * Failure modes (network, parse error, API key missing) degrade
 * silently to "no match" so the upstream caller still tries USDA. We
 * never block an import on the LLM step.
 */

import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'

export interface LlmCandidate {
  /** The raw extracted name (e.g. "pechuga de pollo"). */
  extractedName: string
}

export interface LlmCatalogEntry {
  id: string
  name: string
}

export type LlmMatchVerdict =
  | { kind: 'alias'; ingredientId: string; ingredientName: string }
  | { kind: 'new' }

const SYSTEM_PROMPT = `Eres un asistente que normaliza nombres de ingredientes contra el catálogo de la app ONA (cocina española en castellano).

Para cada \`extracted_name\` que te paso, decides si es un alias de algún ingrediente del \`catalog\` (devuelves su \`id\`), o si es genuinamente un ingrediente nuevo que no está en el catálogo (devuelves \`null\`).

Reglas:

1. NUNCA pierdas información. "pechuga de pollo" NO es "pollo". "muslo de pollo" NO es "pollo". Estas son partes distintas del animal con peso, grasa y precio muy diferentes — devuelve \`null\` para que el sistema cree una entrada nueva.

2. SÍ resuelve sinónimos / regionalismos genuinos: "chuletón" → "chuleta de vaca". "pimentón dulce de la vera" → "pimentón dulce". "guisantes congelados" → "guisantes". "cebolleta" → "cebolla tierna" SI existe en el catálogo (si no, \`null\`).

3. SÍ resuelve estados de cocinado equivalentes: "cebolla en juliana" → "cebolla". "tomate triturado" → "tomate" si el catálogo tiene "tomate" y no tiene "tomate triturado" como variante distinta.

4. Cuando dudes, devuelve \`null\` — auto-crear es más seguro que colapsar significado.

5. Respeta el catálogo: si "aceite de oliva virgen extra" existe en el catálogo y el usuario escribió "aceite de oliva", devuelve el id de "aceite de oliva virgen extra" SOLO si no hay otra entrada más genérica ("aceite de oliva"). Prefiere siempre la entrada más cercana a lo que el usuario escribió.

Output: JSON puro, sin envoltorio markdown, con la forma:

{"matches": [{"extracted_name": "...", "ingredient_id": "uuid-o-null"}, ...]}`

export interface DisambiguateInput {
  /** Recipe title — useful context when the LLM has to guess intent. */
  recipeName?: string
  unmatched: LlmCandidate[]
  catalog: LlmCatalogEntry[]
}

export interface DisambiguateOutput {
  /** Mirror of `input.unmatched`, one verdict per extracted name. */
  verdicts: Map<string, LlmMatchVerdict>
}

const MODEL = 'claude-sonnet-4-6'

/**
 * Batch-disambiguate a list of unmatched ingredient names against the
 * catalogue via a single LLM call. Returns a Map keyed by
 * `extractedName` so the caller can plug verdicts back into its
 * per-ingredient loop.
 *
 * Failure modes (no API key, network, malformed JSON) degrade to an
 * empty verdict map so the caller falls through to the next stage.
 */
export async function disambiguateIngredients(
  input: DisambiguateInput,
): Promise<DisambiguateOutput> {
  const out: DisambiguateOutput = { verdicts: new Map() }
  if (input.unmatched.length === 0) return out
  if (!env.ANTHROPIC_API_KEY) return out

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  const userMsg = JSON.stringify({
    recipe_name: input.recipeName ?? null,
    extracted_names: input.unmatched.map((u) => u.extractedName),
    catalog: input.catalog.map((c) => ({ id: c.id, name: c.name })),
  })

  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    })
  } catch (err) {
    console.warn('[ingredientMatcherLLM] API call failed, falling through:', err)
    return out
  }

  const block = response.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') return out

  let parsed: any
  try {
    parsed = JSON.parse(block.text)
  } catch {
    const fenced = block.text.match(/\{[\s\S]*\}/)
    if (!fenced) return out
    try {
      parsed = JSON.parse(fenced[0])
    } catch {
      return out
    }
  }

  if (!parsed || !Array.isArray(parsed.matches)) return out

  // Build a quick id → name lookup so we can include ingredientName in
  // the verdict without making the caller re-query the catalogue.
  const byId = new Map(input.catalog.map((c) => [c.id, c.name]))

  for (const m of parsed.matches) {
    if (typeof m?.extracted_name !== 'string') continue
    const id = m.ingredient_id
    if (typeof id === 'string' && byId.has(id)) {
      out.verdicts.set(m.extracted_name, {
        kind: 'alias',
        ingredientId: id,
        ingredientName: byId.get(id)!,
      })
    } else {
      out.verdicts.set(m.extracted_name, { kind: 'new' })
    }
  }

  return out
}
