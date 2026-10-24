/**
 * «Tiendas de Mimoia» from chat (PRO-358, D-051; specs/shop-orders.md →
 * «Tiendas de Mimoia»). Same routes as /compra/tiendas, as the user
 * (appApi.ts), so the web chat, voice and WhatsApp see the same shops in the
 * same order and the «¿Ya le comprabas?» answer counts the same way.
 */
import {
  NETWORK_FULFILMENT_LABELS,
  NETWORK_SHOP_TIER_LABELS,
  POSTAL_CODE_PATH,
  SHOP_KIND_LABELS,
  SHOP_NETWORK_NOTICE,
  isPostalCode,
  type HouseholdNetworkShop,
  type HouseholdNetworkView,
  type Shop,
} from '@ona/shared'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'
import { appApiFor, AppApiError, type AppApi } from './appApi.js'

const api = (ctx: SkillContext): AppApi =>
  ctx.api ?? appApiFor(ctx.userId, { channel: ctx.channel === 'whatsapp' ? 'whatsapp' : 'web' })
const text = (summary: string, data: unknown = null): SkillResult => ({ data, summary, uiHint: 'text' })

function euros(n: number | null): string {
  return n == null ? '' : `${String(Math.round(n * 100) / 100).replace('.', ',')} €`
}

/** Pure: one shop of the Red in a line for the model (with its id, to add it). */
export function networkShopLine(s: HouseholdNetworkShop): string {
  const how = s.fulfilment.map((f) => NETWORK_FULFILMENT_LABELS[f].toLowerCase()).join(', ')
  const money = [
    s.deliveryMinEur != null ? `pedido mínimo ${euros(s.deliveryMinEur)}` : '',
    s.deliveryFeeEur != null ? `envío ${euros(s.deliveryFeeEur)}` : '',
    s.freeDeliveryFromEur != null ? `envío gratis desde ${euros(s.freeDeliveryFromEur)}` : '',
  ].filter(Boolean).join(', ')
  return `- ${SHOP_KIND_LABELS[s.kind]} · ${s.name} (${NETWORK_SHOP_TIER_LABELS[s.tier]}; ${how}${money ? `; ${money}` : ''})${s.notes ? `. ${s.notes}` : ''} [id ${s.id}]`
}

export const findNetworkShopsSkill: SkillDefinition = {
  name: 'find_network_shops',
  description:
    'Enseña las «Tiendas de Mimoia»: fruterías, carnicerías y pescaderías de barrio que Mimoia recomienda y que llegan al código postal del hogar, ya ordenadas por su ficha (presupuesto, preferencias, cercanía); nunca por pago. Úsalo cuando al hogar le falte una tienda («no tengo carnicería», «¿conoces alguna pescadería?») o pregunte por las tiendas de Mimoia. Si el hogar aún no ha dicho su código postal, pregúntale «¿En qué código postal vivís?» y pásalo en postal_code (se guarda en su ficha). Di siempre, con estas palabras, cómo funciona: «' + SHOP_NETWORK_NOTICE + '». Para añadir una, pregunta antes «¿Ya le comprabas?» y llama a add_network_shop.',
  parameters: {
    type: 'object',
    properties: {
      postal_code: { type: 'string', description: 'Código postal de 5 cifras, solo si el hogar lo acaba de decir.' },
    },
  },
  async handler(p: { postal_code?: string }, ctx: SkillContext): Promise<SkillResult> {
    const call = api(ctx)
    try {
      if (p?.postal_code !== undefined) {
        const code = String(p.postal_code).trim()
        if (!isPostalCode(code)) return text('No he guardado nada: el código postal tiene que tener 5 cifras (por ejemplo, 28001).')
        await call('PUT', POSTAL_CODE_PATH, { postalCode: code })
      }
      const view = await call<HouseholdNetworkView>('GET', '/shop-network')
      const head = view.postalCode
        ? `Tiendas de Mimoia para el ${view.postalCode}`
        : 'El hogar aún no ha dicho su código postal: pregúntale «¿En qué código postal vivís?». Mientras, solo salen las que envían a toda España'
      if (!view.shops.length) {
        return text(`${head}: ninguna por ahora${view.postalCode ? ' en su zona' : ''}. Cómo funciona: ${SHOP_NETWORK_NOTICE}`, view)
      }
      return text(`${head}, en este orden:\n${view.shops.map(networkShopLine).join('\n')}\nCómo funciona: ${SHOP_NETWORK_NOTICE}`, view)
    } catch (err) {
      if (err instanceof AppApiError && err.status === 403) return text('No lo he cambiado: solo los adultos del hogar pueden cambiar el código postal.')
      throw err
    }
  },
}

export const addNetworkShopSkill: SkillDefinition = {
  name: 'add_network_shop',
  description:
    'Añade al hogar una de las «Tiendas de Mimoia» que ha devuelto find_network_shops (por su id). Antes pregunta «¿Ya le comprabas?»: already_customer=true si ya era su tienda (entra como tienda propia), false si es nueva para el hogar. Desde ahí sus pedidos van a ella como a cualquier otra tienda.',
  parameters: {
    type: 'object',
    properties: {
      shop_id: { type: 'string', description: 'El id de la tienda, tal cual lo da find_network_shops.' },
      already_customer: { type: 'boolean', description: 'Respuesta a «¿Ya le comprabas?».' },
    },
    required: ['shop_id', 'already_customer'],
  },
  async handler(p: { shop_id?: string; already_customer?: boolean }, ctx: SkillContext): Promise<SkillResult> {
    if (!p?.shop_id || typeof p.already_customer !== 'boolean') return text('No he añadido nada: falta la tienda o la respuesta a «¿Ya le comprabas?».')
    try {
      const shop = await api(ctx)<Shop>('POST', `/shop-network/${encodeURIComponent(p.shop_id)}/adopt`, { alreadyCustomer: p.already_customer })
      const where = shop.fulfilment === 'domicilio' ? (shop.address ? ` Te lo llevan a ${shop.address}.` : ' Te lo llevan a casa: dime la dirección antes del primer pedido.') : ' Recoges en la tienda.'
      return {
        data: { shop, navigateTo: '/compra/tiendas' },
        summary: `Añadida a tus tiendas: ${shop.name} (${SHOP_KIND_LABELS[shop.kind]}).${where} Lo de ${SHOP_KIND_LABELS[shop.kind].toLowerCase()} de tus pedidos va a ella.`,
        uiHint: 'confirmation',
      }
    } catch (err) {
      if (err instanceof AppApiError) {
        if (err.status === 409) return text('Ya estaba entre las tiendas del hogar. No he cambiado nada.')
        if (err.status === 404) return text('Esa tienda no está disponible para su zona (o ya no acepta hogares nuevos). Vuelve a mirar con find_network_shops.')
        if (err.status === 403) return text('No la he añadido: solo los adultos del hogar pueden añadir tiendas.')
        if (err.status === 400) return text(`No la he añadido: ${err.message}`)
      }
      throw err
    }
  },
}

export const shopNetworkSkills: SkillDefinition[] = [findNetworkShopsSkill, addNetworkShopSkill]
