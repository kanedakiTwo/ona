/**
 * PRO-70 — /terminos carries Mimoia's intended purpose word for word
 * (D-038, Mimoia HQ constitution §6), in its own «Para qué sirve Mimoia»
 * section. The e2e legal-notice.spec.ts checks the rendered page too.
 *
 * Run: pnpm --filter @ona/api exec vitest run src/tests/termsIntendedPurpose.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = resolve(__dirname, '../../../web/src/app/(public)/terminos/page.tsx')

const INTENDED_PURPOSE =
  'Mimoia es un planificador de menús, recetas y lista de la compra para hogares, según sus gustos, preferencias y restricciones declaradas. Ofrece información general de alimentación. No está destinado a diagnosticar, prevenir, predecir, tratar ni controlar ninguna enfermedad, ni sustituye a un profesional sanitario.'

describe('/terminos intended purpose (PRO-70)', () => {
  const source = readFileSync(PAGE, 'utf8')

  it('has its own «Para qué sirve Mimoia» section', () => {
    expect(source).toMatch(/<h2[^>]*>\s*\d+\. Para qué sirve Mimoia\s*<\/h2>/)
  })

  it('contains the §6 text exactly, rendered in that section', () => {
    expect(source).toContain(`"${INTENDED_PURPOSE}"`)
    expect(source).toMatch(/Para qué sirve Mimoia<\/h2>\s*<p[^>]*>\{INTENDED_PURPOSE\}<\/p>/)
  })
})
