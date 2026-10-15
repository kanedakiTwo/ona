import { Router } from 'express'
import { rateLimit } from '../middleware/rateLimit.js'
import { emailSinkDomains, isSinkAddress, readSink } from '../services/emailSink.js'

/**
 * GET /email-sink?to=<address> — staging only (specs/email.md → «Buzón de
 * pruebas»): the emails the sink kept for a test address, oldest first.
 * 404 when the sink is off (always on production); 400 for an address
 * outside `EMAIL_SINK_DOMAINS`, so it never shows a real person's email.
 */
const router = Router()
const limiter = rateLimit({ max: 120, windowMs: 60 * 1000 })

router.get('/email-sink', limiter, (req, res) => {
  const domains = emailSinkDomains()
  if (domains.length === 0) {
    res.status(404).json({ error: 'Not found', code: 'EMAIL_SINK_OFF' })
    return
  }
  const to = typeof req.query.to === 'string' ? req.query.to.trim().toLowerCase() : ''
  if (!isSinkAddress(to, domains)) {
    res.status(400).json({ error: `Solo direcciones de prueba: ${domains.join(', ')}`, code: 'EMAIL_SINK_NOT_TEST_ADDRESS' })
    return
  }
  res.json({ messages: readSink(to) })
})

export default router
