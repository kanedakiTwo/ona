/**
 * Smoke (real API + Postgres) for PRO-1101 (D-156), «la API de Anthropic sin
 * saldo»: el grupo `saldo_api` de `app_errors`, una vez por hora, la racha
 * (abre, se cierra con saldo, vuelve a abrir) y `apiSaldo` en /admin/metrics.
 *
 *   API_URL=… DATABASE_URL=… METRICS_READ_TOKEN=… pnpm --filter @ona/api exec vitest run src/tests/apiSaldo.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { appErrors } from '../db/schema.js'
import { API_SALDO_FINGERPRINT, closeApiBalanceStreak, loadApiSaldo, recordApiBalanceError } from '../services/apiSaldo.js'
import { errorsForAgents } from '../services/agentView.js'
import { loadAppErrors } from '../services/appErrors.js'

const MIN = 60 * 1000
const T0 = new Date(Date.now() - 5 * 60 * MIN)
const at = (min: number) => new Date(T0.getTime() + min * MIN)
const row = async () => (await db.select().from(appErrors).where(eq(appErrors.fingerprint, API_SALDO_FINGERPRINT)))[0]

describe.skipIf(!reachable)('saldo_api (PRO-1101)', () => {
  it('una vez por hora, la racha y apiSaldo', async () => {
    await db.delete(appErrors).where(eq(appErrors.fingerprint, API_SALDO_FINGERPRINT))
    expect(await loadApiSaldo()).toEqual({ sinSaldoDesde: null, ultimoError: null })

    expect(await recordApiBalanceError(at(0))).toBe(true)
    expect(await recordApiBalanceError(at(20))).toBe(false)
    expect(await recordApiBalanceError(at(59))).toBe(false)
    expect(await row()).toMatchObject({ kind: 'server', count: 1, samplePath: 'anthropic', resolvedAt: null })
    expect(await recordApiBalanceError(at(60))).toBe(true)
    expect((await row()).count).toBe(2)
    expect(await loadApiSaldo()).toEqual({ sinSaldoDesde: at(0).toISOString(), ultimoError: at(60).toISOString() })

    // Vuelve a haber saldo: se cierra una vez.
    expect(await closeApiBalanceStreak(at(90))).toBe(true)
    expect(await closeApiBalanceStreak(at(91))).toBe(false)
    expect(await loadApiSaldo()).toEqual({ sinSaldoDesde: null, ultimoError: at(60).toISOString() })

    // Otra racha: se apunta enseguida, aunque no haya pasado la hora, y empieza ahí.
    expect(await recordApiBalanceError(at(100))).toBe(true)
    expect(await loadApiSaldo()).toEqual({ sinSaldoDesde: at(100).toISOString(), ultimoError: at(100).toISOString() })

    // El token de métricas lo ve con su tipo.
    const errors = errorsForAgents(await loadAppErrors({ days: 1, includeResolved: false, limit: 500 }))
    expect(errors.groups.find((g: any) => g.type === 'saldo_api')).toMatchObject({ kind: 'server', count: 3 })

    const token = process.env.METRICS_READ_TOKEN
    if (token) {
      const res = await fetch(`${API_URL}/admin/metrics?weeks=1`, { headers: { 'x-metrics-token': token } })
      expect(res.status).toBe(200)
      expect(((await res.json()) as any).apiSaldo).toEqual({ sinSaldoDesde: at(100).toISOString(), ultimoError: at(100).toISOString() })
    }

    await db.delete(appErrors).where(eq(appErrors.fingerprint, API_SALDO_FINGERPRINT))
  })
})
