import Anthropic from '@anthropic-ai/sdk'
import { env } from '../../config/env.js'
import type { VisionProvider, RawExtractedRecipe } from '../recipeExtractor.js'

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

export class AnthropicProvider implements VisionProvider {
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

    const parsed = JSON.parse(textBlock.text)

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
}
