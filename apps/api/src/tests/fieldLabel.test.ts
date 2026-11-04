/**
 * Field marks of the web forms (PRO-1103): required « *» (aria-hidden),
 * optional « (opcional)» / « (opcionales)», and the «* Obligatorio» foot line.
 * The screens themselves are guarded by apps/web/e2e/form-field-marks.spec.ts.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  FieldLabel,
  FieldMark,
  RequiredNote,
  fieldMarkText,
} from '../../../web/src/components/FieldLabel'

// React lives in the web app, not in the API.
const requireWeb = createRequire(new URL('../../../web/package.json', import.meta.url))
const React = requireWeb('react') as typeof import('react')
const { renderToStaticMarkup } = requireWeb('react-dom/server') as typeof import('react-dom/server')
const h = React.createElement
// The API's vitest compiles the .tsx with the classic JSX runtime.
;(globalThis as { React?: unknown }).React = React

describe('fieldMarkText', () => {
  it('gives the asterisk or the grey word', () => {
    expect(fieldMarkText({ required: true })).toBe(' *')
    expect(fieldMarkText({ optional: true })).toBe(' (opcional)')
    expect(fieldMarkText({ optional: true, plural: true })).toBe(' (opcionales)')
  })
})

describe('FieldLabel', () => {
  it('a required label ends in a hidden terracotta asterisk', () => {
    const html = renderToStaticMarkup(h(FieldLabel, { htmlFor: 'name', required: true, children: 'Nombre' }))
    expect(html).toContain('<label for="name"')
    expect(html).toMatch(/Nombre<span data-field-mark="required" aria-hidden="true" class="[^"]*text-terracotta-deep[^"]*"> \*<\/span><\/label>/)
  })

  it('an optional label ends in «(opcional)», read aloud', () => {
    const html = renderToStaticMarkup(h(FieldLabel, { htmlFor: 'tags', optional: true, children: 'Etiquetas' }))
    expect(html).toMatch(/Etiquetas<span data-field-mark="optional" class="[^"]*text-ink-muted[^"]*"> \(opcional\)<\/span>/)
    expect(html).not.toContain('aria-hidden')
  })

  it('a label that names several things says «(opcionales)»', () => {
    const html = renderToStaticMarkup(
      h(FieldLabel, { htmlFor: 'x', optional: true, plural: true, children: 'Notas y trucos' }),
    )
    expect(html).toContain('> (opcionales)</span>')
  })

  it('renders a group title without a for', () => {
    const html = renderToStaticMarkup(h(FieldLabel, { as: 'span', htmlFor: 'x', required: true, children: 'Tipo de comida' }))
    expect(html.startsWith('<span>Tipo de comida')).toBe(true)
    expect(html).not.toContain('for=')
  })

  it('never renders without a mark', () => {
    for (const mark of [{ required: true as const }, { optional: true as const }]) {
      const html = renderToStaticMarkup(h(FieldLabel, { ...mark, children: 'Campo' }))
      expect(html).toMatch(/data-field-mark="(required|optional)"/)
    }
    // @ts-expect-error a FieldLabel needs `required` or `optional`
    const bare = h(FieldLabel, { children: 'Campo' })
    expect(bare).toBeTruthy()
  })
})

describe('FieldMark and RequiredNote', () => {
  it('the mark alone works inside other labels', () => {
    expect(renderToStaticMarkup(h(FieldMark, { required: true }))).toContain('data-field-mark="required"')
  })

  it('the foot line reads «* Obligatorio»', () => {
    const html = renderToStaticMarkup(h(RequiredNote, {}))
    expect(html).toContain('data-required-note')
    expect(html.replace(/<[^>]+>/g, '')).toBe('* Obligatorio')
  })
})
