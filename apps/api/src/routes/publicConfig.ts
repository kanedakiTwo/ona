/**
 * `GET /public/config` (PRO-167, specs/waitlist.md «Open registration»): what
 * the public web needs to know about the API, without auth. Today only the
 * registration mode, so the web turns every «Únete a la lista de espera»
 * into «Crea tu cuenta gratis» by itself the day `REGISTRATION_MODE=open`.
 *
 * Mounted after the `/public` static files (express.static falls through
 * when there is no such file).
 */
import { Router } from 'express'
import type { PublicConfig, RegistrationMode } from '@ona/shared'
import { env } from '../config/env.js'

export function buildPublicConfig(mode: RegistrationMode): PublicConfig {
  return { registration: mode === 'open' ? 'open' : 'invite' }
}

const router = Router()

router.get('/public/config', (_req, res) => {
  // Short cache: the day the mode changes, visitors see it within a minute.
  res.set('Cache-Control', 'public, max-age=60')
  res.json(buildPublicConfig(env.REGISTRATION_MODE))
})

export default router
