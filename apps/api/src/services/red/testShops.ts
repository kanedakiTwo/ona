/**
 * Red de tiendas: test shops for tramos 1a/1b (the guided sign-up comes in
 * tramo 2). One made-up frutería, carnicería and pescadería, marked `is_test`,
 * with 600 000 0NN numbers: never a real shop, number or person (PRO-76).
 * Seeding again moves them to another postal code (upsert by WhatsApp).
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../../db/connection.js'
import { redShops } from '../../db/schema.js'

type Db = typeof defaultDb

export const RED_TEST_SHOPS = [
  { kind: 'fruteria', name: 'Frutería de prueba', whatsapp: '34600000091', deliveryMinEur: 20, deliveryFeeEur: 3, delivers: true },
  { kind: 'carniceria', name: 'Carnicería de prueba', whatsapp: '34600000092', deliveryMinEur: null, deliveryFeeEur: null, delivers: false },
  { kind: 'pescaderia', name: 'Pescadería de prueba', whatsapp: '34600000093', deliveryMinEur: 30, deliveryFeeEur: 4, delivers: true },
] as const

export async function seedRedTestShops(input: { postalCode: string; deliversTo?: string[] }, db: Db = defaultDb) {
  const out: Array<{ id: string; kind: string; name: string }> = []
  for (const s of RED_TEST_SHOPS) {
    const deliveryPostalCodes = s.delivers ? [input.postalCode, ...(input.deliversTo ?? [])] : []
    const [row] = await db
      .insert(redShops)
      .values({
        name: s.name, kind: s.kind, postalCode: input.postalCode, whatsapp: s.whatsapp, deliveryPostalCodes,
        deliveryMinEur: s.deliveryMinEur, deliveryFeeEur: s.deliveryFeeEur, notes: 'Tienda de prueba: no existe.', isTest: true,
      })
      .onConflictDoUpdate({
        target: redShops.whatsapp,
        set: { postalCode: input.postalCode, deliveryPostalCodes, status: 'activa', updatedAt: sql`now()` },
      })
      .returning({ id: redShops.id, kind: redShops.kind, name: redShops.name })
    out.push(row)
  }
  return out
}
