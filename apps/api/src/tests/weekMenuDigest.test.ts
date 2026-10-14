/**
 * The compact week summary WhatsApp appends after generating the menu
 * (Miguel, 2026-10-08: "la respuesta debería incluir un resumen del menú para
 * poder iterar desde WhatsApp sin navegar").
 */
import { describe, it, expect } from 'vitest'
import { weekMenuDigest, weekRangeEs, MENU_DIGEST_INVITE } from '../services/menuText.js'

const r = (recipeName: string) => ({ kind: 'recipe' as const, recipeId: recipeName, recipeName })
const slot = (...dishes: any[]) => ({ dishes })

describe('weekRangeEs', () => {
  it('names one month when the week stays inside it', () => {
    expect(weekRangeEs('2026-10-12')).toBe('del 12 al 18 de octubre')
  })
  it('names both months when the week crosses one', () => {
    expect(weekRangeEs('2026-09-28')).toBe('del 28 de septiembre al 4 de octubre')
  })
})

describe('weekMenuDigest', () => {
  const days: any[] = [
    { lunch: slot(r('Lentejas estofadas')), dinner: slot(r('Crema de calabaza')) },
    { lunch: slot(r('Dorada a la marsellesa'), r('Ensalada verde')), dinner: slot({ kind: 'note', text: 'Cenamos fuera' }) },
    { lunch: slot(r('Arroz al caldero')) },
    { lunch: slot(r('Garbanzos con espinacas')), dinner: slot(r('Tortilla de patata')) },
    {},
    { lunch: slot(r('Paella')), dinner: slot(r('Pizza casera')) },
    { lunch: slot(r('Cocido')), dinner: slot(r('Sopa juliana')) },
  ]
  const text = weekMenuDigest({ weekStart: '2026-10-12', days, skippedDays: [4] })
  const lines = text.split('\n')

  it('opens with the week and the meals planned, in order', () => {
    expect(lines[0]).toBe('*Tu semana del 12 al 18 de octubre* (comida · cena)')
  })
  it('one line per day: meals in header order, multi-dish with " + ", notes as written, "—" for a missing meal', () => {
    expect(lines[1]).toBe('*Lun* Lentejas estofadas · Crema de calabaza')
    expect(lines[2]).toBe('*Mar* Dorada a la marsellesa + Ensalada verde · Cenamos fuera')
    expect(lines[3]).toBe('*Mié* Arroz al caldero · —')
  })
  it('marks a skipped day', () => {
    expect(lines[5]).toBe('*Vie* sin cocinar')
  })
  it('lists all seven days and ends inviting changes in the chat', () => {
    expect(lines.filter((l) => /^\*(Lun|Mar|Mié|Jue|Vie|Sáb|Dom)\*/.test(l))).toHaveLength(7)
    expect(lines.at(-1)).toBe(MENU_DIGEST_INVITE)
  })
  it('stays short enough for one WhatsApp message', () => {
    expect(text.length).toBeLessThan(1200)
  })
})

describe('weekMenuDigest with links (PRO-85)', () => {
  const days: any[] = [
    { lunch: slot(r('Lentejas estofadas')), dinner: slot(r('Crema de calabaza')) },
    { lunch: slot(r('Dorada'), r('Ensalada verde')), dinner: slot({ kind: 'note', text: 'Cenamos fuera' }) },
    { lunch: slot({ ...r('Lentejas estofadas'), variant: 'leftover' }) },
    {}, {}, {}, {},
  ]
  const text = weekMenuDigest({ weekStart: '2026-10-12', days }, 'https://mimoia.com')
  const lines = text.split('\n')

  it('each recipe gets its short link under its day, in menu order', () => {
    expect(lines.slice(1, 4)).toEqual([
      '*Lun* Lentejas estofadas · Crema de calabaza',
      '→ Lentejas estofadas: mimoia.com/recipes/Lentejas estofadas',
      '→ Crema de calabaza: mimoia.com/recipes/Crema de calabaza',
    ])
    expect(lines.slice(4, 7)).toEqual([
      '*Mar* Dorada + Ensalada verde · Cenamos fuera',
      '→ Dorada: mimoia.com/recipes/Dorada',
      '→ Ensalada verde: mimoia.com/recipes/Ensalada verde',
    ])
  })
  it('notes never get a link; leftovers link to their recipe', () => {
    expect(text).not.toContain('Cenamos fuera:')
    expect(lines[7]).toBe('*Mié* Lentejas estofadas (sobras) · —')
    expect(lines[8]).toBe('→ Lentejas estofadas: mimoia.com/recipes/Lentejas estofadas')
  })
  it('without a web URL the digest has no links (unchanged)', () => {
    expect(weekMenuDigest({ weekStart: '2026-10-12', days })).not.toContain('/recipes/')
  })
})
