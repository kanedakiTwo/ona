"use client"

import { createContext, useContext, type ReactNode } from "react"

/**
 * PRO-1346: what a page puts in the server HTML while RootShell paints its
 * empty page (the session resolves in the browser). It replaced the root
 * layout's `@seo` parallel slot (PRO-1077): on Railway's build the prerendered
 * pages came without that slot, and the router broke («e is not iterable»,
 * «Application error») on every tap that opened a recipe.
 *
 * - `ServerHtmlOnly` (RootShell, while the session resolves): on the server it
 *   renders the route inside a hidden `<div>`, with `PageBody` turned off, so
 *   only what a layout puts outside `PageBody` (the recipe's JSON-LD) reaches
 *   the HTML. In the browser it is an empty hidden `<div>` that keeps the
 *   server's markup (no hydration of its insides) until RootShell paints the
 *   page itself.
 * - `PageBody` (the layout, around the page): nothing inside `ServerHtmlOnly`.
 */

const ServerHtmlPass = createContext(false)

export function ServerHtmlOnly({ children }: { children: ReactNode }) {
  if (typeof window !== "undefined") {
    return <div hidden suppressHydrationWarning dangerouslySetInnerHTML={{ __html: "" }} />
  }
  return (
    <div hidden>
      <ServerHtmlPass.Provider value={true}>{children}</ServerHtmlPass.Provider>
    </div>
  )
}

export function PageBody({ children }: { children: ReactNode }) {
  return useContext(ServerHtmlPass) ? null : children
}
