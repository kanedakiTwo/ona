"use client"

import Link, { type LinkProps } from "next/link"
import { useRouter } from "next/navigation"
import { type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react"

type Props = LinkProps & AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }

export function TransitionLink({ href, onClick, children, ...rest }: Props) {
  const router = useRouter()

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e)
    if (e.defaultPrevented) return
    // Bypass for modifier keys / external / non-string href
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    if (typeof href !== "string") return
    if (typeof document === "undefined") return

    // View Transitions API path
    const startVT = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition
    if (typeof startVT === "function") {
      e.preventDefault()
      startVT.call(document, () => {
        router.push(href)
      })
    }
    // else: fall through to native Link behavior + AnimatePresence in PageTransition handles the fade
  }

  return (
    <Link href={href} {...rest} onClick={handleClick}>
      {children}
    </Link>
  )
}
