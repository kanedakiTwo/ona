/**
 * Replays real WhatsApp turns through Mimo's CURRENT engine (model, prompt,
 * tools per channel, history with the ⟦hecho⟧ trace) to check a prompt or
 * model change before shipping it. The diagnosis of 2026-10-11 and the
 * Sonnet 5.5 switch were validated this way.
 *
 *   DATABASE_URL="<prod public url>?options=-c%20default_transaction_read_only%3Don" \
 *   ANTHROPIC_API_KEY=… pnpm --filter @ona/api exec tsx scripts/replayWhatsAppTurns.ts \
 *     --turns=/path/outside/the/repo/turns.json [--out=replay.json]
 *
 * turns.json: { "label": "YYYY-MM-DD HH:MM:SS" } — Madrid time of each inbound
 * message to replay (kept outside the repo: they are someone's conversation).
 *
 * Safety: refuses to run unless the database session is read-only. Read
 * skills (menu, recipes, searches) run for real; every other skill is
 * simulated and returns "(simulado) Hecho: …", so nothing is written and no
 * message is sent. Caveat: the user context is loaded as of NOW, so a turn
 * from another day may get dates mixed up ("hoy es lunes, no jueves").
 *
 * Menu fit cases (PRO-155): `--fit-cases=scripts/replayMenuFitCases.json
 * --user=<uuid>` sends, as that user, «hazme el menú de la semana» once per
 * case, with generate_weekly_menu simulated to return the case's menu and
 * «Acierto con sus gustos» lines (alto / medio / bajo). Check that the three
 * replies say different things and the low one invites to add recipes.
 */
import Anthropic from '@anthropic-ai/sdk'
import { readFile, writeFile } from 'node:fs/promises'
import { db, pool } from '../src/db/connection.js'
import { loadUserContext } from '../src/services/assistant/contextLoader.js'
import { buildSystemParts } from '../src/services/assistant/systemPrompt.js'
import { getToolDefinitions, toolsFor } from '../src/services/assistant/skills.js'
import { runToolLoop } from '../src/services/assistant/engine.js'
import { buildChatHistory } from '../src/services/whatsapp/history.js'
import type { SkillDefinition } from '../src/services/assistant/types.js'

const READ_SKILLS = new Set([
  'get_todays_menu', 'get_weekly_menu', 'get_recipe_details', 'search_recipes', 'suggest_recipes', 'get_my_recipes',
  'get_menu_history', 'get_weekly_nutrition', 'get_variety_score', 'scale_recipe',
])

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const turnsPath = arg('turns')
if (!turnsPath && !arg('fit-cases')) throw new Error('--turns=<file.json> or --fit-cases=<file.json> is required (see the header)')

const ro = await pool.query('show default_transaction_read_only')
if (ro.rows[0].default_transaction_read_only !== 'on') throw new Error('The database session is not read-only — refusing to replay.')

const anthropic = new Anthropic()
const out: unknown[] = []

const fitCasesPath = arg('fit-cases')
if (fitCasesPath) {
  const userId = arg('user')
  if (!userId) throw new Error('--fit-cases needs --user=<uuid> (whose context Mimo loads)')
  const cases = JSON.parse(await readFile(fitCasesPath, 'utf8')) as Array<{ label: string; user: string; summary: string }>
  const { instructions, context } = buildSystemParts(await loadUserContext(userId, db), 'whatsapp')
  for (const c of cases) {
    const skills: SkillDefinition[] = toolsFor({ mode: 'whatsapp' }).map((s) =>
      s.name === 'generate_weekly_menu'
        ? { ...s, handler: async () => ({ data: null, summary: c.summary, uiHint: 'text' as const }) }
        : READ_SKILLS.has(s.name)
          ? s
          : { ...s, handler: async (input: unknown) => ({ data: null, summary: `(simulado) Hecho: ${s.name} ${JSON.stringify(input).slice(0, 200)}`, uiHint: 'text' as const }) },
    )
    const r = await runToolLoop({
      client: anthropic as never,
      system: [{ type: 'text', text: instructions, cache_control: { type: 'ephemeral' } }, { type: 'text', text: context }],
      tools: getToolDefinitions({ mode: 'whatsapp' }),
      skills,
      messages: [{ role: 'user' as const, content: c.user }],
      ctx: { userId, db, channel: 'whatsapp' },
    })
    out.push({ label: c.label, user: c.user, reply: r.message, trace: r.toolTrace })
    console.log(`\n### ${c.label}\n  MIMO: ${r.message.replace(/\n+/g, ' ⏎ ')}`)
  }
}

const turns = turnsPath ? (JSON.parse(await readFile(turnsPath, 'utf8')) as Record<string, string>) : {}

for (const [label, ts] of Object.entries(turns)) {
  const { rows: [msg] } = await pool.query(
    `select user_id, phone, body, created_at from whatsapp_messages
      where direction = 'in' and to_char(created_at at time zone 'Europe/Madrid', 'YYYY-MM-DD HH24:MI:SS') = $1`,
    [ts],
  )
  if (!msg) {
    console.log(`?? ${label}: no inbound message at ${ts}`)
    continue
  }
  const { rows } = await pool.query(
    `select direction, kind, body, status, created_at as "createdAt", meta from whatsapp_messages
      where phone = $1 and created_at < $2 and created_at >= $2::timestamptz - interval '12 hours' order by created_at`,
    [msg.phone, msg.created_at],
  )
  const history = buildChatHistory(rows, new Date(msg.created_at))
  const { instructions, context } = buildSystemParts(await loadUserContext(msg.user_id, db), 'whatsapp')
  const skills: SkillDefinition[] = toolsFor({ mode: 'whatsapp' }).map((s) =>
    READ_SKILLS.has(s.name)
      ? s
      : { ...s, handler: async (input: unknown) => ({ data: null, summary: `(simulado) Hecho: ${s.name} ${JSON.stringify(input).slice(0, 200)}`, uiHint: 'text' as const }) },
  )
  const t0 = Date.now()
  const r = await runToolLoop({
    client: anthropic as never,
    system: [{ type: 'text', text: instructions, cache_control: { type: 'ephemeral' } }, { type: 'text', text: context }],
    tools: getToolDefinitions({ mode: 'whatsapp' }),
    skills,
    messages: [...history.map((h) => ({ role: h.role, content: h.content })), { role: 'user' as const, content: msg.body }],
    ctx: { userId: msg.user_id, db, channel: 'whatsapp' },
  })
  const secs = (Date.now() - t0) / 1000
  out.push({ label, user: msg.body, secs, reply: r.message, trace: r.toolTrace, flags: r.corrections, usage: r.usage })
  console.log(`\n### ${label} (${secs.toFixed(1)} s)`)
  console.log(`  USUARIO: ${String(msg.body).slice(0, 300)}`)
  for (const t of r.toolTrace ?? []) console.log(`  · ${t.name} ${t.input.slice(0, 160)}`)
  if (r.corrections?.length) console.log(`  señales: ${r.corrections.join(', ')}`)
  console.log(`  MIMO: ${r.message.replace(/\n+/g, ' ⏎ ').slice(0, 1500)}`)
}

const outPath = arg('out')
if (outPath) await writeFile(outPath, JSON.stringify(out, null, 1))
await pool.end()
