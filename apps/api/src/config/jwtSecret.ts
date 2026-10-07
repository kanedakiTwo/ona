/**
 * The JWT signing secret. Anyone who knows it can mint a token for any user,
 * so a deployed API refuses to boot with a missing or short one. Local dev and
 * tests keep the fixed fallback.
 *
 * "Deployed" = NODE_ENV=production OR running on Railway: the container starts
 * with `pnpm dev` and no NODE_ENV, so NODE_ENV alone would never trip it.
 */
export const MIN_JWT_SECRET_LENGTH = 32

export function isDeployedRuntime(e: NodeJS.ProcessEnv = process.env): boolean {
  return e.NODE_ENV === 'production' || Boolean(e.RAILWAY_ENVIRONMENT_NAME)
}

export function resolveJwtSecret(e: NodeJS.ProcessEnv = process.env): string {
  const raw = e.JWT_SECRET
  if (isDeployedRuntime(e)) {
    if (!raw || raw.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters on a deployed API ` +
          `(got ${raw?.length ?? 0}). Generate one with: openssl rand -base64 48`,
      )
    }
    return raw
  }
  return raw || 'ona-dev-secret'
}
