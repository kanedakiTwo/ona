/**
 * Runs real WhatsApp turns through Mimo's engine with several models and,
 * with --judge, has Opus score the answers blind (PRO-147, 2026-10-16: can a
 * cheaper model replace Sonnet 5.5 for all turns or for the simple ones?).
 *
 *   DATABASE_URL="<prod public url>?options=-c%20default_transaction_read_only%3Don" \
 *   ANTHROPIC_API_KEY=… pnpm --filter @ona/api exec tsx scripts/compareMimoModels.ts \
 *     --out=/path/outside/the/repo/compare.json [--since=2026-10-06] [--limit=100] \
 *     [--models=claude-sonnet-5-5,claude-haiku-5-5:high,claude-sonnet-5-5#2] [--judge] [--concurrency=4]
 *
 * A model spec is `model[:effort][#tag]`: the tag lets the same setup run twice
 * (the gap between two identical runs is the judge's noise).
 *
 * The output holds people's conversations: keep it outside the repo and
 * report only aggregates.
 *
 * Same safety as replayWhatsAppTurns.ts: refuses a writable database session;
 * read skills run for real, every other skill returns "(simulado) Hecho: …".
 * Same caveat: the user context is loaded as of NOW (the menu may be another
 * week's); the clock on each message is the original one. Photo turns are
 * skipped (the image isn't stored) and so are link codes.
 */
import Anthropic from '@anthropic-ai/sdk'
import { writeFile } from 'node:fs/promises'
import { db, pool } from '../src/db/connection.js'
import { loadUserContext } from '../src/services/assistant/contextLoader.js'
import { buildSystemParts } from '../src/services/assistant/systemPrompt.js'
import { getToolDefinitions, toolsFor } from '../src/services/assistant/skills.js'
import { buildTurnMessages, runToolLoop } from '../src/services/assistant/engine.js'
import { buildChatHistory } from '../src/services/whatsapp/history.js'
import { computeCostMicros } from '../src/config/pricing.js'
import type { SkillDefinition } from '../src/services/assistant/types.js'

const READ_SKILLS = new Set([
  'get_todays_menu', 'get_recipe_details', 'search_recipes', 'suggest_recipes', 'get_my_recipes',
  'get_menu_history', 'get_weekly_nutrition', 'get_variety_score', 'scale_recipe',
])
const JUDGE_MODEL = 'claude-opus-5-5'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const outPath = arg('out')
if (!outPath) throw new Error('--out=<file.json> is required (outside the repo)')
const since = arg('since') ?? '2026-01-01'
const limit = Number(arg('limit') ?? 100)
const models = (arg('models') ?? 'claude-sonnet-5-5,claude-haiku-5-5').split(',')
const judge = process.argv.includes('--judge')
const concurrency = Number(arg('concurrency') ?? 4)

// Railway's proxy drops idle connections; without this an idle client's error kills the run.
pool.on('error', (e) => console.log(`pool: ${String(e).slice(0, 120)}`))
const ro = await pool.query('show default_transaction_read_only')
if (ro.rows[0].default_transaction_read_only !== 'on') throw new Error('The database session is not read-only — refusing to run.')

const anthropic = new Anthropic()
const { rows: turns } = await pool.query(
  `select id, user_id, phone, body, created_at from whatsapp_messages
    where direction = 'in' and status = 'processed' and user_id is not null
      and body is not null and length(trim(body)) > 0
      and body not ilike 'Vincular%' and body not like '[Foto]%'
      and created_at >= $1::date
    order by created_at limit $2`,
  [since, limit],
)
console.log(`${turns.length} turns × ${models.length} models${judge ? ' + judge' : ''}`)

const contextCache = new Map<string, string>()
const skills: SkillDefinition[] = toolsFor({ mode: 'whatsapp' }).map((s) =>
  READ_SKILLS.has(s.name)
    ? s
    : { ...s, handler: async (input: unknown) => ({ data: null, summary: `(simulado) Hecho: ${s.name} ${JSON.stringify(input).slice(0, 200)}`, uiHint: 'text' as const }) },
)
const baseTools = getToolDefinitions({ mode: 'whatsapp' })
const tools = baseTools.map((t, i) => (i === baseTools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t))

type Answer = { model: string; reply: string; trace: { name: string; input: string; summary: string }[]; flags: string[]; usd: number; secs: number; error?: string }
type Row = { n: number; at: string; user: string; history: { role: string; content: string }[]; context: string; answers: Answer[]; verdict?: unknown }

async function runTurn(n: number, t: any): Promise<Row> {
  const { rows } = await pool.query(
    `select direction, kind, body, status, created_at as "createdAt", meta from whatsapp_messages
      where phone = $1 and created_at < $2 and created_at >= $2::timestamptz - interval '12 hours' order by created_at`,
    [t.phone, t.created_at],
  )
  const history = buildChatHistory(rows, new Date(t.created_at))
  if (!contextCache.has(t.user_id)) contextCache.set(t.user_id, await loadUserContext(t.user_id, db))
  const { instructions, context } = buildSystemParts(contextCache.get(t.user_id)!, 'whatsapp')
  const system = [{ type: 'text', text: instructions, cache_control: { type: 'ephemeral' } }, { type: 'text', text: context }]
  const answers = await Promise.all(models.map(async (spec): Promise<Answer> => {
    const [modelAndEffort] = spec.split('#')
    const [model, effort] = modelAndEffort.split(':')
    const t0 = Date.now()
    try {
      const r = await runToolLoop({
        client: anthropic as never, system, tools, skills, model, effort,
        messages: buildTurnMessages(history, t.body, [], new Date(t.created_at)),
        ctx: { userId: t.user_id, db, channel: 'whatsapp' },
      })
      const micros = computeCostMicros('anthropic', model, { ...r.usage }, { eurPerUsd: 1, table: (await import('../src/config/pricing.js')).ACTIVE_PRICES }) ?? 0
      return {
        model: spec, reply: r.message, flags: r.corrections ?? [], usd: micros / 1e6, secs: (Date.now() - t0) / 1000,
        trace: (r.toolTrace ?? []).map((x) => ({ name: x.name, input: String(x.input).slice(0, 300), summary: String(x.summary ?? '').slice(0, 300) })),
      }
    } catch (e) {
      return { model: spec, reply: '', trace: [], flags: [], usd: 0, secs: (Date.now() - t0) / 1000, error: String(e).slice(0, 300) }
    }
  }))
  return { n, at: new Date(t.created_at).toISOString(), user: t.body, history: history.slice(-6), context, answers }
}

const JUDGE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      tipo_de_turno: { type: 'string', enum: ['saludo_o_acuse', 'consulta_menu_o_receta', 'apunte_lista_o_memoria', 'cambio_de_menu', 'generar_menu', 'importar_receta', 'duda_de_cocina', 'salud_o_dieta', 'alta', 'otro'] },
      candidatas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            letra: { type: 'string' },
            herramientas_correctas: { type: 'boolean', description: 'Usó las herramientas que el turno pedía (o ninguna si no hacía falta) y con los datos correctos.' },
            hecho_falso: { type: 'boolean', description: 'Dice haber hecho algo que ninguna herramienta hizo, o inventa datos del menú/receta.' },
            dieta_o_alergia_saltada: { type: 'boolean', description: 'Propone o acepta algo que choca con restricciones, alergias o dieta del contexto, o da consejo médico.' },
            tono: { type: 'integer', description: 'De 1 a 5: breve, cálido, natural para WhatsApp, en español de España.' },
            global: { type: 'integer', description: 'De 1 a 5: ¿le resolvió el turno a la persona? 5 = perfecto, 3 = aceptable, 1 = mal.' },
            nota: { type: 'string', description: 'Una frase: el fallo principal, si lo hay.' },
          },
          required: ['letra', 'herramientas_correctas', 'hecho_falso', 'dieta_o_alergia_saltada', 'tono', 'global', 'nota'],
        },
      },
      mejor: { type: 'string', description: 'Letra de la mejor, o "empate".' },
    },
    required: ['tipo_de_turno', 'candidatas', 'mejor'],
}

async function judgeTurn(row: Row): Promise<void> {
  const order = row.answers.map((a, i) => i).sort(() => Math.random() - 0.5)
  const letters = 'ABCDEFG'
  const cands = order.map((i, k) => {
    const a = row.answers[i]
    const tools = a.trace.length ? a.trace.map((x) => `  · ${x.name} ${x.input} → ${x.summary}`).join('\n') : '  (ninguna herramienta)'
    return `### Candidata ${letters[k]}\nHerramientas:\n${tools}\nRespuesta:\n${a.error ? `(ERROR: ${a.error})` : a.reply}`
  }).join('\n\n')
  const prompt = `Eres el revisor de calidad de Mimo, el asistente de cocina de Mimoia por WhatsApp (planifica el menú semanal, la lista de la compra y las recetas de un hogar). Evalúa a ciegas varias respuestas candidatas al MISMO mensaje. Las acciones de escritura están simuladas: un resultado "(simulado) Hecho: …" significa que la herramienta se ejecutó bien. El contexto del usuario se cargó hoy, así que el menú puede ser de otra semana distinta a la del mensaje: no penalices eso a ninguna candidata.

## Datos del usuario (contexto)
${row.context}

## Conversación previa (últimos mensajes)
${row.history.map((h) => `${h.role === 'user' ? 'USUARIO' : 'MIMO'}: ${h.content}`).join('\n') || '(ninguna)'}

## Mensaje a responder
USUARIO: ${row.user}

${cands}`
  const res: any = await anthropic.messages.create({
    model: JUDGE_MODEL, max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: JUDGE_SCHEMA } },
  } as any)
  const text = (res.content ?? []).find((c: any) => c.type === 'text')?.text
  if (!text) return
  const input = JSON.parse(text)
  // Map letters back to models.
  for (const c of input.candidatas ?? []) c.model = row.answers[order[letters.indexOf(c.letra)]]?.model
  input.mejor_modelo = input.mejor === 'empate' ? 'empate' : row.answers[order[letters.indexOf(input.mejor)]]?.model
  row.verdict = input
}

const out: Row[] = []
let next = 0
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < turns.length) {
    const n = next++
    const row = await runTurn(n, turns[n]).catch((e) => { console.log(`turn ${n}: ${String(e).slice(0, 200)}`); return null })
    if (!row) continue
    if (judge) await judgeTurn(row).catch((e) => console.log(`judge ${n}: ${String(e).slice(0, 200)}`))
    out.push(row)
    await writeFile(outPath!, JSON.stringify(out, null, 1)) // partial results survive a crash
    console.log(`${n + 1}/${turns.length} ${row.answers.map((a) => `${a.model.replace('claude-', '')} ${a.secs.toFixed(1)}s $${a.usd.toFixed(4)}${a.error ? ' ERROR' : ''}`).join(' | ')}`)
  }
}))
out.sort((a, b) => a.n - b.n)
await writeFile(outPath, JSON.stringify(out, null, 1))
console.log(`→ ${outPath}`)
await pool.end()
