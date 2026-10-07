import type { Shop, ShopOrder, ShopOrderLine } from '@ona/shared'
import { SHOP_KIND_LABELS, normalizePhone } from '@ona/shared'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'
import { appApiFor, AppApiError, type AppApi } from './appApi.js'
import { bestMatch } from './appSkills.js'

/**
 * "Compra en mis tiendas" from chat (specs/shop-orders.md). Same REST calls
 * as /compra, as the user. ONA never messages a shop: it hands the user a
 * short link (/c/<token>) that opens THEIR WhatsApp with the order written,
 * then reads the shop's reply when the user forwards or pastes it.
 */

const api = (ctx: SkillContext): AppApi => ctx.api ?? appApiFor(ctx.userId)
const toCompra = (summary: string, data: Record<string, unknown> = {}): SkillResult => ({
  data: { ...data, navigateTo: '/compra' },
  summary,
  uiHint: 'text',
})

const KINDS = ['fruteria', 'carniceria', 'pescaderia', 'supermercado', 'otra']

function euros(n: number | null | undefined): string {
  return n == null ? '' : `${String(Math.round(n * 100) / 100).replace('.', ',')} €`
}

function sendLine(o: ShopOrder): string {
  const head = `*${o.shop.name}* (${o.lines.length} ${o.lines.length === 1 ? 'producto' : 'productos'}${o.estimateEur ? `, ≈${euros(o.estimateEur)}` : ''})`
  switch (o.shop.channel) {
    case 'whatsapp':
      return `- ${head}: envíaselo desde tu WhatsApp → ${o.links.shortOrder}`
    case 'email':
      return `- ${head}: envíaselo por email → ${o.links.shortOrder}`
    case 'telefono':
      return `- ${head}: llama al +${o.shop.phone}; la lista está en la app`
    case 'web':
      return `- ${head}: pídelo en su web; tienes la lista con un enlace por producto en la app`
  }
}

async function openOrders(ctx: SkillContext): Promise<ShopOrder[]> {
  return api(ctx)<ShopOrder[]>('GET', '/shop-orders')
}

/** "Ben-Car" ≈ "ben car": punctuation never decides a name match. */
const plain = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function matchShop<T>(items: readonly T[], query: string, nameOf: (t: T) => string): T | null {
  return bestMatch(items, plain(query), (t) => plain(nameOf(t)))
}

/** Pick the order the user means: by shop name, else the only one in the given states. */
function pickOrder(orders: ShopOrder[], states: ShopOrder['status'][], shop?: string): ShopOrder | null | 'ambiguous' {
  const pool = orders.filter((o) => states.includes(o.status))
  if (shop) return matchShop(pool, shop, (o) => o.shop.name) ?? matchShop(pool, shop, (o) => SHOP_KIND_LABELS[o.shop.kind])
  if (pool.length === 1) return pool[0]
  return pool.length ? 'ambiguous' : null
}

function lineStatus(l: ShopOrderLine): string {
  if (l.verdict === 'no_hay') return `- ${l.name}: no hay (lo quito)`
  const price = l.quote?.lineTotal != null ? ` ${euros(l.quote.lineTotal)}` : l.quote?.pricePerKg ? ` ${euros(l.quote.pricePerKg)}/kg` : ''
  if (l.verdict === 'revisar') return `- ${l.name}${price}: ${l.reasons.join(' ')}`
  return `- ${l.name}${price}: ok`
}

// ─── Shops ───────────────────────────────────────────────────────

const manageShops: SkillDefinition = {
  name: 'manage_shops',
  description:
    'Gestiona las tiendas del hogar a las que ONA prepara pedidos (fruteria, carniceria, pescaderia, supermercado). action: list, add, update, remove. Para add hace falta name, kind y al menos un contacto (whatsapp, email, web o phone). customerName = como le conoce la tienda. delivery: recoger | domicilio (con address).',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'add', 'update', 'remove'] },
      name: { type: 'string', description: 'Nombre de la tienda (para update/remove, el nombre actual).' },
      newName: { type: 'string' },
      kind: { type: 'string', enum: KINDS },
      whatsapp: { type: 'string' },
      email: { type: 'string' },
      web: { type: 'string' },
      phone: { type: 'string' },
      customerName: { type: 'string' },
      delivery: { type: 'string', enum: ['recoger', 'domicilio'] },
      address: { type: 'string' },
      notes: { type: 'string' },
    },
    required: ['action'],
  },
  async handler(p, ctx) {
    const shops = await api(ctx)<Shop[]>('GET', '/shops')
    if (p.action === 'list') {
      if (!shops.length) return toCompra('No hay tiendas guardadas todavía.')
      return toCompra(`Tiendas: ${shops.map((s) => `${s.name} (${SHOP_KIND_LABELS[s.kind]}, ${s.channel === 'whatsapp' ? `WhatsApp +${s.whatsapp}` : s.channel})`).join('; ')}.`)
    }
    if (!p.name) return toCompra('Falta el nombre de la tienda; no he cambiado nada.')

    if (p.action === 'add') {
      if (!p.kind) return toCompra('Falta el tipo de tienda (frutería, carnicería, pescadería o supermercado).')
      const body = payloadFrom(p, null)
      if (!body.channel) return toCompra('Falta un contacto de la tienda (WhatsApp, email, web o teléfono); no la he guardado.')
      try {
        const s = await api(ctx)<Shop>('POST', '/shops', body)
        return toCompra(`Hecho: ${s.name} guardada como ${SHOP_KIND_LABELS[s.kind].toLowerCase()}.`)
      } catch (err) {
        if (err instanceof AppApiError && err.status === 400) return toCompra(`No la he guardado: ${err.message}.`)
        throw err
      }
    }

    const hit = matchShop(shops, p.name, (s) => s.name)
    if (!hit) return toCompra(`No tengo ninguna tienda llamada "${p.name}"; no he cambiado nada.`)
    if (p.action === 'remove') {
      await api(ctx)('DELETE', `/shops/${hit.id}`)
      return toCompra(`Hecho: ${hit.name} borrada de tus tiendas.`)
    }
    try {
      await api(ctx)('PATCH', `/shops/${hit.id}`, payloadFrom(p, hit))
    } catch (err) {
      if (err instanceof AppApiError && err.status === 400) return toCompra(`No la he cambiado: ${err.message}.`)
      throw err
    }
    return toCompra(`Hecho: ${p.newName ?? hit.name} actualizada.`)
  },
}

/** Skill params (+ the existing shop, for updates) → the full body the route validates. */
export function payloadFrom(p: Record<string, any>, prev: Shop | null): Record<string, unknown> {
  const whatsapp = p.whatsapp !== undefined ? normalizePhone(p.whatsapp) : prev?.whatsapp ?? null
  const email = p.email !== undefined ? (p.email || null) : prev?.email ?? null
  const rawWeb = p.web !== undefined ? (p.web || null) : prev?.webUrl ?? null
  const webUrl = rawWeb && !/^https?:\/\//i.test(rawWeb) ? `https://${rawWeb}` : rawWeb
  const phone = p.phone !== undefined ? normalizePhone(p.phone) : prev?.phone ?? null
  const changedContact = p.whatsapp !== undefined || p.email !== undefined || p.web !== undefined || p.phone !== undefined
  const channel = !changedContact && prev ? prev.channel : whatsapp ? 'whatsapp' : email ? 'email' : webUrl ? 'web' : phone ? 'telefono' : undefined
  const fulfilment = p.delivery ?? prev?.fulfilment ?? 'recoger'
  return {
    name: String(p.newName ?? prev?.name ?? p.name).slice(0, 80),
    kind: p.kind ?? prev?.kind,
    channel,
    whatsapp,
    email,
    webUrl,
    phone,
    customerName: p.customerName !== undefined ? p.customerName || null : prev?.customerName ?? null,
    fulfilment,
    address: p.address !== undefined ? p.address || null : prev?.address ?? null,
    notes: p.notes !== undefined ? p.notes || null : prev?.notes ?? null,
  }
}

// ─── Orders ──────────────────────────────────────────────────────

const prepareShopOrders: SkillDefinition = {
  name: 'prepare_shop_orders',
  description:
    'Prepara los pedidos de la compra para las tiendas del usuario a partir de su lista actual: reparte cada producto a su frutería, carnicería, pescadería o súper y devuelve un enlace por tienda que abre SU WhatsApp con el pedido escrito. Usala cuando pida "hazme la compra", "haz el pedido", "pídeselo a la frutería". ONA no envía nada: lo envía el usuario.',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_p, ctx) {
    const r = await api(ctx)<{ orders: ShopOrder[]; unassigned: Array<{ name: string }>; skipped: Array<{ name: string }>; hasShops: boolean }>(
      'POST',
      '/shop-orders/prepare',
      {},
    )
    if (!r.hasShops) {
      return { data: { navigateTo: '/compra/tiendas' }, uiHint: 'text', summary: 'El usuario aún no tiene tiendas guardadas. Pídele nombre, tipo (frutería, carnicería, pescadería, súper) y WhatsApp de cada una y guárdalas con manage_shops; o que las añada en la app.' }
    }
    if (!r.orders.length) return toCompra('No hay nada pendiente en la lista para pedir (o ya está todo en pedidos abiertos).')
    const parts = ['Pedidos preparados. Copia los enlaces TAL CUAL en tu respuesta:', ...r.orders.map(sendLine)]
    if (r.unassigned.length) parts.push(`Sin tienda (no tiene ni súper guardado): ${r.unassigned.map((u) => u.name).join(', ')}.`)
    if (r.skipped.length) parts.push(`No incluido por ser básico de despensa o ya pedido: ${r.skipped.map((s) => s.name).join(', ')}.`)
    parts.push('Cuando la tienda conteste, que te reenvíe o pegue su respuesta y la reviso.')
    return toCompra(parts.join('\n'), { orderIds: r.orders.map((o) => o.id) })
  },
}

const registerShopReply: SkillDefinition = {
  name: 'register_shop_reply',
  description:
    'Registra la respuesta de una tienda a un pedido (el usuario la reenvía o la pega: precios, "no queda merluza", "te pongo pescadilla", total…). Compara cada línea con lo previsto y dice qué hay que decidir. Pasa el texto de la tienda literal en text y, si se sabe, el nombre de la tienda en shop.',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string' }, shop: { type: 'string' } },
    required: ['text'],
  },
  async handler(p, ctx) {
    const order = pickOrder(await openOrders(ctx), ['sent', 'draft', 'quoted'], p.shop)
    if (order === 'ambiguous') return toCompra('Hay varios pedidos esperando respuesta; pregunta de qué tienda es este mensaje.')
    if (!order) return toCompra('No hay ningún pedido esperando respuesta de una tienda.')
    let q: ShopOrder
    try {
      q = await api(ctx)<ShopOrder>('POST', `/shop-orders/${order.id}/quote`, { text: String(p.text).slice(0, 4000) })
    } catch (err) {
      if (err instanceof AppApiError && err.status === 502) return toCompra('No he podido leer la respuesta de la tienda; que lo intente otra vez en un momento.')
      throw err
    }
    const s = q.quoteSummary
    const lines = q.lines.map(lineStatus)
    const parts = [`Respuesta de ${q.shop.name}:`, ...lines]
    if (s?.totalEur != null) parts.push(`Total: ${euros(s.totalEur)}${q.capEur ? ` (tope: ${euros(q.capEur)}${s.overCap ? ', LO SUPERA' : ''})` : ''}.`)
    if (s?.pickupText) parts.push(`Recogida/entrega: ${s.pickupText}.`)
    if (s?.paymentText) parts.push(`Pago: ${s.paymentText}.`)
    parts.push(
      s?.needsDecision
        ? 'Pregunta al usuario qué hace con las líneas a revisar (quitar o aceptar) y no confirmes sin su respuesta. Termina con [[opciones: Aceptar todo | Quitar lo dudoso | Ver detalle]].'
        : 'Todo cuadra. Pregunta si lo confirma: [[opciones: Sí, confírmalo | Ver detalle]].',
    )
    return toCompra(parts.join('\n'), { orderId: q.id })
  },
}

const approveShopOrder: SkillDefinition = {
  name: 'approve_shop_order',
  description:
    'Confirma el pedido de una tienda que ya ha contestado, SOLO tras un sí explícito del usuario. remove = productos que el usuario quiere quitar (o sustitutos que rechaza); el resto se acepta tal como lo ha propuesto la tienda. Devuelve un enlace para que el usuario envíe la confirmación desde su WhatsApp.',
  parameters: {
    type: 'object',
    properties: {
      shop: { type: 'string' },
      remove: { type: 'array', items: { type: 'string' } },
      capEur: { type: 'number', description: 'Tope del pedido en euros, si el usuario lo dice.' },
    },
    required: [],
  },
  async handler(p, ctx) {
    const order = pickOrder(await openOrders(ctx), ['quoted'], p.shop)
    if (order === 'ambiguous') return toCompra('Hay varias tiendas que han contestado; pregunta cuál confirmar.')
    if (!order) return toCompra('No hay ningún pedido con respuesta de la tienda pendiente de confirmar.')
    const decisions: Record<string, 'remove'> = {}
    const notFound: string[] = []
    for (const name of (p.remove ?? []) as string[]) {
      const hit = bestMatch(order.lines, name, (l) => l.name) ?? bestMatch(order.lines, name, (l) => l.quote?.substitute ?? '')
      if (hit) decisions[hit.key] = 'remove'
      else notFound.push(name)
    }
    const body: Record<string, unknown> = { decisions }
    if (typeof p.capEur === 'number') body.capEur = p.capEur
    const a = await api(ctx)<ShopOrder>('POST', `/shop-orders/${order.id}/approve`, body)
    const link = a.links.shortConfirmation ?? a.links.confirmation
    const parts = [
      `Responde al usuario: "Toca para enviar la confirmación a ${a.shop.name}: ${link}" (enlace TAL CUAL) y en una línea qué dice el mensaje.`,
      `Mensaje de confirmación: "${a.confirmationText?.replace(/\n/g, ' ')}"`,
    ]
    if (notFound.length) parts.push(`No encontré en el pedido: ${notFound.join(', ')}.`)
    parts.push('El pago es directamente con la tienda.')
    return toCompra(parts.join('\n'), { orderId: a.id })
  },
}

const closeShopOrder: SkillDefinition = {
  name: 'close_shop_order',
  description:
    'Cierra un pedido a una tienda cuando ya está recogido/recibido (marca esos productos como comprados en la lista), o lo cancela con cancel=true. totalEur = lo que pagó, si lo dice.',
  parameters: {
    type: 'object',
    properties: { shop: { type: 'string' }, totalEur: { type: 'number' }, cancel: { type: 'boolean' } },
    required: [],
  },
  async handler(p, ctx) {
    const order = pickOrder(await openOrders(ctx), ['draft', 'sent', 'quoted', 'approved'], p.shop)
    if (order === 'ambiguous') return toCompra('Hay varios pedidos abiertos; pregunta cuál.')
    if (!order) return toCompra('No hay ningún pedido abierto.')
    if (p.cancel) {
      await api(ctx)('POST', `/shop-orders/${order.id}/cancel`)
      return toCompra(`Hecho: pedido a ${order.shop.name} cancelado.`)
    }
    await api(ctx)('POST', `/shop-orders/${order.id}/close`, typeof p.totalEur === 'number' ? { finalTotalEur: p.totalEur } : {})
    return toCompra(`Hecho: pedido a ${order.shop.name} cerrado${typeof p.totalEur === 'number' ? ` (${euros(p.totalEur)})` : ''}; esos productos quedan marcados como comprados.`)
  },
}

const getShopOrders: SkillDefinition = {
  name: 'get_shop_orders',
  description: 'Dice en qué estado están los pedidos abiertos a las tiendas (preparado, enviado, ha contestado, confirmado).',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_p, ctx) {
    const orders = await openOrders(ctx)
    if (!orders.length) return toCompra('No hay pedidos abiertos a tiendas.')
    const label: Record<string, string> = { draft: 'preparado, sin enviar', sent: 'enviado, esperando respuesta', quoted: 'la tienda ha contestado, falta confirmar', approved: 'confirmado' }
    return toCompra(orders.map((o) => `- ${o.shop.name}: ${label[o.status] ?? o.status}${o.status === 'draft' && o.links.shortOrder ? ` → ${o.links.shortOrder}` : ''}`).join('\n'))
  },
}

export const shopOrderSkills: SkillDefinition[] = [manageShops, prepareShopOrders, registerShopReply, approveShopOrder, closeShopOrder, getShopOrders]
