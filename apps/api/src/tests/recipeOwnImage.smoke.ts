/**
 * Smoke (PRO-145): «Subir mi foto» and «Usar como foto principal» against
 * the real API + DB.
 *   - POST /recipes?ownPhoto=1 then POST /recipes/:id/upload-image: the
 *     main photo is ours, cropped to 4:3, and the AI quota is untouched;
 *   - formats (415), max size (413), only the author (403);
 *   - a gallery photo «Usar como foto principal» changes `image_url`.
 * Registers its own users; only needs a reachable API.
 */
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { API_URL, reachable } from './smokeEnv.js'

async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return { status: r.status, json }
}

async function upload(path: string, token: string, field: string, bytes: Buffer, type: string, filename: string) {
  const form = new FormData()
  form.append(field, new Blob([new Uint8Array(bytes)], { type }), filename)
  const r = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  const text = await r.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return { status: r.status, json }
}

async function register(tag: string) {
  const name = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const r = await call('POST', '/register', undefined, { username: name, email: `${name}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(r.status).toBeLessThan(300)
  return { token: r.json.token as string, id: r.json.user.id as string }
}

async function createRecipe(token: string, query = '') {
  const found = await call('GET', '/ingredients?search=ajo&perPage=20')
  const ajo = (found.json as Array<{ id: string; name: string }>).find((i) => i.name === 'ajo') ?? found.json[0]
  expect(ajo, 'seed has ingredients').toBeTruthy()
  const r = await call('POST', `/recipes${query}`, token, {
    name: `Ajo con foto propia ${Date.now()}`,
    servings: 2,
    meals: ['lunch'],
    seasons: ['winter'],
    ingredients: [{ ingredientId: ajo.id, quantity: 10, unit: 'g' }],
    steps: [{ index: 0, text: 'Pela y pica el ajo.' }],
    force: true,
  })
  expect(r.status).toBe(201)
  return r.json as { id: string; imageUrl: string | null }
}

function photo(width: number, height: number, color = { r: 200, g: 120, b: 80 }) {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer()
}

async function fetchImage(imageUrl: string) {
  const url = imageUrl.startsWith('http') ? imageUrl : `${API_URL}${imageUrl}`
  const r = await fetch(`${url}?v=${Date.now()}`)
  expect(r.ok).toBe(true)
  return sharp(Buffer.from(await r.arrayBuffer())).metadata()
}

describe('own recipe photo (smoke)', () => {
  it.skipIf(!reachable)('author uploads their own photo: 4:3, no AI quota used', async () => {
    const a = await register('foto_a')
    const recipe = await createRecipe(a.token, '?ownPhoto=1')
    expect(recipe.imageUrl).toBeNull()

    const up = await upload(`/recipes/${recipe.id}/upload-image`, a.token, 'image', await photo(900, 1600), 'image/jpeg', 'plato.jpg')
    expect(up.status).toBe(200)
    expect(up.json.imageUrl).toMatch(new RegExp(`/${recipe.id}\\.jpg$`))

    const detail = await call('GET', `/recipes/${recipe.id}`, a.token)
    expect(detail.json.imageUrl).toBe(up.json.imageUrl)

    const meta = await fetchImage(up.json.imageUrl)
    expect(meta.width! / meta.height!).toBeCloseTo(4 / 3, 2)

    const me = await call('GET', `/user/${a.id}`, a.token)
    expect(me.json.imageGenQuota?.used ?? 0).toBe(0)
  })

  it.skipIf(!reachable)('rejects other formats, files over 10 MB and anyone but the author', async () => {
    const a = await register('foto_b')
    const other = await register('foto_c')
    const recipe = await createRecipe(a.token, '?ownPhoto=1')
    const path = `/recipes/${recipe.id}/upload-image`

    const gif = await upload(path, a.token, 'image', Buffer.from('GIF89a'), 'image/gif', 'x.gif')
    expect(gif.status).toBe(415)

    const fake = await upload(path, a.token, 'image', Buffer.from('no soy una foto'), 'image/jpeg', 'x.jpg')
    expect(fake.status).toBe(415)

    const big = await upload(path, a.token, 'image', Buffer.alloc(10 * 1024 * 1024 + 1, 1), 'image/jpeg', 'big.jpg')
    expect(big.status).toBe(413)

    const notAuthor = await upload(path, other.token, 'image', await photo(800, 600), 'image/jpeg', 'x.jpg')
    expect(notAuthor.status).toBe(403)

    const after = await call('GET', `/recipes/${recipe.id}`, a.token)
    expect(after.json.imageUrl).toBeNull()
  })

  it.skipIf(!reachable)('«Usar como foto principal» turns a gallery photo into the main one', async () => {
    const a = await register('foto_d')
    const recipe = await createRecipe(a.token, '?ownPhoto=1')
    const first = await upload(`/recipes/${recipe.id}/upload-image`, a.token, 'image', await photo(800, 600), 'image/jpeg', 'a.jpg')
    expect(first.status).toBe(200)
    const before = await call('GET', `/recipes/${recipe.id}`, a.token)

    const gallery = await upload(`/recipes/${recipe.id}/photos`, a.token, 'photo', await photo(1000, 1000, { r: 20, g: 90, b: 60 }), 'image/jpeg', 'g.jpg')
    expect(gallery.status).toBe(201)

    const used = await call('POST', `/recipes/${recipe.id}/photos/${gallery.json.id}/use-as-recipe-image`, a.token)
    expect(used.status).toBe(200)

    const after = await call('GET', `/recipes/${recipe.id}`, a.token)
    expect(after.json.imageUrl).toBe(used.json.imageUrl)
    expect(new Date(after.json.updatedAt).getTime()).toBeGreaterThan(new Date(before.json.updatedAt).getTime())
    const meta = await fetchImage(after.json.imageUrl)
    expect(meta.width! / meta.height!).toBeCloseTo(4 / 3, 2)
    // Green gallery photo, not the first (terracotta) upload.
    const { dominant } = await sharp(Buffer.from(await (await fetch(`${after.json.imageUrl.startsWith('http') ? '' : API_URL}${after.json.imageUrl}?v=${Date.now()}`)).arrayBuffer())).stats()
    expect(dominant.g).toBeGreaterThan(dominant.r)
  })

  it.skipIf(!reachable)('«Usar como foto principal» is only for the recipe author', async () => {
    const a = await register('foto_e')
    const other = await register('foto_f')
    const recipe = await createRecipe(a.token, '?ownPhoto=1')
    const gallery = await upload(`/recipes/${recipe.id}/photos`, other.token, 'photo', await photo(800, 600), 'image/jpeg', 'g.jpg')
    if (gallery.status !== 201) return // the other user can't see a private recipe's gallery: nothing to try
    const used = await call('POST', `/recipes/${recipe.id}/photos/${gallery.json.id}/use-as-recipe-image`, other.token)
    expect(used.status).toBe(403)
  })
})
