/**
 * PRO-1178 · La vista semana abre la misma hoja que la vista día.
 *
 * Hasta entonces cada fila de `WeekGridView` tenía su propio menú, con otros
 * nombres («Aleatorio», «Bloquear», «Quitar slot») y sin Comensales, táper,
 * sobras ni «Marcar como cocinada». Ahora su «···» abre `MealOptionsSheets`
 * con el mismo contexto y los mismos manejadores que la vista día.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MENU_DIR = join(__dirname, '../../../web/src/components/menu')
const files = readdirSync(MENU_DIR).filter((f) => /\.tsx?$/.test(f))
const read = (f: string) => readFileSync(join(MENU_DIR, f), 'utf8')

/** Una etiqueta: el texto entre comillas o entre etiquetas JSX, no un nombre de variable ni un comentario. */
const OLD_LABELS = ['Aleatorio', 'Bloquear', 'Desbloquear', 'Quitar slot', 'Vetar receta']
const asLabel = (label: string) => new RegExp(`(["'\`>]\\s*)${label}(\\s*["'\`<])`)

describe('PRO-1178 · la fila de la vista semana', () => {
  it('en components/menu/ no queda ninguna etiqueta «Aleatorio», «Bloquear» ni «Quitar slot»', () => {
    expect(files.length).toBeGreaterThan(10)
    for (const f of files) {
      const src = read(f)
      for (const label of OLD_LABELS) expect(src, `«${label}» en ${f}`).not.toMatch(asLabel(label))
    }
    // La comprobación pilla una etiqueta de verdad.
    expect('label: "Aleatorio",').toMatch(asLabel('Aleatorio'))
    expect('<span>Quitar slot</span>').toMatch(asLabel('Quitar slot'))
    expect('onPickAleatorio={x}').not.toMatch(asLabel('Aleatorio'))
  })

  it('su «···» abre la hoja de la vista día, con el contexto y los manejadores de /menu', () => {
    const grid = read('WeekGridView.tsx')
    expect(grid).toMatch(/<MealOptionsSheets ctl=\{ctl\} \{\.\.\.props\} \/>/)
    expect(grid).toMatch(/<MealOptionsButton/)
    expect(grid).toMatch(/slotPropsFor\(dayIndex\)\(meal, slot\)/)
    // Una comida que el día no tiene: la misma hoja que la tarjeta «no hay».
    expect(grid).toMatch(/<AbsentMealSheets/)
    // Sin menú propio: ni sus acciones, ni sus confirmaciones, ni su buscador.
    for (const own of ['ActionDef', 'RowActionsButton', 'RecipePickerSheet', 'AddDishSheet', 'ConfirmSheet', 'createPortal']) {
      expect(grid, own).not.toContain(own)
    }
    const page = readFileSync(join(__dirname, '../../../web/src/app/menu/page.tsx'), 'utf8')
    const call = page.slice(page.indexOf('<WeekGridView'), page.indexOf('/>', page.indexOf('<WeekGridView')))
    expect(call).toContain('slotPropsFor={slotPropsFor}')
    expect(call).toContain('absentFor={absentFor}')
    expect(call).not.toMatch(/onRandomize|onBan|onToggleLock|onPickRecipe/)
  })
})
