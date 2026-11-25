/**
 * PRO-402 — the day-before waits are not cooking time (recipeWaitTime.ts).
 */
import { describe, expect, it } from 'vitest'
import { advancePrepLabel } from '@ona/shared'
import { advancePrepText, isDayBeforeWait, splitDayBeforeWaits } from '../services/recipeWaitTime.js'
import { isDayBeforeStep } from '../services/recipeTimeTrim.js'

const soak = { text: 'Ponemos los garbanzos en remojo con agua fría. Al día siguiente los escurrimos.', durationMin: 720, technique: null }
const hummusSteps = [
  soak,
  { text: 'Cocemos los garbanzos con el bicarbonato hasta que estén muy tiernos.', durationMin: 40, technique: 'hervir' },
  { text: 'Doramos el cordero con las especias.', durationMin: 15, technique: 'saltear' },
]

describe('isDayBeforeWait', () => {
  it('a soak, a marinade or a night in the fridge of 6 h or more', () => {
    expect(isDayBeforeWait(soak)).toBe(true)
    expect(isDayBeforeWait({ text: 'Marinamos la carne con el adobo.', durationMin: 720 })).toBe(true)
    expect(isDayBeforeWait({ text: 'Dejamos la masa en la nevera, tapada.', durationMin: 1440 })).toBe(true)
    expect(isDayBeforeWait({ text: 'Remojar las setas 12 horas.' })).toBe(true)
  })

  it('a wait that says «la víspera», whatever it lasts', () => {
    expect(isDayBeforeWait({ text: 'La víspera, humedecemos el pan y lo dejamos reposar tapado.', durationMin: 30 })).toBe(true)
  })

  it('not a short same-day wait, nor a long oven or pot, nor a step without minutes', () => {
    expect(isDayBeforeWait({ text: 'Ponemos los palillos a remojo.', durationMin: 30 })).toBe(false)
    expect(isDayBeforeWait({ text: 'Dejamos levar la masa.', durationMin: 90 })).toBe(false)
    expect(isDayBeforeWait({ text: 'Horneamos la pierna a 150 °C.', durationMin: 270 })).toBe(false)
    expect(isDayBeforeWait({ text: 'Cocemos a fuego lento el caldo.', durationMin: 400 })).toBe(false)
    expect(isDayBeforeWait({ text: 'Ponemos los garbanzos en remojo la víspera.' })).toBe(false)
  })

  it('the total rule (PRO-284) never counts them either', () => {
    for (const s of [soak, { text: 'Marinamos la carne.', durationMin: 720 }, { text: 'En la nevera toda la noche.', durationMin: 480 }]) {
      expect(isDayBeforeWait(s)).toBe(true)
      expect(isDayBeforeStep(s)).toBe(true)
    }
  })
})

describe('splitDayBeforeWaits', () => {
  it('a 12 h soak counted as cooking comes out of the cook time and becomes «la víspera»', () => {
    const out = splitDayBeforeWaits({ prepTime: 40, cookTime: 775 }, hummusSteps)
    expect(out.cookTime).toBe(55)
    expect(out.prepTime).toBe(40)
    expect(out.waitMinutes).toBe(720)
    expect(out.advancePrep).toEqual([{ text: 'Ponemos los garbanzos en remojo con agua fría', hoursBefore: 14 }])
  })

  it('out of the prep time when that is where the source put it', () => {
    const out = splitDayBeforeWaits({ prepTime: 750, cookTime: 30 }, [{ text: 'Marinamos el magret toda la noche.', durationMin: 720 }])
    expect(out).toMatchObject({ prepTime: 30, cookTime: 30, waitMinutes: 720 })
  })

  it('times that never held the wait stay as they are', () => {
    const out = splitDayBeforeWaits({ prepTime: 40, cookTime: 55 }, hummusSteps)
    expect(out).toMatchObject({ prepTime: 40, cookTime: 55, waitMinutes: 720 })
    expect(out.advancePrep).toHaveLength(1)
  })

  it('a recipe without day-before waits is untouched', () => {
    expect(splitDayBeforeWaits({ prepTime: 10, cookTime: 20 }, hummusSteps.slice(1))).toEqual({ prepTime: 10, cookTime: 20, waitMinutes: 0, advancePrep: [] })
  })
})

describe('advancePrepText', () => {
  it('the first sentence, capitalised, never over 140 characters', () => {
    expect(advancePrepText('poner las fabes a remojo; cambiar el agua una vez')).toBe('Poner las fabes a remojo')
    const long = advancePrepText(`Marinamos ${'la carne con mucho cariño '.repeat(10)}`)
    expect(long.length).toBeLessThanOrEqual(140)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('advancePrepLabel (the ficha)', () => {
  it('«La víspera» from 8 h before; less, the hours', () => {
    expect(advancePrepLabel({ text: 'Pon los garbanzos en remojo', hoursBefore: 14 })).toBe('La víspera: pon los garbanzos en remojo')
    expect(advancePrepLabel({ text: 'Saca el filete del frigorífico', hoursBefore: 1.5 })).toBe('1,5 h antes: saca el filete del frigorífico')
  })
})
