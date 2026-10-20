"use client"

import { useEffect, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { isBareRoute, loginHrefFor, needsAccount, signedOutChrome } from "@/lib/routeAccess"
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

/** Empty cream page while the session resolves or a redirect is on its way: never the wrong page for a frame. */
function Blank() {
  return <main className="min-h-screen bg-[#FAF6EE]" aria-busy="true" />
}

/** Signed out on a page that needs an account: off to `/login?next=<path+query>`. */
function ToLogin() {
  const router = useRouter()
  useEffect(() => {
    router.replace(loginHrefFor(`${window.location.pathname}${window.location.search}`))
  }, [router])
  return <Blank />
}

/**
 * Picks the page chrome and applies the one access rule (specs/auth.md →
 * "Public vs protected routes", specs/design-system.md → "Page shells"; the
 * lists live in lib/routeAccess.ts):
 *
 * - bare pages (`isBareRoute`: marketing, auth, onboarding…): a bare `<main>`;
 *   marketing pages add their PublicNavbar + Footer through
 *   `app/(public)/layout.tsx`.
 * - `/recipes`, `/recipes/<id>`, `/recipes/<id>/cook` and `/whatsapp/conectar`
 *   are open to everyone and depend on who is looking: signed out they get the
 *   public chrome (PublicNavbar + Footer; cook mode is a full-screen overlay,
 *   so it gets the bare `<main>`); signed in, the app shell.
 * - everything else needs an account: signed out → `/login?next=…`; signed
 *   in, the app shell (Mimo, sidebar, bottom tab bar…).
 *
 * The session lives in localStorage and resolves in the first effect, so
 * until then every page whose access or chrome depends on it paints an empty
 * cream page instead of flashing the wrong one.
 */
export function RootShell({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { user, isLoading } = useAuth()
  const privatePage = needsAccount(pathname)
  const openChrome = signedOutChrome(pathname)

  if (privatePage || openChrome) {
    if (isLoading) return <Blank />
    if (!user && privatePage) return <ToLogin />
    if (!user && openChrome === "fullscreen") {
      return (
        <main>
          <PageTransition>{children}</PageTransition>
        </main>
      )
    }
    if (!user && openChrome) {
      return (
        <>
          <PublicNavbar />
          <main>
            <PageTransition>{children}</PageTransition>
          </main>
          <Footer />
          {/* Room for the recipe's sticky «Empezar a cocinar» bar (< lg), so the footer's last line clears it. */}
          {openChrome === "recipe" && (
            <div aria-hidden className="h-[calc(84px+var(--safe-bottom))] bg-[#F2EDE0] lg:hidden" />
          )}
        </>
      )
    }
  }

  if (isBareRoute(pathname)) {
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
      <main className="standalone-pt mx-auto max-w-[430px] pb-[calc(9.5rem+var(--safe-bottom))] md:ml-[calc(var(--sidebar-width)+var(--sidebar-gap))] md:max-w-none md:mr-0 md:pb-0 lg:pr-[var(--mimo-panel-width,0px)] lg:transition-[padding] lg:duration-300">
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
