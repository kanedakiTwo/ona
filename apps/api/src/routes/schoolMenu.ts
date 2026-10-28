/**
 * Menú del comedor escolar (PRO-224). Per-route auth (no catch-all), so it
 * can be mounted anywhere. Household scope: the caller's primary household.
 *
 *   GET    /school-menu?from=&to=   saved days + whether the app shows the option
 *   POST   /school-menu/read        photo / PDF → the days read (not saved)
 *   PUT    /school-menu             save days (replace those dates) / clear dates
 */
import { Router, type RequestHandler } from 'express'
import multer from 'multer'
import { schoolMenuSaveSchema } from '@ona/shared'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { requireSpendCapacity } from '../middleware/spendCap.js'
import { getPrimaryHouseholdId } from '../services/scopeResolver.js'
import { runWithCostUser } from '../services/costLedger.js'
import { addDays, madridParts } from '../services/madridTime.js'
import {
  NotASchoolMenuError,
  SchoolMenuFileError,
  householdShowsSchoolMenu,
  isHeicUpload,
  isSchoolMenuMimeType,
  loadSchoolLunches,
  readSchoolMenu,
  saveSchoolLunches,
  type SchoolMenuReader,
} from '../services/schoolMenu.js'

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Tests swap the reader (no Anthropic call). */
let reader: SchoolMenuReader | undefined
export function setSchoolMenuReaderForTests(r: SchoolMenuReader | undefined): void {
  reader = r
}

const upload = multer({
  storage: multer.memoryStorage(),
  // Photos are made smaller before reading (visionImage.ts); a 48 MP camera JPEG fits.
  limits: { fileSize: 25 * 1024 * 1024 },
  // HEIC gets through so the route can say what to do with it (PRO-355).
  fileFilter: (_req, file, cb) => cb(null, isSchoolMenuMimeType(file.mimetype) || isHeicUpload(file.mimetype, file.originalname)),
})

/** Said to the household instead of «Internal server error» (2026-10-23). */
export const SCHOOL_MENU_READ_FAILED = 'No he podido leer el menú ahora. Prueba otra vez en un momento o mándamelo por WhatsApp con «menú del cole».'

/** What to do instead with a file the reader can't take (PRO-355). */
export const SCHOOL_MENU_FILE_HELP = {
  heic: 'Esa foto está en HEIC, el formato del iPhone, y no la puedo leer. Haz una captura de pantalla de la foto y sube la captura, o mándamela por WhatsApp con «menú del cole».',
  too_big: 'Ese archivo es demasiado grande para leerlo (un PDF, como mucho 20 MB y 100 páginas). Sube solo la página del menú del mes, o una foto o captura de esa página.',
} as const

/** multer's own errors (too big…) answer in Spanish, not as a 500. */
const uploadFile: RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next()
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'El archivo es demasiado grande (máximo 25 MB). Prueba con una foto o un PDF más pequeño.' })
      return
    }
    next(err)
  })
}

const router = Router()

router.get('/school-menu', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const householdId = await getPrimaryHouseholdId(req.userId!)
    const today = madridParts(new Date()).isoDate
    const from = typeof req.query.from === 'string' && ISO.test(req.query.from) ? req.query.from : addDays(today, -7)
    const to = typeof req.query.to === 'string' && ISO.test(req.query.to) ? req.query.to : addDays(today, 62)
    const [days, visible] = householdId
      ? await Promise.all([loadSchoolLunches(householdId, from, to), householdShowsSchoolMenu(householdId)])
      : [[], false]
    res.json({ days, visible, from, to })
  } catch (err) {
    next(err)
  }
})

router.post('/school-menu/read', authMiddleware, requireSpendCapacity(), uploadFile, async (req: AuthRequest, res) => {
  try {
    const file = req.file
    if (file && isHeicUpload(file.mimetype, file.originalname)) {
      res.status(415).json({ error: SCHOOL_MENU_FILE_HELP.heic, code: 'HEIC' })
      return
    }
    if (!file || !isSchoolMenuMimeType(file.mimetype)) {
      res.status(400).json({ error: 'Sube una foto (JPG, PNG o WEBP) o un PDF del menú del cole.' })
      return
    }
    const today = madridParts(new Date()).isoDate
    const days = await runWithCostUser(req.userId ?? null, () =>
      readSchoolMenu({ data: file.buffer, mimeType: file.mimetype as any }, today, req.userId ?? null, reader),
    )
    res.json({ days })
  } catch (err) {
    if (err instanceof NotASchoolMenuError) {
      res.status(422).json({ error: err.message })
      return
    }
    if (err instanceof SchoolMenuFileError) {
      const heic = err.reason === 'heic'
      res.status(heic ? 415 : 413).json({ error: SCHOOL_MENU_FILE_HELP[err.reason], code: heic ? 'HEIC' : 'TOO_BIG' })
      return
    }
    // Logged, so the error registry keeps the cause (errorCapture.ts).
    console.error('School menu read error:', err)
    res.status(503).json({ error: SCHOOL_MENU_READ_FAILED })
  }
})

router.put('/school-menu', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const parsed = schoolMenuSaveSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Revisa los días: cada uno necesita fecha y plato.', details: parsed.error.flatten() })
      return
    }
    const householdId = await getPrimaryHouseholdId(req.userId!)
    if (!householdId) {
      res.status(409).json({ error: 'No tienes hogar' })
      return
    }
    await saveSchoolLunches(householdId, req.userId!, parsed.data.days, parsed.data.clear ?? [])
    res.json({ ok: true, saved: parsed.data.days.length })
  } catch (err) {
    next(err)
  }
})

export default router
