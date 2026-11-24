// Mimo's pantry and shopping-list tools. Split out of skills.ts (PRO-400).
import { eq, desc } from 'drizzle-orm'
import { ingredients, shoppingLists } from '../../db/schema.js'
import { isPantryLocation } from '@ona/shared'
import { resolveScope, scopeWhere } from '../scopeResolver.js'
import { toBuyable } from './appSkills.js'
import { setHaveAtHome } from '../shoppingItemState.js'
import { convert as convertUnits } from '../shoppingList.js'
import { nameHasTerm, normalizeText } from '../dietaryRestrictions.js'
import { addPantryForUser, deletePantryForUser, listPantryForUser, NoHouseholdError, patchPantryForUser, type AddPantryInput } from '../pantryStore.js'
import { type SkillDefinition, type SkillContext } from './types.js'

// Helper: fuzzy-find an item in a shopping_lists.items array by ingredient name
function findShoppingItem(items: any[], query: string): any | null {
  const q = query.toLowerCase().trim()
  if (!q) return null
  const exact = items.find(i => String(i?.name ?? '').toLowerCase() === q)
  if (exact) return exact
  const includes = items.find(i => String(i?.name ?? '').toLowerCase().includes(q))
  if (includes) return includes
  const words = q.split(/\s+/).filter(w => w.length >= 3)
  for (const w of words) {
    const found = items.find(i => String(i?.name ?? '').toLowerCase().includes(w))
    if (found) return found
  }
  return null
}

// 1. ── get_pantry_stock ────────────────────────────────────
// One answer to "¿qué tengo en casa?": the real pantry (pantry_items, with
// quantities and expiry dates, what /pantry shows) plus anything marked "ya lo
// tengo" on this week's shopping list. Before 2026-10-07 it only read the list
// flags, so the pantry the user kept in the app was invisible to the assistant.
async function latestShoppingList(ctx: SkillContext) {
  const [list] = await ctx.db
    .select()
    .from(shoppingLists)
    .where(scopeWhere(shoppingLists.userId, shoppingLists.householdId, await resolveScope(ctx.userId, ctx.db)))
    .orderBy(desc(shoppingLists.createdAt))
    .limit(1)
  return list ?? null
}

export const getPantryStock: SkillDefinition = {
  name: 'get_pantry_stock',
  description: 'Lo que el usuario tiene en casa: su despensa (cantidades y caducidades) y lo marcado como "ya lo tengo" en la lista de la compra. Usala para "que tengo en la nevera/despensa", "que me caduca pronto".',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_params, ctx) {
    const pantry = await listPantryForUser(ctx.userId, ctx.db).catch(() => [])
    const list = await latestShoppingList(ctx)
    const inPantry = new Set(pantry.map((p) => normalizeText(p.name)))
    const fromList = ((list?.items as any[]) ?? []).filter((i) => i?.inStock && !inPantry.has(normalizeText(String(i.name ?? ''))))
    if (pantry.length === 0 && fromList.length === 0) {
      return {
        data: [],
        summary: list
          ? 'No tienes nada en la despensa ni marcado como "ya lo tengo" en la lista.'
          : 'Tu despensa esta vacia y aun no tienes lista de la compra.',
        uiHint: 'text',
      }
    }
    // PRO-228: where it is (nevera / congelador; «despensa» is the default and goes unsaid) and since when.
    const place = (r: { location?: string; storedAt?: string }) =>
      r.location === 'congelador' ? ` [congelador desde ${String(r.storedAt ?? '').slice(0, 10)}]` : r.location === 'nevera' ? ' [nevera]' : ''
    const fmt = (r: { name: string; quantity: number; unit: string; expiresAt: string | null; location?: string; storedAt?: string }) =>
      `${r.name}${r.quantity ? ` ${r.quantity} ${r.unit}` : ''}${r.expiresAt ? ` (caduca ${String(r.expiresAt).slice(0, 10)})` : ''}${place(r)}`
    const all = [...pantry.map(fmt), ...fromList.map((i) => String(i.name))]
    return {
      data: { pantry, fromList },
      summary: `Tienes en casa: ${all.slice(0, 40).join(', ')}${all.length > 40 ? '…' : ''}.`,
      uiHint: 'text',
    }
  },
}

// 2. ── mark_in_stock ────────────────────────────────────────
function findPantryRow<T extends { name: string }>(rows: T[], query: string): T | null {
  const q = normalizeText(query)
  if (!q) return null
  return (
    rows.find((r) => normalizeText(r.name) === q) ??
    rows.find((r) => nameHasTerm(normalizeText(r.name), q) || nameHasTerm(q, normalizeText(r.name))) ??
    null
  )
}

/**
 * PRO-349: «nos quedan 4 huevos y medio brócoli» leaves that amount in the
 * pantry too (a row's amount is set, not added: it's what's left). Before,
 * an amount only reached the list, or the pantry got «huevos 1 u», while Mimo
 * said both were in the pantry (Dani y Sara, 2026-10-22). Returns what the pantry holds now, e.g. «Huevos: 4 u».
 */
async function storePantryAmount(
  ctx: SkillContext,
  pantryHit: { id: string } | null,
  name: string,
  amount: { quantity?: number; unit?: string },
  location: AddPantryInput['location'],
): Promise<string | null> {
  const b = toBuyable(amount.quantity, amount.unit)
  if (b.quantity == null || !b.unit) return null
  const unit = b.unit as AddPantryInput['unit']
  let row: { name: string; quantity: number; unit: string } | null = null
  if (pantryHit) {
    row = await patchPantryForUser(ctx.userId, pantryHit.id, { quantity: b.quantity, unit, ...(location ? { location } : {}) }, ctx.db)
  } else {
    try {
      row = await addPantryForUser(ctx.userId, { name: String(b.suffix ? `${name} (${b.suffix})` : name).trim().slice(0, 80), quantity: b.quantity, unit, location }, ctx.db)
    } catch (err) {
      if (!(err instanceof NoHouseholdError)) throw err
    }
  }
  return row ? `${row.name}: ${Math.round(row.quantity * 100) / 100} ${row.unit}` : null
}

export const markInStock: SkillDefinition = {
  name: 'mark_in_stock',
  description:
    'El usuario dice que tiene o que se le ha acabado un ingrediente. "tengo X" → inStock:true (lo apunta en la despensa y lo marca "ya lo tengo" en la lista); "se acabo X" / "ya no tengo X" → false (lo quita de ambas). Sin inStock alterna. Si dice CUANTO le queda ("nos queda una cebolla y medio pimiento", "tengo 200 g de arroz"), pasa quantity (y unit si la dice): la lista compra solo lo que falta en vez de marcar toda la linea; una llamada por ingrediente.',
  parameters: {
    type: 'object',
    properties: {
      ingredient: { type: 'string', description: 'Nombre del ingrediente (acepta coincidencia parcial)' },
      inStock: { type: 'boolean', description: 'true si tiene, false si no. Si se omite, alterna el estado.' },
      location: { type: 'string', enum: ['nevera', 'congelador', 'despensa'], description: 'Donde lo tiene, si lo dice ("tengo pollo en el congelador"). Si ya estaba apuntado en otro sitio, lo cambia de sitio.' },
      quantity: { type: 'number', description: 'Cuanto le queda en casa (0.5 = medio). Solo si lo dice.' },
      unit: { type: 'string', description: 'Unidad de quantity: unidades, g, kg, ml, l… Sin unidad = unidades.' },
    },
    required: ['ingredient'],
  },
  async handler(params: { ingredient: string; inStock?: boolean; location?: string; quantity?: number; unit?: string }, ctx) {
    const { userId, db } = ctx
    const pantry = await listPantryForUser(userId, db).catch(() => [])
    const list = await latestShoppingList(ctx)
    const items = ((list?.items as any[]) ?? []).slice()
    const item = list ? findShoppingItem(items, params.ingredient) : null
    const pantryHit = findPantryRow(pantry, params.ingredient)
    const current = item ? Boolean(item.inStock) : Boolean(pantryHit)
    const next = params.inStock != null ? !!params.inStock : !current

    // «Nos queda una cebolla» (PRO-182): the list buys only the rest of a menu line.
    if (item && item.ingredientId && item.kind !== 'manual' && item.kind !== 'staple' && params.quantity != null && params.quantity >= 0 && params.inStock !== false) {
      const b = toBuyable(params.quantity, params.unit)
      let have: number | null = b.quantity ?? (params.quantity === 0 ? 0 : null)
      if (have != null && have > 0 && b.unit && b.unit !== item.unit) {
        const [ing] = await db
          .select({ density: ingredients.density, unitWeight: ingredients.unitWeight })
          .from(ingredients)
          .where(eq(ingredients.id, item.ingredientId))
          .limit(1)
        have = convertUnits(have, b.unit as any, item.unit, ing?.density, ing?.unitWeight)
      }
      if (have == null) {
        return {
          data: null,
          summary: `No he podido pasar esa cantidad a la unidad de la lista (${item.unit}). ¿Cuánto ${item.name} os queda en ${item.unit}?`,
          uiHint: 'text',
        }
      }
      setHaveAtHome(item, have)
      await db.update(shoppingLists).set({ items }).where(eq(shoppingLists.id, list.id))
      const left = item.inStock ? 0 : Math.max(0, item.quantity - (item.haveQuantity ?? 0))
      const fmt = (n: number) => `${Math.round(n * 10) / 10} ${item.unit}`
      const where = isPantryLocation(params.location) ? params.location : undefined
      const stored = params.quantity > 0 ? await storePantryAmount(ctx, pantryHit, String(item.name), params, where) : null
      const pantryLine = stored ? ` En la despensa queda apuntado: ${stored}.` : ''
      return {
        data: { name: item.name, inStock: item.inStock, haveQuantity: item.haveQuantity ?? null, toBuy: left, pantry: stored },
        summary: item.inStock
          ? `${item.name}: con lo que tenéis llega; marcado como en casa.${pantryLine}`
          : `${item.name}: apuntado lo que os queda; en la lista quedan ${fmt(left)} por comprar (el menú pide ${fmt(item.quantity)}).${pantryLine}`,
        uiHint: 'confirmation',
      }
    }

    let touched = false
    if (item) {
      item.inStock = next
      await db.update(shoppingLists).set({ items }).where(eq(shoppingLists.id, list.id))
      touched = true
    }
    const location = isPantryLocation(params.location) ? params.location : undefined
    // With an amount («tengo 4 huevos»), the pantry keeps that amount (PRO-349).
    const stored = next && params.quantity != null && params.quantity > 0
      ? await storePantryAmount(ctx, pantryHit, String(item?.name ?? params.ingredient), params, location)
      : null
    if (stored) touched = true
    if (!stored && next && pantryHit && location && (pantryHit as { location?: string }).location !== location) {
      await patchPantryForUser(userId, pantryHit.id, { location }, db)
      touched = true
    }
    if (!stored && next && !pantryHit) {
      try {
        await addPantryForUser(userId, { name: String(item?.name ?? params.ingredient).trim().slice(0, 80), location }, db)
        touched = true
      } catch (err) {
        if (!(err instanceof NoHouseholdError)) throw err
      }
    }
    if (!next && pantryHit) {
      await deletePantryForUser(userId, pantryHit.id, db)
      touched = true
    }
    if (!touched) {
      return {
        data: null,
        summary: list
          ? `No he encontrado "${params.ingredient}" en tu lista ni en la despensa.`
          : 'Necesitas tener una lista de la compra activa para gestionar la despensa.',
        uiHint: 'text',
      }
    }
    const name = item?.name ?? pantryHit?.name ?? params.ingredient
    return {
      data: { name, inStock: next, ...(stored ? { pantry: stored } : {}) },
      summary: next
        ? `${name} marcado como en casa${location && location !== 'despensa' ? ` (${location})` : ''}.${stored ? ` En la despensa queda apuntado: ${stored}.` : ''}`
        : `${name} eliminado de la despensa.`,
      uiHint: 'confirmation',
    }
  },
}

// 3. ── check_shopping_item ─────────────────────────────────
export const checkShoppingItem: SkillDefinition = {
  name: 'check_shopping_item',
  description: 'Marca un articulo de la lista de la compra como comprado (o lo desmarca). Util cuando el usuario va por el supermercado en manos libres.',
  parameters: {
    type: 'object',
    properties: {
      ingredient: { type: 'string', description: 'Nombre del ingrediente (acepta coincidencia parcial)' },
      checked: { type: 'boolean', description: 'true para marcar como comprado, false para devolver a pendiente. Si se omite, alterna.' },
    },
    required: ['ingredient'],
  },
  async handler(params: { ingredient: string; checked?: boolean }, ctx) {
    const { userId, db } = ctx
    const [list] = await db
      .select()
      .from(shoppingLists)
      .where(scopeWhere(shoppingLists.userId, shoppingLists.householdId, await resolveScope(userId, db)))
      .orderBy(desc(shoppingLists.createdAt))
      .limit(1)
    if (!list) {
      return { data: null, summary: 'No tienes lista de la compra activa.', uiHint: 'text' }
    }
    const items = ((list.items as any[]) ?? []).slice()
    const item = findShoppingItem(items, params.ingredient)
    if (!item) {
      return { data: null, summary: `No he encontrado "${params.ingredient}" en tu lista.`, uiHint: 'text' }
    }
    const next = params.checked != null ? !!params.checked : !item.checked
    item.checked = next
    await db.update(shoppingLists).set({ items }).where(eq(shoppingLists.id, list.id))
    return {
      data: { name: item.name, checked: next },
      summary: next ? `${item.name} marcado como comprado.` : `${item.name} vuelve a la lista.`,
      uiHint: 'confirmation',
    }
  },
}
