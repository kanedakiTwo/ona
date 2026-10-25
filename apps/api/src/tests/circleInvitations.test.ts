/**
 * PRO-1017 (D-129, D-132 point 2): who came through a household of Miguel's
 * circle counts as «desconocido por invitación», apart from `invita` and from
 * the circle itself — the pure rules and `campaigns` in GET /admin/metrics.
 * The real SQL: circleInvitations.smoke.ts.
 */
import { describe, expect, it } from 'vitest'
import { campaignOrigin, invitationOrigin, isCircleCampaign } from '../services/circleInvitations.js'
import { buildCampaigns, type MetricsInput } from '../services/businessMetrics.js'

describe('isCircleCampaign', () => {
  it('circulo-*, beta-privada-* and colegio-estudio (with or without a hyphen)', () => {
    for (const name of ['circulo-familia', 'Círculo-padel', 'circulo', 'beta-privada-1', 'beta-privada', 'colegio-estudio', 'colegio estudio', 'Colegio Estudio']) {
      expect(isCircleCampaign(name), name).toBe(true)
    }
  })

  it('any other link is not the circle', () => {
    for (const name of ['familia', 'cr-lucia', 'circulos', 'mi-circulo', 'beta-privadas', 'colegio-estudio-2', 'colegio', '', null, undefined]) {
      expect(isCircleCampaign(name), String(name)).toBe(false)
    }
  })
})

describe('invitationOrigin / campaignOrigin', () => {
  const circle = new Set(['circ0001'])

  it('the code of a circle household → desconocido-por-invitacion; any other → invita; none → null', () => {
    expect(invitationOrigin('circ0001', circle)).toBe('desconocido-por-invitacion')
    expect(invitationOrigin('otro0001', circle)).toBe('invita')
    expect(invitationOrigin(null, circle)).toBeNull()
  })

  it('a campaign link wins over who invited', () => {
    expect(campaignOrigin('circulo-familia', 'desconocido-por-invitacion')).toBe('circulo')
    expect(campaignOrigin('cr-lucia', 'invita')).toBe('campaña')
    expect(campaignOrigin(null, 'desconocido-por-invitacion')).toBe('desconocido-por-invitacion')
    expect(campaignOrigin(null, 'invita')).toBe('invita')
    expect(campaignOrigin(null, null)).toBe('sin-enlace')
  })
})

describe('campaigns (GET /admin/metrics) with the circle apart', () => {
  // c1 entered by the circle and invited g1; o1 (not of the circle) invited g2.
  const input: MetricsInput = {
    weeks: ['2026-10-12', '2026-10-19'],
    currentWeek: '2026-10-19',
    activity: [{ householdId: 'g1', week: '2026-10-19' }],
    menus: [],
    shoppingDays: [],
    signups: [
      { householdId: 'c1', day: '2026-10-13' },
      { householdId: 'o1', day: '2026-10-14' },
      { householdId: 'g1', day: '2026-10-20' },
      { householdId: 'g2', day: '2026-10-21' },
    ],
    costs: [],
  }
  const circleCodes = new Set(['codec1'])
  const campaignOf = new Map<string, string | null>([['c1', 'colegio-estudio'], ['o1', null], ['g1', null], ['g2', null]])
  const invitedBy: Record<string, string | null> = { c1: null, o1: null, g1: 'codec1', g2: 'codeo1' }
  const invitationOf = new Map(Object.entries(invitedBy).map(([h, code]) => [h, invitationOrigin(code, circleCodes)]))

  it('the guest of a circle household is «desconocido por invitación», the one of another household is `invita`', () => {
    const rows = buildCampaigns(input, campaignOf, invitationOf)
    expect(rows.find((r) => r.origin === 'desconocido-por-invitacion')).toMatchObject({ campaign: null, signups: 1, activated: 1 })
    expect(rows.find((r) => r.origin === 'invita')).toMatchObject({ campaign: null, signups: 1, activated: 0 })
    expect(rows.find((r) => r.origin === 'circulo')).toMatchObject({ campaign: 'colegio-estudio', signups: 1 })
    expect(rows.find((r) => r.origin === 'sin-enlace')).toMatchObject({ campaign: null, signups: 1 })
    expect(rows.reduce((n, r) => n + r.signups, 0)).toBe(4)
    expect(JSON.stringify(rows)).not.toMatch(/codec1|codeo1/)
  })
})
