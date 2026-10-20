/**
 * The house rewrite for the catalogue import (PRO-154): one Claude call per
 * recipe that writes the steps again in Mimoia's own words (never the
 * book's text) and labels the recipe (meal, season, dish type, protein,
 * technique, cuisine, active/total time, difficulty, allergen doubts).
 * Cost lands on Mimoia (no user), feature `catalog_import_rewrite`.
 */
import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'
import { recordAnthropicCost } from './costLedger.js'
import type { CatalogDraftInput, CatalogRewrite } from './catalogImport.js'
import { CLAUDE_MODEL } from '../config/models.js'

const REWRITE_MODEL = CLAUDE_MODEL

export const REWRITE_PROMPT = `Eres el equipo de cocina de Mimoia, un planificador de menús para hogares en España.
Te paso una receta leída de un libro o de una nota. Tu trabajo es escribir los pasos OTRA VEZ, con nuestras palabras, y etiquetarla.

Reglas de escritura (obligatorias):
- NUNCA copies frases del texto original. No repitas más de 4 palabras seguidas del original. Explica lo mismo con tu propia estructura y vocabulario.
- Estilo de la casa: infinitivo («Picar la cebolla…»), frases cortas y claras, un paso por acción importante, de 4 a 10 pasos.
- Las cantidades son para 4 personas (ya están escaladas en la lista de ingredientes); no las repitas en los pasos salvo que haga falta.
- Cada ingrediente de la lista (salvo los opcionales) tiene que salir en algún paso, nombrado como en la lista, y el paso lo enlaza en "ingredientRefs" (índices desde 0 de la lista).
- No menciones ingredientes que no están en la lista.
- Una línea de aceite con la nota «para freír…» o «para confitar…» se enlaza en el paso donde se fríe o se confita; si el mismo aceite sale en dos líneas, cada una va en su paso.
- Pon "durationMin" en los pasos que llevan tiempo (cocer, hornear, reposar) y "temperature" (°C) si hay horno.
- No hagas afirmaciones de salud ni nutricionales.

Etiquetas:
- "meals": de ["breakfast","lunch","dinner","snack"]; "seasons": de ["spring","summer","autumn","winter"] (todas si es de todo el año).
- "course": "starter" | "main" | "dessert" | null.
- "dishType": tipo de plato en español y en minúscula (guiso, crema, sopa, ensalada, arroz, pasta, legumbre, asado, frito, horneado, postre, tortilla…).
- "protein": proteína principal en minúscula (pollo, ternera, cerdo, cordero, pescado blanco, pescado azul, marisco, huevo, legumbre, tofu, queso, ninguna).
- "techniques": técnicas en minúscula (sofreír, guisar, hornear, freír, plancha, vapor, hervir, crudo…).
- "cuisine": cocina en minúscula (española, mediterránea, italiana, mexicana, japonesa…).
- "activeTime": minutos de trabajo; "totalTime": minutos totales (incluye horno y reposos).
- "difficulty": "easy" | "medium" | "hard".
- "allergenDoubt": true si no se puede descartar un alérgeno por cómo está escrito (por ejemplo «salsa al gusto», «caldo» sin decir de qué, trazas); "allergenNote": por qué, en una frase.
- "tips": un consejo corto con tus palabras, o null.

Devuelve SOLO un JSON con esta forma, sin markdown:
{"steps":[{"text":"…","durationMin":null,"temperature":null,"technique":null,"ingredientRefs":[0,1]}],"meals":[],"seasons":[],"course":null,"dishType":null,"protein":null,"techniques":[],"cuisine":null,"activeTime":null,"totalTime":null,"difficulty":null,"allergenDoubt":false,"allergenNote":null,"tips":null}`

/** Pure: the user message for one recipe. */
export function rewriteMessage(draft: CatalogDraftInput, avoidPhrases: readonly string[] = []): string {
  const ings = draft.ingredients
    .map((i, k) => `${k}. ${i.name} — ${i.unit === 'al_gusto' ? 'al gusto' : `${i.quantity} ${i.unit}`}${i.note ? ` (${i.note})` : ''}${i.optional ? ' [opcional]' : ''}`)
    .join('\n')
  const steps = draft.sourceSteps.map((s, k) => `${k + 1}. ${s}`).join('\n')
  const avoid = avoidPhrases.length
    ? `\n\nEn el intento anterior repetiste estas frases del original; escríbelas de otra forma:\n${avoidPhrases.map((p) => `- «${p}»`).join('\n')}`
    : ''
  return `Receta: ${draft.name}\nRaciones: 4\n\nIngredientes (índice. nombre — cantidad):\n${ings}\n\nPasos del original (solo para entender la técnica; no los copies):\n${steps}${avoid}`
}

/** Pure: parse the model's JSON (tolerates a ``` fence or prose around it). */
export function parseRewrite(text: string): CatalogRewrite {
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('La reescritura no devolvió JSON')
    parsed = JSON.parse(m[0])
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null)
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    steps: (Array.isArray(parsed.steps) ? parsed.steps : [])
      .map((s: any) => ({
        text: String(s?.text ?? '').trim(),
        durationMin: num(s?.durationMin),
        temperature: num(s?.temperature),
        technique: str(s?.technique),
        ingredientRefs: Array.isArray(s?.ingredientRefs) ? s.ingredientRefs.filter((k: unknown) => Number.isInteger(k)) : [],
      }))
      .filter((s: { text: string }) => s.text),
    meals: Array.isArray(parsed.meals) ? parsed.meals.map(String) : [],
    seasons: Array.isArray(parsed.seasons) ? parsed.seasons.map(String) : [],
    course: str(parsed.course),
    dishType: str(parsed.dishType),
    protein: str(parsed.protein),
    techniques: Array.isArray(parsed.techniques) ? parsed.techniques.map(String).filter(Boolean) : [],
    cuisine: str(parsed.cuisine),
    activeTime: num(parsed.activeTime),
    totalTime: num(parsed.totalTime),
    difficulty: str(parsed.difficulty),
    allergenDoubt: parsed.allergenDoubt === true,
    allergenNote: str(parsed.allergenNote),
    tips: str(parsed.tips),
  }
}

export function createAnthropicRewriter(): (draft: CatalogDraftInput, opts: { avoidPhrases?: string[] }) => Promise<CatalogRewrite> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY no está configurada')
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return async (draft, opts) => {
    const response = await client.messages.create({
      model: REWRITE_MODEL,
      max_tokens: 6000,
      system: REWRITE_PROMPT,
      messages: [{ role: 'user', content: rewriteMessage(draft, opts.avoidPhrases ?? []) }],
    })
    recordAnthropicCost('catalog_import_rewrite', REWRITE_MODEL, response.usage, null)
    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('La reescritura no devolvió texto')
    return parseRewrite(block.text)
  }
}
