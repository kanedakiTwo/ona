// apps/api/src/services/llmUnitFallback.ts
import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'

export interface LlmUnitInput {
  displayQuantity: number
  displayUnit: string
  ingredientName?: string
}

export interface LlmUnitResult {
  gramsPerUnit: number | null
  mlPerUnit: number | null
  rationale: string
}

export interface LlmUnitClient {
  call(input: LlmUnitInput): Promise<LlmUnitResult>
}

const PROMPT = `You are a culinary unit conversion expert. Given an abstract
Spanish measurement unit (e.g. "rodajita generosa", "puñado pequeño") and
optionally an ingredient name, return JSON with the conversion factor:

{
  "gramsPerUnit": number | null,
  "mlPerUnit": number | null,
  "rationale": "1-sentence Spanish explanation"
}

Rules:
- Volumetric (typically liquid) → mlPerUnit.
- Solid/discrete → gramsPerUnit.
- Both unclear → prefer gramsPerUnit with ingredient context.
- Numbers must be > 0.
- Return ONLY the JSON, no markdown fences, no prose before/after.

Examples:
Input: { "unit": "rodajita", "ingredient": "limón" }
Output: { "gramsPerUnit": 8, "mlPerUnit": null, "rationale": "Una rodajita fina de limón pesa aprox. 8 g." }

Input: { "unit": "buen chorro", "ingredient": null }
Output: { "gramsPerUnit": null, "mlPerUnit": 40, "rationale": "Un buen chorro de líquido suele rondar 40 ml." }`

class AnthropicLlmUnitClient implements LlmUnitClient {
  private client: Anthropic

  constructor() {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured')
    }
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  }

  async call(input: LlmUnitInput): Promise<LlmUnitResult> {
    const userMessage = JSON.stringify({
      unit: input.displayUnit,
      quantity: input.displayQuantity,
      ingredient: input.ingredientName ?? null,
    })
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [
        { role: 'user', content: `${PROMPT}\n\nInput: ${userMessage}\nOutput:` },
      ],
    })
    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from LLM unit fallback')
    }
    let parsed: { gramsPerUnit: number | null; mlPerUnit: number | null; rationale?: string }
    try {
      parsed = JSON.parse(textBlock.text)
    } catch {
      const fenced = textBlock.text.match(/\{[\s\S]*\}/)
      if (!fenced) throw new Error('LLM unit fallback returned non-JSON: ' + textBlock.text.slice(0, 200))
      parsed = JSON.parse(fenced[0])
    }
    return {
      gramsPerUnit: parsed.gramsPerUnit ?? null,
      mlPerUnit: parsed.mlPerUnit ?? null,
      rationale: parsed.rationale ?? '',
    }
  }
}

let _defaultClient: LlmUnitClient | null = null
export function getDefaultLlmUnitClient(): LlmUnitClient {
  if (!_defaultClient) _defaultClient = new AnthropicLlmUnitClient()
  return _defaultClient
}
