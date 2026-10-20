#!/usr/bin/env tsx
/**
 * PRO-154 — catalogue import by batches (specs/catalog-import.md).
 *
 * Import (everything lands as `draft`: nobody sees it, the menu never uses it):
 *   DATABASE_URL=… ANTHROPIC_API_KEY=… pnpm --filter @ona/api exec tsx scripts/catalogImport.ts import \
 *     --dir=~/libros/cocina-de-mama --origin=miguel --book="Recetario de mamá" --batch=mama-01
 *   … import --json=tanda-cocina-03.json --origin=cocina --batch=cocina-03
 *
 *   --dir=…     folder of page photos (.jpg/.jpeg/.png/.webp) or PDFs (one page
 *               per recipe; PDFs are split with `pdftoppm`). The page number is
 *               taken from the file name («p123.jpg», «page-45.png») or the PDF page.
 *   --json=…    Cocina's batch file (hand-authored shape, see draftsFromCocinaJson)
 *   --origin=…  miguel (Miguel's books, his mother's recipe book) | cocina (found or written by Cocina)
 *   --book=…    source title, saved with the recipe (never its text)
 *   --credit=…  the line the recipe page shows under the title, as it must read
 *               («Receta de la Yaya», «Inspirada en una receta de <autor>, «<libro>»»).
 *               Without it, Miguel's sources read «Inspirada en <book>»; Cocina's, nothing.
 *               In a --json file, `source.credit` (file or recipe; the recipe's wins) beats it.
 *   --batch=…   batch id (default: today's date + origin)
 *   --dry-run   read and rewrite, but save nothing
 *
 * Review and publish:
 *   … status  --batch=…              what's in the batch and what publish would do
 *   … sample  --batch=…              Cocina batches: pick Miguel's one in ten (+ allergen doubts) and list the links
 *   … review  --ok=id,id --no=id     Miguel's verdict on the sample
 *   … publish --batch=… [--dry-run]  publish what the rule allows (Miguel's: audit OK; Cocina's: sample seen and OK)
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const command = argv[0]
const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const has = (name: string) => argv.includes(`--${name}`)
const ids = (name: string) => (flag(name) ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const WEB = process.env.WEB_URL ?? 'https://mimoia.com'

const IMAGE_MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

function pageFromName(file: string): string | null {
  const m = /(?:^|[^a-z])(?:p|pag|page|pagina)?[-_ ]?(\d{1,4})(?=\D*$)/i.exec(path.basename(file, path.extname(file)))
  return m ? m[1] : null
}

async function readPages(dir: string): Promise<Array<{ file: string; page: string | null; buffer: Buffer; mime: string }>> {
  const out: Array<{ file: string; page: string | null; buffer: Buffer; mime: string }> = []
  const files = readdirSync(dir).filter((f) => !f.startsWith('.')).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
  for (const f of files) {
    const full = path.join(dir, f)
    const ext = path.extname(f).toLowerCase()
    if (IMAGE_MIME[ext]) {
      out.push({ file: f, page: pageFromName(f), buffer: readFileSync(full), mime: IMAGE_MIME[ext] })
    } else if (ext === '.pdf') {
      const tmp = mkdtempSync(path.join(tmpdir(), 'catalogo-'))
      try {
        execFileSync('pdftoppm', ['-r', '150', '-jpeg', full, path.join(tmp, 'p')])
        for (const img of readdirSync(tmp).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))) {
          const n = /(\d+)\.jpg$/.exec(img)?.[1]
          out.push({ file: `${f}#${n ?? '?'}`, page: n ? String(Number(n)) : null, buffer: readFileSync(path.join(tmp, img)), mime: 'image/jpeg' })
        }
      } catch (err) {
        throw new Error(`No he podido partir ${f} en páginas (¿está instalado pdftoppm, de poppler?): ${(err as Error).message}`)
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    }
  }
  return out
}

async function runImport() {
  const { importCatalogBatch, draftsFromCocinaJson } = await import('../src/services/catalogImport.js')
  const { createDbCatalogImportDeps } = await import('../src/services/catalogImportDb.js')
  const { createAnthropicRewriter } = await import('../src/services/catalogRewriter.js')
  const origin = flag('origin') === 'miguel' ? 'miguel' : flag('origin') === 'cocina' ? 'cocina' : null
  if (!origin) throw new Error('Falta --origin=miguel|cocina')
  const book = flag('book') ?? null
  const credit = flag('credit') ?? null
  const batch = flag('batch') ?? `${new Date().toISOString().slice(0, 10)}-${origin}`
  const dryRun = has('dry-run')

  type Draft = Parameters<typeof importCatalogBatch>[0][number]
  const drafts: Draft[] = []
  if (flag('json')) {
    drafts.push(...draftsFromCocinaJson(JSON.parse(readFileSync(flag('json')!, 'utf8')), { origin, book, credit, file: path.basename(flag('json')!) }))
  } else if (flag('dir')) {
    const { AnthropicProvider } = await import('../src/services/providers/anthropic.js')
    const vision = new AnthropicProvider()
    for (const p of await readPages(flag('dir')!)) {
      try {
        const raw = await vision.extractRecipe(p.buffer.toString('base64'), p.mime)
        drafts.push({
          name: raw.name,
          servings: raw.servings ?? 4,
          prepTime: raw.prepTime,
          cookTime: raw.cookTime ?? null,
          difficulty: raw.difficulty ?? null,
          meals: raw.suggestedMeals,
          seasons: raw.suggestedSeasons,
          tags: [],
          ingredients: raw.ingredients.map((i) => (i.quantity > 0 ? { name: i.name, quantity: i.quantity, unit: i.unit } : { name: i.name, quantity: 1, unit: 'al_gusto' })),
          sourceSteps: raw.steps,
          source: { origin, book, credit, page: p.page, file: p.file },
        })
        console.log(`· leída ${p.file}: ${raw.name}`)
      } catch (err) {
        console.log(`✗ ${p.file}: no he podido leer la receta (${(err as Error).message})`)
      }
    }
  } else {
    throw new Error('Falta --dir=<carpeta> o --json=<fichero>')
  }

  const deps = createDbCatalogImportDeps(createAnthropicRewriter(), (l) => console.log(l))
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
  const { pickReviewSample } = await import('../src/services/catalogImport.js')
  const { loadBatch, saveSample } = await import('../src/services/catalogImportDb.js')
  const batch = flag('batch')
  if (!batch) throw new Error('Falta --batch=')
  const rows = (await loadBatch(batch)).filter((r) => r.origin === 'cocina')
  const sample = pickReviewSample(rows)
  await saveSample(batch, sample)
  console.log(`Muestra para Miguel (${sample.length} de ${rows.filter((r) => r.status === 'draft').length}); se abren con una cuenta de admin:`)
  for (const id of sample) {
    const r = rows.find((x) => x.id === id)!
    console.log(`  - ${r.name}${r.allergenDoubt ? ' · duda de alérgenos' : ''} → ${WEB}/recipes/${id}`)
  }
  console.log(`Cuando Miguel conteste: review --ok=<ids> --no=<ids>, y luego publish --batch=${batch}`)
}

async function runReview() {
  const { saveReview } = await import('../src/services/catalogImportDb.js')
  await saveReview(ids('ok'), true)
  await saveReview(ids('no'), false)
  console.log(`Anotado: ${ids('ok').length} bien, ${ids('no').length} mal.`)
}

async function runPublish() {
  const { planBatchPublish } = await import('../src/services/catalogImport.js')
  const { loadBatch, publishRecipes } = await import('../src/services/catalogImportDb.js')
  const batch = flag('batch')
  if (!batch) throw new Error('Falta --batch=')
  const plan = planBatchPublish(await loadBatch(batch))
  for (const h of plan.hold) console.log(`  espera · ${h.name} (${h.reason})`)
  if (has('dry-run')) {
    console.log(`Prueba: se publicarían ${plan.publish.length}.`)
    return
  }
  const res = await publishRecipes(plan.publish)
  console.log(`Publicadas ${res.published}; deseos del catálogo cubiertos: ${res.wishesCovered}.`)
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
