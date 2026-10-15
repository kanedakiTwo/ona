"use client"

import type { ReactNode } from "react"
import { useAuth } from "@/lib/auth"
import { publicRecipeRoute } from "@/lib/recipeShell"
import { HealthConsentGate } from "@/components/HealthConsentGate"
import Navbar from "@/components/shared/Navbar"
import PublicNavbar from "@/components/shared/PublicNavbar"
import Footer from "@/components/shared/Footer"
import DesktopSidebar from "@/components/shared/DesktopSidebar"
import OfflineBanner from "@/components/pwa/OfflineBanner"
import InstallSheet from "@/components/pwa/InstallSheet"
import { PageTransition } from "@/components/pwa/PageTransition"
import { SwipeNavigator } from "@/components/pwa/SwipeNavigator"
import MimoProvider from "@/components/mimo/MimoProvider"
import { FeedbackButton } from "@/components/feedback/FeedbackButton"

/**
 * Picks the page chrome (specs/design-system.md → "Page shells"):
 *
 * - public pages (`isPublicRoute`): bare `<main>`; marketing pages add their
 *   PublicNavbar + Footer through `app/(public)/layout.tsx`.
 * - `/recipes/<id>` and `/recipes/<id>/cook` depend on who is looking: signed
 *   out they are public pages (PublicNavbar + Footer around the detail; cook
 *   mode is a full-screen overlay, so it gets the bare `<main>`); signed in,
 *   the app shell. The session lives in localStorage and resolves in the
 *   first effect, so until then those two routes paint an empty cream page
 *   instead of flashing the wrong chrome.
 * - everything else: the app shell (Mimo, sidebar, bottom tab bar…).
 */
export function RootShell({ pathname, isPublicRoute, children }: { pathname: string; isPublicRoute: boolean; children: ReactNode }) {
  const { user, isLoading } = useAuth()
  const recipeRoute = publicRecipeRoute(pathname)

  if (recipeRoute) {
    if (isLoading) return <main className="min-h-screen bg-[#FAF6EE]" aria-busy="true" />
    if (!user) {
      if (recipeRoute === "cook") {
        return (
          <main>
            <PageTransition>{children}</PageTransition>
          </main>
        )
      }
      return (
        <>
          <PublicNavbar />
          <main>
            <PageTransition>{children}</PageTransition>
          </main>
          <Footer />
          {/* Room for the recipe's sticky «Empezar a cocinar» bar (< lg), so the footer's last line clears it. */}
          <div aria-hidden className="h-[calc(84px+var(--safe-bottom))] bg-[#F2EDE0] lg:hidden" />
        </>
      )
    }
  }

  if (isPublicRoute) {
    return (
      <main>
        <PageTransition>{children}</PageTransition>
      </main>
    )
  }

  return (
    <MimoProvider>
      <OfflineBanner />
      <DesktopSidebar />
      <main className="standalone-pt mx-auto max-w-[430px] pb-[calc(5rem+var(--safe-bottom))] md:ml-[calc(var(--sidebar-width)+var(--sidebar-gap))] md:max-w-none md:mr-0 md:pb-0 lg:pr-[var(--mimo-panel-width,0px)] lg:transition-[padding] lg:duration-300">
        <SwipeNavigator>
          <PageTransition>{children}</PageTransition>
        </SwipeNavigator>
      </main>
      <Navbar />
      <FeedbackButton />
      <InstallSheet />
      <HealthConsentGate />
    </MimoProvider>
  )
}
