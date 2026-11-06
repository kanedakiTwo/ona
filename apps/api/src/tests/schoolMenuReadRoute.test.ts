/**
 * PRO-355: `POST /school-menu/read` never answers a bare 500. The real router
 * on an ephemeral port with a fake session and a fake reader (no Anthropic
 * call). 2026-10-22: two 500s from Safari on an iPhone right after «Menú del
 * cole» showed to every household with children.
 *
 *   HEIC photo (type or name)        → 415 + what to do instead
 *   PDF > 20 MB or > 100 pages       → 413 before calling the reader
 *   file > 25 MB                     → 413 (multer)
 *   not a school menu                → 422 NotASchoolMenuError's words
 *   the model says «too large»       → 413
 *   the reader fails otherwise       → 503 «No he podido leer el menú ahora…»
 *
 * Run: pnpm --filter @ona/api test src/tests/schoolMenuReadRoute.test.ts
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {} }))
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    const userId = req.get('x-test-user')
    if (!userId) return void res.status(401).json({ error: 'No token provided' })
    req.userId = userId
    req.user = { id: userId, role: 'user', suspendedAt: null }
    next()
  },
}))
vi.mock('../middleware/spendCap.js', () => ({ requireSpendCapacity: () => (_req: any, _res: any, next: any) => next() }))

const { default: schoolMenuRouter, setSchoolMenuReaderForTests, SCHOOL_MENU_FILE_HELP, SCHOOL_MENU_READ_FAILED } = await import('../routes/schoolMenu.js')
const { NotASchoolMenuError } = await import('@ona/shared')
const { assertPdfFitsReader, isHeicUpload, pdfPageCount } = await import('../services/schoolMenu.js')
const { errorHandler } = await import('../middleware/errorHandler.js')

const reader = vi.fn<(...args: any[]) => Promise<unknown>>()
let server: Server
let base = ''

beforeAll(async () => {
  const app = express()
  app.use(schoolMenuRouter)
  app.use(errorHandler)
  server = app.listen(0)
  await new Promise<void>((r) => server.once('listening', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  setSchoolMenuReaderForTests(reader as any)
})
afterAll(async () => {
  setSchoolMenuReaderForTests(undefined)
  await new Promise<void>((r) => server.close(() => r()))
})
beforeEach(() => {
  reader.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

async function upload(bytes: Uint8Array, type: string, name: string) {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type }), name)
  const r = await fetch(`${base}/school-menu/read`, { method: 'POST', headers: { 'x-test-user': 'u1' }, body: form })
  return { status: r.status, body: (await r.json().catch(() => null)) as any }
}

/** The first bytes of an iPhone HEIC (`ftypheic`). */
const HEIC = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])
/** A PDF with `pages` page objects (uncompressed, as a scanner writes them). */
const pdfWith = (pages: number) => Buffer.from(`%PDF-1.4\n${'<< /Type /Page /Parent 1 0 R >>\n'.repeat(pages)}<< /Type /Pages /Count ${pages} >>\n%%EOF`, 'latin1')
const A_MENU = { days: [{ date: '2026-11-02', dish: 'Lentejas con verduras', group: 'legumbre' }] }

describe('POST /school-menu/read', () => {
  it('a HEIC photo → 415 with what to do, without calling the reader', async () => {
    for (const [type, name] of [
      ['image/heic', 'IMG_0001.HEIC'],
      ['image/heif', 'menu.heif'],
      ['application/octet-stream', 'IMG_0002.heic'],
    ]) {
      const r = await upload(HEIC, type, name)
      expect(r.status).toBe(415)
      expect(r.body).toEqual({ error: SCHOOL_MENU_FILE_HELP.heic, code: 'HEIC' })
    }
    expect(SCHOOL_MENU_FILE_HELP.heic).toMatch(/captura de pantalla/)
    expect(reader).not.toHaveBeenCalled()
  })

  it('a PDF of many pages → 413 before the reader; one of a few pages is read', async () => {
    const big = await upload(pdfWith(101), 'application/pdf', 'menus-curso.pdf')
    expect(big.status).toBe(413)
    expect(big.body).toEqual({ error: SCHOOL_MENU_FILE_HELP.too_big, code: 'TOO_BIG' })
    expect(reader).not.toHaveBeenCalled()

    reader.mockResolvedValueOnce(A_MENU)
    const ok = await upload(pdfWith(3), 'application/pdf', 'noviembre.pdf')
    expect(ok.status).toBe(200)
    expect(ok.body.days).toEqual(A_MENU.days)
  })

  it('a PDF over 20 MB → 413 «solo la página del menú del mes»; over 25 MB → 413 from the upload', async () => {
    const big = await upload(new Uint8Array(21 * 1024 * 1024), 'application/pdf', 'menu.pdf')
    expect(big.status).toBe(413)
    expect(big.body.error).toMatch(/solo la página del menú del mes/)
    const huge = await upload(new Uint8Array(26 * 1024 * 1024), 'application/pdf', 'menu.pdf')
    expect(huge.status).toBe(413)
    expect(huge.body.error).toMatch(/demasiado grande/)
    expect(reader).not.toHaveBeenCalled()
  })

  it('a file that is not a school menu → 422 NotASchoolMenuError', async () => {
    reader.mockResolvedValueOnce({ error: 'not_a_school_menu' })
    const r = await upload(pdfWith(1), 'application/pdf', 'factura.pdf')
    expect(r.status).toBe(422)
    expect(r.body.error).toBe(new NotASchoolMenuError().message)
  })

  it('the model refusing the size → 413; any other failure → 503 in Spanish, never 500', async () => {
    reader.mockRejectedValueOnce(Object.assign(new Error('400 {"type":"error","error":{"message":"A maximum of 100 PDF pages may be provided."}}'), { status: 400 }))
    const pages = await upload(pdfWith(1), 'application/pdf', 'menu.pdf')
    expect(pages.status).toBe(413)
    expect(pages.body.code).toBe('TOO_BIG')
    reader.mockRejectedValueOnce(Object.assign(new Error('request_too_large'), { status: 413 }))
    expect((await upload(pdfWith(1), 'application/pdf', 'menu.pdf')).status).toBe(413)
    reader.mockRejectedValueOnce(new Error('overloaded'))
    const down = await upload(pdfWith(1), 'application/pdf', 'menu.pdf')
    expect(down.status).toBe(503)
    expect(down.body.error).toBe(SCHOOL_MENU_READ_FAILED)
  })

  it('no file or another type → 400 asking for a photo or a PDF', async () => {
    const r = await upload(Uint8Array.from([1, 2, 3]), 'text/plain', 'menu.txt')
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/foto .*PDF/)
  })
})

describe('the file checks', () => {
  it('HEIC by type or by name', () => {
    expect(isHeicUpload('image/heic')).toBe(true)
    expect(isHeicUpload('image/HEIF-sequence')).toBe(true)
    expect(isHeicUpload('application/octet-stream', 'IMG_1234.HEIC ')).toBe(true)
    expect(isHeicUpload('image/jpeg', 'IMG_1234.jpg')).toBe(false)
    expect(isHeicUpload(undefined)).toBe(false)
  })

  it('PDF pages: `/Type /Page` counted, `/Pages` not; packed streams count 0 (not checked)', () => {
    expect(pdfPageCount(pdfWith(7))).toBe(7)
    expect(pdfPageCount(Buffer.from('%PDF-1.7 /Type/ObjStm stream…'))).toBe(0)
    expect(() => assertPdfFitsReader(pdfWith(100))).not.toThrow()
    expect(() => assertPdfFitsReader(pdfWith(101))).toThrow(/too big/)
  })
})
