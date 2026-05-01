"use client"

import { Inter, Fraunces, Cormorant_Garamond, JetBrains_Mono } from "next/font/google"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider } from "@/lib/auth"
import Navbar from "@/components/shared/Navbar"
import { useState } from "react"
import { usePathname } from "next/navigation"
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

  return (
    <html
      lang="es"
      className={`${inter.variable} ${fraunces.variable} ${cormorant.variable} ${jetbrains.variable}`}
    >
      <head>
        <title>ONA — El placer de cocinar sin pensar</title>
        <meta name="description" content="Tu menu semanal listo en 2 minutos. Con la lista de la compra incluida." />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <main className={!isPublicRoute ? "mx-auto max-w-[430px] pb-20" : ""}>
              {children}
            </main>
            {!isPublicRoute && <Navbar />}
          </AuthProvider>
        </QueryClientProvider>
      </body>
    </html>
  )
}
