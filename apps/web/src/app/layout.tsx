"use client"

import { Inter, DM_Serif_Display, JetBrains_Mono } from "next/font/google"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider } from "@/lib/auth"
import Navbar from "@/components/shared/Navbar"
import { useState } from "react"
import { usePathname } from "next/navigation"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-body" })
const dmSerif = DM_Serif_Display({ weight: "400", subsets: ["latin"], variable: "--font-display" })
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: "400" })

// Public routes that show a different navbar (or none)
const PUBLIC_ROUTES = ["/", "/como-funciona", "/por-que-ona", "/privacidad", "/terminos"]

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
    <html lang="es" className={`${inter.variable} ${dmSerif.variable} ${jetbrains.variable}`}>
      <head>
        <title>ONA - Opinionated Nutritional Assistant</title>
        <meta name="description" content="Tu menu semanal listo en 2 minutos. Con la lista de la compra incluida." />
      </head>
      <body className="font-[family-name:var(--font-body)]">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            {!isPublicRoute && <Navbar />}
            <main>{children}</main>
          </AuthProvider>
        </QueryClientProvider>
      </body>
    </html>
  )
}
