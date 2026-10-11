/**
 * PRO-57 — catalogue recipes get the link of their Notion row («Ver fuente»).
 * Pure name ↔ link matching, the embedded data vs the Notion CSV, and the
 * backfill's bookkeeping against a fake DB.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyCatalogSourceLinks,
  buildLinkIndex,
  cleanSourceLink,
  matchSourceLink,
  normalizeRecipeName,
  parseCsv,
  sourceTypeForLink,
} from '../services/catalogSourceLinks.js'
import { NOTION_SOURCE_LINKS } from '../seed/notionSourceLinks.js'
import { seedRecipes } from '../seed/recipes.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const CSV_PATH = path.resolve(here, '../../../../notion-export/Recetas 282e2ef4c94280d0aaf9fb17b3a1fdf6.csv')

describe('normalizeRecipeName', () => {
  it('ignores accents, case and double spaces', () => {
    expect(normalizeRecipeName('Osobuco  a la milanesa')).toBe('osobuco a la milanesa')
    expect(normalizeRecipeName('  Crema de CALABACÍN ')).toBe('crema de calabacin')
    expect(normalizeRecipeName('Albóndigas en salsa española')).toBe(normalizeRecipeName('Albondigas en salsa espanola'))
  })
})

describe('cleanSourceLink / sourceTypeForLink', () => {
  it('keeps plain http(s) URLs and drops notes like «(TBD)» or junk', () => {
    expect(cleanSourceLink(' https://www.youtube.com/watch?v=abc ')).toBe('https://www.youtube.com/watch?v=abc')
    expect(cleanSourceLink('https://www.simplyrecipes.com/recipes/ceviche/ (TBD)')).toBeNull()
    expect(cleanSourceLink('')).toBeNull()
    expect(cleanSourceLink('javascript:alert(1)')).toBeNull()
  })
  it('YouTube links are videos, everything else an article', () => {
    expect(sourceTypeForLink('https://www.youtube.com/watch?v=lcFoC8E2f4c')).toBe('youtube')
    expect(sourceTypeForLink('https://www.directoalpaladar.com/x')).toBe('article')
  })
})

describe('matchSourceLink', () => {
  const index = buildLinkIndex(NOTION_SOURCE_LINKS)

  it('matches the Notion row with double spaces and different accents/case', () => {
    expect(matchSourceLink('Osobuco a la milanesa', index)).toBe(
      'https://www.directoalpaladar.com/recetas-de-carnes-y-aves/ossobuco-a-la-milanesa-receta-tradicional',
    )
    expect(matchSourceLink('ALBONDIGAS GIPSY', index)).toBe('https://www.youtube.com/watch?v=lcFoC8E2f4c')
  })

  it('tolerates one typo on long names only («noddles», «chiken»)', () => {
    expect(matchSourceLink('Wrap de lechuga con noodles', index)).not.toBeNull()
    expect(matchSourceLink('Vegan butter chicken', index)).not.toBeNull()
    expect(matchSourceLink('Lasañas', index)).toBeNull()
  })

  it('never matches a different dish or a recipe that is not in Notion', () => {
    expect(matchSourceLink('Curry de berenjena y garbanzos', index)).toBeNull()
    expect(matchSourceLink('Tortilla francesa', index)).toBeNull()
    // In Notion but without a confirmed link.
    expect(matchSourceLink('Ceviche', index)).toBeNull()
    expect(matchSourceLink('Crema de calabacín', index)).toBeNull()
  })

  it('a name with two different links is ambiguous; a row without link never wins', () => {
    const idx = buildLinkIndex([
      ['Crema de calabaza', 'https://a.example/1'],
      ['Crema  de calabaza', ''],
      ['Pisto', 'https://a.example/2'],
      ['pisto', 'https://b.example/3'],
    ])
    expect(matchSourceLink('Crema de calabaza', idx)).toBe('https://a.example/1')
    expect(matchSourceLink('Pisto', idx)).toBeNull()
  })

  it('links the seed recipes that have a Notion link (CI catalogue shows «Ver fuente»)', () => {
    const linked = seedRecipes.filter((r) => matchSourceLink(r.name, index))
    expect(linked.map((r) => r.name)).toEqual(
      expect.arrayContaining(['Carrilleras de ternera con vino tinto', 'Curry de berenjena', 'Falafel']),
    )
    expect(linked.length).toBeGreaterThanOrEqual(35)
  })
})

describe('embedded Notion links', () => {
  it('match the Notion export (column Link, rows that have one)', () => {
    const [header, ...rows] = parseCsv(readFileSync(CSV_PATH, 'utf8'))
    const nameCol = header.indexOf('Name')
    const linkCol = header.indexOf('Link')
    expect(nameCol).toBe(0)
    expect(linkCol).toBeGreaterThan(0)
    const fromCsv = rows
      .filter((r) => (r[linkCol] ?? '').trim().length > 0)
      .map((r) => [r[nameCol], r[linkCol]])
    expect(NOTION_SOURCE_LINKS.map((r) => [...r])).toEqual(fromCsv)
  })

  it('parseCsv handles quotes, escaped quotes, BOM and CRLF', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
    ])
  })
})

describe('applyCatalogSourceLinks', () => {
  function fakeDb(rows: Array<{ id: string; name: string }>) {
    const updates: Array<{ set: Record<string, unknown> }> = []
    const db = {
      select: () => ({ from: () => ({ where: async () => rows }) }),
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: async () => {
            updates.push({ set })
          },
        }),
      }),
    }
    return { db: db as never, updates }
  }

  it('links the matched ones, reports the rest in the log', async () => {
    const { db, updates } = fakeDb([
      { id: '1', name: 'Albondigas gipsy' },
      { id: '2', name: 'Osobuco a la milanesa' },
      { id: '3', name: 'Receta que no está en Notion' },
    ])
    const lines: string[] = []
    const r = await applyCatalogSourceLinks(db, (l) => lines.push(l))
    expect(r).toEqual({ candidates: 3, matched: 2, unmatched: ['Receta que no está en Notion'] })
    expect(updates).toEqual([
      { set: { sourceUrl: 'https://www.youtube.com/watch?v=lcFoC8E2f4c', sourceType: 'youtube' } },
      {
        set: {
          sourceUrl: 'https://www.directoalpaladar.com/recetas-de-carnes-y-aves/ossobuco-a-la-milanesa-receta-tradicional',
          sourceType: 'article',
        },
      },
    ])
    expect(lines[0]).toMatch(/3 recetas del catálogo sin enlace: 2 emparejadas, 1 sin emparejar/)
    expect(lines[0]).toContain('Receta que no está en Notion')
  })

  it('second run: nothing left to link, nothing updated (idempotent)', async () => {
    const { db, updates } = fakeDb([])
    const r = await applyCatalogSourceLinks(db, () => {})
    expect(r).toEqual({ candidates: 0, matched: 0, unmatched: [] })
    expect(updates).toHaveLength(0)
  })
})
