/**
 * PR 2 — User memory contract tests. Pure functions in @ona/shared
 * (validators + digest builder). The DB store and HTTP routes are
 * tested separately; here we pin the contract every consumer relies on:
 *
 *   1. Every canonical key in MEMORY_KEYS has a Zod schema.
 *   2. Unknown keys reject. Known keys with bad values reject. Known
 *      keys with good values accept.
 *   3. buildMemoryDigestText composes a stable Spanish-prompt fragment
 *      that's empty when memory is empty and well-formed when full.
 */
import { describe, expect, it } from 'vitest'
import {
  MEMORY_KEYS,
  MEMORY_VALUE_SCHEMAS,
  validateMemoryFactValue,
  buildMemoryDigestText,
  type UserMemory,
} from '@ona/shared'

describe('MEMORY_KEYS registry', () => {
  it('every canonical key has a Zod schema entry', () => {
    for (const key of MEMORY_KEYS) {
      expect(MEMORY_VALUE_SCHEMAS[key]).toBeDefined()
    }
  })

  it('has no schema entries for non-canonical keys (no orphan validators)', () => {
    const schemaKeys = Object.keys(MEMORY_VALUE_SCHEMAS).sort()
    const canonical = [...MEMORY_KEYS].sort()
    expect(schemaKeys).toEqual(canonical)
  })
})

describe('validateMemoryFactValue', () => {
  it('rejects unknown keys', () => {
    const r = validateMemoryFactValue('not.a.key', 'whatever')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/unknown memory key/)
  })

  it('accepts a well-formed physical.age', () => {
    const r = validateMemoryFactValue('physical.age', 34)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(34)
  })

  it('rejects an out-of-range physical.age', () => {
    expect(validateMemoryFactValue('physical.age', 999).ok).toBe(false)
    expect(validateMemoryFactValue('physical.age', -1).ok).toBe(false)
    expect(validateMemoryFactValue('physical.age', '34').ok).toBe(false)
  })

  it('accepts a string-array for dislikes / restrictions / equipment / notes', () => {
    expect(validateMemoryFactValue('dislikes', ['cilantro', 'hígado']).ok).toBe(true)
    expect(validateMemoryFactValue('restrictions', ['sin gluten']).ok).toBe(true)
    expect(validateMemoryFactValue('equipment', ['horno', 'freidora']).ok).toBe(true)
    expect(validateMemoryFactValue('notes', ['mi hija no come pescado']).ok).toBe(true)
  })

  it('rejects arrays with empty strings', () => {
    expect(validateMemoryFactValue('dislikes', ['', 'algo']).ok).toBe(false)
  })

  it('accepts time_available with valid weekday keys and minute ranges', () => {
    const r = validateMemoryFactValue('time_available', {
      lunes: 20,
      martes: 45,
      domingo: 120,
    })
    expect(r.ok).toBe(true)
  })

  it('rejects time_available with unknown weekday keys', () => {
    expect(validateMemoryFactValue('time_available', { monday: 20 }).ok).toBe(false)
  })

  it('accepts meal_times with HH:MM strings', () => {
    expect(
      validateMemoryFactValue('meal_times', {
        breakfast: '08:30',
        lunch: '14:00',
        dinner: '21:30',
      }).ok,
    ).toBe(true)
  })

  it('rejects meal_times with malformed time strings', () => {
    expect(validateMemoryFactValue('meal_times', { breakfast: '8:30' }).ok).toBe(false)
    expect(validateMemoryFactValue('meal_times', { breakfast: '25:00' }).ok).toBe(false)
  })

  it('accepts cuisine_bias as a numeric slider per cuisine', () => {
    expect(
      validateMemoryFactValue('cuisine_bias', {
        mediterranea: 90,
        asiatica: 60,
        mexicana: 30,
      }).ok,
    ).toBe(true)
  })

  it('rejects cuisine_bias with values outside 0-100', () => {
    expect(validateMemoryFactValue('cuisine_bias', { x: 150 }).ok).toBe(false)
  })
})

describe('buildMemoryDigestText', () => {
  it('returns the empty string for an empty memory blob', () => {
    expect(buildMemoryDigestText({})).toBe('')
  })

  it('opens with the canonical header so the advisor system prompt can be cached', () => {
    const memory: UserMemory = {
      'physical.age': {
        key: 'physical.age',
        value: 40,
        source: 'manual',
        confidence: 1,
        updatedAt: '2026-05-17T00:00:00Z',
      },
    }
    const out = buildMemoryDigestText(memory)
    expect(out.startsWith('Memoria del usuario')).toBe(true)
  })

  it('renders dislikes + restrictions + equipment in compact Spanish', () => {
    const memory: UserMemory = {
      dislikes: { key: 'dislikes', value: ['cilantro', 'hígado'], source: 'inferred', confidence: 0.8, updatedAt: '' },
      restrictions: { key: 'restrictions', value: ['sin gluten'], source: 'manual', confidence: 1, updatedAt: '' },
      equipment: { key: 'equipment', value: ['horno', 'freidora de aire'], source: 'onboarding', confidence: 1, updatedAt: '' },
    }
    const out = buildMemoryDigestText(memory)
    expect(out).toContain('Le disgustan: cilantro, hígado')
    expect(out).toContain('Restricciones: sin gluten')
    expect(out).toContain('Equipo de cocina: horno, freidora de aire')
  })

  it('surfaces only "liked" cuisines (slider ≥ 70) — the prompt budget is finite', () => {
    const memory: UserMemory = {
      cuisine_bias: {
        key: 'cuisine_bias',
        value: { mediterranea: 95, asiatica: 80, mexicana: 30, india: 50 },
        source: 'onboarding',
        confidence: 1,
        updatedAt: '',
      },
    }
    const out = buildMemoryDigestText(memory)
    expect(out).toContain('mediterranea')
    expect(out).toContain('asiatica')
    expect(out).not.toContain('mexicana')
    expect(out).not.toContain('india')
  })

  it('flags weekdays with tight (≤30 min) cooking windows', () => {
    const memory: UserMemory = {
      time_available: {
        key: 'time_available',
        value: { lunes: 15, martes: 25, miercoles: 60, jueves: 120 },
        source: 'onboarding',
        confidence: 1,
        updatedAt: '',
      },
    }
    const out = buildMemoryDigestText(memory)
    expect(out).toContain('lunes')
    expect(out).toContain('martes')
    expect(out).not.toContain('miercoles')
    expect(out).not.toContain('jueves')
  })

  it('stays under a sane token budget for a maximally populated user', () => {
    // Token estimate: ~4 chars per token, so 2000 chars ≈ 500 tokens. Plenty
    // of headroom inside the 1500-token budget the spec sets.
    const memory: UserMemory = Object.fromEntries(
      MEMORY_KEYS.map((k) => {
        const baseValue: Record<string, unknown> = {
          'physical.sex': 'male',
          'physical.age': 35,
          'physical.height_cm': 178,
          'physical.weight_kg': 76,
          'physical.activity_level': 'moderate',
          'household.adults': 2,
          'household.kids_2_to_10': 1,
          restrictions: ['sin gluten', 'sin lactosa'],
          dislikes: ['cilantro', 'hígado', 'callos'],
          equipment: ['horno', 'freidora de aire', 'olla express', 'wok'],
          time_available: { lunes: 20, martes: 25, miercoles: 60, jueves: 120, viernes: 45, sabado: 180, domingo: 180 },
          weekly_budget_eur: 120,
          cuisine_bias: { mediterranea: 90, asiatica: 70, mexicana: 80 },
          cooking_skill: 'medium',
          meal_times: { breakfast: '08:30', lunch: '14:00', snack: '17:30', dinner: '21:30' },
          notes: ['mi hija no come pescado', 'mejor cocidos los domingos'],
        }
        return [
          k,
          {
            key: k,
            value: baseValue[k] ?? null,
            source: 'manual',
            confidence: 1,
            updatedAt: '',
          },
        ]
      }),
    ) as UserMemory
    const out = buildMemoryDigestText(memory)
    expect(out.length).toBeLessThan(2000)
  })
})
