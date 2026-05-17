/**
 * User-memory REST surface.
 *
 *   GET    /memory               → UserMemory blob (auth)
 *   PATCH  /memory                → upsert one or many facts (auth, source='manual')
 *   DELETE /memory/:key           → drop one fact (auth)
 *
 * The advisor's `update_memory` skill writes via the service directly, not
 * this surface, so it can record source='inferred'.
 */
import { Router } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import {
  getMemoryForUser,
  setMemoryFact,
  setMemoryBatch,
  deleteMemoryFact,
  UnknownMemoryKeyError,
  MemoryValueValidationError,
} from '../services/userMemoryStore.js'

const router = Router()

router.use(authMiddleware)

router.get('/memory', async (req: AuthRequest, res) => {
  try {
    const memory = await getMemoryForUser(req.userId!)
    res.json(memory)
  } catch (err) {
    console.error('Get memory error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/memory', async (req: AuthRequest, res) => {
  try {
    const body = req.body ?? {}
    // Two accepted shapes:
    //   { key, value, confidence? }        — single upsert
    //   { facts: [{ key, value, confidence? }] }  — batch
    if (Array.isArray(body.facts)) {
      try {
        const memory = await setMemoryBatch(req.userId!, body.facts, 'manual')
        res.json(memory)
      } catch (e) {
        if (e instanceof UnknownMemoryKeyError) {
          res.status(400).json({ error: e.message })
        } else if (e instanceof MemoryValueValidationError) {
          res.status(422).json({ error: e.message, key: e.key, reason: e.reason })
        } else {
          throw e
        }
      }
      return
    }
    if (typeof body.key === 'string') {
      try {
        const fact = await setMemoryFact(
          req.userId!,
          body.key,
          body.value,
          'manual',
          typeof body.confidence === 'number' ? body.confidence : 1,
        )
        res.json(fact)
      } catch (e) {
        if (e instanceof UnknownMemoryKeyError) {
          res.status(400).json({ error: e.message })
        } else if (e instanceof MemoryValueValidationError) {
          res.status(422).json({ error: e.message, key: e.key, reason: e.reason })
        } else {
          throw e
        }
      }
      return
    }
    res.status(400).json({ error: 'Body must be { key, value } or { facts: [{ key, value }] }' })
  } catch (err) {
    console.error('Patch memory error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/memory/:key', async (req: AuthRequest, res) => {
  try {
    await deleteMemoryFact(req.userId!, String(req.params.key))
    res.status(204).send()
  } catch (err) {
    console.error('Delete memory error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
