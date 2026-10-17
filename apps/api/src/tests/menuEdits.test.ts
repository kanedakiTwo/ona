/**
 * PRO-149 · Registro de cambios del menú: the pure helpers that turn a
 * route's before/after into rows, and who made the change (the user in the
 * app or Mimo over loopback, with its channel). Route-level coverage against a
 * real API + Postgres lives in menuEditsRoute.smoke.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Dish } from '@ona/shared'
import {
  CHANNEL_HEADER,
  menuEditRows,
  menuEditWho,
  moveChanges,
  slotDiff,
  slotRemoved,
} from '../services/menuEdits.js'
import { INTERNAL_CALL_HEADER } from '../services/usageEvents.js'
import { appApiFor } from '../services/assistant/appApi.js'

const r = (id: string, name = id): Dish => ({ kind: 'recipe', recipeId: id, recipeName: name, course: null })
const note = (text: string): Dish => ({ kind: 'note', text }) as Dish
const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] })

describe('menuEditWho', () => {
  it('a normal request is the user on the web', () => {
    expect(menuEditWho(headers({}))).toEqual({ actor: 'user', channel: 'web' })
  })
  it('a loopback call is Mimo, with the conversation channel', () => {
    expect(menuEditWho(headers({ [INTERNAL_CALL_HEADER]: '1', [CHANNEL_HEADER]: 'whatsapp' }))).toEqual({ actor: 'mimo', channel: 'whatsapp' })
    expect(menuEditWho(headers({ [INTERNAL_CALL_HEADER]: '1' }))).toEqual({ actor: 'mimo', channel: 'web' })
  })
  it('the channel header alone does not make it Mimo', () => {
    expect(menuEditWho(headers({ [CHANNEL_HEADER]: 'whatsapp' }))).toEqual({ actor: 'user', channel: 'web' })
  })
})

describe('slotDiff', () => {
  it('a different recipe in the same position is a swap with before and after', () => {
    expect(slotDiff(2, 'dinner', [r('a', 'Ceviche')], [r('b', 'Tortilla')])).toEqual([
      { action: 'swap', day: 2, meal: 'dinner', before: { id: 'a', name: 'Ceviche' }, after: { id: 'b', name: 'Tortilla' } },
    ])
  })
  it('unchanged positions and notes leave no row', () => {
    expect(slotDiff(0, 'lunch', [r('a'), note('fuera')], [r('a'), note('fuera')])).toEqual([])
  })
  it('a recipe in an empty slot is an add; one that disappears is a remove', () => {
    expect(slotDiff(1, 'lunch', [], [r('b')])).toEqual([{ action: 'add', day: 1, meal: 'lunch', after: { id: 'b', name: 'b' } }])
    expect(slotDiff(1, 'lunch', [r('a')], [note('x')])).toEqual([{ action: 'remove', day: 1, meal: 'lunch', before: { id: 'a', name: 'a' } }])
  })
})

describe('slotRemoved / moveChanges', () => {
  it('one row per recipe removed, notes skipped', () => {
    expect(slotRemoved('skip_day', 4, 'dinner', { dishes: [r('a'), note('n'), r('b')] })).toEqual([
      { action: 'skip_day', day: 4, meal: 'dinner', before: { id: 'a', name: 'a' } },
      { action: 'skip_day', day: 4, meal: 'dinner', before: { id: 'b', name: 'b' } },
    ])
  })
  it('moving to an empty slot gives one row from origin to target', () => {
    expect(moveChanges({ day: 0, meal: 'lunch', slot: { dishes: [r('a')] } }, { day: 3, meal: 'dinner', slot: undefined })).toEqual([
      { action: 'move', day: 3, meal: 'dinner', fromDay: 0, fromMeal: 'lunch', after: { id: 'a', name: 'a' } },
    ])
  })
  it('swapping two full slots gives rows in both directions', () => {
    const rows = moveChanges({ day: 0, meal: 'lunch', slot: { dishes: [r('a')] } }, { day: 3, meal: 'dinner', slot: { dishes: [r('b')] } })
    expect(rows.map((x) => [x.after?.id, x.fromDay, x.day])).toEqual([['a', 0, 3], ['b', 3, 0]])
  })
})

describe('menuEditRows', () => {
  it('carries menu, household, who and recipes', () => {
    const [row] = menuEditRows({ id: 'm', householdId: 'h' }, 'u', { actor: 'mimo', channel: 'whatsapp' }, [
      { action: 'ban', before: { id: 'a', name: 'Ceviche' } },
    ])
    expect(row).toEqual({
      householdId: 'h', menuId: 'm', userId: 'u', day: null, meal: null, fromDay: null, fromMeal: null,
      action: 'ban', beforeRecipeId: 'a', beforeRecipeName: 'Ceviche', afterRecipeId: null, afterRecipeName: null,
      actor: 'mimo', channel: 'whatsapp',
    })
  })
})

describe('appApiFor sends the conversation channel', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('loopback calls carry the internal header and the channel', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await appApiFor('00000000-0000-0000-0000-000000000001', { channel: 'whatsapp' })('POST', '/menu/x/ban', {})
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    const h = init.headers as Record<string, string>
    expect(h[INTERNAL_CALL_HEADER]).toBe('1')
    expect(h[CHANNEL_HEADER]).toBe('whatsapp')
  })
})
