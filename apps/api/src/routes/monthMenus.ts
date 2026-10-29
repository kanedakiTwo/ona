import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'
import { copyMonthMenuToWeek, importMonthMenu, loadMonthMenu, madridMonth } from '../services/monthMenus.js'

/**
 * «Menú del mes» (PRO-378, specs/menus.md → «Menú del mes»).
 *
 *   GET  /month-menus/current          signed in → `{ menu }`, this month's (Madrid) or null
 *   POST /month-menus/:month/copy      signed in, `{ weekStart, force? }` → copies it into
 *                                      the caller's week; 409 MENU_NOT_EMPTY without `force`
 *                                      when the week has dishes
 *   POST /admin/month-menus            admin JWT, `{ file }` (Cocina's JSON) → 201/200 with
 *                                      the menu, 422 `{ problems }` (in Spanish) when the
 *                                      file or the week's rules fail
 */
const copySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  force: z.boolean().optional(),
})

export function createMonthMenusRouter(
  overrides: Partial<{
    load: typeof loadMonthMenu
    copy: typeof copyMonthMenuToWeek
    import: typeof importMonthMenu
    auth: RequestHandler
    admin: RequestHandler
  }> = {},
): Router {
  const d = {
    load: loadMonthMenu,
    copy: copyMonthMenuToWeek,
    import: importMonthMenu,
    auth: authMiddleware as RequestHandler,
    admin: requireAdmin as RequestHandler,
    ...overrides,
  }
  const router = Router()

  router.get('/month-menus/current', d.auth, async (_req, res) => {
    try {
      res.json({ menu: await d.load(madridMonth()) })
    } catch (err) {
      console.error('[month-menu] load failed:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.post('/month-menus/:month/copy', d.auth, async (req: AuthRequest, res) => {
    const month = String(req.params.month)
    const body = copySchema.safeParse(req.body)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !body.success) {
      res.status(400).json({ error: 'Datos no válidos.' })
      return
    }
    try {
      const result = await d.copy({ userId: req.userId!, month, weekStart: body.data.weekStart, force: body.data.force })
      if (result.status === 'not_found') {
        res.status(404).json({ error: 'Este mes no tiene menú.' })
        return
      }
      if (result.status === 'not_empty') {
        res.status(409).json({ error: 'Se cambiarán los platos de esta semana.', code: 'MENU_NOT_EMPTY' })
        return
      }
      res.status(201).json(result)
    } catch (err) {
      console.error('[month-menu] copy failed:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.post('/admin/month-menus', d.auth, d.admin, async (req: AuthRequest, res) => {
    try {
      const result = await d.import(req.body?.file, req.userId!)
      if (!result.ok) {
        res.status(422).json({ error: 'El menú del mes no se puede importar.', problems: result.problems })
        return
      }
      res.status(result.created ? 201 : 200).json({ menu: result.menu })
    } catch (err) {
      console.error('[month-menu] import failed:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}

export default createMonthMenusRouter()
