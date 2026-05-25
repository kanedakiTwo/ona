/**
 * Tiny inline-markdown renderer.
 *
 * URL-imported recipes occasionally come back from the LLM with
 * `**retirar cabeza y tripas**` markers around the key actions — and a
 * few sites also slip `*emphasis*` / `_emphasis_` into their JSON-LD
 * step text. Rendering the raw asterisks in `<p>{step.text}</p>` reads
 * as a bug, so we convert the three common patterns to <strong> / <em>.
 *
 * Scope is deliberately minimal: bold + italic only, no links / headings
 * / code / lists. React renders the segments as text nodes, so there is
 * no XSS risk even though the input can be user-edited.
 */

import type { ReactNode } from "react"

const PATTERN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g

export function renderInlineMarkdown(text: string): ReactNode[] {
  if (!text) return []
  const parts = text.split(PATTERN)
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (
      (part.startsWith("*") && part.endsWith("*")) ||
      (part.startsWith("_") && part.endsWith("_"))
    ) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    return part
  })
}
