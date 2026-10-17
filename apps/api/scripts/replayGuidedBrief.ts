/**
 * Live replay of the guided morning brief (PRO-156): five consecutive days of
 * the same synthetic household, each written by the REAL writer (Claude Haiku
 * 4.5, `services/whatsapp/guided.ts`) with the previous days as context, and
 * checked with the same validation that runs before every send. Prints the
 * five messages and fails (exit 1) if any day fell back to the fixed text or
 * any sentence repeats across days.
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @ona/api exec tsx scripts/replayGuidedBrief.ts [--days=5]
 *
 * Needs no database and sends nothing. Costs well under a cent (one Haiku
 * call per day, ~1,500 input + 200 output tokens).
 */
import type { DayMenu } from '@ona/shared'
import { setCostSinkForTests } from '../src/services/costLedger.js'
import { defaultGuidedWriter } from '../src/services/whatsapp/guided.js'
import { repeatedSentences, replayDailyBriefs } from '../src/services/whatsapp/guidedReplay.js'

if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required')
const n = Math.max(1, Number(process.argv.find((a) => a.startsWith('--days='))?.slice(7) ?? 5))
setCostSinkForTests(async () => {}) // no DB: the cost row is not stored

const r = (id: string, name: string) => ({ kind: 'recipe' as const, recipeId: id, recipeName: name })
const WEEK: DayMenu[] = [
  { lunch: { dishes: [r('l1', 'Lentejas estofadas')] }, dinner: { dishes: [r('d1', 'Tortilla de patatas')] } },
  { lunch: { dishes: [r('l2', 'Arroz con pollo')] }, dinner: { dishes: [r('d2', 'Crema de calabaza'), r('d2b', 'Huevos rellenos')] } },
  { lunch: { dishes: [r('l3', 'Merluza en salsa verde')] }, dinner: { dishes: [r('d3', 'Ensalada de garbanzos')] } },
  { lunch: { dishes: [r('l4', 'Macarrones con tomate')] }, dinner: { dishes: [{ kind: 'note' as const, text: 'Cena fuera' }] } },
  { lunch: { dishes: [r('l5', 'Pollo al horno con patatas')] }, dinner: { dishes: [r('d5', 'Pizza casera')] } },
] as unknown as DayMenu[]

const days = Array.from({ length: n }, (_, i) => WEEK[i % WEEK.length])
const out = await replayDailyBriefs(days, {
  webUrl: 'https://mimoia.com',
  writer: defaultGuidedWriter(),
  memory: ['household.adults: 2', 'household.kids_2_to_10: 1', 'dislikes: ["coliflor"]', 'notes: "Los viernes, pizza en familia"'],
  replies: ['Perfecto, gracias', null, 'Hoy cenamos fuera, cámbiame la cena', null],
})
out.forEach((m, i) => console.log(`\n── Día ${i + 1} (${m.source}${m.reason ? `: ${m.reason}` : ''}) ──\n${m.text}`))
const fallbacks = out.filter((m) => m.source !== 'guide').length
const repeated = repeatedSentences(out.map((m) => m.text))
console.log(`\n${out.length} días · ${fallbacks} con el texto fijo · frases repetidas: ${repeated.length ? repeated.join(' | ') : 'ninguna'}`)
process.exit(fallbacks || repeated.length ? 1 : 0)
