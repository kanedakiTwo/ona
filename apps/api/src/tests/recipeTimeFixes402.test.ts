/**
 * PRO-402 (2) — the batch of Cocina's corrected times (recipeTimeFixes402.ts).
 */
import { describe, expect, it } from 'vitest'
import { TIME_FIXES_402, TIME_FIXES_402_LEFT, planTimeFix, timeFixLine, type TimeFix } from '../services/recipeTimeFixes402.js'
import { planTimeTrim } from '../services/recipeTimeTrim.js'

const migas: TimeFix = TIME_FIXES_402.find((f) => f.name === 'Migas')!
const migasSteps = [
  { text: 'Cortamos el pan en dados, lo humedecemos con agua y sal y lo dejamos reposar tapado toda la noche.', durationMin: 600 },
  { text: 'Freímos los ajos y el chorizo.', durationMin: 10 },
  { text: 'Añadimos el pan y lo removemos a fuego medio hasta que esté suelto y dorado.', durationMin: 30 },
]

describe('planTimeFix', () => {
  it('a wait counted as cooking: the audit’s total, a cook time the boot rule keeps, and «la víspera»', () => {
    const row = { prepTime: 36, cookTime: 605, totalTime: 641, activeTime: 40, advancePrep: [] }
    const plan = planTimeFix(row, migasSteps, migas)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.after.totalTime).toBe(45)
    expect(plan.after.prepTime).toBe(36)
    expect(plan.after.activeTime).toBe(40)
    expect(plan.advancePrep).toEqual([{ text: 'Humedece el pan y déjalo reposar tapado', hoursBefore: 11 }])
    // The next boot (PRO-284) leaves it as it is.
    const again = planTimeTrim(plan.after, migasSteps, { trimPrep: false })
    expect(again.totalTime).toBe(45)
  })

  it('a total too short rises, and the boot rule doesn’t bring it down again', () => {
    const fix: TimeFix = TIME_FIXES_402.find((f) => f.name === 'Ossobuco a la milanesa')!
    const steps = [
      { text: 'Enharinamos y doramos el ossobuco.', durationMin: 15 },
      { text: 'Hacemos el sofrito con la verdura.', durationMin: 25 },
      { text: 'Horneamos tapado a 160 °C.', durationMin: 120 },
    ]
    const plan = planTimeFix({ prepTime: 40, cookTime: 120, totalTime: 140, activeTime: 50, advancePrep: [] }, steps, fix)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.after.totalTime).toBe(165)
    expect(planTimeTrim(plan.after, steps, { trimPrep: false }).totalTime).toBe(165)
    expect(plan.advancePrep).toBeNull()
  })

  it('the prep the audit gives, and the hands-on time drops with it', () => {
    const fix: TimeFix = TIME_FIXES_402.find((f) => f.name === 'Croquetas de cocido')!
    const plan = planTimeFix({ prepTime: 148, cookTime: 50, totalTime: 173, activeTime: 120, advancePrep: [] }, [], fix)
    expect(plan).toMatchObject({ ok: true, after: { prepTime: 80, totalTime: 205, activeTime: 80 } })
  })

  it('times changed since the audit are left alone', () => {
    const plan = planTimeFix({ prepTime: 36, cookTime: 30, totalTime: 60, activeTime: 40, advancePrep: [] }, migasSteps, migas)
    expect(plan).toEqual({ ok: false, reason: 'sus tiempos ya no son los del informe (hoy 36 / 30 / 60)' })
    expect(timeFixLine('Migas', { prepTime: 36, cookTime: 30, totalTime: 60, activeTime: 40 }, plan)).toContain('se queda como está')
  })

  it('never replaces the preparativos a recipe already has', () => {
    const own = [{ text: 'Corta el pan la víspera', hoursBefore: 12 }]
    const plan = planTimeFix({ prepTime: 36, cookTime: 605, totalTime: 641, activeTime: 40, advancePrep: own }, migasSteps, migas)
    expect(plan).toMatchObject({ ok: true, advancePrep: null })
  })
})

describe('the batch', () => {
  it('29 recipes (10 waits, 19 short totals), 7 left with their reason, none twice', () => {
    expect(TIME_FIXES_402.filter((f) => f.kind === 'espera')).toHaveLength(10)
    expect(TIME_FIXES_402.filter((f) => f.kind === 'corto')).toHaveLength(19)
    expect(TIME_FIXES_402_LEFT).toHaveLength(7)
    const ids = [...TIME_FIXES_402, ...TIME_FIXES_402_LEFT].map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('every wait fix lowers the total and leaves a preparativo; every short one raises it', () => {
    for (const f of TIME_FIXES_402) {
      if (f.kind === 'espera') {
        expect(f.totalTime).toBeLessThan(f.before.totalTime)
        expect(f.advancePrep?.length).toBe(1)
        for (const p of f.advancePrep!) {
          expect(p.text.length).toBeGreaterThanOrEqual(3)
          expect(p.text.length).toBeLessThanOrEqual(140)
          expect(p.hoursBefore).toBeGreaterThan(0)
          expect(p.hoursBefore).toBeLessThanOrEqual(72)
        }
      } else {
        expect(f.totalTime).toBeGreaterThan(f.before.totalTime)
      }
    }
  })
})
