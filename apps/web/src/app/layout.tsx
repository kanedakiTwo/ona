"use client"

import { Inter, Fraunces, Cormorant_Garamond, JetBrains_Mono } from "next/font/google"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider } from "@/lib/auth"
import Navbar from "@/components/shared/Navbar"
import OfflineBanner from "@/components/pwa/OfflineBanner"
import InstallSheet from "@/components/pwa/InstallSheet"
import VoiceProvider from "@/components/voice/VoiceProvider"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { recordVisit } from "@/lib/pwa/installPrompt"
import { scheduleMealReminders } from "@/lib/pwa/notifications"
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

const PUBLIC_ROUTES = ["/", "/como-funciona", "/por-que-ona", "/privacidad", "/terminos", "/login", "/register", "/onboarding"]

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
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname)

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60 * 1000, retry: 1 },
        },
      })
  )

  useEffect(() => {
    recordVisit()
    scheduleMealReminders()
  }, [])

  return (
    <html
      lang="es"
      className={`${inter.variable} ${fraunces.variable} ${cormorant.variable} ${jetbrains.variable}`}
    >
      <head>
        <title>ONA — El placer de cocinar sin pensar</title>
        <meta name="description" content="Tu menu semanal listo en 2 minutos. Con la lista de la compra incluida." />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />

        {/* PWA manifest + theme */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content={isPublicRoute ? "#1A1612" : "#FAF6EE"} />

        {/* iOS PWA capabilities */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="ONA" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />

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
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            {isPublicRoute ? (
              <main>{children}</main>
            ) : (
              <VoiceProvider>
                <OfflineBanner />
                <main className="standalone-pt mx-auto max-w-[430px] pb-20">
                  {children}
                </main>
                <Navbar />
                <InstallSheet />
              </VoiceProvider>
            )}
          </AuthProvider>
        </QueryClientProvider>
      </body>
    </html>
  )
}
