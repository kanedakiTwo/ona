/**
 * Field marks (PRO-1103): lists the visible fields of a form that go without
 * a mark. A field is marked when its label (`<label for>`, a wrapping
 * `<label>` or `aria-labelledby`) holds a `[data-field-mark]`, or when it sits
 * in a `[data-field-group]` whose title holds one (lists of ingredient rows,
 * steps, notes). A required mark also needs `required` / `aria-required` on
 * the field itself (or on its group).
 */
import type { Locator } from '@playwright/test'

export async function unmarkedFields(form: Locator): Promise<string[]> {
  return form.evaluate((root) => {
    const problems: string[] = []
    const skip = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'search'])
    const controls = root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input, select, textarea',
    )
    for (const el of controls) {
      if (el instanceof HTMLInputElement && skip.has(el.type)) continue
      const box = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (box.width === 0 || box.height === 0 || style.visibility === 'hidden') continue
      // Honeypots and the like: hidden from people on purpose.
      if (el.closest('[aria-hidden="true"]')) continue

      const labels: Element[] = [...(el.labels ?? [])]
      for (const id of (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)) {
        const byId = document.getElementById(id)
        if (byId) labels.push(byId)
      }
      let mark = labels.map((l) => l.querySelector('[data-field-mark]')).find(Boolean) ?? null
      let fromGroup = false
      if (!mark) {
        mark = el.closest('[data-field-group]')?.querySelector('[data-field-group-label] [data-field-mark]') ?? null
        fromGroup = !!mark
      }
      const name =
        el.getAttribute('aria-label') ||
        labels.map((l) => l.textContent?.trim()).find(Boolean) ||
        el.getAttribute('placeholder') ||
        el.id ||
        el.outerHTML.slice(0, 80)
      if (!mark) {
        problems.push(`sin marca: ${name}`)
        continue
      }
      const isRequired = el.required || el.getAttribute('aria-required') === 'true'
      if (mark.getAttribute('data-field-mark') === 'required' && !fromGroup && !isRequired) {
        problems.push(`con asterisco pero sin required: ${name}`)
      }
      if (mark.getAttribute('data-field-mark') === 'optional' && isRequired) {
        problems.push(`required pero marcado «(opcional)»: ${name}`)
      }
    }
    return problems
  })
}
