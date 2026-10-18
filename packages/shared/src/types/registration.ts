/**
 * Open registration (PRO-167, D-057; specs/waitlist.md «Open registration»).
 *
 * Until 2026-11-16 an account needs an invitation (`REGISTRATION_MODE=invite`).
 * From that day `REGISTRATION_MODE=open` lets anyone in, and the web follows by
 * itself: it reads the mode from `GET /public/config` and every public call to
 * action becomes «Crea tu cuenta gratis» → `/register`, keeping the `?ref`,
 * `?invita` and `utm_*` the visitor came with.
 */

export const REGISTRATION_MODES = ['invite', 'open'] as const
export type RegistrationMode = (typeof REGISTRATION_MODES)[number]

/** `GET /public/config`: what the public web needs to know about the API. */
export interface PublicConfig {
  registration: RegistrationMode
}

/** The call to action with open registration (Miguel, 2026-10-18; Marketing reviews). */
export const OPEN_SIGNUP_CTA_LABEL = 'Crea tu cuenta gratis'

const CARRIED_PARAMS = ['invita', 'utm_source', 'utm_medium', 'utm_campaign'] as const

/**
 * `/register` with the attribution of the page the visitor is on: its own
 * `?ref` (else `fallbackRef`, the placement: `receta`, `blog`…), `?invita`
 * and `utm_*`. Pure, so the web and the tests build the same link.
 */
export function openRegistrationHref(fallbackRef: string | null, search: string = ''): string {
  const current = new URLSearchParams(search)
  const out = new URLSearchParams()
  const ref = current.get('ref')?.trim() || fallbackRef
  if (ref) out.set('ref', ref)
  for (const key of CARRIED_PARAMS) {
    const v = current.get(key)?.trim()
    if (v) out.set(key, v)
  }
  const qs = out.toString()
  return qs ? `/register?${qs}` : '/register'
}
