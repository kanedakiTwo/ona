import Anthropic from '@anthropic-ai/sdk'
import { env } from '../../config/env.js'
import type {
  RawExtractedRecipe,
  TextExtractionHint,
  TextExtractionProvider,
  TextExtractionResult,
  VisionProvider,
} from '../recipeExtractor.js'

const EXTRACTION_PROMPT = `Eres un asistente especializado en extraer recetas de fotografias.
Analiza la imagen proporcionada que contiene una receta escrita o impresa.

Extrae la siguiente informacion en formato JSON:

{
  "name": "nombre de la receta",
  "servings": 4,
  "servingsConfidence": "explicit",
  "prepTime": numero en minutos o null si no se menciona,
  "ingredients": [
    {
      "name": "nombre del ingrediente en espanol, singular, minusculas",
      "display": { "quantity": 1, "unit": "cda" },
      "canonical": { "quantity": 15, "unit": "ml" }
    }
  ],
  "steps": ["paso 1", "paso 2"],
  "suggestedMeals": ["breakfast | lunch | dinner | snack"],
  "suggestedSeasons": ["spring | summer | autumn | winter"],
  "tags": ["etiqueta1", "etiqueta2"]
}

Reglas generales:
- Nombres de ingredientes genericos (ej: "pollo" no "pechuga de pollo deshuesada")
- Si no puedes determinar tipo de comida, usa ["lunch", "dinner"]
- Si no puedes determinar temporada, usa las 4 estaciones
- Devuelve SOLO el JSON, sin texto adicional ni markdown
- Si la imagen no contiene una receta legible, responde: {"error": "No se pudo identificar una receta en la imagen"}

Campo "servings" OBLIGATORIO:
- Si la receta dice expresamente "para 4 personas", "rinde 6 raciones", "4 comensales" →
  { "servings": 4, "servingsConfidence": "explicit" }
- Si la receta NO lo dice expresamente, ESTIMA basandote en:
  - La cantidad de la proteina principal (200-250 g por comensal)
  - Cantidad de carbohidrato (60-80 g de arroz / 80-100 g de pasta crudos por persona)
  - Volumen total para sopas/cremas (~350 ml por persona)
  - Si nada de lo anterior aplica, asume 4 personas por defecto
  Devuelve { "servings": <numero>, "servingsConfidence": "estimated" }
- servings debe ser un entero positivo entre 1 y 12.

Campo "ingredients" — cada elemento debe tener:
- "name": nombre generico, singular, minusculas
- "canonical": SIEMPRE presente, con quantity (numero) + unit en ('g'|'ml'|'u'). Esto
  es lo que se usa para nutricion y escalado.
- "display": OPCIONAL, solo si el texto original usa una unidad abstracta como
  "cucharada", "pizca", "punado", "chorrito", "diente", "rodaja", "ramita", etc.
  Si esta presente: { quantity (numero), unit (string) }. Si la unidad original
  ya era canonica (g/ml/u/kg/l), omite "display".

Reglas de conversion:
- 1 cda = 15 ml; 1 cdita = 5 ml; 1 pizca = 0.5 g; 1 punado = 30 g; 1 chorrito = 10 ml
- Para discretos (huevo, aguacate, diente, hoja, rodaja, ramita): "canonical.unit": "u"
  y "canonical.quantity" = numero de unidades. NO conviertas a gramos en el extractor —
  la base de datos sabe el peso por unidad de cada ingrediente.
- Para liquidos en abstracto (cucharada de aceite, vaso de leche): canonical va en
  "ml". El servidor convierte a gramos despues usando la densidad del ingrediente.
- Kilogramos y litros: traducir a g/ml respectivamente (1.5 kg → 1500 g).

Reglas de COHERENCIA:
- NO repitas el mismo ingrediente en varias filas. Si la receta menciona "pimenton dulce" dos veces (una en el adobo, otra para espolvorear), consolida en UNA fila con la cantidad total.
- Cada ingrediente debe aparecer EXACTAMENTE una vez en el array.
- Si un ingrediente aparece sin cantidad ("sal al gusto"), devuelve
  canonical: { quantity: 0, unit: "g" } y omite display.`

const TEXT_EXTRACTION_PROMPT = `Eres un asistente especializado en extraer recetas a partir de texto (articulos web o transcripciones de videos de cocina).
Analiza el contenido y decide primero si describe realmente una receta cocinable.

Devuelve un JSON con esta forma exacta:

Si NO es una receta cocinable (vlog, articulo de opinion, noticia generica, etc.):
{
  "isRecipe": false,
  "reason": "frase breve en espanol explicando por que no es una receta"
}

Si SI es una receta:
{
  "isRecipe": true,
  "name": "nombre de la receta",
  "servings": 4,
  "servingsConfidence": "explicit",
  "prepTime": minutos de preparacion o null,
  "cookTime": minutos de coccion o null,
  "difficulty": "easy" | "medium" | "hard" | null,
  "ingredients": [
    {
      "name": "nombre del ingrediente en espanol, singular, minusculas",
      "display": { "quantity": 1, "unit": "cda" },
      "canonical": { "quantity": 15, "unit": "ml" }
    }
  ],
  "steps": ["paso 1", "paso 2"],
  "suggestedMeals": ["breakfast | lunch | dinner | snack"],
  "suggestedSeasons": ["spring | summer | autumn | winter"],
  "tags": ["etiqueta1", "etiqueta2"]
}

Reglas generales:
- Nombres de ingredientes genericos (ej: "pollo" no "pechuga de pollo deshuesada")
- Si no puedes determinar tipo de comida, usa ["lunch", "dinner"]
- Si no puedes determinar temporada, usa las 4 estaciones
- Devuelve SOLO el JSON, sin texto adicional ni markdown

Campo "servings" OBLIGATORIO:
- Si la receta dice expresamente "para 4 personas", "rinde 6 raciones", "4 comensales" →
  { "servings": 4, "servingsConfidence": "explicit" }
- Si la receta NO lo dice expresamente, ESTIMA basandote en:
  - La cantidad de la proteina principal (200-250 g por comensal)
  - Cantidad de carbohidrato (60-80 g de arroz / 80-100 g de pasta crudos por persona)
  - Volumen total para sopas/cremas (~350 ml por persona)
  - Si nada de lo anterior aplica, asume 4 personas por defecto
  Devuelve { "servings": <numero>, "servingsConfidence": "estimated" }
- servings debe ser un entero positivo entre 1 y 12.

Campo "ingredients" — cada elemento debe tener:
- "name": nombre generico, singular, minusculas
- "canonical": SIEMPRE presente, con quantity (numero) + unit en ('g'|'ml'|'u'). Esto
  es lo que se usa para nutricion y escalado.
- "display": OPCIONAL, solo si el texto original usa una unidad abstracta como
  "cucharada", "pizca", "punado", "chorrito", "diente", "rodaja", "ramita", etc.
  Si esta presente: { quantity (numero), unit (string) }. Si la unidad original
  ya era canonica (g/ml/u/kg/l), omite "display".

Reglas de conversion:
- 1 cda = 15 ml; 1 cdita = 5 ml; 1 pizca = 0.5 g; 1 punado = 30 g; 1 chorrito = 10 ml
- Para discretos (huevo, aguacate, diente, hoja, rodaja, ramita): "canonical.unit": "u"
  y "canonical.quantity" = numero de unidades. NO conviertas a gramos en el extractor —
  la base de datos sabe el peso por unidad de cada ingrediente.
- Para liquidos en abstracto (cucharada de aceite, vaso de leche): canonical va en
  "ml". El servidor convierte a gramos despues usando la densidad del ingrediente.
- Kilogramos y litros: traducir a g/ml respectivamente (1.5 kg → 1500 g).

Reglas de COHERENCIA:
- NO repitas el mismo ingrediente en varias filas. Si el texto lo menciona dos veces, consolida en UNA fila con la cantidad total.
- Cada ingrediente debe aparecer EXACTAMENTE una vez en el array.
- Si un ingrediente aparece sin cantidad (ej. "sal al gusto"), usa canonical: { quantity: 0, unit: "g" } y omite display.`

export class AnthropicProvider implements VisionProvider, TextExtractionProvider {
  private client: Anthropic

  constructor() {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured')
    }
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  }

  async extractRecipe(imageBase64: string, mimeType: string): Promise<RawExtractedRecipe> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
              data: imageBase64,
            },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      }],
    })

    const textBlock = response.content.find(block => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from AI model')
    }

    // Claude sometimes wraps the JSON in a ```json … ``` fence even when the
    // prompt explicitly says "sin markdown". Same defensive strip as the
    // text extractor: try direct parse, then fall back to the first {...}
    // block in the raw text.
    let parsed: any
    try {
      parsed = JSON.parse(textBlock.text)
    } catch {
      const fenced = textBlock.text.match(/\{[\s\S]*\}/)
      if (!fenced) throw new Error('AI response was not valid JSON')
      parsed = JSON.parse(fenced[0])
    }

    if (parsed.error) {
      throw new Error(parsed.error)
    }

    // Harden servings
    let servings: number = parsed.servings ?? null
    let servingsConfidence: 'explicit' | 'estimated' =
      parsed.servingsConfidence === 'explicit' ? 'explicit' : 'estimated'
    if (servings == null || !Number.isInteger(servings) || servings < 1) {
      servings = 4
      servingsConfidence = 'estimated'
    }
    if (servings > 12) {
      servings = 12
      servingsConfidence = 'estimated'
    }

    return {
      name: parsed.name || '',
      servings,
      servingsConfidence,
      prepTime: parsed.prepTime ?? null,
      ingredients: (parsed.ingredients || []).map((ing: any) => {
        // New shape: { name, canonical: {quantity, unit}, display?: {quantity, unit} }
        if (ing.canonical) {
          return {
            name: ing.name,
            quantity: ing.canonical.quantity || 0,
            unit: ing.canonical.unit || 'g',
            displayQuantity: ing.display?.quantity ?? null,
            displayUnit: ing.display?.unit ?? null,
          }
        }
        // Legacy shape: { name, quantity, unit }
        return {
          name: ing.name,
          quantity: ing.quantity || 0,
          unit: ing.unit || 'g',
          displayQuantity: null,
          displayUnit: null,
        }
      }),
      steps: parsed.steps || [],
      suggestedMeals: parsed.suggestedMeals || ['lunch', 'dinner'],
      suggestedSeasons: parsed.suggestedSeasons || ['spring', 'summer', 'autumn', 'winter'],
      tags: parsed.tags || [],
    }
  }

  async extractRecipeFromText(
    text: string,
    hint: TextExtractionHint,
  ): Promise<TextExtractionResult> {
    const sourceLabel =
      hint === 'youtube'
        ? 'transcripcion de YouTube (titulo + descripcion + subtitulos)'
        : 'articulo web'

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${TEXT_EXTRACTION_PROMPT}\n\nFuente: ${sourceLabel}\n\nContenido:\n${text}`,
            },
          ],
        },
      ],
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from AI model')
    }

    let parsed: any
    try {
      parsed = JSON.parse(textBlock.text)
    } catch {
      // Try to extract JSON if the model wrapped it in prose / fences.
      const fenced = textBlock.text.match(/\{[\s\S]*\}/)
      if (!fenced) throw new Error('AI response was not valid JSON')
      parsed = JSON.parse(fenced[0])
    }

    if (parsed.isRecipe === false) {
      return {
        isRecipe: false,
        reason: typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
          ? parsed.reason
          : 'El contenido no describe una receta cocinable.',
      }
    }

    // Harden servings
    let servings: number = parsed.servings ?? null
    let servingsConfidence: 'explicit' | 'estimated' =
      parsed.servingsConfidence === 'explicit' ? 'explicit' : 'estimated'
    if (servings == null || !Number.isInteger(servings) || servings < 1) {
      servings = 4
      servingsConfidence = 'estimated'
    }
    if (servings > 12) {
      servings = 12
      servingsConfidence = 'estimated'
    }

    const raw: RawExtractedRecipe = {
      name: parsed.name || '',
      prepTime: parsed.prepTime ?? null,
      cookTime: parsed.cookTime ?? null,
      // Servings already hardened above; stored in raw for the extractor entry
      // points to apply the same clamping logic uniformly.
      servings,
      servingsConfidence,
      difficulty: parsed.difficulty ?? null,
      ingredients: (parsed.ingredients || []).map((ing: any) => {
        // New shape: { name, canonical: {quantity, unit}, display?: {quantity, unit} }
        if (ing.canonical) {
          return {
            name: ing.name,
            quantity: ing.canonical.quantity || 0,
            unit: ing.canonical.unit || 'g',
            displayQuantity: ing.display?.quantity ?? null,
            displayUnit: ing.display?.unit ?? null,
          }
        }
        // Legacy shape: { name, quantity, unit }
        return {
          name: ing.name,
          quantity: ing.quantity || 0,
          unit: ing.unit || 'g',
          displayQuantity: null,
          displayUnit: null,
        }
      }),
      steps: parsed.steps || [],
      suggestedMeals: parsed.suggestedMeals || ['lunch', 'dinner'],
      suggestedSeasons:
        parsed.suggestedSeasons || ['spring', 'summer', 'autumn', 'winter'],
      tags: parsed.tags || [],
    }
    return { isRecipe: true, raw }
  }
}
