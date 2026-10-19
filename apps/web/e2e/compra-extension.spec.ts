/**
 * «Enviar a <cadena>» en la tarjeta del súper (specs/shop-orders.md → «Enviar a
 * la extensión del navegador»), con una extensión del navegador simulada
 * (`window.chrome.runtime.sendMessage`). La cadena es inventada: «La Cadena»,
 * con web en tienda.example. Necesita BASKET_EXTENSION_EMAILS=@test.local en la
 * API y NEXT_PUBLIC_BASKET_EXTENSION_ID en la web (CI y scripts/test-e2e.sh).
 *
 * La extensión simulada se porta como la de verdad: recuerda el último envío
 * que pudo tocar el carro (otro `enviar` lo devuelve con `repetido: true`;
 * `deshacer` y `olvidar` lo olvidan). Cada test cambia lo que contesta con
 * `setExt`. Las capturas de los estados principales van a la carpeta de
 * resultados de cada test (test-results/).
 */
import { test, expect, type Locator, type Page, type Route } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'
const ETIQUETA = 'La Cadena'
const SEND = `Enviar a ${ETIQUETA}`
const UNDO = 'Quitar lo que añadió Mimoia'
const MANUAL = 'Ya lo he quitado yo'
const NO_ANSWER = 'No sabemos si ha entrado; abre tu carro. Si vuelves a pulsar no se duplica.'
const UNDONE = 'Envío deshecho; puedes volver a enviarlo.'
/** Lo que se teclea en la lista (pasillo «otros»: todo al súper). La lista puede traer además lo del menú. */
const ITEMS = ['detergente', 'suavizante', 'lejía', 'papel de cocina']
/** Un envío con una línea de cada estado (las del menú, si las hay, entran por la tabla). */
const MIXED = { suavizante: 'busqueda', lejia: 'no_verificada', 'papel de cocina': 'fallida' } as const

test.describe.configure({ timeout: 90_000 })

// ─── la extensión simulada ─────────────────────────────────────

type Estado = 'tabla' | 'busqueda' | 'no_verificada' | 'fallida'

/** Cómo contesta la extensión simulada a un tipo de mensaje. */
interface Reply {
  /** Contesta esto tal cual, sin hacer nada más. */
  value?: unknown
  /** Contesta pasados estos ms (20 por defecto). */
  delay?: number
  /** Hace su trabajo pero no contesta nunca. */
  silent?: boolean
  /** Como si no hubiera extensión: `chrome.runtime.lastError` y respuesta vacía. */
  lastError?: boolean
}

interface ExtCfg {
  ping?: Reply
  enviar?: Reply & {
    /** Estado de las líneas cuyo nombre (sin tildes, en minúsculas) contiene la clave; `*` = todas. Por defecto, `tabla`. */
    estados?: Record<string, Estado>
    error?: 'sin_zona' | 'sin_sesion' | 'contrato' | 'red' | 'verificacion'
    bajoMinimo?: boolean
    /** Claves que no son del protocolo, en el resultado y en cada línea. */
    extra?: boolean
  }
  deshacer?: Reply
  /** `noOlvida`: contesta que sí, pero sigue recordando el envío. */
  olvidar?: Reply & { noOlvida?: boolean }
}

interface ExtCall {
  id: string
  tipo: string
  answered: boolean
}

interface FakeExt {
  cfg: ExtCfg
  calls: ExtCall[]
}

async function fakeExtension(page: Page, cfg: ExtCfg = {}) {
  await page.addInitScript((initial: ExtCfg) => {
    type Msg = { tipo: string; lineas?: Array<{ key: string; name: string }> }
    type Linea = Record<string, unknown> & { estado: string }
    const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    const fake = { cfg: initial, calls: [] as ExtCall[], n: 0, ultimo: null as null | Record<string, unknown> }
    const runtime: { lastError?: { message: string }; sendMessage?: (id: string, msg: Msg, cb: (r: unknown) => void) => void } = {}
    runtime.sendMessage = (id, msg, cb) => {
      const call = { id, tipo: msg.tipo, answered: false }
      fake.calls.push(call)
      const r = ((fake.cfg as Record<string, unknown>)[msg.tipo] ?? {}) as Reply & NonNullable<ExtCfg['enviar']> & { noOlvida?: boolean }
      const answer = (value: unknown) => {
        if (r.silent) return
        setTimeout(() => {
          call.answered = true
          if (!r.lastError) return cb(value)
          runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' }
          cb(undefined)
          delete runtime.lastError
        }, r.delay ?? 20)
      }
      if (r.lastError || 'value' in r) return answer(r.value)
      if (msg.tipo === 'ping') return answer({ ok: true, protocolo: 1, version: 'e2e', hosts: ['tienda.example'], etiqueta: 'La Cadena' })
      if (msg.tipo === 'enviar') {
        if (r.error && r.error !== 'verificacion')
          return answer({ envioId: '', ok: false, error: r.error, lineas: [], anadidas: 0, totalEur: null, bajoMinimo: false, version: 'e2e', contrato: 'e2e' })
        if (fake.ultimo) return answer({ ...fake.ultimo, repetido: true })
        const estados = Object.entries(r.estados ?? {})
        const lineas: Linea[] = (msg.lineas ?? []).map((l, i) => {
          const estado = estados.find(([k]) => k === '*' || norm(l.name).includes(k))?.[1] ?? 'tabla'
          const linea: Linea = { key: l.key, estado }
          if (estado === 'tabla' || estado === 'busqueda') Object.assign(linea, { productoId: String(100 + i), producto: `Producto de ${l.name}`, unidades: 1 })
          if (estado === 'fallida') linea.motivo = 'no_encontrado'
          if (r.extra) linea.pista = 'solo de la extensión'
          return linea
        })
        const anadidas = lineas.filter((l) => l.estado === 'tabla' || l.estado === 'busqueda').length
        const res = {
          envioId: `e2e-${++fake.n}`,
          ok: !r.error,
          ...(r.error ? { error: r.error } : {}),
          lineas,
          anadidas,
          totalEur: anadidas > 0 ? 12.5 : null,
          bajoMinimo: !!r.bajoMinimo,
          version: 'e2e',
          contrato: 'e2e',
          ...(r.extra ? { secreto: 'solo de la extensión' } : {}),
        }
        // Como la de verdad: recuerda el envío que pudo tocar el carro.
        if (anadidas > 0 || lineas.some((l) => l.estado === 'no_verificada')) fake.ultimo = res
        return answer(res)
      }
      if (msg.tipo === 'deshacer') {
        if (!fake.ultimo) return answer({ ok: false, error: 'nada_que_deshacer' })
        const restadas = fake.ultimo.anadidas
        fake.ultimo = null
        return answer({ ok: true, restadas })
      }
      if (msg.tipo === 'olvidar') {
        if (!r.noOlvida) fake.ultimo = null
        return answer({ ok: true })
      }
    }
    Object.defineProperty(window, 'chrome', { value: { runtime }, configurable: true, writable: true })
    Object.defineProperty(window, '__fakeExt', { value: fake, configurable: true })
  }, cfg)
}

/** Cambia lo que contesta la extensión simulada (solo las claves que se pasan). */
async function setExt(page: Page, cfg: ExtCfg) {
  await page.evaluate((c) => Object.assign((window as unknown as { __fakeExt: FakeExt }).__fakeExt.cfg, c), cfg)
}

/** Los tipos de mensaje que ha recibido la extensión simulada, en orden. */
async function extCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __fakeExt: FakeExt }).__fakeExt.calls.map((c) => c.tipo))
}

/** ¿Ha contestado ya la extensión simulada a algún mensaje de este tipo? */
async function answered(page: Page, tipo: string): Promise<boolean> {
  return page.evaluate((t) => (window as unknown as { __fakeExt: FakeExt }).__fakeExt.calls.some((c) => c.tipo === t && c.answered), tipo)
}

// ─── la API ────────────────────────────────────────────────────

async function authHeaders(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  return { Authorization: `Bearer ${token}` }
}

type ApiOrder = { id: string; lines: Array<{ key: string }>; shop: { kind: string } }

async function superOrderFromApi(page: Page): Promise<ApiOrder> {
  const orders = (await (await page.request.get(`${API_URL}/shop-orders`, { headers: await authHeaders(page) })).json()) as ApiOrder[]
  const order = orders.find((o) => o.shop.kind === 'supermercado')
  expect(order).toBeTruthy()
  return order!
}

/** Cuerpos de los POST a la API cuya ruta acaba en `suffix`, en orden (también los que contesta `page.route`). */
function watchPosts(page: Page, suffix: string): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith(suffix)) bodies.push(r.postDataJSON())
  })
  return bodies
}

/** Contesta una llamada a la API sin que llegue (con las cabeceras CORS: la API está en otro origen). */
function fulfillApi(status: number, json: unknown) {
  return (route: Route) =>
    route.fulfill({
      status,
      json,
      headers: { 'access-control-allow-origin': route.request().headers()['origin'] ?? '*', 'access-control-allow-credentials': 'true' },
    })
}

// ─── la página ─────────────────────────────────────────────────

async function dismissOverlays(page: Page) {
  const later = page.getByRole('button', { name: 'No mostrar otra vez' })
  if (await later.isVisible({ timeout: 1_000 }).catch(() => false)) await later.click()
}

/** Un súper con web en tienda.example, los ITEMS en la lista y los pedidos preparados: la tarjeta del súper. */
async function superOrder(page: Page): Promise<Locator> {
  const headers = await authHeaders(page)
  const shop = await page.request.post(`${API_URL}/shops`, {
    headers,
    data: { name: 'Súper del barrio', kind: 'supermercado', channel: 'web', webUrl: 'https://tienda.example/', customerName: 'Ana' },
  })
  expect(shop.ok()).toBe(true)
  const list = await (await page.request.get(`${API_URL}/shopping-list`, { headers })).json()
  for (const name of ITEMS) {
    const r = await page.request.post(`${API_URL}/shopping-list/${list.id}/items`, { headers, data: { name, quantity: 1, unit: 'u', aisle: 'otros' } })
    expect(r.ok()).toBe(true)
  }
  await page.goto('/compra')
  await dismissOverlays(page)
  await page.getByRole('button', { name: /Preparar los pedidos/ }).click()
  const card = page.getByTestId('order-supermercado')
  await expect(card).toBeVisible({ timeout: 15_000 })
  return card
}

const sendButton = (card: Locator) => card.getByRole('button', { name: SEND, exact: true })
const anySendButton = (card: Locator) => card.getByRole('button', { name: /^Enviar a / })
const storeLinks = (card: Locator) => card.getByRole('button', { name: /Hacer este pedido en Carrefour/ })
const badge = (card: Locator, label: string) => card.locator('header').getByText(label, { exact: true })

/** Envía y espera el cuerpo de «enviado». */
async function sendOk(card: Locator): Promise<Locator> {
  await sendButton(card).click()
  const sent = card.getByTestId('basket-extension-sent')
  await expect(sent).toBeVisible({ timeout: 10_000 })
  return sent
}

async function expectAbove(a: Locator, b: Locator) {
  const [ba, bb] = [await a.boundingBox(), await b.boundingBox()]
  expect(ba && bb && ba.y + ba.height <= bb.y + 1).toBe(true)
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

/** Lo fijo que tapa la tarjeta en una captura de la tarjeta sola. */
const OVERLAYS =
  'nav[aria-label="Navegación principal"], button[aria-label="Danos tu opinión"], button[aria-label="Hablar con Mimo"], nextjs-portal { visibility: hidden !important; }'

async function shot(page: Page, name: string, target?: Locator) {
  const path = test.info().outputPath(`${name}.png`)
  if (target) await target.screenshot({ path, style: OVERLAYS })
  else await page.screenshot({ path, fullPage: true })
}

/** Apunta cada aviso (`role="alert"`) que aparezca en la tarjeta del súper, aunque desaparezca enseguida. */
async function recordAlerts(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { __alerts: string[] }).__alerts = seen
    new MutationObserver(() =>
      document.querySelectorAll('[data-testid="order-supermercado"] [role="alert"]').forEach((el) => {
        const t = el.textContent ?? ''
        if (t && !seen.includes(t)) seen.push(t)
      }),
    ).observe(document.body, { childList: true, subtree: true, characterData: true })
  })
}

const alertsSeen = (page: Page) => page.evaluate(() => (window as unknown as { __alerts: string[] }).__alerts)

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test.describe('móvil 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  // ─── cuándo sale el botón ────────────────────────────────────

  test('sin extensión: no hay botón y siguen los enlaces de la tienda', async ({ page }) => {
    const card = await superOrder(page)
    await expect(storeLinks(card)).toBeVisible({ timeout: 10_000 })
    await expect(anySendButton(card)).toHaveCount(0)
  })

  test('la extensión tarda más de 1,5 s en contestar al ping: no hay botón', async ({ page }) => {
    await fakeExtension(page, { ping: { delay: 2_500 } })
    const card = await superOrder(page)
    await expect(storeLinks(card)).toBeVisible({ timeout: 10_000 })
    // La respuesta tardía llega y no cambia nada.
    await expect.poll(() => answered(page, 'ping'), { timeout: 10_000 }).toBe(true)
    await expect(anySendButton(card)).toHaveCount(0)
    await expect(storeLinks(card)).toBeVisible()
  })

  test('la extensión no sabe llenar la web de esta tienda (hosts): no hay botón', async ({ page }) => {
    await fakeExtension(page, { ping: { value: { ok: true, protocolo: 1, version: 'e2e', hosts: ['otra.example'], etiqueta: ETIQUETA } } })
    const card = await superOrder(page)
    await expect(storeLinks(card)).toBeVisible({ timeout: 10_000 })
    expect(await extCalls(page)).toContain('ping')
    await expect(anySendButton(card)).toHaveCount(0)
  })

  test('interruptor apagado: sin botón y la extensión no recibe ningún mensaje', async ({ page }) => {
    await fakeExtension(page)
    // Por la API de verdad (cabeceras CORS incluidas), pero diciendo que no.
    await page.route('**/shop-extension/status', async (route) => route.fulfill({ response: await route.fetch(), json: { enabled: false } }))
    const card = await superOrder(page)
    await expect(storeLinks(card)).toBeVisible({ timeout: 10_000 })
    await expect(anySendButton(card)).toHaveCount(0)
    expect(await extCalls(page)).toEqual([])
  })

  test('cesta vacía (todo excluido): sin botón; al incluir una línea vuelve', async ({ page }) => {
    await fakeExtension(page)
    const card = await superOrder(page)
    await expect(sendButton(card)).toBeVisible({ timeout: 10_000 })

    const headers = await authHeaders(page)
    const order = await superOrderFromApi(page)
    const patch = (include: (key: string) => boolean) =>
      page.request.patch(`${API_URL}/shop-orders/${order.id}`, { headers, data: { lines: order.lines.map((l) => ({ key: l.key, include: include(l.key) })) } })
    expect((await patch(() => false)).ok()).toBe(true)
    await page.reload()
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => answered(page, 'ping'), { timeout: 10_000 }).toBe(true)
    // Ya se sabe que hay extensión; se da un momento al repintado antes de mirar lo que no está.
    await page.waitForTimeout(500)
    await expect(anySendButton(card)).toHaveCount(0)
    await expect(storeLinks(card)).toHaveCount(0)

    const first = order.lines[0].key
    expect((await patch((k) => k === first)).ok()).toBe(true)
    await page.reload()
    await expect(sendButton(page.getByTestId('order-supermercado'))).toBeVisible({ timeout: 15_000 })
  })

  // ─── enviar ──────────────────────────────────────────────────

  test('envío completo: «Enviando…», secciones, total, lo que añadió Mimoia; al recargar sigue enviado', async ({ page }) => {
    await fakeExtension(page, { enviar: { delay: 1_500, estados: MIXED, error: 'verificacion', bajoMinimo: true } })
    const card = await superOrder(page)
    await sendButton(card).click()

    const sending = card.getByRole('button', { name: `Enviando a ${ETIQUETA}…`, exact: true })
    await expect(sending).toBeVisible()
    await expect(sending).toBeDisabled()
    await expect(card.getByText(`Puede tardar un minuto. No cierres la pestaña de ${ETIQUETA}.`)).toBeVisible()
    await shot(page, 'm-enviando', card)

    const sent = card.getByTestId('basket-extension-sent')
    await expect(sent).toBeVisible({ timeout: 10_000 })
    const anadidas = await page.evaluate(
      () => ((window as unknown as { __fakeExt: { ultimo: { anadidas: number } } }).__fakeExt.ultimo.anadidas),
    )
    expect(anadidas).toBeGreaterThanOrEqual(2)
    const summary = `${anadidas} productos en tu carro de ${ETIQUETA} · total del carro: 12,5 €`
    await expect(sent.getByText(summary, { exact: true })).toBeVisible()
    await expect(badge(card, 'Enviado')).toBeVisible()
    await expect(sent.getByText(`Tu carro no llega al pedido mínimo de ${ETIQUETA}: añade algo más allí.`)).toBeVisible()

    await expect(sent.getByRole('heading', { name: 'Revísalo' })).toBeVisible()
    await expect(sent.getByText(`Los hemos buscado en ${ETIQUETA} y hemos puesto lo primero que salía.`)).toBeVisible()
    await expect(sent.getByText('Suavizante → Producto de suavizante × 1', { exact: true })).toBeVisible()
    await expect(sent.getByRole('heading', { name: 'Sin confirmar' })).toBeVisible()
    await expect(sent.getByText('Lejía', { exact: true })).toBeVisible()
    await expect(sent.getByRole('heading', { name: 'No han entrado' })).toBeVisible()
    await expect(sent.getByText(`Papel de cocina — no aparece en ${ETIQUETA}`, { exact: true })).toBeVisible()
    // Con líneas «Sin confirmar» no se repite el aviso general de la verificación.
    await expect(sent.getByText('Puede que algo no haya entrado; revisa tu carro.')).toHaveCount(0)

    const added = card.getByTestId('basket-extension-added')
    await expect(added).not.toHaveAttribute('open')
    await added.getByText('Lo que añadió Mimoia').click()
    await expect(added).toHaveAttribute('open')
    await expect(added.getByText('Producto de detergente × 1', { exact: true })).toBeVisible()
    await expect(added.getByText('Producto de suavizante × 1', { exact: true })).toBeVisible()
    await expect(added.getByText(/lejía|papel de cocina/i)).toHaveCount(0)
    await expectNoHorizontalScroll(page)
    await shot(page, 'm-enviado')
    await shot(page, 'm-enviado-tarjeta', card)

    // El id de la extensión es el de NEXT_PUBLIC_BASKET_EXTENSION_ID.
    const ids = await page.evaluate(() => (window as unknown as { __fakeExt: FakeExt }).__fakeExt.calls.map((c) => c.id))
    expect(new Set(ids)).toEqual(new Set([process.env.NEXT_PUBLIC_BASKET_EXTENSION_ID ?? 'e2e-basket-extension']))

    await page.reload()
    const again = page.getByTestId('order-supermercado')
    await expect(again.getByTestId('basket-extension-sent').getByText(summary, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(badge(again, 'Enviado')).toBeVisible()
    await expect(again.getByText(`Papel de cocina — no aparece en ${ETIQUETA}`, { exact: true })).toBeVisible()
  })

  test('errores del resultado: en borrador, encima del botón, y siguen al recargar', async ({ page }) => {
    await fakeExtension(page)
    const card = await superOrder(page)
    await expect(sendButton(card)).toBeVisible({ timeout: 10_000 })
    const cases = [
      ['contrato', `La web de ${ETIQUETA} no responde o ha cambiado; no hemos tocado tu carro.`],
      ['red', `La web de ${ETIQUETA} no responde o ha cambiado; no hemos tocado tu carro.`],
      ['sin_sesion', `Entra en tu cuenta de ${ETIQUETA} en este navegador y vuelve a pulsar.`],
      ['sin_zona', `Elige tu código postal en ${ETIQUETA} y vuelve a pulsar.`],
    ] as const
    for (const [error, text] of cases) {
      await setExt(page, { enviar: { error } })
      const saved = page.waitForResponse((r) => r.url().endsWith('/extension-result') && r.request().method() === 'POST')
      await sendButton(card).click()
      expect((await saved).status()).toBe(200)
      const alert = card.getByRole('alert').filter({ hasText: text })
      await expect(alert).toBeVisible({ timeout: 10_000 })
      await expect(card.getByRole('alert')).toHaveCount(1)
      await expectAbove(alert, sendButton(card))
      await expect(badge(card, 'Borrador')).toBeVisible()
      await expect(card.getByTestId('basket-extension-sent')).toHaveCount(0)
    }
    await shot(page, 'm-error-borrador', card)

    await page.reload()
    const again = page.getByTestId('order-supermercado')
    await expect(again.getByRole('alert').filter({ hasText: `Elige tu código postal en ${ETIQUETA} y vuelve a pulsar.` })).toBeVisible({ timeout: 15_000 })
    await expect(badge(again, 'Borrador')).toBeVisible()
  })

  test('no entra nada (todo fallida): los nombres salen de la foto de la cesta', async ({ page }) => {
    await fakeExtension(page, { enviar: { estados: { '*': 'fallida' } } })
    const card = await superOrder(page)
    const saved = page.waitForResponse((r) => r.url().endsWith('/extension-result') && r.request().method() === 'POST')
    await sendButton(card).click()
    await saved
    const alert = card.getByRole('alert').filter({ hasText: `No hemos encontrado estos productos en ${ETIQUETA}:` })
    await expect(alert).toBeVisible({ timeout: 10_000 })
    await expect(alert).toContainText('Detergente')
    await expect(alert).toContainText('Papel de cocina')
    await expect(badge(card, 'Borrador')).toBeVisible()
    await shot(page, 'm-todo-fallida', card)

    // Fuera del pedido, «Papel de cocina» ya no está en las líneas: su nombre sale de la foto guardada.
    await card.getByRole('button', { name: 'Quitar Papel de cocina', exact: true }).click()
    await expect(card.getByRole('button', { name: 'Quitar Papel de cocina', exact: true })).toHaveCount(0, { timeout: 10_000 })
    await expect(alert).toContainText('Papel de cocina')
    await expect(alert).not.toContainText('un producto')
  })

  test('lo que contesta la extensión se valida: sin un resultado válido no va nada a la API; las claves de más no pasan', async ({ page }) => {
    await fakeExtension(page, { enviar: { lastError: true } })
    const posts = watchPosts(page, '/extension-result')
    const card = await superOrder(page)

    // lastError: el aviso sale al momento, sin esperar los 180 s.
    await sendButton(card).click()
    await expect(card.getByRole('alert').filter({ hasText: NO_ANSWER })).toBeVisible({ timeout: 5_000 })
    expect(posts).toHaveLength(0)

    // Algo que no es un resultado (la extensión falla por dentro): lo mismo, y nada a la API.
    await setExt(page, { enviar: { value: { ok: false, error: 'red' } } })
    await sendButton(card).click()
    await expect.poll(async () => (await extCalls(page)).filter((t) => t === 'enviar').length).toBe(2)
    await expect.poll(() => page.evaluate(() => (window as unknown as { __fakeExt: FakeExt }).__fakeExt.calls.every((c) => c.answered))).toBe(true)
    await expect(sendButton(card)).toBeEnabled()
    await expect(card.getByRole('alert').filter({ hasText: NO_ANSWER })).toBeVisible()
    expect(posts).toHaveLength(0)

    // Un resultado con claves de más: a la API solo va lo del protocolo.
    await setExt(page, { enviar: { extra: true } })
    await sendOk(card)
    expect(posts).toHaveLength(1)
    const body = posts[0] as { envioId: string; lineas: Array<Record<string, unknown>> }
    expect(body.envioId).toBe('e2e-1')
    expect(body).not.toHaveProperty('secreto')
    expect(body.lineas.length).toBeGreaterThan(0)
    for (const l of body.lineas) expect(l).not.toHaveProperty('pista')
  })

  test('403 al guardar: su aviso y una sola petición; un 500 se guarda al segundo intento', async ({ page }) => {
    await fakeExtension(page)
    const posts = watchPosts(page, '/extension-result')
    const card = await superOrder(page)

    await page.route('**/shop-orders/*/extension-result', fulfillApi(403, { error: 'No disponible.' }))
    await sendButton(card).click()
    const forbidden = card.getByRole('alert').filter({
      hasText: `Esta función no está activada para tu cuenta. Revisa tu carro de ${ETIQUETA} por si ha entrado algo.`,
    })
    await expect(forbidden).toBeVisible({ timeout: 10_000 })
    await expect(forbidden).not.toContainText('no se duplica')
    expect(posts).toHaveLength(1)
    await page.unroute('**/shop-orders/*/extension-result')

    // Ahora la API falla una vez (500) y luego funciona: se guarda al segundo intento, sin aviso.
    let calls = 0
    await page.route('**/shop-orders/*/extension-result', async (route) => {
      calls += 1
      if (calls === 1) return fulfillApi(500, { error: 'Internal server error' })(route)
      return route.continue()
    })
    await sendOk(card)
    expect(posts).toHaveLength(3)
    expect(calls).toBe(2)
    expect(posts[2]).toMatchObject({ envioId: 'e2e-1', repetido: true })
    await expect(card.getByRole('alert')).toHaveCount(0)
  })

  test('sin respuesta al enviar: aviso; al volver a pulsar llega el mismo envío (repetido) y queda enviado', async ({ page }) => {
    await page.clock.install()
    await fakeExtension(page, { enviar: { silent: true } })
    const posts = watchPosts(page, '/extension-result')
    const card = await superOrder(page)
    await sendButton(card).click()
    await expect(card.getByRole('button', { name: `Enviando a ${ETIQUETA}…` })).toBeDisabled()
    await page.clock.fastForward(181_000)
    await expect(card.getByRole('alert').filter({ hasText: NO_ANSWER })).toBeVisible({ timeout: 10_000 })
    expect(posts).toHaveLength(0)

    await setExt(page, { enviar: {} })
    await sendOk(card)
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ envioId: 'e2e-1', repetido: true })
  })

  test('reenvío tras «Ya lo he quitado yo»: si la extensión no lo olvida, aviso; si lo olvida, envío nuevo', async ({ page }) => {
    await fakeExtension(page)
    const posts = watchPosts(page, '/extension-result')
    const card = await superOrder(page)
    await sendOk(card)

    // Deshecho a mano: la extensión de este navegador sigue recordando el envío.
    await setExt(page, { deshacer: { value: { ok: false, error: 'nada_que_deshacer' } }, olvidar: { noOlvida: true } })
    await card.getByRole('button', { name: UNDO }).click()
    await card.getByRole('button', { name: MANUAL }).click()
    await expect(card.getByText(UNDONE)).toBeVisible({ timeout: 10_000 })
    await expect(badge(card, 'Borrador')).toBeVisible()

    await sendButton(card).click()
    await expect(card.getByRole('alert').filter({ hasText: 'No hemos podido rehacer el envío. Vuelve a pulsar.' })).toBeVisible({ timeout: 10_000 })
    expect((await extCalls(page)).slice(-3)).toEqual(['enviar', 'olvidar', 'enviar'])
    expect(posts.map((p) => p.envioId)).toEqual(['e2e-1', 'e2e-1', 'e2e-1'])
    await expect(badge(card, 'Borrador')).toBeVisible()

    await setExt(page, { olvidar: {} })
    await sendOk(card)
    expect(posts.map((p) => p.envioId)).toEqual(['e2e-1', 'e2e-1', 'e2e-1', 'e2e-1', 'e2e-2'])
    await expect(badge(card, 'Enviado')).toBeVisible()
  })

  // ─── deshacer ────────────────────────────────────────────────

  test('deshacer: mientras espera, «Quitando…» y «Ya está pedido» desactivados; después, «Envío deshecho»', async ({ page }) => {
    await fakeExtension(page, { deshacer: { delay: 1_500 } })
    const posts = watchPosts(page, '/extension-undo')
    const card = await superOrder(page)
    await sendOk(card)
    await card.getByRole('button', { name: UNDO }).click()

    await expect(card.getByRole('button', { name: 'Quitando…' })).toBeDisabled()
    await expect(card.getByRole('button', { name: 'Ya está pedido' })).toBeDisabled()
    await expect(card.getByText(`Puede tardar un poco. No cierres la pestaña de ${ETIQUETA}.`)).toBeVisible()
    await shot(page, 'm-quitando', card)

    await expect(card.getByText(UNDONE)).toBeVisible({ timeout: 10_000 })
    await expect(sendButton(card)).toBeVisible()
    await expect(badge(card, 'Borrador')).toBeVisible()
    expect(posts).toEqual([{ manual: false }])
  })

  test('deshacer sin extensión en la página: aviso para quitarlo a mano al momento', async ({ page }) => {
    await fakeExtension(page)
    const card = await superOrder(page)
    const sent = await sendOk(card)
    const before = (await extCalls(page)).length
    await page.evaluate(() => delete (window as unknown as { chrome: { runtime: { sendMessage?: unknown } } }).chrome.runtime.sendMessage)

    await card.getByRole('button', { name: UNDO }).click()
    await expect(sent.getByText(/^En este navegador no hay nada que quitar\./)).toBeVisible({ timeout: 2_000 })
    await expect(card.getByRole('button', { name: MANUAL })).toBeVisible()
    await expect(card.getByTestId('basket-extension-added')).toHaveAttribute('open')
    await expect(card.getByRole('alert')).toHaveCount(0)
    expect(await extCalls(page)).toHaveLength(before)
  })

  test('deshacer con error: sin sesión, red (genérico), contrato (aviso, quitar a mano, abierto); volver a pulsar oculta «Ya lo he quitado yo»', async ({ page }) => {
    await fakeExtension(page)
    const card = await superOrder(page)
    const sent = await sendOk(card)
    const undo = card.getByRole('button', { name: UNDO })
    const manualText = sent.getByText(`También puedes quitarlo a mano en tu carro de ${ETIQUETA}. Cuando ya no esté, pulsa «Ya lo he quitado yo».`)
    const generic = card.getByRole('alert').filter({ hasText: 'No hemos podido deshacerlo. Vuelve a intentarlo.' })
    const added = card.getByTestId('basket-extension-added')

    await setExt(page, { deshacer: { value: { ok: false, error: 'sin_sesion' } } })
    await undo.click()
    await expect(card.getByRole('alert').filter({ hasText: `Entra en tu cuenta de ${ETIQUETA} en este navegador y vuelve a intentarlo.` })).toBeVisible({ timeout: 10_000 })
    await expect(card.getByRole('button', { name: MANUAL })).toHaveCount(0)

    await setExt(page, { deshacer: { value: { ok: false, error: 'red' } } })
    await undo.click()
    await expect(generic).toBeVisible({ timeout: 10_000 })
    await expect(card.getByRole('button', { name: MANUAL })).toHaveCount(0)
    await expect(added).not.toHaveAttribute('open')

    await setExt(page, { deshacer: { value: { ok: false, error: 'contrato' } } })
    await undo.click()
    await expect(manualText).toBeVisible({ timeout: 10_000 })
    await expect(generic).toBeVisible()
    await expectAbove(generic, manualText)
    await expectAbove(generic, added)
    await expect(added).toHaveAttribute('open')
    await expect(card.getByRole('button', { name: MANUAL })).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shot(page, 'm-deshacer-contrato', card)

    // Otro intento: lo que se dijo antes («Ya lo he quitado yo») ya no vale mientras espera.
    await setExt(page, { deshacer: { delay: 4_000 } })
    await undo.click()
    await expect(card.getByRole('button', { name: 'Quitando…' })).toBeVisible()
    await expect(card.getByRole('button', { name: MANUAL })).toHaveCount(0, { timeout: 1_000 })
    await expect(card.getByRole('button', { name: 'Quitando…' })).toBeVisible() // sigue esperando
    await expect(card.getByText(UNDONE)).toBeVisible({ timeout: 10_000 })
  })

  test('deshacer que no contesta: «No sabemos si se ha quitado»', async ({ page }) => {
    await page.clock.install()
    await fakeExtension(page, { deshacer: { silent: true } })
    const posts = watchPosts(page, '/extension-undo')
    const card = await superOrder(page)
    await sendOk(card)
    await card.getByRole('button', { name: UNDO }).click()
    await expect(card.getByRole('button', { name: 'Quitando…' })).toBeDisabled()
    await page.clock.fastForward(181_000)
    await expect(card.getByRole('alert').filter({ hasText: 'No sabemos si se ha quitado; mira tu carro.' })).toBeVisible({ timeout: 10_000 })
    // No es «sin extensión»: no se ofrece quitarlo a mano, y el pedido sigue enviado.
    await expect(card.getByRole('button', { name: MANUAL })).toHaveCount(0)
    await expect(badge(card, 'Enviado')).toBeVisible()
    expect(posts).toHaveLength(0)
  })

  test('la extensión resta pero no se puede guardar: aviso; al volver a pulsar, quitar a mano; el segundo «Ya lo he quitado yo» (409) sin error', async ({ page }) => {
    await fakeExtension(page)
    const posts = watchPosts(page, '/extension-undo')
    const card = await superOrder(page)
    await sendOk(card)

    await page.route('**/shop-orders/*/extension-undo', fulfillApi(500, { error: 'Internal server error' }))
    await card.getByRole('button', { name: UNDO }).click()
    await expect(
      card.getByRole('alert').filter({ hasText: 'Lo hemos quitado de tu carro, pero no hemos podido guardarlo. Vuelve a pulsar.' }),
    ).toBeVisible({ timeout: 15_000 })
    expect(posts).toHaveLength(3)
    await expect(badge(card, 'Enviado')).toBeVisible()
    await page.unroute('**/shop-orders/*/extension-undo')

    // La extensión ya lo restó: al volver a pulsar no tiene nada que deshacer.
    await card.getByRole('button', { name: UNDO }).click()
    await expect(card.getByText(/^En este navegador no hay nada que quitar\./)).toBeVisible({ timeout: 10_000 })
    await expect(card.getByRole('alert')).toHaveCount(0)
    expect(posts).toHaveLength(3)

    // Otro miembro del hogar lo marca antes («Ya lo he quitado yo» desde su móvil).
    const order = await superOrderFromApi(page)
    const first = await page.request.post(`${API_URL}/shop-orders/${order.id}/extension-undo`, { headers: await authHeaders(page), data: { manual: true } })
    expect(first.ok()).toBe(true)

    // Tras deshacer se recarga el pedido, y la tarjeta pasa a borrador antes de que se pueda pintar un
    // error: para ver si el 409 se toma por un error, esa recarga falla y la tarjeta se queda como estaba.
    const ordersList = (url: URL) => url.pathname === '/shop-orders'
    await page.route(ordersList, (route) => (route.request().method() === 'GET' ? route.abort() : route.fallback()))
    await recordAlerts(page)
    const second = page.waitForResponse((r) => r.url().endsWith('/extension-undo') && r.request().method() === 'POST')
    await card.getByRole('button', { name: MANUAL }).click()
    expect((await second).status()).toBe(409)
    // Ha terminado (la recarga, con su reintento, también): el botón vuelve a estar como antes.
    await expect(card.getByRole('button', { name: MANUAL })).toBeEnabled({ timeout: 20_000 })
    expect(await alertsSeen(page)).toEqual([])
    await expect(card.getByRole('alert')).toHaveCount(0)
    expect(posts.at(-1)).toEqual({ manual: true })

    await page.unroute(ordersList)
    await page.reload()
    await expect(page.getByTestId('order-supermercado').getByText(UNDONE)).toBeVisible({ timeout: 15_000 })
  })

  // ─── cerrar y pedidos de antes ───────────────────────────────

  test('«Ya está pedido» con un envío vivo: en la lista solo quedan tachadas las que entraron', async ({ page }) => {
    await fakeExtension(page, { enviar: { estados: MIXED } })
    const card = await superOrder(page)
    await sendOk(card)
    await card.getByRole('button', { name: 'Ya está pedido' }).click()
    // Cerrado, sale de los pedidos abiertos.
    await expect(page.getByText('Pedidos cerrados · 1')).toBeVisible({ timeout: 10_000 })
    await expect(card).toHaveCount(0)

    await page.goto('/shopping')
    await dismissOverlays(page)
    const row = (name: RegExp) => page.locator('li').filter({ has: page.getByText(name) })
    const expectBought = async (name: RegExp, bought: boolean) => {
      const r = row(name)
      await expect(r).toHaveCount(1, { timeout: 15_000 })
      await expect(r.getByRole('button', { name: 'Marcar como comprado' })).toHaveAttribute('aria-pressed', String(bought))
      if (bought) await expect(r.getByText(name)).toHaveClass(/line-through/)
      else await expect(r.getByText(name)).not.toHaveClass(/line-through/)
    }
    await expectBought(/^detergente$/i, true) // tabla
    await expectBought(/^suavizante$/i, true) // búsqueda
    await expectBought(/^lejía$/i, false) // sin confirmar
    await expectBought(/^papel de cocina$/i, false) // no entró
  })

  test('pedido de antes, enviado sin resultado de la extensión: el cuerpo de enviado de siempre', async ({ page }) => {
    await fakeExtension(page)
    await superOrder(page)
    const order = await superOrderFromApi(page)
    const r = await page.request.post(`${API_URL}/shop-orders/${order.id}/sent`, { headers: await authHeaders(page) })
    expect(r.ok()).toBe(true)

    await page.reload()
    const card = page.getByTestId('order-supermercado')
    await expect(badge(card, 'Enviado')).toBeVisible({ timeout: 15_000 })
    await expect(card.getByText(/^Enviado\. Cuando te conteste, pega aquí su respuesta/)).toBeVisible()
    await expect(card.getByTestId('basket-extension-sent')).toHaveCount(0)
    await expect(card.getByRole('button', { name: UNDO })).toHaveCount(0)
  })
})

test.describe('escritorio 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('envío completo y quitarlo a mano, sin scroll horizontal', async ({ page }) => {
    await fakeExtension(page, { enviar: { estados: MIXED, bajoMinimo: true } })
    const card = await superOrder(page)
    await expect(sendButton(card)).toBeVisible({ timeout: 10_000 })
    await expectNoHorizontalScroll(page)
    await shot(page, 'd-borrador', card)

    const sent = await sendOk(card)
    await expect(sent.getByRole('heading', { name: 'Revísalo' })).toBeVisible()
    await expect(sent.getByRole('heading', { name: 'Sin confirmar' })).toBeVisible()
    await expect(sent.getByRole('heading', { name: 'No han entrado' })).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shot(page, 'd-enviado')

    await setExt(page, { deshacer: { value: { ok: false, error: 'contrato' } } })
    await card.getByRole('button', { name: UNDO }).click()
    await expect(card.getByRole('button', { name: MANUAL })).toBeVisible({ timeout: 10_000 })
    await expect(card.getByTestId('basket-extension-added')).toHaveAttribute('open')
    await expectNoHorizontalScroll(page)
    await shot(page, 'd-deshacer-contrato', card)
  })
})
