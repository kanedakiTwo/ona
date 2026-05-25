/**
 * Populate `ingredients.prep_requirements` for the entire catalogue using
 * Claude. Writes the result to `scripts/output/prep-requirements.jsonl`
 * for human review BEFORE applying — so the LLM never edits the DB
 * directly. Two-step pipeline, mirroring `apply:recipes`:
 *
 *   1. `pnpm prep-requirements:populate`
 *        → reads every row from `ingredients`
 *        → asks Claude in batches of 50 which method (if any) each one
 *          needs from the closed PREP_METHODS enum
 *        → writes JSONL to scripts/output/prep-requirements.jsonl
 *
 *   2. Manual review: open the JSONL, delete / edit any line you
 *      disagree with. Keys: `id`, `name`, `prep_requirements`
 *      (object or null).
 *
 *   3. `pnpm prep-requirements:populate --apply`
 *        → re-reads the JSONL, UPDATEs the matching rows.
 *
 * Cost: one batched LLM call per ~50 ingredients. With ~250 in the
 * catalogue that's 5 calls, ~$0.10 total. The LLM is told to default
 * to `null` (no requirement) when in doubt — pollution-free.
 */

import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { eq } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../src/db/connection.js'
import { ingredients } from '../src/db/schema.js'
import { env } from '../src/config/env.js'
import { PREP_METHODS, type PrepMethod } from '@ona/shared'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = path.join(__dirname, 'output', 'prep-requirements.jsonl')
const BATCH_SIZE = 50
const MODEL = 'claude-sonnet-4-20250514'

interface OutputRow {
  id: string
  name: string
  prep_requirements: { method: PrepMethod; notes?: string } | null
}

const SYSTEM_PROMPT = `Eres un asistente que clasifica ingredientes de cocina española según si necesitan una preparación previa con tiempo antes de cocinar.

Para cada ingrediente, decides si su MÉTODO típico de preparación entra en uno de estos casos cerrados:

  - thaw_24h           — pescado o carne CONGELADA que requiere ~24h de descongelado en nevera. Aplica a: filetes de pescado, lubina, dorada, gambas, pechuga de pollo congelada, atún, salmón.
  - thaw_48h           — piezas grandes congeladas (pollo entero, costillar, pierna de cordero, pescado grande entero).
  - soak_overnight     — legumbres secas que necesitan remojo de noche (~8h): garbanzos, alubias blancas, alubias pintas, judías, fabes.
  - soak_30min         — lentejas, arroz especiales que se enjuagan + 30min.
  - temper_30min       — carnes que conviene atemperar antes de cocinar (filetes, chuletones).
  - marinate_2h        — pieza que mejora con marinada corta (NO usar por defecto, solo si el ingrediente lo necesita siempre).
  - marinate_overnight — solo si el ingrediente SIEMPRE se marina toda la noche (poco frecuente).
  - dough_rise_overnight — masas que requieren levado largo (masa madre, masa de pizza fría).

REGLAS:

1. La MAYORÍA de ingredientes (verduras frescas, especias, lácteos, huevos, pan, harina, aceite, sal, azúcar, frutas) NO necesitan nada. Devuelve null para ellos.

2. SOLO marca un método cuando es habitual en la práctica española:
   - Pescado, marisco: thaw_24h (asumimos que se vende congelado salvo evidencia contraria)
   - Carnes que sabemos que se congelan habitualmente: pollo, ternera, cerdo → thaw_24h
   - Garbanzos / alubias / fabes secas → soak_overnight
   - Lentejas → soak_30min (NO overnight)
   - Pasta, arroz blanco, quinoa, cuscús → null (no necesitan)

3. Si el ingrediente es un PRODUCTO PROCESADO (atún en lata, garbanzos cocidos en bote, alubias en conserva, lentejas cocidas, jamón, embutido) → null.

4. \`notes\` es opcional, máximo 200 caracteres en castellano, con un consejo práctico. Ej: "Sácalo a la nevera la víspera." o "Cubre con agua y deja toda la noche."

Output: JSON puro (sin markdown), con la forma:

{"results": [{"id": "uuid", "name": "...", "prep_requirements": {"method": "thaw_24h", "notes": "..."} | null}, ...]}`

async function classifyBatch(
  client: Anthropic,
  batch: { id: string; name: string }[],
): Promise<OutputRow[]> {
  const userMsg = JSON.stringify({ ingredients: batch })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  })

  const block = response.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('No text response')

  let parsed: any
  try {
    parsed = JSON.parse(block.text)
  } catch {
    const m = block.text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('Response was not JSON')
    parsed = JSON.parse(m[0])
  }
  if (!Array.isArray(parsed.results)) throw new Error('No results array')

  const validMethods = new Set<PrepMethod>(PREP_METHODS)
  const out: OutputRow[] = []
  for (const r of parsed.results) {
    if (typeof r?.id !== 'string' || typeof r?.name !== 'string') continue
    const pr = r.prep_requirements
    if (pr === null || pr === undefined) {
      out.push({ id: r.id, name: r.name, prep_requirements: null })
      continue
    }
    if (typeof pr?.method !== 'string' || !validMethods.has(pr.method as PrepMethod)) {
      // LLM hallucinated an unknown method — drop, default to null.
      out.push({ id: r.id, name: r.name, prep_requirements: null })
      continue
    }
    out.push({
      id: r.id,
      name: r.name,
      prep_requirements: {
        method: pr.method as PrepMethod,
        ...(typeof pr.notes === 'string' && pr.notes.length > 0
          ? { notes: pr.notes.slice(0, 200) }
          : {}),
      },
    })
  }
  return out
}

async function populate(): Promise<void> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  console.log('[prep-requirements] loading catalogue…')
  const rows = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .orderBy(ingredients.name)
  console.log(`[prep-requirements] ${rows.length} ingredients`)

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await fs.writeFile(OUTPUT_PATH, '')

  let total = 0
  let withRequirement = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    console.log(`[prep-requirements] batch ${i / BATCH_SIZE + 1} (${batch.length} items)…`)
    const result = await classifyBatch(client, batch)
    for (const r of result) {
      total += 1
      if (r.prep_requirements) withRequirement += 1
      await fs.appendFile(OUTPUT_PATH, JSON.stringify(r) + '\n')
    }
  }

  console.log(`[prep-requirements] wrote ${total} rows → ${OUTPUT_PATH}`)
  console.log(`[prep-requirements] ${withRequirement} marked with a requirement, ${total - withRequirement} null`)
  console.log('[prep-requirements] review the JSONL then re-run with --apply')
}

async function apply(): Promise<void> {
  console.log(`[prep-requirements] reading ${OUTPUT_PATH}…`)
  const raw = await fs.readFile(OUTPUT_PATH, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)

  let updated = 0
  let cleared = 0
  for (const line of lines) {
    const row: OutputRow = JSON.parse(line)
    await db
      .update(ingredients)
      .set({ prepRequirements: row.prep_requirements })
      .where(eq(ingredients.id, row.id))
    if (row.prep_requirements) updated += 1
    else cleared += 1
  }

  console.log(`[prep-requirements] ${updated} requirements applied, ${cleared} cleared`)
}

const mode = process.argv.includes('--apply') ? 'apply' : 'populate'
if (mode === 'apply') {
  apply().then(() => process.exit(0)).catch((err) => {
    console.error(err)
    process.exit(1)
  })
} else {
  populate().then(() => process.exit(0)).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
