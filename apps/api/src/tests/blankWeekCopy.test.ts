/**
 * PRO-1180 · «Configurar pesa más que pedirle a la IA» (propuesta de Producto
 * 2026-11-11 §5, E-72).
 *
 * - La semana en blanco: con semana tipo, sus dos líneas, «Editar» y «Llenar
 *   con mi semana tipo»; sin ella, «Hacer mi menú» y «Primero, cuéntame cómo
 *   coméis». Nunca «Generar mi menú» ni destellos.
 * - «Añadir plato»: «Elegir del catálogo», «Escribir un plato» y, al final,
 *   «Que elija Mimoia».
 * - El piloto: «Cambiar algo» abre la semana, no Mimo.
 *
 * El recorrido en el navegador está en apps/web/e2e/configure-first.spec.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fullWeekTypeDays, type WeekTypeDays } from '@ona/shared'
import { blankWeekCopy, weekTypeConfigured, weekTypeSummary } from '../../../web/src/lib/blankWeek'
import { ADD_DISH_OPTIONS } from '../../../web/src/lib/addDishSheet'

const WEB = join(__dirname, '../../../web/src')
const source = (rel: string) => readFileSync(join(WEB, rel), 'utf8')

/** The default week (lunch and dinner every day, any recipe) with some slots changed. */
function week(edit: (days: WeekTypeDays) => void = () => {}): WeekTypeDays {
  const days = fullWeekTypeDays()
  edit(days)
  return days
}

describe('semana en blanco sin semana tipo', () => {
  it('«Hacer mi menú» y el enlace a contar cómo coméis, sin resumen', () => {
    for (const days of [undefined, null, week()]) {
      expect(weekTypeConfigured(days)).toBe(false)
      const copy = blankWeekCopy(days)
      expect(copy.primary).toBe('Hacer mi menú')
      expect(copy.setupLink).toBe(true)
      expect(copy.summary).toBeNull()
    }
  })

  it('unos comensales o un «Cualquier receta» no cuentan como semana tipo', () => {
    const days = week((d) => {
      d[0].lunch = { diners: 3 }
      d[1].dinner = { options: [{ kind: 'any' }] }
    })
    expect(blankWeekCopy(days).primary).toBe('Hacer mi menú')
  })
})

describe('semana en blanco con semana tipo', () => {
  const days = week((d) => {
    d[0].lunch = { options: [{ kind: 'type', type: 'legumbres' }] }
    d[2].lunch = { options: [{ kind: 'type', type: 'legumbres' }] }
    d[4].dinner = { options: [{ kind: 'type', type: 'pizza' }] }
  })

  it('«Llenar con mi semana tipo», sus dos líneas y nada de enlace', () => {
    const copy = blankWeekCopy(days)
    expect(copy.primary).toBe('Llenar con mi semana tipo')
    expect(copy.setupLink).toBe(false)
    expect(copy.summary).toEqual({ meals: 'Comida y cena', dishes: 'legumbres lunes y miércoles · viernes cena: pizza' })
  })

  it('un «no hay» o un desayuno añadido ya son semana tipo', () => {
    expect(weekTypeConfigured(week((d) => { d[6].dinner = { off: true } }))).toBe(true)
    const breakfast = week((d) => { for (const day of d) day.breakfast = {} })
    expect(weekTypeConfigured(breakfast)).toBe(true)
    expect(weekTypeSummary(breakfast)).toEqual({ meals: 'Desayuno, comida y cena', dishes: null })
  })

  it('juntos, cada N semanas, una receta y más de tres grupos', () => {
    const many = week((d) => {
      d[0].lunch = { options: [{ kind: 'type', type: 'pasta' }, { kind: 'type', type: 'ensaladas' }], together: true }
      d[1].lunch = { options: [{ kind: 'type', type: 'pizza' }, { kind: 'any' }] }
      d[2].dinner = { options: [{ kind: 'recipe', recipeId: 'r1', name: 'Tortilla de patatas' }] }
      d[3].lunch = { options: [{ kind: 'taper' }] }
    })
    expect(weekTypeSummary(many).dishes).toBe('pasta + ensaladas lunes · pizza cada 2 semanas martes · miércoles cena: Tortilla de patatas · y 1 más')
  })
})

describe('«Añadir plato»', () => {
  it('elegir primero y «Que elija Mimoia» la última', () => {
    expect(ADD_DISH_OPTIONS.map((o) => o.label)).toEqual(['Elegir del catálogo', 'Escribir un plato', 'Que elija Mimoia'])
  })

  it('la hoja sigue ese orden, sin «Mimoia sugiere» ni destellos', () => {
    const sheet = source('components/menu/AddDishSheet.tsx')
    expect(sheet).toContain('ADD_DISH_OPTIONS.map')
    expect(sheet).not.toContain('Mimoia sugiere')
    expect(sheet).not.toContain('Sparkles')
  })
})

describe('la pantalla', () => {
  it('la semana en blanco no dice «Generar mi menú» ni lleva destellos', () => {
    const page = source('app/menu/page.tsx')
    expect(page).toContain('{blankCopy.primary}')
    expect(page).toContain('Primero, cuéntame cómo coméis')
    expect(page).not.toMatch(/>\s*Generar mi menú/)
    expect(page).not.toContain('Sparkles')
  })

  it('«Cambiar algo» del piloto abre su semana, no Mimo', () => {
    const card = source('components/menu/AutoplanCard.tsx')
    expect(card).toContain('onOpenWeek(kept.weekStart)')
    expect(card).not.toContain('useMimo')
    expect(card).toContain('Hecha con tu semana tipo')
  })
})
