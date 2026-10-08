/**
 * "Pásalo" (audit §4): a share must be able to bring another household — a
 * link that opens without an account and says what Mimoia is.
 */
import { describe, expect, it } from 'vitest'
import { menuShareText, recipeSharePayload, withOnaFooter } from '@ona/shared'

const ORIGIN = 'https://ona.example/'

describe('recipeSharePayload', () => {
  it('catalogue recipes share their public page (no account needed)', () => {
    const p = recipeSharePayload({ id: 'r1', name: 'Lentejas', authorId: null }, ORIGIN)
    expect(p.url).toBe('https://ona.example/recipes-ona/r1?ref=receta')
    expect(p.text).toContain('receta de Mimoia')
    expect(p.text).not.toMatch(/\bONA\b/)
  })

  it('private recipes go as text with the ingredients and a link to Mimoia (their page is private)', () => {
    const p = recipeSharePayload(
      {
        id: 'r2',
        name: 'Fabada de mi madre',
        authorId: 'u1',
        ingredients: [
          { ingredientName: 'alubias', quantity: 500, unit: 'g' },
          { ingredientName: 'sal', quantity: 0, unit: 'al_gusto' },
        ],
      },
      ORIGIN,
    )
    expect(p.url).toBeUndefined()
    expect(p.text).toContain('- alubias (500 g)')
    expect(p.text).toContain('- sal\n')
    expect(p.text).toContain('La organizo con Mimoia, mi menú semanal: https://ona.example/?ref=receta')
    expect(p.text).not.toContain('/recipes/r2')
  })
})

describe('menuShareText', () => {
  it('one line per meal, notes included, empty days skipped, Mimoia footer', () => {
    const text = menuShareText(
      [
        { lunch: { dishes: [{ kind: 'recipe', recipeName: 'Lentejas' }, { kind: 'recipe', recipeName: 'Ensalada' }] } },
        {},
        { dinner: { dishes: [{ kind: 'note', text: 'Cenamos fuera' }] } },
      ],
      ORIGIN,
    )
    expect(text).toContain('*Lunes*\n- comida: Lentejas · Ensalada')
    expect(text).not.toContain('Martes')
    expect(text).toContain('*Miércoles*\n- cena: Cenamos fuera')
    expect(text).toContain('https://ona.example/?ref=menu')
  })

  it('withOnaFooter appends the link once', () => {
    expect(withOnaFooter('Lista\n\n', ORIGIN, 'lista')).toMatch(/^Lista\n\n— Hecho con Mimoia,.*\/\?ref=lista$/)
  })
})
