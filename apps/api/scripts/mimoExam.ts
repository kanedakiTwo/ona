/**
 * PRO-1304 · El examen fijo de Mimo: pasa los 75 casos del histórico
 * (`MIMO_EXAM_CASES`, src/services/assistant/mimoExamCases.ts) por el motor de
 * ahora (prompt, herramientas y modelo del canal; las herramientas simuladas,
 * nada se lee ni se escribe), pone a cada respuesta su nota de 0 a 2 en los
 * seis criterios (corrector de src/services/assistant/mimoExam.ts: código y
 * un juez) y su precio, y deja el informe en un JSON.
 *
 *   pnpm --filter @ona/api exec tsx scripts/mimoExam.ts --remoto --dir=<carpeta de los informes>/data/mimo/examen
 *     [--out=fichero.json] [--case=h-001,h-002] [--concurrencia=2]
 *   pnpm --filter @ona/api exec tsx scripts/mimoExam.ts --comparar=a.json,b.json
 *
 * `--remoto` (D-168: por la suscripción, nunca por la API): cada ronda de Mimo
 * y cada juez van a «Mimo remoto» (PRO-1102) en la base de `DATABASE_URL`
 * (la de staging) y los contesta la oficina; sin él hace falta
 * `ANTHROPIC_API_KEY` y se paga. `--dir` escribe `<dir>/AAAA-MM-DD.json`
 * (fecha de Madrid). `--comparar` dice cuánto difieren dos pasadas (estable:
 * menos de 0,2 puntos de media) y sale con 1 si no lo son.
 */
import Anthropic from '@anthropic-ai/sdk'
import { execSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from '../src/config/env.js'
import { CLAUDE_MODEL } from '../src/config/models.js'
import { knowledgeBaseReady } from '../src/services/assistant/systemPrompt.js'
import { MIMO_EXAM_CASES } from '../src/services/assistant/mimoExamCases.js'
import { EXAM_CRITERIA, compareExams } from '../src/services/assistant/mimoExam.js'
import { runExam, type MessagesLike } from '../src/services/assistant/mimoExamRun.js'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const comparar = arg('comparar')
if (comparar) {
  const [a, b] = await Promise.all(comparar.split(',').map(async (p) => JSON.parse(await readFile(p.trim(), 'utf8'))))
  const d = compareExams(a, b)
  console.log(`Nota media: ${a.resumen.nota} → ${b.resumen.nota} (${d.diferencia >= 0 ? '+' : ''}${d.diferencia}): ${d.estable ? 'estable' : 'NO estable'} (menos de 0,2).`)
  for (const k of EXAM_CRITERIA) console.log(`  ${k.padEnd(20)} ${d.porCriterio[k] ?? '—'}`)
  for (const c of d.casosQueCambian) console.log(`  ${c.id}: ${c.antes} → ${c.ahora}`)
  process.exit(d.estable ? 0 : 1)
}

const remote = process.argv.includes('--remoto')
if (!remote && !process.env.ANTHROPIC_API_KEY) throw new Error('Hace falta --remoto (D-168) o ANTHROPIC_API_KEY')
const only = arg('case')?.split(',').map((s) => s.trim())

await knowledgeBaseReady
const client: MessagesLike = remote
  ? await (async () => {
      const { db } = await import('../src/db/connection.js')
      const { dbTurnStore, remoteMessagesClient } = await import('../src/services/assistant/mimoRemoto.js')
      return remoteMessagesClient(dbTurnStore(db))
    })()
  : new Anthropic()

const { resumen, casos } = await runExam(
  MIMO_EXAM_CASES.filter((c) => !only || only.includes(c.id)),
  {
    client,
    remote,
    eurPerUsd: env.ADVISOR_EUR_PER_USD,
    concurrency: Number(arg('concurrencia') ?? 2) || 2,
    onCase: (r) => {
      const notas = EXAM_CRITERIA.map((k) => `${k.split('_')[0]} ${r.notas[k] ?? '—'}`).join(' · ')
      console.log(`${r.id} ${r.error ? `ERROR: ${r.error}` : `${r.nota} (${notas}) ${r.precioEur} €${r.porCodigo ? ' [código]' : ''}`}`)
    },
  },
)

let commit: string | null = process.env.RAILWAY_GIT_COMMIT_SHA ?? null
try {
  commit ??= execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
} catch {
  // Sin git: el informe va sin commit.
}
const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const report = {
  fecha,
  generado: new Date().toISOString(),
  version: { commit, modelo: CLAUDE_MODEL },
  modo: remote ? 'remoto' : 'api',
  tokens: remote ? 'estimados (≈3,5 caracteres por token, con la caché del motor)' : 'los de Anthropic',
  resumen,
  casos,
}

console.log(`\nNota media ${resumen.nota} / 2 en ${resumen.corregidos} casos${resumen.conError ? ` (${resumen.conError} con error)` : ''}.`)
for (const k of EXAM_CRITERIA) console.log(`  ${k.padEnd(20)} ${resumen.porCriterio[k] ?? '—'}`)
for (const [tipo, t] of Object.entries(resumen.porTipo)) console.log(`  ${tipo.padEnd(20)} ${t.nota} (${t.casos} casos, ${t.precioMedioEur} €/caso)`)
console.log(`Precio: ${resumen.coste.precioEur} € (${resumen.coste.precioMedioEur} € por caso tras una pausa${resumen.coste.precioMedioCalienteEur !== null ? `, ${resumen.coste.precioMedioCalienteEur} € con lo fijo en caché` : ''}).`)

const dir = arg('dir')
const outPath = arg('out') ?? (dir ? join(dir, `${fecha}.json`) : null)
if (outPath) {
  if (dir) await mkdir(dir, { recursive: true })
  await writeFile(outPath, `${JSON.stringify(report, null, 1)}\n`)
  console.log(`Informe: ${outPath}`)
}
process.exit(resumen.conError ? 1 : 0)
