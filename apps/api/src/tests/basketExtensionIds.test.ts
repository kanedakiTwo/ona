/**
 * Varias extensiones del navegador, una por cadena (specs/shop-orders.md → «Enviar a la extensión del
 * navegador»): los ids de la build y qué extensión llena la web de cada tienda.
 *
 * Run: pnpm --filter @ona/api test src/tests/basketExtensionIds.test.ts
 */
import { describe, it, expect } from 'vitest'
import { extensionForHost, parseExtensionIds, type BasketPing } from '@ona/shared'

const ping = (hosts: string[], etiqueta: string): BasketPing => ({ ok: true, protocolo: 1, version: '0.1.0', hosts, etiqueta })

describe('parseExtensionIds', () => {
  it('uno, varios con espacios, vacíos y repetidos', () => {
    expect(parseExtensionIds('aaa')).toEqual(['aaa'])
    expect(parseExtensionIds(' aaa , bbb,,aaa , ')).toEqual(['aaa', 'bbb'])
    expect(parseExtensionIds('')).toEqual([])
    expect(parseExtensionIds(' , ')).toEqual([])
    expect(parseExtensionIds(undefined)).toEqual([])
    expect(parseExtensionIds(null)).toEqual([])
  })
})

describe('extensionForHost', () => {
  const pings = [
    { id: 'aaa', ping: ping(['tienda.example'], 'La Cadena') },
    { id: 'bbb', ping: ping(['super.example', 'www.super.example'], 'Otra Cadena') },
    { id: 'ccc', ping: ping(['super.example'], 'Repetida') },
  ]
  it('la que sabe llenar la web de ese host; si dos, la primera de la build', () => {
    expect(extensionForHost(pings, 'tienda.example')?.id).toBe('aaa')
    expect(extensionForHost(pings, 'www.super.example')?.ping.etiqueta).toBe('Otra Cadena')
    expect(extensionForHost(pings, 'super.example')?.id).toBe('bbb')
  })
  it('ninguna que lo sepa, sin host o sin pings → null', () => {
    expect(extensionForHost(pings, 'otra.example')).toBeNull()
    expect(extensionForHost(pings, null)).toBeNull()
    expect(extensionForHost([], 'tienda.example')).toBeNull()
  })
  it('el host tiene que ser exacto (sin subdominios ni sufijos)', () => {
    expect(extensionForHost(pings, 'example')).toBeNull()
    expect(extensionForHost(pings, 'tienda.example.otra.web')).toBeNull()
  })
})
