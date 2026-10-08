/**
 * Catalogue-wide photo audit (specs/recipes.md → Photos): every recipe's
 * hero image goes through the vision check (right dish + house style);
 * `fix` regenerates the ones that fail, are missing or don't load.
 *
 * Lives in src/ (not scripts/) so it ships in dist and can run inside the
 * ona-api container, where the image volume and the provider keys are:
 *
 *   railway ssh --service ona-api -- node -e "import('/app/apps/api/dist/services/recipeImageAudit.js').then(m => m.cli(['--fix'])).then(() => process.exit(0))"
 *
 * Locally, `scripts/auditRecipeImages.ts` runs the read-only audit.
 */

import { asc, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { recipes } from '../db/schema.js'
import { applyHouseImage, loadDish, type ApplyOutcome } from './recipeHouseImage.js'
import { checkRecipeImage, verdictOk, type ImageVerdict } from './recipeImageCheck.js'

export interface AuditRow {
  id: string
  name: string
  system: boolean
  imageUrl: string | null
  status: 'ok' | 'fail' | 'lowres' | 'missing' | 'unreachable' | 'unchecked'
  /** Source width in px (photos under MIN_WIDTH look pixelated in the wide desktop slots). */
  width: number | null
  verdict: ImageVerdict | null
  fixed?: ApplyOutcome
}

export interface AuditOptions {
  ids?: string[]
  /** Base for relative seed URLs (`/images/recipes/<slug>.jpg`). */
  webBase?: string
  fix?: boolean
  concurrency?: number
  log?: (line: string) => void
}

/** Absolute URL to fetch a stored image_url from. */
export function imageFetchUrl(imageUrl: string, webBase: string): string {
  return /^https?:\/\//.test(imageUrl) ? imageUrl : `${webBase.replace(/\/+$/, '')}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`
}

/** Narrower than this is a fail even when it's the right dish (pixelated on desktop). */
export const MIN_WIDTH = 1000

async function fetchForCheck(url: string): Promise<{ jpeg: Buffer; width: number | null } | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) return null
    const raw = Buffer.from(await res.arrayBuffer())
    const { width } = await sharp(raw).metadata()
    // Any format in, a modest JPEG out (fewer vision tokens, one media type).
    const jpeg = await sharp(raw).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
    return { jpeg, width: width ?? null }
  } catch {
    return null
  }
}

const FIXABLE = new Set<AuditRow['status']>(['fail', 'lowres', 'missing', 'unreachable'])

async function auditOne(id: string, opts: AuditOptions): Promise<AuditRow> {
  const dish = await loadDish(id)
  if (!dish) return { id, name: '?', system: false, imageUrl: null, status: 'unchecked', width: null, verdict: null }
  const row: AuditRow = { id, name: dish.name, system: dish.authorId == null, imageUrl: dish.imageUrl, status: 'unchecked', width: null, verdict: null }
  if (!dish.imageUrl) row.status = 'missing'
  else {
    const img = await fetchForCheck(imageFetchUrl(dish.imageUrl, opts.webBase ?? env.WEB_PUBLIC_URL))
    if (!img) row.status = 'unreachable'
    else {
      row.width = img.width
      row.verdict = await checkRecipeImage({ ...dish, image: img.jpeg, mimeType: 'image/jpeg' })
      row.status = !row.verdict ? 'unchecked' : !verdictOk(row.verdict) ? 'fail' : (img.width ?? 0) < MIN_WIDTH ? 'lowres' : 'ok'
    }
  }
  if (opts.fix && FIXABLE.has(row.status)) {
    row.fixed = await applyHouseImage(id, { force: true })
  }
  return row
}

export async function auditRecipeImages(opts: AuditOptions = {}): Promise<AuditRow[]> {
  const log = opts.log ?? ((l: string) => console.log(l))
  const all = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(opts.ids?.length ? inArray(recipes.id, opts.ids) : undefined)
    .orderBy(asc(recipes.name))
  const queue = all.map((r) => r.id)
  const out: AuditRow[] = []
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const row = await auditOne(id, opts)
        out.push(row)
        const fix = row.fixed ? ` → ${row.fixed.status}${row.fixed.status === 'saved' ? ` (${row.fixed.attempts} intento/s)` : ''}` : ''
        log(`${row.status.padEnd(11)} ${row.system ? 'sys' : 'usr'} ${String(row.width ?? '-').padStart(5)}px ${row.name.slice(0, 50).padEnd(50)} ${row.verdict?.reason ?? ''}${fix}`)
      } catch (err) {
        log(`error       ${id} ${(err as Error)?.message ?? err}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, worker))
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** `--fix --only=<id,id> --web=<url> --concurrency=N` */
export async function cli(argv: string[]): Promise<AuditRow[]> {
  const arg = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=')
  const rows = await auditRecipeImages({
    fix: argv.includes('--fix'),
    ids: arg('only')?.split(',').filter(Boolean),
    webBase: arg('web'),
    concurrency: arg('concurrency') ? Number(arg('concurrency')) : undefined,
  })
  const count = (s: AuditRow['status']) => rows.filter((r) => r.status === s).length
  console.log(`\n${rows.length} recetas · ok ${count('ok')} · fallan ${count('fail')} · baja resolución ${count('lowres')} · sin foto ${count('missing')} · no cargan ${count('unreachable')} · sin comprobar ${count('unchecked')}`)
  return rows
}
