/**
 * «Mimo remoto» (PRO-1102, D-157): staging only. With `MIMO_REMOTO=1` the
 * office answers Mimo's rounds instead of Anthropic
 * (services/assistant/mimoRemoto.ts). A production API refuses to boot with
 * the mode on: `NODE_ENV=production` or Railway's production environment.
 */
export function resolveMimoRemoto(e: NodeJS.ProcessEnv = process.env): boolean {
  const on = e.MIMO_REMOTO === '1' || e.MIMO_REMOTO === 'true'
  if (!on) return false
  const production =
    e.NODE_ENV === 'production' || e.RAILWAY_ENVIRONMENT === 'production' || e.RAILWAY_ENVIRONMENT_NAME === 'production'
  if (production) {
    throw new Error('MIMO_REMOTO solo es para staging: la API no arranca en producción con el modo encendido (PRO-1102).')
  }
  return true
}
