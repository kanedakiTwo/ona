/**
 * "Pásalo" (audit §4): a share must be able to bring another household — a
 * link that opens without an account and says what Mimoia is.
 */
import { describe, expect, it } from 'vitest'
import { madeWithMimoLine, menuShareText, recipeSharePayload, shortInviteLink, withOnaFooter } from '@ona/shared'

const ORIGIN = 'https://ona.example/'

describe('recipeSharePayload', () => {
  it('catalogue recipes share the one recipe page (opens without an account)', () => {
    const p = recipeSharePayload({ id: 'r1', name: 'Lentejas', authorId: null }, ORIGIN)
    expect(p).toEqual({ title: 'Lentejas', url: 'https://ona.example/recipes/r1?ref=receta' })
  })

  it('catalogue recipes carry no text next to the link (some apps glue it into the URL)', () => {
    const p = recipeSharePayload({ id: 'r1', name: 'Pollo a la plancha', authorId: null }, ORIGIN)
    expect(p.text).toBeUndefined()
    expect(p.url).not.toContain('recipes-ona')
    expect(p.url).not.toMatch(/\s/)
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

describe('the household’s invitation at the foot (PRO-1016, D-132)', () => {
  it('short link: no scheme, no www, /i/<code>', () => {
    expect(shortInviteLink('https://www.mimoia.com/', 'abcd2345')).toBe('mimoia.com/i/abcd2345')
    expect(madeWithMimoLine('https://mimoia.com', 'abcd2345')).toBe('Hecho con Mimo · mimoia.com/i/abcd2345')
  })

  it('the shared list ends with «Hecho con Mimo · …/i/<code>» of the household that shares it', () => {
    const text = withOnaFooter('Lista de compra · Mimoia\n\n## Frutas\n- Cebolla: 300 g\n', 'https://mimoia.com', 'lista', 'abcd2345')
    expect(text).toBe('Lista de compra · Mimoia\n\n## Frutas\n- Cebolla: 300 g\n\nHecho con Mimo · mimoia.com/i/abcd2345')
    expect(text).not.toContain('?ref=lista')
  })

  it('a catalogue recipe carries the code in its link (no text next to the url)', () => {
    const p = recipeSharePayload({ id: 'r1', name: 'Lentejas', authorId: null }, ORIGIN, 'abcd2345')
    expect(p).toEqual({ title: 'Lentejas', url: 'https://ona.example/recipes/r1?ref=receta&invita=abcd2345' })
  })

  it('a private recipe ends with the household’s «Hecho con Mimo» line', () => {
    const p = recipeSharePayload({ id: 'r2', name: 'Fabada', authorId: 'u1', ingredients: [{ ingredientName: 'alubias', quantity: 500, unit: 'g' }] }, 'https://mimoia.com', 'abcd2345')
    expect(p.text).toBe('Fabada\n\nIngredientes:\n- alubias (500 g)\n\nHecho con Mimo · mimoia.com/i/abcd2345')
  })

  it('without a code (signed out, not loaded yet) the share is as before', () => {
    expect(recipeSharePayload({ id: 'r1', name: 'Lentejas', authorId: null }, ORIGIN, null).url).toBe('https://ona.example/recipes/r1?ref=receta')
    expect(withOnaFooter('Lista', ORIGIN, 'lista', undefined)).toContain('/?ref=lista')
  })
})
