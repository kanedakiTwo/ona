/**
 * Average cost of one Mimo reply per week, channel and kind of turn
 * (PRO-393). Reads `cost_events` of the database in DATABASE_URL.
 *
 * Run: pnpm --filter @ona/api exec tsx scripts/mimoTurnCost.ts [--weeks 4] [--json]
 */
import { pool } from '../src/db/connection.js'
import { TURN_KIND_LABELS, loadMimoTurns, summarizeTurnCosts, type TurnKind } from '../src/services/mimoTurnCost.js'

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const weeks = Math.max(1, Number(arg('--weeks') ?? 4) || 4)

const label = (group: string) => {
  if (group === 'total') return 'todas'
  const [axis, value] = group.split(':')
  if (axis === 'kind') return TURN_KIND_LABELS[value as TurnKind] ?? value
  return value === 'escribe_bloque_fijo' ? 'escribe el bloque fijo en caché' : 'lee el bloque fijo de caché'
}

const since = new Date(Date.now() - weeks * 7 * 86_400_000)
const groups = summarizeTurnCosts(await loadMimoTurns(since))
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(groups, null, 2))
} else {
  console.log('semana      canal           tipo de turno                               turnos  €/resp.  entrada  leído    escrito  (1 h)    salida  rondas')
  for (const g of groups) {
    console.log(
      [
        g.week,
        g.feature.padEnd(15),
        label(g.group).padEnd(43),
        String(g.turns).padStart(6),
        g.avgCostEur.toFixed(4).padStart(8),
        String(g.avgInputTokens).padStart(8),
        String(g.avgCacheReadTokens).padStart(8),
        String(g.avgCacheWriteTokens).padStart(8),
        String(g.avgCacheWrite1hTokens).padStart(8),
        String(g.avgOutputTokens).padStart(7),
        g.avgRounds === null ? '     —' : g.avgRounds.toFixed(2).padStart(6),
      ].join(' '),
    )
  }
}
await pool.end()
