/**
 * Populate `recipes.course` for the entire catalogue via Claude. Two-step
 * pipeline, mirroring `populatePrepRequirements.ts`:
 *
 *   1. `pnpm course:populate`
 *        → reads every row from `recipes`
 *        → asks Claude in batches of 50 which course tag it belongs to
 *        → writes JSONL to scripts/output/recipe-courses.jsonl
 *
 *   2. Manual review (optional): open the JSONL, delete/edit lines you
 *      disagree with.
 *
 *   3. `pnpm course:apply`
 *        → re-reads the JSONL, UPDATEs the matching rows.
 *
 * Cost: ~5 batched LLM calls for the ~79 seed recipes, ~$0.10. The prompt
 * defaults to `null` when in doubt — pollution-free.
 */

import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { eq } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../src/db/connection.js'
import { recipes } from '../src/db/schema.js'
import { env } from '../src/config/env.js'
import { COURSES, type Course } from '@ona/shared'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = path.join(__dirname, 'output', 'recipe-courses.jsonl')
const BATCH_SIZE = 50
const MODEL = 'claude-sonnet-4-20250514'

interface OutputRow {
  id: string
  name: string
  course: Course | null
}

const SYSTEM_PROMPT = `Eres un asistente que clasifica recetas españolas según el tipo de plato.

Para cada receta, decides si su rol típico en una comida tradicional española es uno de estos casos cerrados:

  - starter   — Entrante / primer plato. Suele ser ligero, preparatorio. Ejemplos: cremas, sopas, ensaladas, gazpacho, salmorejo, croquetas, empanadillas, tortilla pequeña, hummus, tabla de quesos. NO: un cocido completo, una paella.
  - main      — Plato principal / segundo. Comida completa que puede comerse sola. Ejemplos: paella, cocido, lentejas con chorizo, lasaña, chuletón con guarnición, bacalao al pil-pil, pollo asado, hamburguesa con patatas.
  - dessert   — Postre. Dulce o fruta. Ejemplos: flan, arroz con leche, tarta de Santiago, helado, fruta asada, natillas, brownie.

REGLAS:

1. La MAYORÍA del catálogo cae en \`main\` o \`null\`. Solo marca \`starter\` cuando la receta es claramente ligera y preparatoria, y \`dessert\` solo si es dulce explícito.

2. \`null\` es válido y preferido cuando la receta es versátil — funciona como plato único Y también como acompañamiento, según contexto. Ejemplos comunes: arroz blanco, pasta simple, verduras al horno, tortilla francesa, huevos rotos.

3. Una receta que es claramente \`starter\` o \`dessert\` jamás debe marcarse \`main\`. Una crema de calabacín NO es \`main\`.

4. Si dudas, devuelve \`null\`. El menú generador trata \`null\` como "vale como plato único" — es la opción segura.

Output: JSON puro (sin markdown), con la forma:

{"results": [{"id": "uuid", "name": "...", "course": "starter" | "main" | "dessert" | null}, ...]}`

async function classifyBatch(
  client: Anthropic,
  batch: { id: string; name: string }[],
): Promise<OutputRow[]> {
  const userMsg = JSON.stringify({ recipes: batch })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
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

  const validCourses = new Set<Course>(COURSES)
  const out: OutputRow[] = []
  for (const r of parsed.results) {
    if (typeof r?.id !== 'string' || typeof r?.name !== 'string') continue
    const c = r.course
    if (c === null || c === undefined) {
      out.push({ id: r.id, name: r.name, course: null })
      continue
    }
    if (typeof c !== 'string' || !validCourses.has(c as Course)) {
      // LLM hallucinated an unknown course — drop, default to null.
      out.push({ id: r.id, name: r.name, course: null })
      continue
    }
    out.push({ id: r.id, name: r.name, course: c as Course })
  }
  return out
}

async function populate(): Promise<void> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  console.log('[course] loading catalogue…')
  const rows = await db
    .select({ id: recipes.id, name: recipes.name })
    .from(recipes)
    .orderBy(recipes.name)
  console.log(`[course] ${rows.length} recipes`)

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await fs.writeFile(OUTPUT_PATH, '')

  let total = 0
  let withCourse = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    console.log(`[course] batch ${i / BATCH_SIZE + 1} (${batch.length} items)…`)
    const result = await classifyBatch(client, batch)
    for (const r of result) {
      total += 1
      if (r.course) withCourse += 1
      await fs.appendFile(OUTPUT_PATH, JSON.stringify(r) + '\n')
    }
  }

  console.log(`[course] wrote ${total} rows → ${OUTPUT_PATH}`)
  console.log(`[course] ${withCourse} classified, ${total - withCourse} null`)
  console.log('[course] review the JSONL then re-run with --apply')
}

async function apply(): Promise<void> {
  console.log(`[course] reading ${OUTPUT_PATH}…`)
  const raw = await fs.readFile(OUTPUT_PATH, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)

  let updated = 0
  let cleared = 0
  for (const line of lines) {
    const row: OutputRow = JSON.parse(line)
    await db
      .update(recipes)
      .set({ course: row.course })
      .where(eq(recipes.id, row.id))
    if (row.course) updated += 1
    else cleared += 1
  }

  console.log(`[course] ${updated} courses applied, ${cleared} cleared/null`)
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
