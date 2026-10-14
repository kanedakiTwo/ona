import Link from "next/link"
import type { ReactNode } from "react"
import type { Block, Inline } from "@/lib/blog/markdown"

/**
 * Renders a parsed blog article (lib/blog/markdown.ts) as React elements —
 * never as raw HTML. Editorial skin: Fraunces headings, 17 px body in
 * ink-soft, terracotta links.
 */
function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return n.text
      case "strong":
        return <strong key={i} className="font-semibold text-[#1A1612]">{renderInline(n.children)}</strong>
      case "em":
        return <em key={i}>{renderInline(n.children)}</em>
      case "code":
        return (
          <code key={i} className="rounded bg-[#EFE8D8] px-1.5 py-0.5 font-mono text-[0.9em]">
            {n.text}
          </code>
        )
      case "link": {
        const cls = "text-[#C65D38] underline underline-offset-4 hover:text-[#1A1612]"
        if (n.href.startsWith("/") || n.href.startsWith("#")) {
          return (
            <Link key={i} href={n.href} className={cls}>
              {renderInline(n.children)}
            </Link>
          )
        }
        return (
          <a key={i} href={n.href} className={cls} target="_blank" rel="noopener noreferrer">
            {renderInline(n.children)}
          </a>
        )
      }
    }
  })
}

export default function BlogBody({ blocks }: { blocks: Block[] }) {
  return (
    <div data-testid="blog-body" className="space-y-6 text-[17px] leading-[1.75] text-[#4A4239]">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading":
            return b.level === 2 ? (
              <h2 key={i} className="pt-6 font-display text-[28px] leading-tight text-[#1A1612] md:text-[32px]">
                {renderInline(b.children)}
              </h2>
            ) : (
              <h3 key={i} className="pt-2 font-display text-[22px] leading-snug text-[#1A1612]">
                {renderInline(b.children)}
              </h3>
            )
          case "paragraph":
            return <p key={i}>{renderInline(b.children)}</p>
          case "list": {
            const Tag = b.ordered ? "ol" : "ul"
            return (
              <Tag key={i} className={`ml-5 space-y-2 ${b.ordered ? "list-decimal" : "list-disc"} marker:text-[#C65D38]`}>
                {b.items.map((item, j) => (
                  <li key={j} className="pl-1">{renderInline(item)}</li>
                ))}
              </Tag>
            )
          }
          case "quote":
            return (
              <blockquote
                key={i}
                className="border-l-2 border-[#C65D38] pl-5 font-italic text-[22px] italic leading-snug text-[#1A1612]"
              >
                {renderInline(b.children)}
              </blockquote>
            )
          case "image":
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={b.src} alt={b.alt} loading="lazy" className="w-full rounded-[20px] object-cover" />
            )
          case "rule":
            return <hr key={i} className="divider-dotted my-10" />
        }
      })}
    </div>
  )
}
