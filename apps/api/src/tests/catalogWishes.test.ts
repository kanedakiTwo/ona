/**
 * PRO-154 — «deseos del catálogo», photos on demand and drafts hidden
 * (specs/catalog-import.md).
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  catalogCoversDish,
  dishKey,
  recordCatalogWish,
  recordWishesFromFavoriteDishes,
  uncoveredDishes,
  type CatalogWishStore,
} from '../services/catalogWishes.js'
import { _resetRequestedPhotos, recipesNeedingPhoto, requestCatalogPhotos } from '../services/catalogImageOnDemand.js'
import { filterVisible, isHiddenDraft } from '../services/recipeVisibility.js'

/** In-memory store with the same rules as the table: one wish per key, one vote per household and source. */
function memoryStore() {
  const wishes = new Map<string, { id: string; dish: string }>()
  const votes = new Set<string>()
  const store: CatalogWishStore = {
    async upsert(i) {
      let w = wishes.get(i.dishKey)
      const created = !w
      if (!w) {
        w = { id: `w${wishes.size + 1}`, dish: i.dish }
        wishes.set(i.dishKey, w)
      }
      votes.add(`${w.id}|${i.voterKey}|${i.source}`)
      const households = new Set([...votes].filter((v) => v.startsWith(`${w!.id}|`)).map((v) => v.split('|')[1])).size
      return { wishId: w.id, created, households }
    },
  }
  return { store, wishes }
}

// The case in D-065: what a beta household said it loves, against a catalogue with cremas but no carbonara.
const CATALOG = ['Crema de calabaza', 'Sopa de picadillo', 'Menestra de verduras con carne', 'Curry de patatas y guisantes', 'Espaguetis a la boloñesa']

describe('what the catalogue covers', () => {
  it('a dish is covered only when one recipe has all its words', () => {
    expect(catalogCoversDish('carbonara', [...CATALOG, 'Espaguetis a la carbonara'])).toBe(true)
    expect(catalogCoversDish('pastel de carne', CATALOG)).toBe(false) // «carne» alone is not enough
    expect(catalogCoversDish('cremas y sopas', CATALOG)).toBe(true) // either one
    expect(catalogCoversDish('Crema de calabaza', CATALOG)).toBe(true)
  })

  it('the D-065 favourites → wishes for the ones we lack', () => {
    const fav = ['cremas y sopas', 'carbonara', 'pastel de carne con puré', 'rodaballo al horno', 'croquetas de cocido', 'buñuelos de bacalao', 'chuletón', 'Carbonara ']
    expect(uncoveredDishes(fav, CATALOG)).toEqual(['carbonara', 'pastel de carne con puré', 'rodaballo al horno', 'croquetas de cocido', 'buñuelos de bacalao', 'chuletón'])
  })

  it('one key per dish whatever the accents, plurals or order', () => {
    expect(dishKey('Croquetas de cocido')).toBe(dishKey('croqueta  del COCIDO'))
    expect(dishKey('Buñuelos de bacalao')).toBe(dishKey('bacalao, buñuelo'))
    expect(dishKey('de la')).toBe('')
  })
})

describe('recordCatalogWish', () => {
  it('a request with no recipe creates the wish, another household adds to it, the same one does not', async () => {
    const { store } = memoryStore()
    const householdOf = async (u: string) => ({ u1: 'h1', u2: 'h1', u3: 'h2' } as Record<string, string>)[u] ?? null
    const a = await recordCatalogWish({ dish: 'Rodaballo al horno', source: 'alta', userId: 'u1' }, { store, householdOf })
    expect(a).toMatchObject({ created: true, households: 1 })
    const b = await recordCatalogWish({ dish: 'rodaballo al HORNO', source: 'alta', userId: 'u2' }, { store, householdOf })
    expect(b).toMatchObject({ wishId: a!.wishId, created: false, households: 1 })
    const c = await recordCatalogWish({ dish: 'Rodaballo al horno', source: 'evaluador', userId: 'u3' }, { store, householdOf })
    expect(c).toMatchObject({ wishId: a!.wishId, households: 2 })
    // No household: the user counts as one.
    const d = await recordCatalogWish({ dish: 'Rodaballo al horno', source: 'mimo', userId: 'solo' }, { store, householdOf })
    expect(d!.households).toBe(3)
    expect(await recordCatalogWish({ dish: '  de  ', source: 'mimo', userId: 'u1' }, { store, householdOf })).toBeNull()
  })

  it('sign-up favourites record only what the catalogue lacks, and never throw', async () => {
    const recorded: string[] = []
    const missing = await recordWishesFromFavoriteDishes('u1', ['carbonara', 'Crema de calabaza'], {
      catalogNames: async () => CATALOG,
      record: async (i) => {
        recorded.push(`${i.source}:${i.dish}`)
        return null
      },
    })
    expect(missing).toEqual(['carbonara'])
    expect(recorded).toEqual(['alta:carbonara'])
    const broken = await recordWishesFromFavoriteDishes('u1', ['carbonara'], { catalogNames: async () => { throw new Error('db caída') } })
    expect(broken).toEqual([])
  })
})

describe('photos on demand', () => {
  afterEach(() => _resetRequestedPhotos())

  it('only published catalogue recipes with no image, once each', () => {
    const rows = [
      { id: 'a', authorId: null, imageUrl: null },
      { id: 'b', authorId: null, imageUrl: '/images/recipes/b.jpg' },
      { id: 'c', authorId: 'u1', imageUrl: null },
      { id: 'd', authorId: null, imageUrl: null, status: 'draft' },
      { id: 'a', authorId: null, imageUrl: null },
    ]
    expect(recipesNeedingPhoto(rows, new Set())).toEqual(['a'])
    const asked: Array<[string, string | null]> = []
    const schedule = (id: string, author: string | null) => void asked.push([id, author])
    expect(requestCatalogPhotos(rows, schedule)).toEqual(['a'])
    // A second menu with the same recipe doesn't ask again.
    expect(requestCatalogPhotos(rows, schedule)).toEqual([])
    expect(asked).toEqual([['a', null]])
  })

  it('a scheduler failure never breaks the page', () => {
    expect(requestCatalogPhotos([{ id: 'z', authorId: null, imageUrl: null }], () => { throw new Error('boom') })).toEqual([])
  })
})

describe('drafts are hidden', () => {
  it('filterVisible drops drafts; only admins open one', () => {
    const rows = [
      { id: '1', authorId: null, status: 'published' },
      { id: '2', authorId: null, status: 'draft' },
      { id: '3', authorId: 'u1', status: 'published' },
    ]
    expect(filterVisible(rows, ['u1']).map((r) => r.id)).toEqual(['1', '3'])
    expect(isHiddenDraft({ status: 'draft' }, false)).toBe(true)
    expect(isHiddenDraft({ status: 'draft' }, true)).toBe(false)
    expect(isHiddenDraft({ status: 'published' }, false)).toBe(false)
  })
})
