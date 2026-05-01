"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { WifiOff } from "lucide-react"

export default function OfflineBanner() {
  const [mounted, setMounted] = useState(false)
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    setMounted(true)
    setIsOffline(!navigator.onLine)

    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  // Avoid SSR/hydration mismatch — only render banner contents after mount
  if (!mounted) return null

  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          key="offline-banner"
          role="status"
          aria-live="polite"
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ ease: [0.19, 1, 0.22, 1], duration: 0.3 }}
          className="fixed left-0 right-0 top-0 z-40 bg-warn-bg"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="mx-auto flex max-w-[430px] items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-warn-text">
            <WifiOff size={16} strokeWidth={2} />
            <span>Sin conexión</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
