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
  "prepTime": numero en minutos o null si no se menciona,
  "ingredients": [
    { "name": "nombre del ingrediente en espanol, singular, minusculas", "quantity": numero, "unit": "g | kg | ml | l | ud | cda | cdta" }
  ],
  "steps": ["paso 1", "paso 2"],
  "suggestedMeals": ["breakfast | lunch | dinner | snack"],
  "suggestedSeasons": ["spring | summer | autumn | winter"],
  "tags": ["etiqueta1", "etiqueta2"]
}

Reglas:
- Nombres de ingredientes genericos (ej: "pollo" no "pechuga de pollo deshuesada")
- Si la cantidad no esta clara, estima para 2 personas
- Unidades: g, kg, ml, l, ud, cda, cdta
- Si no puedes determinar tipo de comida, usa ["lunch", "dinner"]
- Si no puedes determinar temporada, usa las 4 estaciones
- Devuelve SOLO el JSON, sin texto adicional ni markdown
- Si la imagen no contiene una receta legible, responde: {"error": "No se pudo identificar una receta en la imagen"}`

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
  "servings": numero de comensales o null,
  "prepTime": minutos de preparacion o null,
  "cookTime": minutos de coccion o null,
  "difficulty": "easy" | "medium" | "hard" | null,
  "ingredients": [
    { "name": "nombre del ingrediente en espanol, singular, minusculas", "quantity": numero, "unit": "g | kg | ml | l | u | cda | cdita" }
  ],
  "steps": ["paso 1", "paso 2"],
  "suggestedMeals": ["breakfast | lunch | dinner | snack"],
  "suggestedSeasons": ["spring | summer | autumn | winter"],
  "tags": ["etiqueta1", "etiqueta2"]
}

Reglas:
- Nombres de ingredientes genericos (ej: "pollo" no "pechuga de pollo deshuesada")
- Si la cantidad no esta clara, estima para 2 personas
- Unidades: g, kg, ml, l, u, cda, cdita
- Si no puedes determinar tipo de comida, usa ["lunch", "dinner"]
- Si no puedes determinar temporada, usa las 4 estaciones
- Devuelve SOLO el JSON, sin texto adicional ni markdown`

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

    return {
      name: parsed.name || '',
      prepTime: parsed.prepTime ?? null,
      ingredients: (parsed.ingredients || []).map((ing: { name: string; quantity: number; unit: string }) => ({
        name: ing.name,
        quantity: ing.quantity || 0,
        unit: ing.unit || 'g',
      })),
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

    const raw: RawExtractedRecipe = {
      name: parsed.name || '',
      prepTime: parsed.prepTime ?? null,
      cookTime: parsed.cookTime ?? null,
      servings: parsed.servings ?? null,
      difficulty: parsed.difficulty ?? null,
      ingredients: (parsed.ingredients || []).map(
        (ing: { name: string; quantity: number; unit: string }) => ({
          name: ing.name,
          quantity: ing.quantity || 0,
          unit: ing.unit || 'g',
        }),
      ),
      steps: parsed.steps || [],
      suggestedMeals: parsed.suggestedMeals || ['lunch', 'dinner'],
      suggestedSeasons:
        parsed.suggestedSeasons || ['spring', 'summer', 'autumn', 'winter'],
      tags: parsed.tags || [],
    }
    return { isRecipe: true, raw }
  }
}
