import type { ProactiveKind } from './proactive.js'

/**
 * PRO-244: right after the sign-up the household has just seen its first
 * menu; a shopping reminder in that same minute (WhatsApp sign-up on a
 * Saturday morning, 17-oct: 31 things on the list) is noise. These kinds
 * wait until this long after the first steps were finished.
 */
export const SIGN_UP_QUIET_MS = 24 * 60 * 60 * 1000
export const SIGN_UP_QUIET_KINDS: ReadonlySet<ProactiveKind> = new Set<ProactiveKind>(['shopping_reminder'])

/** Is `kind` held back because the first steps ended less than 24 h ago? */
export function quietAfterSignUp(kind: ProactiveKind, onboardingCompletedAt: Date | null | undefined, now: Date): boolean {
  if (!SIGN_UP_QUIET_KINDS.has(kind) || !onboardingCompletedAt) return false
  const elapsed = now.getTime() - new Date(onboardingCompletedAt).getTime()
  return elapsed >= 0 && elapsed < SIGN_UP_QUIET_MS
}
