"use client"

import { Inter, Fraunces, Cormorant_Garamond, JetBrains_Mono } from "next/font/google"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider } from "@/lib/auth"
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration"
import { RootShell } from "@/components/shared/RootShell"
import { isRecipeSegment } from "@/lib/recipeShell"
import { isBareRoute } from "@/lib/routeAccess"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { recordVisit } from "@/lib/pwa/installPrompt"
import { reportInstalledOpen } from "@/lib/pwa/installedOpen"
import { scheduleMealReminders } from "@/lib/pwa/notifications"
import { installErrorReporter } from "@/lib/errorReporter"
import { CF_BEACON_SRC, cfBeaconAttr } from "@/lib/cfBeacon"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["300", "400", "500", "600", "700"],
})

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["SOFT", "opsz"],
})

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-cormorant",
  style: ["italic", "normal"],
  weight: ["300", "400", "500"],
})

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  weight: ["400"],
})

// Cookieless visit statistics (Cloudflare Web Analytics), only when the token is set at build time.
const CF_BEACON = cfBeaconAttr(process.env.NEXT_PUBLIC_CF_BEACON_TOKEN)

/** Pages that set their own title/description/canonical with Next's `metadata` (specs/blog.md, the recipe page's link preview in specs/recipes.md): the default tags below would duplicate them. */
const hasOwnMetadata = (pathname: string) => pathname === "/blog" || pathname.startsWith("/blog/") || isRecipeSegment(pathname)

const APPLE_SPLASH_IMAGES = [
  { src: "splash-2048x2732.png", w: 1024, h: 1366, dpr: 2 },
  { src: "splash-1668x2388.png", w: 834, h: 1194, dpr: 2 },
  { src: "splash-1536x2048.png", w: 768, h: 1024, dpr: 2 },
  { src: "splash-1290x2796.png", w: 430, h: 932, dpr: 3 },
  { src: "splash-1179x2556.png", w: 393, h: 852, dpr: 3 },
  { src: "splash-1170x2532.png", w: 390, h: 844, dpr: 3 },
  { src: "splash-1125x2436.png", w: 375, h: 812, dpr: 3 },
  { src: "splash-1242x2688.png", w: 414, h: 896, dpr: 3 },
] as const

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // Who may open which page and with which chrome: lib/routeAccess.ts (applied by RootShell).
  const isPublicRoute = isBareRoute(pathname)

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60 * 1000, retry: 1 },
        },
      })
  )

  useEffect(() => {
    // In-house error tracker (specs/errors.md): window errors + unhandled rejections.
    installErrorReporter()
    recordVisit()
    // PRO-83: count installed-app opens (aggregate only, once a day).
    reportInstalledOpen()
    scheduleMealReminders()
  }, [])

  return (
    <html
      lang="es"
      className={`${inter.variable} ${fraunces.variable} ${cormorant.variable} ${jetbrains.variable}`}
    >
      <head>
        {!hasOwnMetadata(pathname) && (
          <>
            <title>Mimoia — Tu semana de comidas, ya pensada</title>
            <meta name="description" content="Asistente nutricional en castellano. Te planifica el menú de la semana, te hace la lista de la compra y va recordando lo que vas aprendiendo sobre tu cuerpo." />
          </>
        )}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />

        {/* PWA manifest + theme */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content={isPublicRoute ? "#1A1612" : "#FAF6EE"} />

        {/* iOS PWA capabilities */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Mimoia" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />

        {CF_BEACON && <script defer src={CF_BEACON_SRC} data-cf-beacon={CF_BEACON} />}

        {/* iOS splash screens */}
        {APPLE_SPLASH_IMAGES.map((img) => (
          <link
            key={img.src}
            rel="apple-touch-startup-image"
            href={`/icons/${img.src}`}
            media={`(device-width: ${img.w}px) and (device-height: ${img.h}px) and (-webkit-device-pixel-ratio: ${img.dpr}) and (orientation: portrait)`}
          />
        ))}
      </head>
      <body>
        <ServiceWorkerRegistration />
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RootShell pathname={pathname}>
              {children}
            </RootShell>
          </AuthProvider>
        </QueryClientProvider>
      </body>
    </html>
  )
}
