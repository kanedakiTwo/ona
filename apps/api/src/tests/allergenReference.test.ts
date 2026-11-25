/**
 * PRO-399: the ingredient → allergen reference (`allergenReference.json`)
 * through the name detector. Every case must come out exactly as written:
 * a missing tag is a reaction, an extra one hides a recipe. When Cocina
 * corrects a case, change the file and then the detector until this passes.
 */
import { describe, it, expect } from 'vitest'
import { ALLERGEN_TAGS, inferAllergenTagsFromName } from '../services/nutrition/allergens.js'
import reference from '../services/nutrition/allergenReference.json'

type Case = { ingrediente: string; alergenos: string[]; grupo: string; por: string; nota?: string }
const cases = reference.casos as Case[]

describe('allergen reference (PRO-399)', () => {
  it('is well formed: known tags, sorted, no repeated name', () => {
    expect(reference.etiquetas).toEqual([...ALLERGEN_TAGS])
    const seen = new Set<string>()
    for (const c of cases) {
      expect(c.ingrediente.trim(), 'empty name').not.toBe('')
      expect(seen.has(c.ingrediente.toLowerCase()), `repeated: ${c.ingrediente}`).toBe(false)
      seen.add(c.ingrediente.toLowerCase())
      for (const t of c.alergenos) expect(ALLERGEN_TAGS, `${c.ingrediente}: ${t}`).toContain(t)
      expect(c.alergenos, `${c.ingrediente}: sort the tags`).toEqual([...c.alergenos].sort())
    }
  })

  it('has the lactose false positives of 2026-11-11 inside', () => {
    const names = new Set(cases.map((c) => c.ingrediente))
    for (const n of ['yogur de soja', 'yogur de coco', 'queso vegano rallado']) expect(names).toContain(n)
  })

  it.each(cases.map((c) => [c.ingrediente, c.alergenos] as const))('%s → %j', (name, expected) => {
    expect(inferAllergenTagsFromName(name)).toEqual(expected)
  })
})
