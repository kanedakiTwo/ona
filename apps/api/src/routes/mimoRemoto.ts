import { Router, type Request, type Response, type NextFunction } from 'express'
import { createHash, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { answerTurn, parseRemoteAnswer, takeNextTurn } from '../services/assistant/mimoRemoto.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Constant-time comparison (hashes first, so the lengths never leak). */
function sameToken(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * «Mimo remoto» en staging (PRO-1102, specs/advisor.md): the office takes
 * Mimo's pending rounds and answers them. Bearer `MIMO_REMOTO_TOKEN`; with the
 * mode off (or no token set) the routes don't exist (404).
 */
export function createMimoRemotoRouter(deps: {
  enabled: () => boolean
  token: () => string
  db: any
  nextWaitMs?: number
}): Router {
  const router = Router()

  const guard = (req: Request, res: Response, next: NextFunction) => {
    const expected = deps.token()
    if (!deps.enabled() || !expected) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    const header = req.headers.authorization ?? ''
    const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!provided || !sameToken(provided, expected)) {
      res.status(401).json({ error: 'Token no válido' })
      return
    }
    next()
  }

  // The oldest pending round, marked `cogido`; waits up to 25 s for one (204 when none).
  router.post('/agent/mimo-remoto/siguiente', guard, async (_req, res, next) => {
    try {
      const turn = await takeNextTurn(deps.db, { waitMs: deps.nextWaitMs })
      if (!turn) {
        res.status(204).end()
        return
      }
      res.json(turn)
    } catch (err) {
      next(err)
    }
  })

  // The answer: Messages API `content` (text and `tool_use` blocks) and `stop_reason`.
  router.post('/agent/mimo-remoto/:id/respuesta', guard, async (req, res, next) => {
    try {
      const id = String(req.params.id)
      if (!UUID_RE.test(id)) {
        res.status(404).json({ error: 'No existe ese turno' })
        return
      }
      const parsed = parseRemoteAnswer(req.body)
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error })
        return
      }
      const done = await answerTurn(deps.db, id, parsed.answer)
      if (done.ok) {
        res.json({ ok: true })
        return
      }
      if (!done.estado) {
        res.status(404).json({ error: 'No existe ese turno' })
        return
      }
      res.status(409).json({ error: `El turno está ${done.estado}`, estado: done.estado })
    } catch (err) {
      next(err)
    }
  })

  return router
}

export default createMimoRemotoRouter({
  enabled: () => env.MIMO_REMOTO,
  token: () => env.MIMO_REMOTO_TOKEN,
  db: defaultDb,
})
