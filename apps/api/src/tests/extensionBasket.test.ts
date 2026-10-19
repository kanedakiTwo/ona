/**
 * La cesta para la extensión del navegador (specs/shop-orders.md): qué
 * artículos de una línea fusionada son productos distintos, la cesta que
 * sale de las líneas del pedido y de qué artículos de la lista viene cada
 * clave.
 *
 * Run: pnpm --filter @ona/api test src/tests/extensionBasket.test.ts
 */
import { describe, it, expect } from 'vitest'
import { orderMembers } from '@ona/shared'

const m = (id: string, name: string, quantity: number, unit: 'g' | 'ml' | 'u' = 'g') => ({ id, name, quantity, unit })

describe('orderMembers', () => {
  it('separa productos que la lista separa (alubias blancas + rojas)', () => {
    expect(orderMembers([m('a', 'alubias blancas', 400), m('b', 'alubias rojas', 400)], 'alubias')).toEqual([
      { name: 'alubias blancas', quantity: 400, unit: 'g', sourceItemIds: ['a'] },
      { name: 'alubias rojas', quantity: 400, unit: 'g', sourceItemIds: ['b'] },
    ])
  })
  it('el nombre genérico de la regla se suma al específico (jamón + jamón serrano, leche + leche entera)', () => {
    expect(orderMembers([m('a', 'jamon', 50), m('b', 'Jamón serrano', 1, 'u')], 'jamon')).toBeNull()
    expect(orderMembers([m('a', 'leche', 1, 'u'), m('b', 'leche entera', 50, 'ml')], 'leche')).toBeNull()
    expect(orderMembers([m('a', 'alubias', 1, 'u'), m('b', 'alubias rojas', 400)], 'alubias')).toBeNull()
  })
  it('el mismo producto escrito de dos formas no se separa', () => {
    expect(orderMembers([m('a', 'huevos', 4, 'u'), m('b', 'yema de huevo', 1, 'u')], 'huevos')).toBeNull()
    expect(orderMembers([m('a', 'Tomate', 3, 'u'), m('b', 'Tomate · varias presentaciones', 2, 'u')], 'tomate')).toBeNull()
    // «huevo» no es la clave de la regla (`huevos`): aquí solo los junta el criterio de la lista.
    expect(orderMembers([m('a', 'huevo', 4, 'u'), m('b', 'yema de huevo', 1, 'u')], 'huevos')).toBeNull()
  })
  it('una sola línea o una línea sin regla con un solo nombre: null', () => {
    expect(orderMembers([m('a', 'arroz', 500)], 'arroz')).toBeNull()
    expect(orderMembers([m('a', 'kombu', 10), m('b', 'Kombu', 5)], null)).toBeNull()
  })
})
