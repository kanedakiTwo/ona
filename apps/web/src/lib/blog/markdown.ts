/**
 * Blog articles (specs/blog.md): a Markdown file with a small front matter.
 *
 *   ---
 *   titulo: Cómo pensamos el menú de la semana
 *   fecha: 2026-10-14
 *   autor: Miguel Martín
 *   resumen: Una frase para el listado y la descripción SEO.
 *   imagen: /landing/step-02.jpg
 *   publicado: false
 *   ---
 *   Cuerpo en Markdown…
 *
 * Pure and dependency-free (no fs, no React) so the API's vitest suite can
 * pin it (apps/api/src/tests/blogMarkdown.test.ts). Only the subset an
 * article needs is supported: `##`/`###` headings, paragraphs, `-`/`1.`
 * lists, `>` quotes, `---` rules, `![alt](src)` images and, inline,
 * **bold**, *italic*, `code` and [links](url). Raw HTML is never rendered:
 * the page turns these tokens into React elements, so it shows as text.
 */

export interface BlogFrontMatter {
  titulo: string
  /** AAAA-MM-DD */
  fecha: string
  autor: string
  resumen: string
  /** Public path (`/landing/…`) or absolute https URL. */
  imagen: string
  publicado: boolean
}

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] }

export type Block =
  | { type: "heading"; level: 2 | 3; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Inline[] }
  | { type: "image"; src: string; alt: string }
  | { type: "rule" }

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const REQUIRED = ["titulo", "fecha", "autor", "resumen", "imagen", "publicado"] as const

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug)
}

function unquote(v: string): string {
  const t = v.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return t
}

/**
 * Splits `---` front matter from the body and validates it. Throws with a
 * message naming the missing/invalid field: a broken article must fail the
 * build, not vanish silently from the blog.
 */
export function parseArticle(source: string): { meta: BlogFrontMatter; body: string } {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text)
  if (!m) throw new Error("falta la cabecera (bloque --- … --- al principio)")

  const raw: Record<string, string> = {}
  for (const line of m[1].split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue
    const idx = line.indexOf(":")
    if (idx < 1) throw new Error(`línea de cabecera sin «clave: valor»: ${line}`)
    raw[line.slice(0, idx).trim()] = unquote(line.slice(idx + 1))
  }
  for (const key of REQUIRED) {
    if (!raw[key]) throw new Error(`falta «${key}» en la cabecera`)
  }
  if (!DATE_RE.test(raw.fecha) || Number.isNaN(Date.parse(`${raw.fecha}T00:00:00Z`))) {
    throw new Error(`«fecha» debe ser AAAA-MM-DD (es «${raw.fecha}»)`)
  }
  if (raw.publicado !== "true" && raw.publicado !== "false") {
    throw new Error(`«publicado» debe ser true o false (es «${raw.publicado}»)`)
  }
  if (!/^(\/|https:\/\/)/.test(raw.imagen)) {
    throw new Error("«imagen» debe empezar por / o https://")
  }

  return {
    meta: {
      titulo: raw.titulo,
      fecha: raw.fecha,
      autor: raw.autor,
      resumen: raw.resumen,
      imagen: raw.imagen,
      publicado: raw.publicado === "true",
    },
    body: text.slice(m[0].length),
  }
}

/** Links the page may render as <a>: site paths, anchors, https/http, mailto. Anything else stays text. */
export function isSafeHref(href: string): boolean {
  return /^(\/(?!\/)|#|https?:\/\/|mailto:)/i.test(href)
}

const INLINE_RE = /(\*\*([^*\n]+)\*\*)|(\*([^*\n]+)\*|_([^_\n]+)_)|(`([^`\n]+)`)|(\[([^\]\n]+)\]\(([^)\s]+)\))/

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let rest = text
  while (rest) {
    const m = INLINE_RE.exec(rest)
    if (!m) {
      out.push({ type: "text", text: rest })
      break
    }
    if (m.index > 0) out.push({ type: "text", text: rest.slice(0, m.index) })
    if (m[1]) out.push({ type: "strong", children: parseInline(m[2]) })
    else if (m[3]) out.push({ type: "em", children: parseInline(m[4] ?? m[5]) })
    else if (m[6]) out.push({ type: "code", text: m[7] })
    else if (m[8]) {
      const children = parseInline(m[9])
      if (isSafeHref(m[10])) out.push({ type: "link", href: m[10], children })
      else out.push(...children)
    }
    rest = rest.slice(m.index + m[0].length)
  }
  // Merge adjacent text nodes (keeps the tree tidy for tests and React keys).
  return out.reduce<Inline[]>((acc, node) => {
    const last = acc[acc.length - 1]
    if (node.type === "text" && last?.type === "text") last.text += node.text
    else acc.push(node)
    return acc
  }, [])
}

const IMAGE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/
const UL_RE = /^[-*]\s+(.*)$/
const OL_RE = /^\d+[.)]\s+(.*)$/

export function parseMarkdown(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n")
  const blocks: Block[] = []
  let i = 0
  const isBlank = (l: string) => !l.trim()

  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line) {
      i++
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      // The page's <h1> is the article title, so body headings start at h2.
      const level = heading[1].length <= 2 ? 2 : 3
      blocks.push({ type: "heading", level, children: parseInline(heading[2].trim()) })
      i++
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      blocks.push({ type: "rule" })
      i++
      continue
    }
    const img = IMAGE_RE.exec(line)
    if (img) {
      if (/^(\/(?!\/)|https:\/\/)/.test(img[2])) blocks.push({ type: "image", alt: img[1], src: img[2] })
      i++
      continue
    }
    if (UL_RE.test(line) || OL_RE.test(line)) {
      const ordered = OL_RE.test(line)
      const re = ordered ? OL_RE : UL_RE
      const items: Inline[][] = []
      while (i < lines.length && re.test(lines[i].trim())) {
        items.push(parseInline(re.exec(lines[i].trim())![1]))
        i++
      }
      blocks.push({ type: "list", ordered, items })
      continue
    }
    if (line.startsWith(">")) {
      const parts: string[] = []
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        parts.push(lines[i].trim().replace(/^>\s?/, ""))
        i++
      }
      blocks.push({ type: "quote", children: parseInline(parts.join(" ").trim()) })
      continue
    }
    // A paragraph always takes its first line (so a stray "![…" can't stall the loop).
    const parts: string[] = [line]
    i++
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !/^(#{1,6}\s|>|[-*]\s|\d+[.)]\s|!\[)/.test(lines[i].trim()) &&
      !/^(-{3,}|\*{3,})$/.test(lines[i].trim())
    ) {
      parts.push(lines[i].trim())
      i++
    }
    blocks.push({ type: "paragraph", children: parseInline(parts.join(" ")) })
  }
  return blocks
}

/** «14 de octubre de 2026» from AAAA-MM-DD (UTC, so the day never shifts). */
export function formatBlogDate(fecha: string): string {
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${fecha}T00:00:00Z`),
  )
}
