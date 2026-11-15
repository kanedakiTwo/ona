/**
 * PRO-1179 · La hoja «···» de la semana (propuesta de Producto 2026-11-11
 * §1.7 y §3): «Tu semana tipo» arriba, «Rehacer la semana…» al final y sin
 * ‹ › ni «Volver a esta semana» (están en la cabecera). En una semana pasada,
 * sin «Rehacer». En escritorio, «Semana tipo» es el botón de la cabecera y
 * ya no hay «Regenerar semana» a la vista.
 *
 * El recorrido en el navegador está en apps/web/e2e/menu-week-sheet.spec.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MENU_SHEET_ACTIONS } from '@ona/shared'
import { WEEK_TYPE_HREF, weekSheetOptions } from '../../../web/src/lib/weekSheet'

const WEB = join(__dirname, '../../../web/src')
const read = (f: string) => readFileSync(join(WEB, f), 'utf8')

describe('PRO-1179 · hoja de la semana', () => {
  it('semana actual en el móvil: semana tipo arriba, rehacer al final, con sus tres formas', () => {
    expect(weekSheetOptions({ weeksFromNow: 0, hasMenu: true, desktop: false })).toEqual({
      main: ['semana_tipo', 'vista', 'compartir', 'imprimir', 'historial', 'rehacer'],
      redo: ['regenerar', 'favoritas', 'vaciar'],
    })
  })

  it('semana futura: lo mismo; sin menú todavía no hay compartir, imprimir ni vaciar', () => {
    expect(weekSheetOptions({ weeksFromNow: 2, hasMenu: true, desktop: false })).toEqual(
      weekSheetOptions({ weeksFromNow: 0, hasMenu: true, desktop: false }),
    )
    expect(weekSheetOptions({ weeksFromNow: 1, hasMenu: false, desktop: false })).toEqual({
      main: ['semana_tipo', 'vista', 'historial', 'rehacer'],
      redo: ['regenerar', 'favoritas'],
    })
  })

  it('semana pasada: sin «Rehacer»', () => {
    const past = weekSheetOptions({ weeksFromNow: -1, hasMenu: true, desktop: false })
    expect(past.main).not.toContain('rehacer')
    expect(past.redo).toEqual([])
    expect(past.main).toEqual(['semana_tipo', 'vista', 'compartir', 'imprimir', 'historial'])
  })

  it('escritorio: sin el cambio de vista ni la semana tipo (está en la cabecera)', () => {
    expect(weekSheetOptions({ weeksFromNow: 0, hasMenu: true, desktop: true }).main).toEqual([
      'compartir',
      'imprimir',
      'historial',
      'rehacer',
    ])
  })

  it('la hoja ya no navega entre semanas', () => {
    const sheet = read('components/menu/WeekActionsSheet.tsx')
    expect(sheet).not.toMatch(/Semana anterior|Semana siguiente|Volver a esta semana/)
    for (const gone of ['semana_anterior', 'semana_siguiente', 'volver_semana']) {
      expect(MENU_SHEET_ACTIONS.semana as readonly string[]).not.toContain(gone)
    }
    expect(MENU_SHEET_ACTIONS.semana).toEqual(expect.arrayContaining(['semana_tipo', 'rehacer', 'regenerar', 'favoritas', 'vaciar']))
  })

  it('escritorio: «Semana tipo» lleva a su pantalla y no queda «Regenerar semana»', () => {
    const page = read('app/menu/page.tsx')
    expect(page).not.toMatch(/>\s*Regenerar semana\s*</)
    expect(page).toMatch(/href=\{WEEK_TYPE_HREF\}/)
    expect(WEEK_TYPE_HREF).toBe('/profile/semana-tipo')
  })
})
