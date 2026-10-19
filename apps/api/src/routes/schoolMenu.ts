/**
 * Menú del comedor escolar (PRO-224). Per-route auth (no catch-all), so it
 * can be mounted anywhere. Household scope: the caller's primary household.
 *
 *   GET    /school-menu?from=&to=   saved days + whether the app shows the option
 *   POST   /school-menu/read        photo / PDF → the days read (not saved)
 *   PUT    /school-menu             save days (replace those dates) / clear dates
 */
import { Router } from 'express'
import multer from 'multer'
import { schoolMenuSaveSchema } from '@ona/shared'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { requireSpendCapacity } from '../middleware/spendCap.js'
import { getPrimaryHouseholdId } from '../services/scopeResolver.js'
import { runWithCostUser } from '../services/costLedger.js'
import { addDays, madridParts } from '../services/madridTime.js'
import {
  NotASchoolMenuError,
  householdShowsSchoolMenu,
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
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, isSchoolMenuMimeType(file.mimetype)),
})

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

router.post('/school-menu/read', authMiddleware, requireSpendCapacity(), upload.single('file'), async (req: AuthRequest, res, next) => {
  try {
    const file = req.file
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
    next(err)
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
