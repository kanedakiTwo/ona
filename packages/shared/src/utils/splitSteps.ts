/**
 * A pasted preparation text → its steps (PRO-1115). Splits by line breaks
 * and by numbering («1.», «2)», «Paso 3:»), also when the numbering runs
 * inside one paragraph («1. Pica la cebolla. 2. Sofríela.»). With
 * numbering, an unnumbered line continues the step above it; without it,
 * each line is a step, unless a line clearly continues the sentence of the
 * one before (it ends without a stop and the next starts in lowercase).
 */

const MARKER = /^(\d{1,2})\s*[.)º°:\-–]+(?!\d)\s*/
const PASO_MARKER = /^paso\s*(\d{1,2})\b\s*[.):\-–]*\s*/i
const BULLET = /^\s*(?:[-–—•*·]+\s*)+/
/** «Preparación:», «Elaboración:», «Pasos:»: a heading, not a step. */
const HEADING = /^(?:preparaci[oó]n|elaboraci[oó]n|pasos|modo de preparaci[oó]n|instrucciones|c[oó]mo se hace)\s*:?$/i

function markerOf(line: string): { n: number; text: string } | null {
  const paso = PASO_MARKER.exec(line)
  if (paso) return { n: Number(paso[1]), text: line.slice(paso[0].length) }
  // «2 huevos batidos…» is a sentence, not «2.»: a bare number needs punctuation.
  const m = MARKER.exec(line)
  if (!m) return null
  return { n: Number(m[1]), text: line.slice(m[0].length) }
}

/** Puts a line break before inline numbering that counts 1, 2, 3… */
function breakInlineNumbering(text: string): string {
  const re = /(^|[\s])((?:paso\s*)?(\d{1,2})[.):]\s+)(?=\S)/gi
  const hits: Array<{ index: number; n: number }> = []
  for (const m of text.matchAll(re)) {
    hits.push({ index: (m.index ?? 0) + m[1].length, n: Number(m[3]) })
  }
  // Keep the longest run 1, 2, 3… in order.
  const run: number[] = []
  let expected = 1
  for (const h of hits) {
    if (h.n === expected) {
      run.push(h.index)
      expected++
    }
  }
  if (run.length < 2) return text
  let out = ''
  let last = 0
  for (const index of run) {
    out += text.slice(last, index).replace(/[ \t]+$/, '') + '\n'
    last = index
  }
  return out + text.slice(last)
}

function clean(text: string): string {
  return text.replace(BULLET, '').replace(/[ \t]+/g, ' ').trim()
}

export function splitSteps(text: string): string[] {
  const normalized = breakInlineNumbering(text.replace(/\r\n?/g, '\n'))
  const lines = normalized.split('\n').map((l) => l.trim())
  const numbered = lines.some((l) => markerOf(l) != null)
  const steps: string[] = []

  if (numbered) {
    let current: string | null = null
    for (const line of lines) {
      if (!line) continue
      const marker = markerOf(line)
      if (marker) {
        if (current != null && current.trim()) steps.push(clean(current))
        current = marker.text
      } else if (current == null) {
        if (!HEADING.test(line)) steps.push(clean(line))
      } else {
        current = current ? `${current} ${line}` : line
      }
    }
    if (current != null && current.trim()) steps.push(clean(current))
    return steps.filter(Boolean)
  }

  let current: string | null = null
  for (const line of lines) {
    const text = clean(line)
    if (!text) {
      if (current) steps.push(current)
      current = null
      continue
    }
    if (HEADING.test(text)) continue
    if (current && !/[.!?:)…]$/.test(current) && /^[a-záéíóúñü]/.test(text)) {
      current = `${current} ${text}`
    } else {
      if (current) steps.push(current)
      current = text
    }
  }
  if (current) steps.push(current)
  return steps
}
