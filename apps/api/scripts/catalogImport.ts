#!/usr/bin/env tsx
/**
 * PRO-154 — catalogue import by batches (specs/catalog-import.md).
 *
 * Import (everything lands as `draft`: nobody sees it, the menu never uses it):
 *   DATABASE_URL=… pnpm --filter @ona/api exec tsx scripts/catalogImport.ts import \
 *     --json=tanda-cocina-03.json --origin=cocina --batch=cocina-03
 *
 *   --json=…    Cocina's batch file (hand-authored shape, see draftsFromCocinaJson),
 *               rewritten: `"reescrita": true`, its steps and labels saved as they
 *               come (PRO-1097). Since PRO-1312 (D-164) the import makes no call to
 *               the model: a batch without `reescrita` is refused, and so is
 *               `--dir=` (a folder of page photos: Cocina reads them and writes the
 *               rewritten batch). Ingredients match by `catalogo` or name, without AI.
 *   --origin=…  miguel (Miguel's books, his mother's recipe book) | cocina (found or written by Cocina)
 *   --book=…    source title, saved with the recipe (never its text)
 *   --credit=…  the line the recipe page shows under the title, as it must read
 *               («Receta de la Yaya», «Inspirada en una receta de <autor>, «<libro>»»).
 *               Without it, Miguel's sources read «Inspirada en <book>»; Cocina's, nothing.
 *               In a --json file, `source.credit` (file or recipe; the recipe's wins) beats it.
 *   --batch=…   batch id (default: today's date + origin)
 *   --dry-run   check and match, but save nothing
 *
 * The same, from the web: Admin → «Recetas pendientes» (/admin/recetas) lists
 * the drafts by batch, publishes or discards each one and imports a --json
 * batch file in the background (routes/catalogReview.ts).
 *
 * Review and publish:
 *   … status  --batch=…              what's in the batch and what publish would do
 *   … sample  --batch=…              Cocina batches: list the links of every draft for Miguel (D-099), allergen doubts first
 *   … review  --ok=id,id --no=id     Miguel's verdict, recipe by recipe
 *   … publish --batch=… [--dry-run]  publish what the rule allows (Miguel's: audit OK; Cocina's: only those Miguel said OK to)
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const command = argv[0]
const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const has = (name: string) => argv.includes(`--${name}`)
const ids = (name: string) => (flag(name) ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const WEB = process.env.WEB_URL ?? 'https://mimoia.com'

async function runImport() {
  const { importCatalogBatch, draftsFromCocinaJson, noHouseRewrite } = await import('../src/services/catalogImport.js')
  const { createDbCatalogImportDeps } = await import('../src/services/catalogImportDb.js')
  const origin = flag('origin') === 'miguel' ? 'miguel' : flag('origin') === 'cocina' ? 'cocina' : null
  if (!origin) throw new Error('Falta --origin=miguel|cocina')
  const book = flag('book') ?? null
  const credit = flag('credit') ?? null
  const batch = flag('batch') ?? `${new Date().toISOString().slice(0, 10)}-${origin}`
  const dryRun = has('dry-run')

  if (flag('dir')) {
    // PRO-1312 (D-164): reading the pages and rewriting them spent Mimoia's API.
    throw new Error('La carpeta de fotos ya no se importa: Cocina lee las páginas y escribe la tanda reescrita (JSON con «reescrita»: true); impórtala con --json=<fichero>.')
  }
  if (!flag('json')) throw new Error('Falta --json=<fichero> (la tanda reescrita de Cocina)')
  const json = JSON.parse(readFileSync(flag('json')!, 'utf8'))
  // Checked like the web page checks it: a batch without `reescrita: true` is refused (PRO-1312).
  const { checkCocinaBatch } = await import('@ona/shared')
  const check = checkCocinaBatch(json)
  if (!check.ok) throw new Error(`La tanda no vale:\n${check.problems.map((p) => `- ${p}`).join('\n')}`)
  const drafts = draftsFromCocinaJson(json, { origin, book, credit, file: path.basename(flag('json')!) })

  const deps = createDbCatalogImportDeps(noHouseRewrite, (l) => console.log(l))
  if (dryRun) deps.persistDraft = async () => ({ ok: true, recipeId: '(sin guardar)' })
  const out = await importCatalogBatch(drafts, batch, deps)
  const count = (s: string) => out.filter((o) => o.status === s).length
  console.log(`\nTanda ${batch}: ${count('draft')} en borrador, ${count('duplicate')} repetidas, ${count('rejected')} rechazadas${dryRun ? ' (prueba: nada guardado)' : ''}.`)
  const doubts = out.filter((o) => o.status === 'draft' && o.allergenDoubt).map((o) => o.name)
  if (doubts.length) console.log(`Con dudas de alérgenos: ${doubts.join(', ')}`)
  console.log(origin === 'miguel' ? `Siguiente: publish --batch=${batch}` : `Siguiente: sample --batch=${batch}`)
}

async function runStatus() {
  const { planBatchPublish } = await import('../src/services/catalogImport.js')
  const { loadBatch } = await import('../src/services/catalogImportDb.js')
  const batch = flag('batch')
  if (!batch) throw new Error('Falta --batch=')
  const rows = await loadBatch(batch)
  const plan = planBatchPublish(rows)
  console.log(`Tanda ${batch}: ${rows.length} recetas (${rows.filter((r) => r.status === 'published').length} publicadas).`)
  console.log(`Se publicarían ${plan.publish.length}.`)
  for (const h of plan.hold) console.log(`  espera · ${h.name} (${h.reason})`)
}

async function runSample() {
  const { listForReview } = await import('../src/services/catalogImport.js')
  const { loadBatch, saveSample } = await import('../src/services/catalogImportDb.js')
  const batch = flag('batch')
  if (!batch) throw new Error('Falta --batch=')
  const rows = (await loadBatch(batch)).filter((r) => r.origin === 'cocina')
  const list = listForReview(rows)
  await saveSample(list)
  const verdict = (ok: boolean | undefined) => (ok === true ? ' · ya dijo que sí' : ok === false ? ' · ya dijo que no' : '')
  console.log(`Para Miguel, todas las de la tanda (${list.length}); se abren con una cuenta de admin:`)
  for (const id of list) {
    const r = rows.find((x) => x.id === id)!
    console.log(`  - ${r.name}${r.allergenDoubt ? ' · duda de alérgenos' : ''}${verdict(r.reviewOk)} → ${WEB}/recipes/${id}`)
  }
  console.log(`Cuando Miguel conteste: review --ok=<ids> --no=<ids>, y luego publish --batch=${batch} (solo salen las que dijo que sí)`)
}

async function runReview() {
  const { saveReview } = await import('../src/services/catalogImportDb.js')
  await saveReview(ids('ok'), true)
  await saveReview(ids('no'), false)
  console.log(`Anotado: ${ids('ok').length} bien, ${ids('no').length} mal.`)
}

async function runPublish() {
  // Same helper as the admin page's «Publicar las aprobadas» (catalogImportDb.publishBatch).
  const { publishBatch } = await import('../src/services/catalogImportDb.js')
  const batch = flag('batch')
  if (!batch) throw new Error('Falta --batch=')
  const res = await publishBatch(batch, { dryRun: has('dry-run') })
  for (const h of res.plan.hold) console.log(`  espera · ${h.name} (${h.reason})`)
  if (has('dry-run')) {
    console.log(`Prueba: se publicarían ${res.plan.publish.length}.`)
    return
  }
  console.log(`Publicadas ${res.published}; deseos del catálogo cubiertos: ${res.wishesCovered}.`)
  const waiting = res.plan.hold.filter((h) => h.reason === 'sin_foto').length
  if (waiting) console.log(`${waiting} esperan su foto: el API la hace y salen solas en cuanto la tienen.`)
}

const COMMANDS: Record<string, () => Promise<void>> = { import: runImport, status: runStatus, sample: runSample, review: runReview, publish: runPublish }

async function main() {
  const run = COMMANDS[command ?? '']
  if (!run) {
    console.log('Uso: catalogImport.ts import|status|sample|review|publish … (ver la cabecera del fichero)')
    process.exit(1)
  }
  try {
    await run()
  } finally {
    const { pool } = await import('../src/db/connection.js')
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err?.message ?? err)
  process.exit(1)
})
