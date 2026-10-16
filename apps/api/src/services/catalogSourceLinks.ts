/**
 * PRO-57 — link catalogue recipes to their original (Notion `Link` column).
 *
 * The system catalogue was seeded from a Notion export whose `Link` column
 * (YouTube videos, Directo al Paladar, …) the seed never used. This backfill
 * gives every system recipe (`author_id IS NULL`) that still has no
 * `source_url` the link of the Notion row with the same name, so the detail
 * shows «Ver fuente». User recipes and recipes that already carry a link are
 * never touched; re-running it changes nothing (idempotent).
 *
 * It runs by itself after `db:migrate` (every API boot: staging and
 * production deploys) and at the end of `db:seed` (fresh dev / CI databases).
 */

import { and, eq, isNull } from 'drizzle-orm'
import type { SourceType } from '@ona/shared'
import { recipes } from '../db/schema.js'
import { NOTION_SOURCE_LINKS } from '../seed/notionSourceLinks.js'
import { detectSourceType } from './sources/sourceType.js'
import { oldNamesOf } from './recipeRenames.js'

// ─── Pure matching ───────────────────────────────────────────────

/** Lowercase, no accents, single spaces: «Osobuco  a la Milanesa» → «osobuco a la milanesa». */
export function normalizeRecipeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A usable http(s) URL, or null. A cell with anything after the URL (e.g.
 * «… (TBD)», Miguel's "to be decided") is not a confirmed source: skipped.
 */
export function cleanSourceLink(raw: string): string | null {
  const value = raw.trim()
  if (!value || /\s/.test(value)) return null
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export function sourceTypeForLink(url: string): Extract<SourceType, 'youtube' | 'article'> {
  return detectSourceType(url)
}

export type LinkIndex = Map<string, string>

/**
 * Normalised name → link. A name that appears twice with different links is
 * ambiguous and left out (a row without a link never overrides one with it).
 */
export function buildLinkIndex(rows: ReadonlyArray<readonly [string, string]>): LinkIndex {
  const index: LinkIndex = new Map()
  const ambiguous = new Set<string>()
  for (const [name, raw] of rows) {
    const link = cleanSourceLink(raw)
    if (!link) continue
    const key = normalizeRecipeName(name)
    const prev = index.get(key)
    if (prev && prev !== link) ambiguous.add(key)
    else index.set(key, link)
  }
  for (const key of ambiguous) index.delete(key)
  return index
}

/** Levenshtein distance, bailing out as soon as it exceeds `max`. */
function editDistanceAtMost(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return false
    prev = cur
  }
  return prev[b.length] <= max
}

/** Names this long tolerate one typo («noddles», «chiken» in the Notion export). */
const TYPO_MIN_LENGTH = 12

/**
 * The original link for a catalogue recipe name, or null. Exact match after
 * normalising (accents, case, spaces); otherwise a single-letter typo on long
 * names, only when exactly one Notion row is that close.
 */
export function matchSourceLink(name: string, index: LinkIndex): string | null {
  // A renamed catalogue recipe (PRO-140) keeps the link of its old Notion name.
  for (const old of oldNamesOf(name)) {
    const viaOld = matchSourceLink(old, index)
    if (viaOld) return viaOld
  }
  const key = normalizeRecipeName(name)
  const exact = index.get(key)
  if (exact) return exact
  if (key.length < TYPO_MIN_LENGTH) return null
  const near = [...index.entries()].filter(([k]) => k.length >= TYPO_MIN_LENGTH && editDistanceAtMost(key, k, 1))
  return near.length === 1 ? near[0][1] : null
}

/** Pure: RFC 4180-ish CSV (quoted fields, "" escapes, BOM, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// ─── DB backfill ─────────────────────────────────────────────────

export interface CatalogSourceLinkResult {
  /** System recipes without a link before the run. */
  candidates: number
  matched: number
  unmatched: string[]
}

// Structural type so tests can pass a fake; the real `db` (drizzle) fits.
type Db = typeof import('../db/connection.js').db

export async function applyCatalogSourceLinks(
  db: Db,
  log: (line: string) => void = console.log,
): Promise<CatalogSourceLinkResult> {
  const index = buildLinkIndex(NOTION_SOURCE_LINKS)
  const rows = await db
    .select({ id: recipes.id, name: recipes.name })
    .from(recipes)
    .where(and(isNull(recipes.authorId), isNull(recipes.sourceUrl)))

  let matched = 0
  const unmatched: string[] = []
  for (const r of rows) {
    const link = matchSourceLink(r.name, index)
    if (!link) {
      unmatched.push(r.name)
      continue
    }
    // Same guard again in the UPDATE: never a user recipe, never overwrite.
    await db
      .update(recipes)
      .set({ sourceUrl: link, sourceType: sourceTypeForLink(link) })
      .where(and(eq(recipes.id, r.id), isNull(recipes.authorId), isNull(recipes.sourceUrl)))
    matched++
  }

  log(
    `[catalog-source-links] ${rows.length} recetas del catálogo sin enlace: ${matched} emparejadas, ${unmatched.length} sin emparejar` +
      (unmatched.length > 0 ? ` (${unmatched.slice(0, 40).join(' · ')}${unmatched.length > 40 ? ' …' : ''})` : ''),
  )
  return { candidates: rows.length, matched, unmatched }
}
