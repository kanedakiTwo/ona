/**
 * Tiny inline-markdown renderer.
 *
 * URL-imported recipes come back in three flavours:
 *   - Plain text.
 *   - Markdown asterisks: `**retirar cabeza y tripas**` / `*emphasis*` /
 *     `_emphasis_`. The matcher converts these to <strong> / <em>.
 *   - Raw HTML: `<strong>asar</strong>`, `<b>asar</b>`, `<i>...</i>` or
 *     even a stray `<br>`. JSON-LD recipe sites occasionally embed these
 *     in their `recipeInstructions`. We convert the safe whitelist to
 *     React elements and strip the rest before rendering.
 *
 * Scope is deliberately minimal: bold + italic only, no links / headings
 * / code / lists. React renders the segments as text nodes, so there is
 * no XSS risk even though the input can be user-edited.
 */

import type { ReactNode } from "react"

// Order matters: convert HTML → markdown first so the downstream pattern
// catches the same shape regardless of how the source encoded it.
function htmlToMarkdown(text: string): string {
  return (
    text
      .replace(/<\s*(strong|b)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, "**$2**")
      .replace(/<\s*(em|i)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, "*$2*")
      // <br> / <br/> become a single space (the renderer doesn't model
      // line breaks; the outer <p> already wraps).
      .replace(/<\s*br\s*\/?\s*>/gi, " ")
      // Strip anything else — `<span class="...">`, mismatched tags, etc.
      // Safe because React would otherwise render the angle brackets as
      // text anyway; this just hides the noise instead of showing it.
      .replace(/<[^>]*>/g, "")
  )
}

const PATTERN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g

export function renderInlineMarkdown(text: string): ReactNode[] {
  if (!text) return []
  const normalized = htmlToMarkdown(text)
  const parts = normalized.split(PATTERN)
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
