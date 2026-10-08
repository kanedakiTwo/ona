import type { Shop, ShopOrder, ShopOrderLine } from '@ona/shared'
import { SHOP_KIND_LABELS, normalizePhone, resolveBuyRule } from '@ona/shared'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'
import { appApiFor, AppApiError, type AppApi } from './appApi.js'
import { bestMatch, toBuyable } from './appSkills.js'
import { classifyShopKind, kindForBuyShop } from '../shopOrders/classify.js'

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
  // Same rank as get_shopping_list, and the latest wins: the reply links /compra (send buttons), not /shopping.
  uiHint: 'shopping_list',
})

const KINDS = ['fruteria', 'carniceria', 'pescaderia', 'supermercado', 'otra']

function euros(n: number | null | undefined): string {
  return n == null ? '' : `${String(Math.round(n * 100) / 100).replace('.', ',')} €`
}

function deliveryNote(o: ShopOrder): string {
  if (o.shop.channel === 'web') return ''
  if (o.fulfilment !== 'domicilio') return ' Recoges en tienda.'
  const d = o.delivery
  let out = ` A domicilio${o.address ? ` (${o.address})` : ''}.`
  if (d?.minEur != null) {
    if (!d.confident) out += ` Mínimo ${euros(d.minEur)}: no sé si llegas.`
    else if (d.shortByEur) out += ` Te faltan unos ${euros(d.shortByEur)} para el mínimo de ${euros(d.minEur)}.`
  }
  return out
}

function sendLine(o: ShopOrder): string {
  const live = o.lines.filter((l) => l.included !== false).length
  const head = `*${o.shop.name}* (${live} ${live === 1 ? 'producto' : 'productos'}${o.estimateEur ? `, ≈${euros(o.estimateEur)}` : ''})`
  if (o.blockers.length && o.shop.channel !== 'web') {
    return `- ${head}: antes de enviarlo falta: ${o.blockers.join('; ')}.${deliveryNote(o)}`
  }
  return sendLineReady(o, head) + deliveryNote(o)
}

function sendLineReady(o: ShopOrder, head: string): string {
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
    'Gestiona las tiendas del hogar a las que Mimoia prepara pedidos (fruteria, carniceria, pescaderia, supermercado). action: list, add, update, remove. Para add hace falta name, kind y al menos un contacto (whatsapp, email, web o phone). customerName = como le conoce la tienda. delivery: recoger | domicilio (con address).',
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
      deliveryMinEur: { type: 'number', description: 'Pedido mínimo para envío a domicilio, en euros.' },
      deliveryFeeEur: { type: 'number', description: 'Gastos de envío, en euros.' },
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
    deliveryMinEur: typeof p.deliveryMinEur === 'number' ? p.deliveryMinEur : prev?.deliveryMinEur ?? null,
    deliveryFeeEur: typeof p.deliveryFeeEur === 'number' ? p.deliveryFeeEur : prev?.deliveryFeeEur ?? null,
  }
}

// ─── Orders ──────────────────────────────────────────────────────

const prepareShopOrders: SkillDefinition = {
  name: 'prepare_shop_orders',
  description:
    'Prepara (o rehace) los pedidos de la compra para las tiendas del usuario a partir de su lista actual. Llámala solo cuando pida hacer la compra, no después de editar: para cambiar un pedido preparado usa edit_shop_order. Reparte cada producto a su frutería, carnicería, pescadería o súper y devuelve un enlace por tienda que abre SU WhatsApp con el pedido escrito. Usala cuando pida "hazme la compra", "haz el pedido", "pídeselo a la frutería". Mimoia no envía nada: lo envía el usuario.',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_p, ctx) {
    const r = await api(ctx)<{ orders: ShopOrder[]; unassigned: Array<{ name: string }>; skipped: Array<{ name: string }>; pantry?: string[]; hasShops: boolean }>(
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
    const pantry = r.pantry ?? []
    const already = r.skipped.filter((s) => !pantry.includes(s.name))
    if (already.length) parts.push(`Ya está en un pedido abierto: ${already.map((s) => s.name).join(', ')}.`)
    if (pantry.length) parts.push(`Doy por hecho que en casa tienes: ${pantry.join(', ')}. Si te falta algo, que lo diga y lo añado.`)
    parts.push(
      'Responde con UNA línea por tienda: las que están listas con su enlace copiado TAL CUAL; las que tienen "antes de enviarlo falta", con esa pregunta (corta) — luego se aplica con edit_shop_order, sin volver a preparar. Termina preguntando si quiere añadir algo más (por ejemplo fruta para la semana): se añade con edit_shop_order y el enlace sigue siendo el mismo. Cuando la tienda conteste, que te reenvíe o pegue su respuesta y la reviso.',
    )
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

interface EditParams {
  shop?: string
  add?: Array<{ name: string; quantity?: number; unit?: string }>
  remove?: string[]
  choose?: Array<{ item: string; option: string }>
  amounts?: Array<{ item: string; quantity: number; unit?: string }>
  include?: string[]
  delivery?: 'recoger' | 'domicilio'
  address?: string
}

/** Kind of shop a free-text product goes to (same rules as the draft). */
function kindForName(name: string): ShopOrder['shop']['kind'] {
  const r = resolveBuyRule(name)
  return r ? kindForBuyShop(r.rule.shop) : classifyShopKind(name, null)
}

const editShopOrder: SkillDefinition = {
  name: 'edit_shop_order',
  description:
    'Cambia un pedido preparado ANTES de enviarlo: añadir cosas ("añade 1 kg de manzanas y naranjas"), quitar, elegir una opción ("el jamón serrano", "lubina en vez de dorada"), poner cantidad ("150 g de york"), incluir algo marcado como "probablemente lo tienes", o recoger/a domicilio con dirección. Sin shop, cada producto añadido va a la tienda que le toca. El enlace del pedido sigue siendo el mismo.',
  parameters: {
    type: 'object',
    properties: {
      shop: { type: 'string', description: 'Tienda a la que aplicar entrega/dirección o a la que añadir, si el usuario la nombra.' },
      add: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, quantity: { type: 'number' }, unit: { type: 'string' } }, required: ['name'] } },
      remove: { type: 'array', items: { type: 'string' } },
      choose: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, option: { type: 'string' } }, required: ['item', 'option'] } },
      amounts: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, quantity: { type: 'number' }, unit: { type: 'string' } }, required: ['item', 'quantity'] } },
      include: { type: 'array', items: { type: 'string' } },
      delivery: { type: 'string', enum: ['recoger', 'domicilio'] },
      address: { type: 'string' },
    },
    required: [],
  },
  async handler(p: EditParams, ctx) {
    const drafts = (await openOrders(ctx)).filter((o) => o.status === 'draft')
    if (!drafts.length) return toCompra('No hay pedidos preparados sin enviar. Primero prepara la compra (prepare_shop_orders).')
    const named = p.shop ? matchShop(drafts, p.shop, (o) => o.shop.name) ?? matchShop(drafts, p.shop, (o) => SHOP_KIND_LABELS[o.shop.kind]) : null
    if (p.shop && !named) return toCompra(`No hay ningún pedido preparado para "${p.shop}"; no he cambiado nada.`)
    const bodies = new Map<string, Record<string, any>>()
    const body = (o: ShopOrder) => {
      let b = bodies.get(o.id)
      if (!b) bodies.set(o.id, (b = {}))
      return b
    }
    const notes: string[] = []
    const allLines = drafts.flatMap((o) => o.lines.map((l) => ({ o, l })))
    const findLine = (item: string) => matchShop(allLines, item, ({ l }) => l.name) ?? matchShop(allLines, item, ({ l }) => l.text ?? '')
    const linePatch = (item: string, patch: Record<string, unknown>) => {
      const hit = findLine(item)
      if (!hit) return void notes.push(`no encuentro "${item}" en los pedidos`)
      const b = body(hit.o)
      b.lines = [...(b.lines ?? []), { key: hit.l.key, ...patch }]
    }
    for (const a of p.add ?? []) {
      const kind = kindForName(a.name)
      const target = named ?? drafts.find((o) => o.shop.kind === kind) ?? drafts.find((o) => o.shop.kind === 'supermercado') ?? drafts[0]
      const q = toBuyable(a.quantity, a.unit)
      const b = body(target)
      b.add = [...(b.add ?? []), { name: String(q.suffix ? `${a.name} (${q.suffix})` : a.name).slice(0, 80), ...(q.quantity ? { quantity: q.quantity, unit: q.unit } : {}) }]
    }
    for (const r of p.remove ?? []) linePatch(r, { remove: true })
    for (const c of p.choose ?? []) linePatch(c.item, { choice: c.option })
    for (const m of p.amounts ?? []) {
      const q = toBuyable(m.quantity, m.unit ?? 'g')
      if (q.quantity) linePatch(m.item, { quantity: q.quantity, unit: q.unit })
    }
    for (const i of p.include ?? []) linePatch(i, { include: true })
    if (p.delivery || p.address) {
      for (const o of named ? [named] : drafts.filter((d) => d.shop.channel !== 'web')) {
        const b = body(o)
        if (p.delivery) b.fulfilment = p.delivery
        if (p.address) b.address = p.address
      }
    }
    if (!bodies.size) return toCompra(`No he cambiado nada${notes.length ? `: ${notes.join('; ')}` : ''}.`)
    const updated: ShopOrder[] = []
    for (const [id, b] of bodies) updated.push(await api(ctx)<ShopOrder>('PATCH', `/shop-orders/${id}`, b))
    const parts = ['Hecho. Pedidos actualizados (los enlaces son los mismos; cópialos tal cual si los repites):', ...updated.map(sendLine)]
    if (notes.length) parts.push(`Ojo: ${notes.join('; ')}.`)
    return toCompra(parts.join('\n'), { orderIds: updated.map((o) => o.id) })
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

export const shopOrderSkills: SkillDefinition[] = [manageShops, prepareShopOrders, editShopOrder, registerShopReply, approveShopOrder, closeShopOrder, getShopOrders]
