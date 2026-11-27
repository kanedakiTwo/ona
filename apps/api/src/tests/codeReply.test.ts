/**
 * PRO-1292: what the code answers without the model — the menu read
 * («¿qué hay hoy?», «mándame el menú») and the cook mode's «siguiente» —
 * and what still goes to the model (anything more than that).
 */
import { describe, it, expect, vi } from 'vitest'
import type { DayMenu } from '@ona/shared'
import {
  cookStepReply,
  dayMenuReply,
  listCodeReply,
  menuCodeReply,
  recognizeCodeIntent,
  stepCodeReply,
  weekMenuReply,
} from '../services/assistant/codeReply.js'
import { traceLine } from '../services/whatsapp/history.js'

const recipe = (name: string, id = name) => ({ kind: 'recipe' as const, recipeId: id, recipeName: name })
const day = (lunch?: string, dinner?: string): DayMenu =>
  ({
    ...(lunch ? { lunch: { dishes: [recipe(lunch)] } } : {}),
    ...(dinner ? { dinner: { dishes: [recipe(dinner)] } } : {}),
  }) as unknown as DayMenu

// Tuesday 24 Nov 2026, 13:00 in Madrid.
const NOW = new Date('2026-11-24T12:00:00Z')

describe('recognizeCodeIntent: el menú', () => {
  it.each([
    ['¿Qué hay hoy?', 'hoy', null],
    ['qué hay hoy', 'hoy', null],
    ['¿Qué toca hoy?', 'hoy', null],
    ['¿qué cenamos mañana?', 'mañana', 'dinner'],
    ['Qué comemos hoy', 'hoy', 'lunch'],
    ['¿Qué cenamos?', 'hoy', 'dinner'],
    ['¿qué hay de cena hoy?', 'hoy', 'dinner'],
    ['¿Qué hay hoy para cenar?', 'hoy', 'dinner'],
    ['¿Qué hay para comer mañana?', 'mañana', 'lunch'],
    ['y mañana qué hay?', 'mañana', null],
    ['Hoy qué comemos', 'hoy', 'lunch'],
    ['¿Qué hay el jueves?', 'el jueves', null],
    ['Qué toca el sábado', 'el sabado', null],
    ['Menú de hoy', 'hoy', null],
    ['el menú del jueves', 'el jueves', null],
    ['Dime el menú de mañana, porfa', 'mañana', null],
    ['Hola Mimo, ¿qué hay hoy?', 'hoy', null],
    ['¿qué cenamos esta noche?', 'hoy', 'dinner'],
  ])('«%s» → el menú de un día (%s, %s)', (text, dayWords, meal) => {
    expect(recognizeCodeIntent(text)).toEqual({ kind: 'ver_menu', scope: 'day', day: dayWords, meal })
  })

  it.each([
    'mándame el menú',
    'Mándame el menú de la semana',
    'Ver el menú',
    'menú',
    'pásame el menú semanal',
    '¿Me pasas el menú?',
    '¿Qué comemos esta semana?',
  ])('«%s» → la semana', (text) => {
    expect(recognizeCodeIntent(text)).toEqual({ kind: 'ver_menu', scope: 'week', nextWeek: false })
  })

  it.each(['el menú de la semana que viene', '¿qué hay la semana que viene?', 'mándame el menú de la próxima semana'])(
    '«%s» → la semana que viene',
    (text) => {
      expect(recognizeCodeIntent(text)).toEqual({ kind: 'ver_menu', scope: 'week', nextWeek: true })
    },
  )

  it.each([
    '¿qué hay hoy? y cámbiame el jueves',
    '¿Qué hay hoy? Y apunta leche',
    'qué hay hoy\nquita la cena del viernes',
    '¿Qué hay?',
    'Hola, ¿qué tal?',
    '¿qué hay hoy que lleve pescado?',
    '¿por qué hay lentejas hoy?',
    'cámbiame el menú',
    'hazme el menú',
    'genera el menú de la semana',
    '¿qué cenamos mañana que sea rápido?',
    'el menú de hoy no me gusta',
    '¿Cuántas calorías tiene el menú de hoy?',
    'siguiente',
    'repite',
    '',
  ])('«%s» → al modelo', (text) => {
    expect(recognizeCodeIntent(text)).toBeNull()
  })
})

describe('recognizeCodeIntent: el modo cocina', () => {
  it.each([
    ['Siguiente', 'next'],
    ['siguiente paso', 'next'],
    ['Venga, siguiente.', 'next'],
    ['vale, el siguiente', 'next'],
    ['pasa al siguiente paso', 'next'],
    ['Anterior', 'previous'],
    ['vuelve al paso anterior', 'previous'],
    ['atrás', 'previous'],
    ['Repite', 'repeat'],
    ['¿me lo repites?', 'repeat'],
    ['repite el paso, porfa', 'repeat'],
  ])('«%s» → paso %s', (text, direction) => {
    expect(recognizeCodeIntent(text, { cooking: true })).toEqual({ kind: 'paso_cocina', direction })
  })

  it.each(['siguiente, ¿y cuánto tiempo lo dejo?', 'pon un temporizador de 5 minutos', '¿cuánto falta?', '¿y si no tengo nata?', 'siguiente receta'])(
    '«%s» → al modelo',
    (text) => {
      expect(recognizeCodeIntent(text, { cooking: true })).toBeNull()
    },
  )
})

describe('respuestas', () => {
  it('el día: una línea por comida, sin enlaces', () => {
    expect(dayMenuReply(day('Lentejas estofadas', 'Pollo al horno'), '2026-11-24', null, NOW)).toBe(
      'Hoy, martes 24:\n- Comida: Lentejas estofadas\n- Cena: Pollo al horno',
    )
    expect(dayMenuReply(day('Lentejas estofadas', 'Pollo al horno'), '2026-11-25', 'dinner', NOW)).toBe('Mañana, miércoles 25:\n- Cena: Pollo al horno')
    expect(dayMenuReply(day('Lentejas estofadas', 'Pollo al horno'), '2026-11-26', null, NOW)).toBe(
      'El jueves 26:\n- Comida: Lentejas estofadas\n- Cena: Pollo al horno',
    )
    // The meal asked isn't planned: the whole day.
    expect(dayMenuReply(day('Lentejas estofadas'), '2026-11-24', 'dinner', NOW)).toBe('Hoy, martes 24:\n- Comida: Lentejas estofadas')
    expect(dayMenuReply(day(), '2026-11-24', null, NOW)).toBeNull()
  })

  it('la semana: los huecos se dicen', () => {
    const days = [day('Lentejas', 'Pollo'), day('Arroz'), day(), day(), day(), day(undefined, 'Pizza'), day()]
    expect(weekMenuReply('2026-11-23', days, [6])).toBe(
      [
        'Menú de la semana, del 23 al 29 de noviembre:',
        '- Lunes 23: comida, Lentejas; cena, Pollo',
        '- Martes 24: comida, Arroz',
        '- Miércoles 25: sin planificar',
        '- Jueves 26: sin planificar',
        '- Viernes 27: sin planificar',
        '- Sábado 28: cena, Pizza',
        '- Domingo 29: sin cocinar',
      ].join('\n'),
    )
    expect(weekMenuReply('2026-11-23', [day(), day()], [])).toBeNull()
  })

  it('el paso: el siguiente, el anterior, el mismo; en los bordes no se mueve', () => {
    const steps = ['Lava las alubias.', 'Pocha 150 g de cebolla y dos dientes de ajo.', 'Añade el caldo.']
    expect(cookStepReply(steps, { step: 1, total: 3 }, 'next')).toEqual({ message: 'Paso 2 de 3: Pocha 150 g de cebolla y dos dientes de ajo.', direction: 'next' })
    expect(cookStepReply(steps, { step: 2, total: 3 }, 'next')).toEqual({ message: 'Paso 3, el último: Añade el caldo.', direction: 'next' })
    expect(cookStepReply(steps, { step: 3, total: 3 }, 'next')).toEqual({ message: 'Ya estás en el último paso. Añade el caldo.', direction: 'repeat' })
    expect(cookStepReply(steps, { step: 2, total: 3 }, 'previous')).toEqual({ message: 'Paso 1 de 3: Lava las alubias.', direction: 'previous' })
    expect(cookStepReply(steps, { step: 1, total: 3 }, 'previous')).toEqual({ message: 'Ya estás en el primer paso. Lava las alubias.', direction: 'repeat' })
    expect(cookStepReply(steps, { step: 2, total: 3 }, 'repeat')?.message).toBe('Paso 2 de 3: Pocha 150 g de cebolla y dos dientes de ajo.')
    expect(cookStepReply([], { step: 1, total: 1 }, 'next')).toBeNull()
    expect(cookStepReply(steps, { step: 5, total: 5 }, 'next')).toBeNull()
  })

  it('el paso lleva la misma pista que la herramienta cooking_step, y su rastro', () => {
    const r = stepCodeReply(['Uno.', 'Dos.'], { step: 1, total: 2 }, 'next')!
    expect(r.uiHint).toBe('cooking_step')
    expect(r.data).toEqual({ direction: 'next' })
    expect(r.toolsUsed).toEqual(['cooking_step'])
    expect(r.actionTaken).toBe(false)
  })
})

describe('menuCodeReply: lee con las herramientas del modelo', () => {
  const ctx = { userId: 'u-1', db: {} }

  it('un día: get_todays_menu con las palabras del día, y el rastro para ⟦hecho: …⟧', async () => {
    const runSkill = vi.fn(async () => ({
      data: { date: '2026-11-25', weekStart: '2026-11-23', menuId: 'm-1', day: day('Lentejas', 'Pollo') },
      summary: 'Menu del miércoles 25 de noviembre: comida: Lentejas; cena: Pollo',
      uiHint: 'menu' as const,
    }))
    const r = await menuCodeReply({ kind: 'ver_menu', scope: 'day', day: 'mañana', meal: 'dinner' }, ctx, { runSkill, now: NOW })
    expect(runSkill).toHaveBeenCalledWith('get_todays_menu', { day: 'mañana' }, ctx)
    expect(r?.message).toBe('Mañana, miércoles 25:\n- Cena: Pollo')
    expect(r?.uiHint).toBe('menu')
    expect(r?.toolsUsed).toEqual(['get_todays_menu'])
    expect(traceLine({ toolTrace: r?.toolTrace })).toBe(
      '⟦hecho: get_todays_menu {"day":"mañana"} → Menu del miércoles 25 de noviembre: comida: Lentejas; cena: Pollo⟧',
    )
  })

  it('la semana: get_weekly_menu, con los datos que WhatsApp convierte en la imagen', async () => {
    const days = [day('Lentejas', 'Pollo'), day(), day(), day(), day(), day(), day()]
    const runSkill = vi.fn(async () => ({ data: { menuId: 'm-1', weekStart: '2026-11-30', days, skippedDays: [] }, summary: 'Menu de la semana…', uiHint: 'menu' as const }))
    const r = await menuCodeReply({ kind: 'ver_menu', scope: 'week', nextWeek: true }, ctx, { runSkill, now: NOW })
    expect(runSkill).toHaveBeenCalledWith('get_weekly_menu', { nextWeek: true }, ctx)
    expect(r?.toolsUsed).toEqual(['get_weekly_menu'])
    expect(r?.data).toMatchObject({ menuId: 'm-1' })
    expect(r?.message.split('\n')[0]).toBe('Menú de la semana, del 30 de noviembre al 6 de diciembre:')
  })

  it('sin menú o con el día vacío: null, y contesta el modelo como antes', async () => {
    const none = vi.fn(async () => ({ data: null, summary: 'No hay menu para la semana del lunes 23 de noviembre.', uiHint: 'text' as const }))
    expect(await menuCodeReply({ kind: 'ver_menu', scope: 'day', day: 'hoy', meal: null }, ctx, { runSkill: none, now: NOW })).toBeNull()
    expect(await menuCodeReply({ kind: 'ver_menu', scope: 'week', nextWeek: false }, ctx, { runSkill: none, now: NOW })).toBeNull()
    const empty = vi.fn(async () => ({ data: { date: '2026-11-24', day: day() }, summary: 'No hay comidas planificadas', uiHint: 'menu' as const }))
    expect(await menuCodeReply({ kind: 'ver_menu', scope: 'day', day: 'hoy', meal: null }, ctx, { runSkill: empty, now: NOW })).toBeNull()
  })
})

describe('mimo_code_reply en /admin/usage', () => {
  it('es un evento de uso y se desglosa por kind', async () => {
    const { USAGE_EVENTS, sanitizeProps } = await import('../services/usageEvents.js')
    const { BREAKDOWN_EVENTS, USAGE_DEFINITIONS } = await import('../services/usageReport.js')
    expect(USAGE_EVENTS).toContain('mimo_code_reply')
    expect(BREAKDOWN_EVENTS).toContain('mimo_code_reply')
    expect(USAGE_DEFINITIONS.breakdown).toContain('mimo_code_reply')
    expect(sanitizeProps({ kind: 'ver_menu' })).toEqual({ kind: 'ver_menu' })
    expect(sanitizeProps({ kind: 'paso_cocina' })).toEqual({ kind: 'paso_cocina' })
  })
})

describe('PRO-1302: la lista de la compra la lee el código', () => {
  it('reconoce la lista cuando el mensaje es solo eso', () => {
    for (const t of [
      'la lista',
      'La lista de la compra',
      'Mándame la lista de la compra, porfa',
      'pásame la lista',
      'Hola Mimo, ¿me pasas la lista?',
      '¿Qué me falta por comprar?',
      '¿qué tengo que comprar?',
      'hazme la lista de la compra',
    ]) {
      expect(recognizeCodeIntent(t), t).toEqual({ kind: 'ver_lista' })
    }
    for (const t of ['añade leche a la lista', 'quita el pan de la lista', 'la lista y el menú del jueves', '¿qué me falta para la tortilla?']) {
      expect(recognizeCodeIntent(t), t).toBeNull()
    }
  })

  it('listCodeReply: get_shopping_list; en la app su resumen, en WhatsApp sin palabras (la lista va debajo)', async () => {
    const runSkill = vi.fn(async () => ({ data: { listId: 'l', items: [{ name: 'Leche', aisle: 'lacteos' }] }, summary: 'Te faltan 1 cosas: Leche.', uiHint: 'shopping_list' as const }))
    const app = await listCodeReply({ userId: 'u', db: {}, channel: 'text' }, { runSkill })
    expect(app).toMatchObject({ message: 'Te faltan 1 cosas: Leche.', uiHint: 'shopping_list', toolsUsed: ['get_shopping_list'] })
    expect(runSkill).toHaveBeenCalledWith('get_shopping_list', {}, expect.objectContaining({ userId: 'u' }))
    const wa = await listCodeReply({ userId: 'u', db: {}, channel: 'whatsapp' }, { runSkill })
    expect(wa?.message).toBe('')
    expect(wa?.toolTrace?.[0]).toMatchObject({ name: 'get_shopping_list', summary: 'Te faltan 1 cosas: Leche.' })
  })

  it('la lista vacía: null, y contesta el modelo (puede ofrecer hacerla)', async () => {
    const runSkill = async () => ({ data: { listId: 'l', items: [] }, summary: 'La lista de la compra está vacía', uiHint: 'shopping_list' as const })
    expect(await listCodeReply({ userId: 'u', db: {} }, { runSkill })).toBeNull()
  })
})
