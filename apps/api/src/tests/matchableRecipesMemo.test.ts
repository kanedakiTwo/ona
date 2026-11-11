/**
 * 2026-11-10 («hago cambios sobre el menú y tardan mucho en mostrarse»): the
 * step mentions (PRO-346) and the catalogue audit (PRO-73) of every recipe
 * were recomputed on each `loadMatchableRecipes` — ~250 ms of CPU over 400
 * recipes on a laptop, seconds on the server, on every picker search,
 * `/taste/status`, «al azar» and generation, and a menu change sent meanwhile
 * waited behind them. They are now kept per recipe while their inputs don't
 * change. This pins that the kept value is the same as computing it, that it
 * is reused, and that an edited recipe is read again.
 *
 * Run: pnpm --filter @ona/api test src/tests/matchableRecipesMemo.test.ts
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { _clearDerivedRecipeMemo, derivedRecipeReads } from '../services/matchableRecipes.js'
import { unlistedDietMentions } from '../services/stepDietMentions.js'
import { catalogAuditIssuesFor } from '../services/catalogRecipeAudit.js'

const steps = ['Sofríe la cebolla.', 'Añade el chorizo y la morcilla y cuece 40 minutos.']
const names = ['lentejas', 'cebolla', 'aceite de oliva']
const audit = {
  name: 'Lentejas guisadas',
  servings: 4,
  course: 'main',
  meals: ['lunch'],
  stepCount: steps.length,
  ingredients: names.map((name) => ({ name, quantity: 100, unit: 'g', unitWeight: null, density: null, edibleFraction: null, note: null })),
}

describe('derivedRecipeReads', () => {
  beforeEach(() => _clearDerivedRecipeMemo())

  it('gives the same as computing the step mentions and the audit', () => {
    const d = derivedRecipeReads('r1', null, steps, names, audit, {})
    expect(d.stepMentions).toEqual(unlistedDietMentions(steps, names).map(({ term, category }) => ({ term, category })))
    expect(d.stepMentions.map((m) => m.term)).toEqual(expect.arrayContaining(['chorizo', 'morcilla']))
    expect(d.audit).toEqual(catalogAuditIssuesFor(null, audit, {}))
  })

  it('reuses the kept value while the recipe does not change', () => {
    const a = derivedRecipeReads('r1', null, steps, names, audit, {})
    const b = derivedRecipeReads('r1', null, [...steps], [...names], { ...audit }, {})
    expect(b.stepMentions).toBe(a.stepMentions)
    expect(b.audit).toBe(a.audit)
  })

  it('households with and without «proteína en cada plato» keep their own audit (they used to throw each other\'s out)', () => {
    const plain = derivedRecipeReads('r1', null, steps, names, audit, {})
    const strict = derivedRecipeReads('r1', null, steps, names, audit, { strictProteinMinimum: true })
    const plainAgain = derivedRecipeReads('r1', null, steps, names, audit, {})
    const strictAgain = derivedRecipeReads('r1', null, steps, names, audit, { strictProteinMinimum: true })
    expect(plainAgain.audit).toBe(plain.audit)
    expect(strictAgain.audit).toBe(strict.audit)
    expect(strict.audit).toEqual(catalogAuditIssuesFor(null, audit, { strictProteinMinimum: true }))
    // The step mentions don't depend on the household: one for both.
    expect(strict.stepMentions).toBe(plain.stepMentions)
  })

  it('reads an edited recipe again', () => {
    derivedRecipeReads('r1', null, steps, names, audit, {})
    const fixed = derivedRecipeReads('r1', null, steps, [...names, 'chorizo', 'morcilla'], audit, {})
    expect(fixed.stepMentions.map((m) => m.term)).not.toContain('chorizo')
    const longer = { ...audit, stepCount: 3 }
    const reaudited = derivedRecipeReads('r1', null, steps, [...names, 'chorizo', 'morcilla'], longer, {})
    expect(reaudited.audit).toEqual(catalogAuditIssuesFor(null, longer, {}))
    expect(reaudited.stepMentions).toBe(fixed.stepMentions)
  })
})
