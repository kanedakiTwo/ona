/**
 * «Mimo remoto» (PRO-1102, D-157): staging only. With `MIMO_REMOTO=1` the
 * office answers Mimo's rounds instead of Anthropic
 * (services/assistant/mimoRemoto.ts). The API refuses to boot with the mode on
 * anywhere but staging. On Railway, Railway's environment name decides: only
 * `staging` (the build sets `NODE_ENV=production` in staging too, so on its own
 * it said nothing). Off Railway, `NODE_ENV=production` refuses.
 */
export function resolveMimoRemoto(e: NodeJS.ProcessEnv = process.env): boolean {
  const on = e.MIMO_REMOTO === '1' || e.MIMO_REMOTO === 'true'
  if (!on) return false
  const railway = [e.RAILWAY_ENVIRONMENT, e.RAILWAY_ENVIRONMENT_NAME].filter((n): n is string => !!n)
  const staging = railway.length > 0 ? railway.every((n) => n === 'staging') : e.NODE_ENV !== 'production'
  if (!staging) {
    throw new Error('MIMO_REMOTO solo es para staging: la API no arranca fuera de staging con el modo encendido (PRO-1102).')
  }
  return true
}
