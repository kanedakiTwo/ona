/**
 * Guard for the "D · Luz y foto" redesign (D-016, PRO-36…46): a page moved
 * to D must not use the old green app palette as an accent. Each redesign
 * task adds a test that lists its files and calls `legacyPaletteHits`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export const REPO = resolve(__dirname, '../../../../..')

/** Old app-mode accents: forest green as hex, the mint chip, mint/leaf/forest tokens. */
export const LEGACY_PALETTE =
  /#2D6A4F|#EAF3DE|#D8F3DC|#40916C|#1B4332|#52B788|#95D5B2|\b(?:bg|text|border|ring|from|to|via|fill|stroke|accent|outline|decoration|divide|shadow)-(?:forest(?:-deep|-mid)?|mint|leaf(?:-light)?)\b/gi

function listFiles(path: string): string[] {
  const abs = resolve(REPO, path)
  if (statSync(abs).isFile()) return [abs]
  return readdirSync(abs).flatMap((name) => listFiles(relative(REPO, join(abs, name))))
}

/** Returns `file:line: match` for every legacy-palette use under `paths` (files or dirs, repo-relative). */
export function legacyPaletteHits(paths: string[]): string[] {
  const hits: string[] = []
  for (const file of paths.flatMap(listFiles)) {
    if (!/\.(tsx?|css)$/.test(file)) continue
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(LEGACY_PALETTE)) hits.push(`${relative(REPO, file)}:${i + 1}: ${m[0]}`)
      })
  }
  return hits
}
