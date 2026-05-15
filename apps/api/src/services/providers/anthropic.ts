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
    { "name": "nombre del ingrediente en espanol, singular, minusculas", "quantity": numero, "unit": "g | kg | ml | l | u | cda | cdita | pizca | al_gusto" }
  ],
  "steps": ["paso 1", "paso 2"],
  "suggestedMeals": ["breakfast | lunch | dinner | snack"],
  "suggestedSeasons": ["spring | summer | autumn | winter"],
  "tags": ["etiqueta1", "etiqueta2"]
}

Reglas generales:
- Nombres de ingredientes genericos (ej: "pollo" no "pechuga de pollo deshuesada")
- Si la cantidad no esta clara, estima para 2 personas
- Si no puedes determinar tipo de comida, usa ["lunch", "dinner"]
- Si no puedes determinar temporada, usa las 4 estaciones
- Devuelve SOLO el JSON, sin texto adicional ni markdown
- Si la imagen no contiene una receta legible, responde: {"error": "No se pudo identificar una receta en la imagen"}

Reglas de UNIDADES (criticas, no las inventes):
- Solidos por peso → g o kg: carnes (pollo, ternera, cordero), pescados, verduras (cebolla, zanahoria, calabacin), frutas no liquidas (manzana en gramos si esta cortada), granos, legumbres, harinas, quesos, frutos secos. NUNCA uses ml para solidos.
- Liquidos por volumen → ml o l: aceite, agua, caldo, leche, nata, vino, vinagre, salsa de soja, miel cuando esta como liquido, zumo. NUNCA uses g para liquidos.
- Discretos por unidad → u (no "ud"): huevo, aguacate entero, platano, naranja, limon, diente de ajo, hoja de laurel, rebanada de pan, bote de conserva. Un huevo es "4 u", no "4 g" ni "200 g".
- Cucharadas y cucharaditas → cda, cdita: especias, condimentos, levadura, polvos de hornear cuando se miden asi.
- Pizca (sal, pimienta, especias en cantidad minima) o al_gusto (cuando la receta no especifica) son validas.

Reglas de COHERENCIA:
- NO repitas el mismo ingrediente en varias filas. Si la receta menciona "pimenton dulce" dos veces (una en el adobo, otra para espolvorear), consolida en UNA fila con la cantidad total.
- Cada ingrediente debe aparecer EXACTAMENTE una vez en el array.
- Si un ingrediente aparece sin cantidad (ej. "sal al gusto"), usa quantity: 1 con unit: "al_gusto".`

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
    { "name": "nombre del ingrediente en espanol, singular, minusculas", "quantity": numero, "unit": "g | kg | ml | l | u | cda | cdita | pizca | al_gusto" }
  ],
  "steps": ["paso 1", "paso 2"],
  "suggestedMeals": ["breakfast | lunch | dinner | snack"],
  "suggestedSeasons": ["spring | summer | autumn | winter"],
  "tags": ["etiqueta1", "etiqueta2"]
}

Reglas generales:
- Nombres de ingredientes genericos (ej: "pollo" no "pechuga de pollo deshuesada")
- Si la cantidad no esta clara, estima para 2 personas
- Si no puedes determinar tipo de comida, usa ["lunch", "dinner"]
- Si no puedes determinar temporada, usa las 4 estaciones
- Devuelve SOLO el JSON, sin texto adicional ni markdown

Reglas de UNIDADES (criticas, no las inventes):
- Solidos por peso → g o kg: carnes (pollo, ternera, cordero), pescados, verduras (cebolla, zanahoria, calabacin), frutas no liquidas, granos, legumbres, harinas, quesos, frutos secos. NUNCA uses ml para solidos.
- Liquidos por volumen → ml o l: aceite, agua, caldo, leche, nata, vino, vinagre, salsa de soja, miel cuando esta como liquido, zumo. NUNCA uses g para liquidos.
- Discretos por unidad → u (no "ud"): huevo, aguacate entero, platano, naranja, limon, diente de ajo, hoja de laurel, rebanada de pan, bote de conserva. Un huevo es "4 u", no "4 g" ni "200 g".
- Cucharadas y cucharaditas → cda, cdita: especias, condimentos cuando se miden asi.
- Pizca (sal, pimienta, especias en cantidad minima) o al_gusto (cuando la receta no especifica) son validas.

Reglas de COHERENCIA:
- NO repitas el mismo ingrediente en varias filas. Si el texto lo menciona dos veces, consolida en UNA fila con la cantidad total.
- Cada ingrediente debe aparecer EXACTAMENTE una vez en el array.
- Si un ingrediente aparece sin cantidad (ej. "sal al gusto"), usa quantity: 1 con unit: "al_gusto".`

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
