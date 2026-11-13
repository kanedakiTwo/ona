/**
 * PRO-392: how much goes into each of Mimo's turns, to compare before and
 * after loading only the tools a turn needs.
 *
 *   pnpm --filter @ona/api exec tsx scripts/mimoInputTokens.ts [--desde=2026-11-04] [--hasta=2026-11-11]
 *
 * Two sources, read-only, from the database in `DATABASE_URL`:
 * - `cost_events` (production): per channel (`assistant_chat`, `whatsapp_chat`,
 *   `telegram_chat`), turns and the mean input tokens per turn, split into
 *   uncached, cache write and cache read (one row per turn, all rounds summed).
 * - `mimo_turnos_remotos` (staging with «Mimo remoto», PRO-1102, where
 *   `cost_events` writes nothing): per round, the mean size of the tools, the
 *   system prompt and the messages, in characters and in estimated tokens
 *   (≈3.5 characters per token; Anthropic's count is the real one).
 */
import { sql } from 'drizzle-orm'
import { db } from '../src/db/connection.js'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const hasta = arg('hasta') ?? new Date().toISOString().slice(0, 10)
const desde = arg('desde') ?? new Date(Date.parse(hasta) - 7 * 86_400_000).toISOString().slice(0, 10)
const CHARS_PER_TOKEN = 3.5

const rows = (r: any) => (r.rows ?? r) as any[]

const costs = rows(await db.execute(sql`
  SELECT feature,
         count(*)::int AS turns,
         avg(coalesce((units->>'inputTokens')::numeric, 0))::int AS input,
         avg(coalesce((units->>'cacheWriteTokens')::numeric, 0))::int AS cache_write,
         avg(coalesce((units->>'cacheReadTokens')::numeric, 0))::int AS cache_read
  FROM cost_events
  WHERE feature IN ('assistant_chat', 'whatsapp_chat', 'telegram_chat')
    AND created_at >= ${desde}::date AND created_at < ${hasta}::date + 1
  GROUP BY feature ORDER BY feature
`))
console.log(`Mimo del ${desde} al ${hasta}\n\ncost_events (tokens de entrada por turno, media):`)
if (costs.length === 0) console.log('  (ninguno)')
for (const c of costs) {
  const total = c.input + c.cache_write + c.cache_read
  console.log(`  ${c.feature}: ${c.turns} turnos · ${total} en total = ${c.input} sin caché + ${c.cache_write} escritos en caché + ${c.cache_read} leídos de caché`)
}

const remote = rows(await db.execute(sql`
  SELECT count(*)::int AS rounds,
         avg(length(coalesce(peticion->'tools', '[]'::jsonb)::text))::int AS tools,
         avg(jsonb_array_length(coalesce(peticion->'tools', '[]'::jsonb)))::numeric(6,1) AS n_tools,
         avg(length(coalesce(peticion->'system', '""'::jsonb)::text))::int AS system,
         avg(length(coalesce(peticion->'messages', '[]'::jsonb)::text))::int AS messages
  FROM mimo_turnos_remotos
  WHERE creado >= ${desde}::date AND creado < ${hasta}::date + 1
`).catch(() => [{ rounds: 0 }]))[0]
console.log('\nmimo_turnos_remotos (por ronda, media):')
if (!remote?.rounds) {
  console.log('  (ninguna)')
} else {
  const tok = (chars: number) => Math.round(chars / CHARS_PER_TOKEN)
  const total = remote.tools + remote.system + remote.messages
  console.log(`  ${remote.rounds} rondas · ${remote.n_tools} herramientas`)
  console.log(`  herramientas ${remote.tools} caracteres (≈${tok(remote.tools)} tokens) · sistema ${remote.system} (≈${tok(remote.system)}) · mensajes ${remote.messages} (≈${tok(remote.messages)})`)
  console.log(`  total ≈${tok(total)} tokens; las herramientas son el ${Math.round((100 * remote.tools) / total)} %`)
}
process.exit(0)
