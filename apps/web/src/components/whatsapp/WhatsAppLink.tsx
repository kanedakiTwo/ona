"use client"

import type { AnchorHTMLAttributes, MouseEvent } from "react"
import { openWhatsApp } from "@/lib/whatsappOpen"

/**
 * A link to WhatsApp (`wa.me`) that on iPhone/iPad opens the app itself, not
 * WhatsApp's «Download» page (see `lib/whatsappOpen.ts`). Elsewhere it is a
 * plain link with the same `href`.
 */
export function WhatsAppLink({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const handled = openWhatsApp(href, {
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
      go: (url) => {
        window.location.href = url
      },
      visible: () => document.visibilityState === "visible",
      later: (fn, ms) => {
        window.setTimeout(fn, ms)
      },
    })
    if (handled) e.preventDefault()
  }
  return <a href={href} onClick={handle} {...rest} />
}
